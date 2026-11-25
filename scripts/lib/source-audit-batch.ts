import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceCorrectionCandidate } from './source-correction-candidate.js';
import type { SourceAuditOptions } from './source-audit.js';
import type { AuditInventory } from './source-audit-input.js';
import { acceptedAuditBytes } from './source-audit-input.js';
import { auditCommand } from './source-audit-process.js';
import { auditJson, auditSha, readAuditInput, type AuditWriter } from './source-audit-io.js';
import { auditBody, auditDifference, auditRendered } from './source-audit-record.js';
import { auditBatchWitnesses, compactAuditWitness, type AuditCheck, type AuditSourceRecord } from './source-audit-oracle.js';
import type { AuditRecipe } from './source-audit-recipe.js';
import { auditStagingKey, type AuditResumeState, type ResumeCandidate } from './source-audit-resume.js';

interface BatchContext {
  options: SourceAuditOptions; source: AuditInventory; records: AuditSourceRecord[];
  name: string; recipe: AuditRecipe; resume: AuditResumeState;
  acceptedPaths: string[];
}
interface RecordInput { sourceRecord: AuditSourceRecord; old: Buffer | null; stagingKey: string; cached?: ResumeCandidate }

async function recordInputs(context: BatchContext): Promise<RecordInput[]> {
  const result = [];
  for (const sourceRecord of context.records) {
    const old = await acceptedAuditBytes(context.options.dataRepository, context.options.acceptedRef, sourceRecord.path!);
    const stagingKey = auditStagingKey({ source: context.source, recipe: context.recipe,
      generatedAt: context.options.generatedAt, record: sourceRecord, acceptedBytes: old });
    const previous = context.resume.candidates.get(sourceRecord.identifier!);
    const cached = previous?.key === stagingKey ? previous : undefined;
    if (previous && !cached) context.resume.invalidatedCandidates++;
    result.push({ sourceRecord, old, stagingKey, ...(cached ? { cached } : {}) });
  }
  return result;
}

function requireProducerIdentity(candidate: SourceCorrectionCandidate, context: BatchContext): void {
  const expected = { schemaVersion: 'usct.source-correction-candidate/v1', state: 'candidate',
    source: { sha256: context.source.member.sha256, byteLength: context.source.member.byteLength }, title: context.source.title,
    generatedAt: context.options.generatedAt, releaseLabel: context.source.releaseLabel,
    dependencyLockSha256: context.recipe.files['pnpm-lock.yaml'],
    candidateProducerSha256: context.recipe.files['scripts/lib/source-correction-candidate.ts'],
    compilerDistributions: context.recipe.compilerDistributions };
  const actual = { schemaVersion: candidate.schemaVersion, state: candidate.state, source: candidate.source,
    title: candidate.title, generatedAt: candidate.generatedAt, releaseLabel: candidate.releaseLabel,
    dependencyLockSha256: candidate.dependencyLockSha256, candidateProducerSha256: candidate.candidateProducerSha256,
    compilerDistributions: candidate.compilerDistributions };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Candidate producer identity differs from the pinned current recipe');
}

async function freshStage(writer: AuditWriter, context: BatchContext, inputs: RecordInput[]): Promise<SourceCorrectionCandidate> {
  const sections = inputs.map(item => item.sourceRecord.section!);
  await writer.reserve((sections.length + 1) * 2 * 1024 ** 2);
  const script = fileURLToPath(new URL('../prepare-source-correction.ts', import.meta.url));
  const result = await auditCommand(process.execPath, ['--max-old-space-size=2048', '--import', 'tsx', script,
    '--xml', join(writer.root, 'input.xml'), '--sha256', context.source.member.sha256, '--title', context.source.title,
    '--sections', sections.join(','), '--release', context.source.releaseLabel, '--generated-at', context.options.generatedAt,
    '--output', join(writer.root, `${context.name}-candidate`), '--purpose', 'bounded-audit']);
  await writer.adopt(`${context.name}-candidate`);
  await writer.write(`${context.name}-producer.stdout.txt`, result.stdout);
  await writer.write(`${context.name}-producer.stderr.txt`, result.stderr);
  if (result.code !== 0) throw new Error('Bounded source-correction producer failed; retained its diagnostics');
  const bytes = await readAuditInput(join(writer.root, `${context.name}-candidate/candidate-manifest.json`), 2 * 1024 ** 2);
  const candidate = JSON.parse(bytes.toString('utf8')) as SourceCorrectionCandidate;
  requireProducerIdentity(candidate, context);
  if (!Array.isArray(candidate.files) || candidate.files.length !== inputs.length
    || new Set(candidate.files.map(file => file.path)).size !== inputs.length
    || candidate.files.some(file => !inputs.some(item => item.sourceRecord.path === file.path))) {
    throw new Error('Candidate producer manifest did not close the requested staging scope');
  }
  return candidate;
}

