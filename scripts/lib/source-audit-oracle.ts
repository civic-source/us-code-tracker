import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditInventory } from './source-audit-input.js';
import { auditCommand } from './source-audit-process.js';
import { auditJson, auditSha, type AuditWriter } from './source-audit-io.js';

export interface AuditSourceRecord {
  index: number; identifier: string | null; section: string | null; chapter: string | null;
  identityState: string; path: string | null; locator: string;
}
export interface AuditSourceInventory {
  schemaVersion: string; source_xml_sha256: string; title: string; releaseLabel: string;
  topLevelSourceRecords: number; rawSectionNodes: number; excludedNestedSections: number;
  normalizationUnicodeVersion: string; pythonRuntimeVersion: string; records: AuditSourceRecord[];
}
export interface AuditCheck { id: string; identity: string; html: string; htmlSha256: string }
export interface AuditWitness { pass: boolean; exitCode: number; report: Record<string, unknown> }
const helper = fileURLToPath(new URL('../python/uslm_fidelity_batch.py', import.meta.url));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function canonicalSourceMapping(value: Record<string, unknown>, title: string): boolean {
  return typeof value.section === 'string' && typeof value.chapter === 'string'
    && /^[0-9]+[A-Za-z]*$/.test(value.section) && /^[A-Za-z0-9-]+$/.test(value.chapter)
    && value.identifier === `/us/usc/t${title}/s${value.section}`
    && value.path === `statutes/title-${title}/chapter-${value.chapter}/section-${value.section}.md`;
}

function sourceRecord(value: unknown, index: number, title: string): AuditSourceRecord {
  if (!object(value) || value.index !== index || typeof value.identityState !== 'string' || typeof value.locator !== 'string') {
    throw new Error('Malformed source inventory record');
  }
  if (![value.identifier, value.section, value.chapter, value.path].every(item => item === null || typeof item === 'string')) {
    throw new Error('Malformed source inventory identity fields');
  }
  if (value.identityState === 'canonical_single' && !canonicalSourceMapping(value, title)) throw new Error('Canonical source inventory path or identity mismatch');
  return value as unknown as AuditSourceRecord;
}

function inventoryRuntime(value: Record<string, unknown>): boolean {
  return [value.normalizationUnicodeVersion, value.pythonRuntimeVersion].every(version => typeof version === 'string');
}

function inventoryCountClosure(value: Record<string, unknown>): boolean {
  const counts = [value.topLevelSourceRecords, value.rawSectionNodes, value.excludedNestedSections];
  return counts.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    && Number(value.topLevelSourceRecords) + Number(value.excludedNestedSections) === value.rawSectionNodes;
}

function sourceInventoryEnvelope(value: unknown, source: AuditInventory): asserts value is Record<string, unknown> & { records: unknown[] } {
  if (!object(value) || value.schemaVersion !== 'usct.source-fidelity-inventory/v1'
    || value.source_xml_sha256 !== source.member.sha256 || value.title !== source.title || value.releaseLabel !== source.releaseLabel) {
    throw new Error('Malformed full-source inventory identity');
  }
  if (!Array.isArray(value.records) || value.records.length !== value.topLevelSourceRecords
    || !inventoryRuntime(value)) {
    throw new Error('Malformed full-source inventory coverage/runtime');
  }
  if (!inventoryCountClosure(value)) throw new Error('Source inventory count closure mismatch');
}

export async function auditSourceInventory(writer: AuditWriter, source: AuditInventory): Promise<AuditSourceInventory> {
  const run = await auditCommand('python3', ['-B', helper, '--xml', join(writer.root, 'input.xml'),
    '--expected-source-sha256', source.member.sha256, '--inventory', '--title', source.title, '--release', source.releaseLabel],
  { maxBuffer: 32 * 1024 ** 2 });
  await writer.write('inventory.stdout.json', run.stdout);
  await writer.write('inventory.stderr.txt', run.stderr);
  if (run.code !== 0) throw new Error('Full-source inventory failed; retained its diagnostics');
  const value: unknown = JSON.parse(run.stdout.toString('utf8'));
  sourceInventoryEnvelope(value, source);
  const records = value.records.map((item, index) => sourceRecord(item, index, source.title));
  return { ...value, records } as unknown as AuditSourceInventory;
}

