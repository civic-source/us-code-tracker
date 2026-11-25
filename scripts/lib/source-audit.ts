import { resolve } from 'node:path';
import { err, ok, type Result } from '@civic-source/types';
import { auditInventory, auditSource, requireAuditCommit, acceptedAuditInventory } from './source-audit-input.js';
import { auditJson, auditSha, freshAuditWriter } from './source-audit-io.js';
import { auditSourceInventory, type AuditSourceInventory, type AuditSourceRecord } from './source-audit-oracle.js';
import { auditBatch } from './source-audit-batch.js';
import { sourceAuditRecipe } from './source-audit-recipe.js';
import { loadAuditResume } from './source-audit-resume.js';
import { auditTransport } from './source-audit-transport.js';

export interface SourceAuditOptions {
  inventory: string; archive: string; dataRepository: string; acceptedRef: string;
  generatedAt: string; outputDirectory: string; sections?: string[]; all?: boolean; resumeFrom?: string; resumeSha256?: string;
}
type AuditRow = Record<string, unknown> & { candidatePass: boolean; index: number };
interface AuditSummary { selectedFragmentQualified: boolean; operationalFailures: boolean; manifestSha256: string }

function selectedRecords(options: SourceAuditOptions, source: AuditSourceInventory): AuditSourceRecord[] {
  if (options.all) return source.records;
  return options.sections!.map(section => {
    const matches = source.records.filter(record => record.section === section && record.identityState === 'canonical_single');
    if (matches.length !== 1) throw new Error(`Requested source section is absent, grouped or ambiguous: ${section}`);
    return matches[0]!;
  }).sort((a, b) => a.index - b.index);
}

function validateScope(options: SourceAuditOptions): void {
  if (Boolean(options.all) === Boolean(options.sections)) throw new Error('Choose exactly one of explicit sections or all inventory');
  if (options.sections && (!options.sections.length || new Set(options.sections).size !== options.sections.length
    || options.sections.some(section => !/^\d+[A-Za-z0-9-]*$/.test(section)))) throw new Error('Select distinct canonical section identifiers');
  const date = new Date(options.generatedAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== options.generatedAt) throw new Error('A fixed canonical generation timestamp is required');
}

async function initialize(options: SourceAuditOptions) {
  validateScope(options);
  const source = await auditInventory(options.inventory);
  await requireAuditCommit(options.dataRepository, options.acceptedRef);
  const xml = await auditSource(options.archive, source);
  const resume = await loadAuditResume({ ...(options.resumeFrom ? { directory: options.resumeFrom } : {}),
    ...(options.resumeSha256 ? { sha256: options.resumeSha256 } : {}) });
  const writer = await freshAuditWriter(resolve(options.outputDirectory));
  await writer.write('input.xml', xml);
  const sourceInventory = await auditSourceInventory(writer, source);
  const recipe = await sourceAuditRecipe(sourceInventory);
  const acceptedInventory = await acceptedAuditInventory(options.dataRepository, options.acceptedRef, source.title,
    sourceInventory.records.flatMap(record => record.path ? [record.path] : []));
  return { options, source, writer, sourceInventory, recipe, acceptedInventory, resume, selected: selectedRecords(options, sourceInventory) };
}
type AuditRun = Awaited<ReturnType<typeof initialize>>;

async function finish(run: AuditRun, records: AuditRow[], batches: unknown[]): Promise<AuditSummary> {
  const { options, writer, source, sourceInventory, recipe, acceptedInventory, selected, resume } = run;
  records.sort((a, b) => a.index - b.index);
  const operationalFailures = records.some(record => record.operationallyComplete === false);
  const selectedFragmentQualified = records.length > 0 && records.every(item => item.candidatePass)
    && (!options.all || acceptedInventory.extraPaths.length === 0);
  const manifest = { schemaVersion: 'usct.source-correction-audit/v1', state: 'renderer-fragment-audit', source, sourceInventory, recipe, acceptedInventory,
    scope: { mode: options.all ? 'all' : 'explicit', identifiers: selected.map(record => record.identifier) },
    acceptedRef: options.acceptedRef, generatedAt: options.generatedAt, selectedFragmentQualified, operationalFailures,
    completeInventoryFragmentQualified: Boolean(options.all) && selectedFragmentQualified, publisherAcquisitionVerified: false,
    dataAccepted: false, buildCompleted: false, deploymentVerified: false, batches, records, transport: await auditTransport(writer.root) };
  const bytes = auditJson(manifest);
  if (Buffer.byteLength(bytes) > 32 * 1024 ** 2) throw new Error('Canonical audit manifest exceeds 32 MiB');
  await writer.write('audit-manifest.json', bytes);
  await writer.write('audit-operation.json', auditJson({ reusedCandidates: resume.reusedCandidates, invalidatedCandidates: resume.invalidatedCandidates }));
  return { selectedFragmentQualified, operationalFailures, manifestSha256: auditSha(bytes) };
}

/** Stage independent diagnostics; accepted corpus, checkpoints, tags and publication state remain read-only. */
export async function auditSourceCorrection(options: SourceAuditOptions): Promise<Result<AuditSummary>> {
  try {
    const run = await initialize(options);
    const canonical = run.selected.filter(record => record.identityState === 'canonical_single');
    const records: AuditRow[] = [];
    const batches = [];
    for (let index = 0; index < canonical.length; index += 100) {
      const batch = await auditBatch(run.writer, { ...run, acceptedPaths: run.acceptedInventory.paths,
        records: canonical.slice(index, index + 100), name: `batch-${String(index / 100).padStart(4, '0')}` });
      records.push(...batch.records); batches.push(batch.manifest);
    }
    for (const record of run.selected.filter(record => record.identityState !== 'canonical_single')) {
      records.push({ ...record, candidatePass: false, storedPass: false, classification: 'identity_unresolved' });
    }
    return ok(await finish(run, records, batches));
  } catch (error: unknown) { return err(error instanceof Error ? error : new Error(String(error))); }
}
