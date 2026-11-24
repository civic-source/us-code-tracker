import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EvidenceSpan } from '@civic-source/types';
import { CanonicalWorkbenchCatalog, type LocalModelDraftReceipt } from '../lib/workbench-catalog.js';

const run = promisify(execFile);
const makeEvidence = (id: string): EvidenceSpan => ({
  schemaVersion: 'usct.evidence-span/v1', evidenceId: id, sourceSnapshotId: `snap-${id}`,
  artifactSha256: 'a'.repeat(64), locatorKind: 'uslm_id', locatorValue: '/us/usc/t18/s1001',
  excerpt: id, excerptSha256: createHash('sha256').update(id).digest('hex'), extractorVersion: '1',
});

async function writeCatalog(dir: string): Promise<string> {
  const catalog = new CanonicalWorkbenchCatalog();
  const boundary = { state: 'open' as const, precision: 'unknown' as const, conditions: [], basis: 'unestablished' as const, evidenceIds: [] };
  const result = catalog.ingestBundle({
    provisions: [{ schemaVersion: 'usct.provision/v1', provisionId: 'prov', jurisdiction: 'US', documentKind: 'usc_section', creationBasis: 'fixture', identityRegistryVersion: 1 }],
    provisionVersions: ['old', 'new'].map((version) => ({
      schemaVersion: 'usct.provision-version/v1', provisionVersionId: `pv-${version}`, provisionId: 'prov',
      normalizedContentHash: 'b'.repeat(64), normalizationVersion: '1', uscTitle: '18', uscChapter: '47', uscSection: '1001',
      heading: version, status: 'active', bodyMarkdown: version, sourceCredits: [], notes: [], tables: [], unsupportedStructures: [],
      evidenceIds: [`ev-${version}`], legacyDerived: false,
    })),
    memberships: ['old', 'new'].map((version) => ({
      schemaVersion: 'usct.snapshot-membership/v1', membershipId: `m-${version}`, sourceReleaseId: `rel-${version}`,
      provisionVersionId: `pv-${version}`, provisionId: 'prov', sourceOrder: 1,
      hierarchyPath: 'title-18/chapter-47/section-1001', sourceLocator: '/us/usc/t18/s1001',
    })),
    evidenceSpans: ['ev-old', 'ev-new', 'ev-old-assertion', 'ev-unaligned'].map(makeEvidence),
    applicabilityClaims: [{
      schemaVersion: 'usct.applicability-claim/v1', claimId: 'claim-new', targetProvisionVersionId: 'pv-new',
      applicabilityState: 'unknown', startBoundary: boundary, endBoundary: boundary, requiredContextFacts: [],
      evidenceIds: ['ev-new'], editorialReview: 'accepted', competingClaimIds: [],
    }],
    assertions: [
      { assertionId: 'as-new', subjectId: 'prov', applicabilityClaimIds: ['claim-new'], evidenceIds: ['ev-new'] },
      { assertionId: 'as-old', subjectId: 'pv-old', applicabilityClaimIds: [], evidenceIds: ['ev-old-assertion'] },
      { assertionId: 'as-unaligned', subjectId: 'prov', applicabilityClaimIds: [], evidenceIds: ['ev-unaligned'] },
    ].map((assertion) => ({
      ...assertion, schemaVersion: 'usct.legal-assertion/v1', relationType: 'cites', authorityKind: 'statute',
      extractionMethod: 'fixture', extractorVersion: '1', extractionState: 'verified', editorialReview: 'accepted', versionAlignmentState: 'verified',
    })),
  });
  if (!result.ok) throw result.error;
  const catalogPath = join(dir, 'catalog.json');
  await catalog.saveToFile(catalogPath);
  return catalogPath;
}

describe('Local Gemma CLI release and failure provenance', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'usct-gemma-provenance-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('limits release-scoped evidence to selected versions and aligned assertions', async () => {
    const catalogPath = await writeCatalog(dir);
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      requests.push(body);
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"paused"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const output = join(dir, 'release.json');
      await expect(run('pnpm', ['exec', 'tsx', 'scripts/workbench.ts', '--action', 'draft-note', '--catalog', catalogPath,
        '--provision', 'prov', '--release', 'rel-old', '--endpoint', `http://127.0.0.1:${port}/v1`, '--out', output],
      { cwd: process.cwd(), timeout: 30_000 })).rejects.toMatchObject({ code: 1 });
      const receipt = JSON.parse(await readFile(output, 'utf8')) as LocalModelDraftReceipt;
      expect(receipt.inputProvisionVersionIds).toEqual(['pv-old']);
      expect(receipt.inputEvidenceIds).toEqual(['ev-old', 'ev-old-assertion']);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain('ev-old-assertion');
      expect(requests[0]).not.toContain('ev-new');
      expect(requests[0]).not.toContain('ev-unaligned');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it('records the resolved Merlin model and context size in rejected failure receipts', async () => {
    const catalogPath = await writeCatalog(dir);
    const capabilitiesFile = join(dir, 'capabilities.json');
    const configPath = join(dir, 'config.json');
    const binary = join(dir, 'mock-merlin');
    const sentModel = join(dir, 'sent-model.json');
    await writeFile(capabilitiesFile, JSON.stringify({ profiles: { 'custom-model': { context_tokens: 8192 } } }));
    await writeFile(configPath, JSON.stringify({ schema_version: 1, gateway_host: 'models.example', gateway_port: 11435,
      ca_file: join(dir, 'ca.pem'), token_file: join(dir, 'token'), default_model: 'custom-model', capabilities_file: capabilitiesFile }));
    await writeFile(binary, [
      '#!/usr/bin/env node',
      'const fs = require("node:fs"); const args = process.argv.slice(2);',
      `fs.writeFileSync(${JSON.stringify(sentModel)}, JSON.stringify(args[args.indexOf('--model') + 1]));`,
      'console.log(JSON.stringify({status:"paused",error:{code:"admission_closed",message:"Paused"}})); process.exit(3);',
    ].join('\n'), { mode: 0o755 });
    const output = join(dir, 'failure.json');
    await expect(run('pnpm', ['exec', 'tsx', 'scripts/workbench.ts', '--action', 'draft-note', '--catalog', catalogPath,
      '--provision', 'prov', '--merlin-config', configPath, '--merlin-bin', binary, '--out', output],
    { cwd: process.cwd(), timeout: 30_000 })).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await readFile(sentModel, 'utf8'))).toBe('custom-model');
    const receipt = JSON.parse(await readFile(output, 'utf8')) as LocalModelDraftReceipt;
    expect(receipt.modelId).toBe('custom-model');
    expect(receipt.runtimeConfig).toMatchObject({ modelAlias: 'custom-model', numCtx: 8192, endpointKind: 'merlin_gateway' });
    expect(receipt).toMatchObject({ editorialReview: 'rejected', validationPassed: false, budget: { status: 'gateway_unavailable' } });
  }, 30_000);
});