function witnessIdentity(report: Record<string, unknown>, check: AuditCheck, sourceSha: string): boolean {
  return report.section === check.identity && report.source_xml_sha256 === sourceSha && report.html_sha256 === check.htmlSha256
    && report.html_kind === 'renderer_fragment' && report.scope === 'text-lanes-and-list-placement-v1';
}

function emptyWitnessIssues(report: Record<string, unknown>): boolean {
  return Array.isArray(report.issues) && report.issues.length === 0
    && Array.isArray(report.unknown_elements) && report.unknown_elements.length === 0;
}

function witnessEnvelope(value: unknown, id: string): asserts value is { id: string; exitCode: number; result: Record<string, unknown> } {
  if (!object(value) || value.id !== id || typeof value.exitCode !== 'number'
    || ![0, 1, 2].includes(value.exitCode) || !object(value.result)) throw new Error('Malformed or missing independent batch witness');
}

function witness(value: unknown, check: AuditCheck, sourceSha: string): AuditWitness {
  witnessEnvelope(value, check.id);
  const report = value.result;
  if (value.exitCode !== 2 && !witnessIdentity(report, check, sourceSha)) throw new Error('Independent witness identity differs from selected bytes');
  const pass = value.exitCode === 0 && report.accepted === true && emptyWitnessIssues(report);
  if (value.exitCode === 0 && !pass) throw new Error('Independent witness returned inconsistent acceptance');
  return { pass, exitCode: value.exitCode, report };
}

export async function auditBatchWitnesses(writer: AuditWriter, options: { checks: AuditCheck[]; sourceSha: string; batch: string }) {
  const manifest = `${options.batch}-checks.json`;
  await writer.write(manifest, auditJson({ schemaVersion: 'usct.fidelity-batch/v1', checks: options.checks.map(check => ({
    id: check.id, section: check.identity, html: check.html, fragment: true })) }));
  const run = await auditCommand('python3', ['-B', helper, '--xml', join(writer.root, 'input.xml'),
    '--expected-source-sha256', options.sourceSha, '--manifest', join(writer.root, manifest)], { maxBuffer: 32 * 1024 ** 2 });
  await writer.write(`${options.batch}.stdout.json`, run.stdout);
  await writer.write(`${options.batch}.stderr.txt`, run.stderr);
  const value: unknown = JSON.parse(run.stdout.toString('utf8'));
  if (!object(value) || value.source_xml_sha256 !== options.sourceSha || !Array.isArray(value.checks)
    || value.checks.length !== options.checks.length) throw new Error('Independent batch did not close the selected witness scope');
  const result = new Map<string, AuditWitness>();
  for (const [index, check] of options.checks.entries()) {
    const packet = witness(value.checks[index], check, options.sourceSha);
    await writer.write(`records/${check.id}-witness.json`, auditJson(packet));
    result.set(check.id, packet);
  }
  if (run.code !== Math.max(...[...result.values()].map(packet => packet.exitCode))) throw new Error('Independent batch exit/status disagreement');
  return result;
}

export function compactAuditWitness(value: AuditWitness | undefined) {
  if (!value) return null;
  const bytes = auditJson(value);
  return { pass: value.pass, exitCode: value.exitCode, sha256: auditSha(bytes),
    canonicalTextSha256: value.report.canonical_text_sha256 ?? null, wordCounts: value.report.word_counts ?? null,
    issues: value.report.issues ?? [], unknownElements: value.report.unknown_elements ?? [],
    ...(value.report.error ? { error: value.report.error } : {}) };
}
