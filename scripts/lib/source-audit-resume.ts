import { join, resolve } from 'node:path';
import type { SourceCorrectionCandidate } from './source-correction-candidate.js';
import type { AuditInventory } from './source-audit-input.js';
import type { AuditSourceRecord } from './source-audit-oracle.js';
import type { AuditRecipe } from './source-audit-recipe.js';
import { auditSha, readAuditInput } from './source-audit-io.js';
import { auditTransport, safeAuditRelative } from './source-audit-transport.js';

export interface ResumeCandidate { key: string; path: string; sha256: string; base: SourceCorrectionCandidate }
export interface AuditResumeState { candidates: Map<string, ResumeCandidate>; reusedCandidates: number; invalidatedCandidates: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function auditStagingKey(options: { source: AuditInventory; recipe: AuditRecipe; generatedAt: string;
  record: AuditSourceRecord; acceptedBytes: Buffer | null }): string {
  return auditSha(JSON.stringify({ source: options.source, recipeSha256: options.recipe.sha256,
    generatedAt: options.generatedAt, identifier: options.record.identifier, path: options.record.path,
    acceptedSha256: options.acceptedBytes === null ? null : auditSha(options.acceptedBytes) }));
}

interface ResumeRecord { identifier: string; candidatePath: string; candidateSha256: string; stagingKey: string; path: string }
function resumeRecord(value: Record<string, unknown>): ResumeRecord {
  if (typeof value.identifier !== 'string' || typeof value.candidatePath !== 'string' || !safeAuditRelative(value.candidatePath)
    || !digest(value.candidateSha256) || !digest(value.stagingKey) || typeof value.path !== 'string') {
    throw new Error('Invalid resume staging record');
  }
  return value as unknown as ResumeRecord;
}

function resumeProducer(batches: unknown[], record: ResumeRecord): SourceCorrectionCandidate {
  const matches = batches.filter(batch => object(batch) && typeof batch.name === 'string'
    && record.candidatePath === `${batch.name}-candidate/${record.path}`);
  if (matches.length !== 1 || !object(matches[0]) || !object(matches[0].candidate)) throw new Error('Resume candidate manifest is missing or ambiguous');
  const base = matches[0].candidate as unknown as SourceCorrectionCandidate;
  if (!Array.isArray(base.files) || base.files.filter(file => file.path === record.path && file.sha256 === record.candidateSha256).length !== 1) {
    throw new Error('Resume staging byte identity differs from its producer manifest');
  }
  return base;
}

function resumeCandidates(root: string, report: Record<string, unknown>): Map<string, ResumeCandidate> {
  if (!Array.isArray(report.records) || !Array.isArray(report.batches)) throw new Error('Resume report has no record/batch closure');
  const result = new Map<string, ResumeCandidate>();
  for (const value of report.records) {
    if (!object(value)) throw new Error('Malformed resume record');
    if (value.identityState !== 'canonical_single') continue;
    const record = resumeRecord(value);
    if (result.has(record.identifier)) throw new Error('Ambiguous resume staging record');
    result.set(record.identifier, { key: record.stagingKey, path: join(root, record.candidatePath),
      sha256: record.candidateSha256, base: resumeProducer(report.batches, record) });
  }
  return result;
}

export async function loadAuditResume(options: { directory?: string; sha256?: string }): Promise<AuditResumeState> {
  const empty = { candidates: new Map<string, ResumeCandidate>(), reusedCandidates: 0, invalidatedCandidates: 0 };
  if (Boolean(options.directory) !== Boolean(options.sha256)) throw new Error('Resume requires both prior directory and pinned manifest SHA-256');
  if (!options.directory) return empty;
  if (!digest(options.sha256)) throw new Error('Resume manifest SHA-256 is invalid');
  const root = resolve(options.directory);
  const bytes = await readAuditInput(join(root, 'audit-manifest.json'), 32 * 1024 ** 2);
  if (auditSha(bytes) !== options.sha256) throw new Error('Pinned resume manifest digest mismatch');
  const report: unknown = JSON.parse(bytes.toString('utf8'));
  if (!object(report) || report.schemaVersion !== 'usct.source-correction-audit/v1' || !Array.isArray(report.transport)) {
    throw new Error('Unsupported resume audit manifest');
  }
  const actual = await auditTransport(root);
  if (JSON.stringify(actual) !== JSON.stringify(report.transport)) throw new Error('Resume transport is missing, corrupt or has unexpected payloads');
  return { ...empty, candidates: resumeCandidates(root, report) };
}