async function stage(writer: AuditWriter, context: BatchContext, inputs: RecordInput[]): Promise<SourceCorrectionCandidate> {
  const fresh = inputs.filter(item => !item.cached);
  const base = fresh.length ? await freshStage(writer, context, fresh) : inputs[0]!.cached!.base;
  requireProducerIdentity(base, context);
  const files: SourceCorrectionCandidate['files'] = [];
  for (const input of inputs) {
    const path = input.sourceRecord.path!;
    if (input.cached) {
      const bytes = await readAuditInput(input.cached.path, 2 * 1024 ** 2);
      if (auditSha(bytes) !== input.cached.sha256) throw new Error('Pinned resume staging bytes changed before copying');
      await writer.write(`${context.name}-candidate/${path}`, bytes);
      files.push({ path, sha256: input.cached.sha256 });
      context.resume.reusedCandidates++;
    } else {
      const file = base.files.find(item => item.path === path);
      if (!file) throw new Error('Fresh candidate path is missing from producer manifest');
      files.push(file);
    }
  }
  const candidate = { ...base, sections: inputs.map(item => item.sourceRecord.section!).sort(),
    files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  await writer.write(`${context.name}-candidate-manifest.json`, auditJson(candidate));
  return candidate;
}

async function renderRecord(writer: AuditWriter, context: BatchContext, input: RecordInput, candidate: SourceCorrectionCandidate) {
  const { sourceRecord, old, stagingKey } = input;
  const path = sourceRecord.path!;
  const section = sourceRecord.section!;
  const entry = candidate.files.find(file => file.path === path);
  if (!entry) throw new Error('Candidate path differs from independent source mapping');
  const current = await readAuditInput(join(writer.root, `${context.name}-candidate`, path), 2 * 1024 ** 2);
  if (auditSha(current) !== entry.sha256) throw new Error('Candidate staged bytes differ from their manifest');
  const checks: AuditCheck[] = [{ id: `${section}-candidate`, identity: sourceRecord.identifier!,
    html: `records/${section}-candidate.html`, htmlSha256: await auditRendered(writer, `records/${section}-candidate.html`, current) }];
  if (old !== null) checks.push({ id: `${section}-stored`, identity: sourceRecord.identifier!,
    html: `records/${section}-stored.html`, htmlSha256: await auditRendered(writer, `records/${section}-stored.html`, old) });
  const label = old?.toString('utf8').match(/^current_through: (.+)$/m)?.[1];
  const acceptedReleaseMatches = old === null || label === context.source.releaseLabel || label === JSON.stringify(context.source.releaseLabel);
  const identityPaths = context.acceptedPaths.filter(path => path.endsWith(`/section-${section}.md`));
  const acceptedPathMatches = identityPaths.length <= 1 && identityPaths.every(item => item === path);
  return { record: { ...sourceRecord, stagingKey, difference: auditDifference(old, current), acceptedReleaseMatches, acceptedPathMatches,
    storedSha256: old === null ? null : auditSha(old), candidateSha256: auditSha(current),
    candidatePath: `${context.name}-candidate/${path}`, bodySha256: auditSha(auditBody(current)) }, checks };
}

function classification(state: { operationallyComplete: boolean; acceptedPathMatches: boolean; acceptedReleaseMatches: boolean;
  candidatePass: boolean; storedPass: boolean; missingStored: boolean }): string {
  if (!state.operationallyComplete) return 'comparison_inconclusive';
  if (!state.acceptedPathMatches) return 'accepted_path_conflict';
  if (!state.acceptedReleaseMatches) return 'accepted_release_mismatch';
  if (!state.candidatePass) return 'current_candidate_blocked';
  if (state.storedPass) return 'both_fragment_pass';
  return state.missingStored ? 'new_source_record_fragment_pass' : 'stored_failure_current_fragment_pass';
}

export async function auditBatch(writer: AuditWriter, context: BatchContext) {
  const inputs = await recordInputs(context);
  const candidate = await stage(writer, context, inputs);
  const rendered = [];
  for (const input of inputs) rendered.push(await renderRecord(writer, context, input, candidate));
  const witnesses = await auditBatchWitnesses(writer, { checks: rendered.flatMap(item => item.checks),
    sourceSha: context.source.member.sha256, batch: context.name });
  const records = rendered.map(({ record }) => {
    const current = witnesses.get(`${record.section}-candidate`)!;
    const stored = witnesses.get(`${record.section}-stored`);
    const operationallyComplete = current.exitCode !== 2 && stored?.exitCode !== 2;
    const candidatePass = current.pass && record.acceptedReleaseMatches && record.acceptedPathMatches && operationallyComplete;
    return { ...record, operationallyComplete, storedPass: stored?.pass ?? false, candidatePass,
      classification: classification({ operationallyComplete, acceptedPathMatches: record.acceptedPathMatches,
        acceptedReleaseMatches: record.acceptedReleaseMatches, candidatePass, storedPass: stored?.pass ?? false,
        missingStored: record.storedSha256 === null }),
      candidateWitness: compactAuditWitness(current), storedWitness: compactAuditWitness(stored) };
  });
  return { records, manifest: { name: context.name, sections: context.records.map(record => record.section!), candidate } };
}
