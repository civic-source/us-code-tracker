import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { ok, type EvidenceSpan } from '@civic-source/types';
import { CanonicalWorkbenchCatalog } from '../lib/workbench-catalog.js';
import {
  DEFAULT_MERLIN_MODEL,
  DEFAULT_MERLIN_NUM_CTX,
  buildFailureDraftReceipt,
  generateEvidenceBoundDraft,
  loadMerlinClientConfig,
} from '../lib/local-gemma-adapter.js';

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

const makeEvidenceSpan = (id: string, excerpt: string): EvidenceSpan => ({
  schemaVersion: 'usct.evidence-span/v1',
  evidenceId: id,
  sourceSnapshotId: `snap-${id}`,
  artifactSha256: 'a'.repeat(64),
  locatorKind: 'uslm_id',
  locatorValue: '/us/usc/t18/s1001/a',
  excerpt,
  excerptSha256: sha256(excerpt),
  extractorVersion: 'uslm-transformer-2.0.0',
});

describe('Local Gemma 4 Merlin & HTTP Transport Integration (USCT-024)', () => {
  let tmpDir: string;
  const execFileAsync = promisify(execFile);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usct-gemma-tr-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('scrubs bearer tokens across HTTP auth errors, 300-char snippets, and client config reads', async () => {
    const sentinel = 'sentinel-secret-token-value-1234567890';
    const span = makeEvidenceSpan('ev-1', '18 U.S.C. 1001');
    let seenAuth = '';
    const server = http.createServer((req, res) => {
      seenAuth = String(req.headers.authorization ?? '');
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid Authorization: Bearer ${sentinel} raw=${sentinel}` }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const envKey = 'USCT_TEST_MERLIN_SENTINEL_TOKEN';
    process.env[envKey] = sentinel;
    try {
      const addr = server.address() as { port: number };
      const res = await generateEvidenceBoundDraft({
        provisionId: 'prov-18-1001', question: 'Summarize', inputProvisionVersionIds: ['pv-1'],
        availableEvidenceSpans: [span], endpoint: `http://127.0.0.1:${addr.port}/v1`, tokenEnv: envKey,
      });
      expect(seenAuth).toBe(`Bearer ${sentinel}`);
      expect(!res.ok && res.error.kind === 'auth_error' && !res.error.message.includes(sentinel)).toBe(true);
      const rcpt = buildFailureDraftReceipt({
        modelId: DEFAULT_MERLIN_MODEL, inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span],
        runtimeConfig: { endpointKind: 'openai_compatible', modelAlias: DEFAULT_MERLIN_MODEL, numCtx: DEFAULT_MERLIN_NUM_CTX, maxOutputTokens: 1024, timeoutMs: 10_000 },
        budget: { deadlineMs: 10_000, elapsedMs: 10, maxOutputTokens: 1024, status: 'failed' },
        errorMessage: `Transport failed with Bearer ${sentinel}`, secrets: [sentinel],
      });
      expect(JSON.stringify(rcpt)).not.toContain(sentinel);
    } finally {
      delete process.env[envKey];
      await new Promise<void>((r) => server.close(() => r()));
    }

    const paddedBody = `${'x'.repeat(288)}${sentinel}${'y'.repeat(50)}`;
    const padRes = await generateEvidenceBoundDraft({
      provisionId: 'prov-18-1001', question: 'Summarize', inputProvisionVersionIds: ['pv-1'],
      availableEvidenceSpans: [span], token: sentinel,
      transport: async () => ok({ statusCode: 500, headers: {}, rawBody: paddedBody }),
    });
    expect(!padRes.ok && !padRes.error.message.includes(sentinel.slice(0, 12))).toBe(true);

    const caFile = path.join(tmpDir, 'ca.crt');
    const tokenFile = path.join(tmpDir, 'token');
    const cfgPath = path.join(tmpDir, 'config.json');
    await fs.writeFile(caFile, 'CERT', 'utf-8');
    await fs.writeFile(tokenFile, `${sentinel}\n`, { mode: 0o600 });
    await fs.writeFile(cfgPath, JSON.stringify({
      schema_version: 1, gateway_host: 'merlin-models.lab.example', gateway_port: 11435,
      ca_file: caFile, token_file: tokenFile, default_model: DEFAULT_MERLIN_MODEL, timeout_seconds: 180,
    }));
    const cfg = await loadMerlinClientConfig({ configPath: cfgPath });
    expect(cfg.ok && cfg.value.gatewayHost === 'merlin-models.lab.example' && !JSON.stringify(cfg.value).includes(sentinel)).toBe(true);
  });

  it('delegates Merlin requests via merlin-agent CLI, enforces override/file guards, and handles slow timeouts', async () => {
    const caFile = path.join(tmpDir, 'models-ca.crt');
    const tokenFile = path.join(tmpDir, 'token');
    const configPath = path.join(tmpDir, 'merlin-config.json');
    const mockBin = path.join(tmpDir, 'mock-merlin-agent');
    await fs.writeFile(caFile, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n', 'utf-8');
    await fs.writeFile(tokenFile, 'test-token-value-123456789012345678901234\n', { mode: 0o600 });
    await fs.writeFile(configPath, JSON.stringify({
      schema_version: 1, gateway_host: 'merlin-models.lab.example', gateway_port: 11435,
      ca_file: caFile, token_file: tokenFile, default_model: DEFAULT_MERLIN_MODEL, timeout_seconds: 120,
    }));
    await fs.writeFile(mockBin, [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const args = process.argv.slice(2);',
      'const prompt = JSON.stringify(JSON.parse(fs.readFileSync(args[args.indexOf("--task") + 1], "utf8")).messages);',
      'if (prompt.includes("SIM_SLEEP")) { setTimeout(() => {}, 5000); return; }',
      'if (prompt.includes("SIM_PAUSED")) { console.log(JSON.stringify({ schema_version: 1, status: "paused", error: { code: "admission_closed", message: "Paused" } })); process.exit(3); }',
      'if (prompt.includes("SIM_LENGTH")) { console.log(JSON.stringify({ schema_version: 1, status: "budget_exhausted", content: "{\\"partial\\":true", finish_reason: "length" })); process.exit(4); }',
      'if (prompt.includes("SIM_AUTH")) { console.log(JSON.stringify({ schema_version: 1, status: "incompatible", error: { code: "authentication", message: "Bad token" } })); process.exit(2); }',
      'console.log(JSON.stringify({ schema_version: 1, status: "completed", finish_reason: "stop", prompt_tokens: 90, completion_tokens: 35, content: JSON.stringify({ draftSummary: "Merlin summary.", claims: [{ statement: "Grounded.", citedEvidenceIds: ["ev-m1"], supportStatus: "supported" }], unresolvedQuestions: [] }) }));',
    ].join('\n'), { mode: 0o755 });

    const span = makeEvidenceSpan('ev-m1', '18 U.S.C. 1001 text');
    const okRes = await generateEvidenceBoundDraft({
      provisionId: 'prov-18-1001', question: 'Normal', inputProvisionVersionIds: ['pv-1'],
      availableEvidenceSpans: [span], merlinConfig: configPath, merlinBin: mockBin,
    });
    expect(okRes.ok && okRes.value.validationPassed && okRes.value.budget?.promptTokens === 90).toBe(true);

    const paused = await generateEvidenceBoundDraft({ provisionId: 'p', question: 'SIM_PAUSED', inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span], merlinConfig: configPath, merlinBin: mockBin });
    expect(!paused.ok && paused.error.kind === 'gateway_unavailable').toBe(true);

    const trunc = await generateEvidenceBoundDraft({ provisionId: 'p', question: 'SIM_LENGTH', inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span], merlinConfig: configPath, merlinBin: mockBin });
    expect(!trunc.ok && trunc.error.kind === 'budget_exhausted').toBe(true);

    const auth = await generateEvidenceBoundDraft({ provisionId: 'p', question: 'SIM_AUTH', inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span], merlinConfig: configPath, merlinBin: mockBin });
    expect(!auth.ok && auth.error.kind === 'auth_error').toBe(true);

    const slow = await generateEvidenceBoundDraft({ provisionId: 'p', question: 'SIM_SLEEP', inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span], merlinConfig: configPath, merlinBin: mockBin, timeoutMs: 80 });
    expect(!slow.ok && slow.error.kind === 'budget_exhausted').toBe(true);

    const merlinOverride = await generateEvidenceBoundDraft({ provisionId: 'p', question: 'Q', inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span], merlinConfig: configPath, merlinBin: mockBin, caFile });
    expect(!merlinOverride.ok && merlinOverride.error.kind === 'invalid_config').toBe(true);

    const epFile = await generateEvidenceBoundDraft({ provisionId: 'p', question: 'Q', inputProvisionVersionIds: ['pv-1'], availableEvidenceSpans: [span], endpoint: 'http://127.0.0.1:11434/v1', tokenFile });
    expect(!epFile.ok && epFile.error.kind === 'invalid_config').toBe(true);
  });

  it('runs workbench CLI --action draft-note cleanly on 200 and fails closed on 503 without mutating catalog', async () => {
    const span = makeEvidenceSpan('ev-18-1001-cli', 'Whoever knowingly and willfully falsifies a material fact...');
    const catalog = new CanonicalWorkbenchCatalog();
    catalog.ingestBundle({
      provisions: [{ schemaVersion: 'usct.provision/v1', provisionId: 'prov-18-1001', jurisdiction: 'US', documentKind: 'usc_section', creationBasis: 'olrc_uslm_id:/us/usc/t18/s1001', identityRegistryVersion: 1 }],
      provisionVersions: [{ schemaVersion: 'usct.provision-version/v1', provisionVersionId: 'pv-18-1001-curr', provisionId: 'prov-18-1001', normalizedContentHash: 'b'.repeat(64), normalizationVersion: '1.0.0', uscTitle: '18', uscChapter: '47', uscSection: '1001', heading: '§ 1001. Statements generally', status: 'active', bodyMarkdown: 'Whoever knowingly...', sourceCredits: [], notes: [], tables: [], unsupportedStructures: [], evidenceIds: ['ev-18-1001-cli'], legacyDerived: false }],
      evidenceSpans: [span],
    });
    const catalogPath = path.join(tmpDir, 'catalog.json');
    await catalog.saveToFile(catalogPath);
    const beforeCatalog = await fs.readFile(catalogPath, 'utf-8');

    let mode: 'ok' | '503' = 'ok';
    const server = http.createServer((_req, res) => {
      if (mode === '503') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'merlin_paused', message: 'Paused' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'c', object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ draftSummary: 'Prohibited.', claims: [{ statement: 'Prohibited.', citedEvidenceIds: ['ev-18-1001-cli'], supportStatus: 'supported' }], unresolvedQuestions: [] }) } }],
      }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const addr = server.address() as { port: number };
      const endpoint = `http://127.0.0.1:${addr.port}/v1`;
      const okOut = path.join(tmpDir, 'draft-ok.json');
      await execFileAsync('pnpm', ['exec', 'tsx', 'scripts/workbench.ts', '--action', 'draft-note', '--catalog', catalogPath, '--provision', 'prov-18-1001', '--endpoint', endpoint, '--out', okOut], { cwd: process.cwd(), timeout: 30_000 });
      const okReceipt = JSON.parse(await fs.readFile(okOut, 'utf-8')) as { validationPassed: boolean; extractionState: string; editorialReview: string };
      expect(okReceipt).toMatchObject({ validationPassed: true, extractionState: 'candidate', editorialReview: 'unreviewed' });

      mode = '503';
      const failOut = path.join(tmpDir, 'draft-503.json');
      let exitedNonZero = false;
      try {
        await execFileAsync('pnpm', ['exec', 'tsx', 'scripts/workbench.ts', '--action', 'draft-note', '--catalog', catalogPath, '--provision', 'prov-18-1001', '--endpoint', endpoint, '--out', failOut], { cwd: process.cwd(), timeout: 30_000 });
      } catch { exitedNonZero = true; }
      expect(exitedNonZero).toBe(true);
      const failReceipt = JSON.parse(await fs.readFile(failOut, 'utf-8')) as { validationPassed: boolean; editorialReview: string; budget?: { status?: string } };
      expect(failReceipt.validationPassed).toBe(false);
      expect(failReceipt.editorialReview).toBe('rejected');
      expect(failReceipt.budget?.status).toBe('gateway_unavailable');
      expect(await fs.readFile(catalogPath, 'utf-8')).toBe(beforeCatalog);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 30_000);
});
