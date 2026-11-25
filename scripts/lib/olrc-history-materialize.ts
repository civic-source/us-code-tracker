import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { XmlToMarkdownAdapter } from '@civic-source/transformer';
import { err, ok, ProvisionVersionSchema, type ProvisionVersion, type Result } from '@civic-source/types';
import { renderHistoricalSource } from '../../apps/web/src/lib/historical-source-renderer.js';
import { historicalRecordDigest } from './historical-qualification.js';
import { readPinnedOlrcEdition, type HistoricalSourcePin } from './olrc-historical-sources.js';

const execute = promisify(execFile);
function repositoryRoot(): string {
  for (const candidate of [process.cwd(), resolve(process.cwd(), '../..')]) {
    if (existsSync(join(candidate, 'pnpm-lock.yaml')) && existsSync(join(candidate, 'scripts/lib/olrc-history-materialize.ts'))) return candidate;
  }
  throw new Error('Historical replay requires the reviewed source checkout at the workspace root or apps/web working directory');
}
const root = repositoryRoot();
export const PILOT_SECTIONS = ['1001', '111', '1114'] as const;
const recipeFiles = [
  'pnpm-lock.yaml', 'scripts/lib/olrc-history-materialize.ts',
  'scripts/python/olrc_source_sections.py', 'scripts/python/uslm_fidelity.py',
  'apps/web/src/lib/historical-source-renderer.ts', 'apps/web/src/lib/subsection-anchors.ts',
  ...['constants', 'transformer', 'parser', 'markdown-generator', 'xml-utils', 'markdown-format', 'rich-structure']
    .map((name) => `packages/transformer/src/${name}.ts`),
];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function historicalRecipeDigest(): Promise<string> {
  const hashes = await Promise.all(recipeFiles.map(async (path) => `${path}:${digest(await readFile(join(root, path), 'utf8'))}`));
  return digest(hashes.join('\n'));
}

/** Compilation is unqualified until the original full-member oracle and reviewed pins agree. */
export async function compileHistoricalSection(options: {
  xml: string; releaseId: string; section: string;
}): Promise<Result<Pick<ProvisionVersion, 'bodyMarkdown' | 'sourceCredits' | 'notes' | 'tables' | 'unsupportedStructures'> & { renderedHtml: string }>> {
  if (!/^pl-119-(73|142)$/.test(options.releaseId) || !PILOT_SECTIONS.some((item) => item === options.section)) {
    return err(new Error('Section is outside the explicitly qualified historical pilot'));
  }
  const compiled = new XmlToMarkdownAdapter(options.releaseId.replace('pl-', 'PL ')).transformToFiles(options.xml);
  if (!compiled.ok) return compiled;
  const matches = compiled.value.filter((file) => file.uslmIdentifier === `/us/usc/t18/s${options.section}`);
  if (matches.length !== 1) return err(new Error('Historical section output is missing or ambiguous'));
  const bodyMarkdown = matches[0]!.content.replace(/^---\n[\s\S]*?\n---\n/, '');
  const file = matches[0]!;
  try { return ok({ bodyMarkdown, renderedHtml: await renderHistoricalSource(bodyMarkdown),
    ...sectionStructures(file) }); }
  catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
}

function sectionStructures(file: { notes?: ProvisionVersion['notes']; tables?: ProvisionVersion['tables'];
  sourceCredits?: string[]; unsupportedStructures?: ProvisionVersion['unsupportedStructures'] }) {
  return { notes: file.notes ?? [], tables: file.tables ?? [], sourceCredits: file.sourceCredits ?? [],
    unsupportedStructures: file.unsupportedStructures ?? [] };
}

interface SectionMetadata { section: string; chapter: string; identifier: string; heading: string }
function sectionMetadata(raw: string): SectionMetadata[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('sections' in parsed) || !Array.isArray(parsed.sections) ||
    !('canonicalProvisionCount' in parsed) || parsed.canonicalProvisionCount !== 1399) throw new Error('Unexpected source inventory');
  return parsed.sections.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid section metadata');
    const record = item as Record<string, unknown>;
    for (const key of ['section', 'chapter', 'identifier', 'heading']) {
      if (typeof record[key] !== 'string' || !record[key]) throw new Error('Missing section metadata');
    }
    return { section: String(record.section), chapter: String(record.chapter), identifier: String(record.identifier), heading: String(record.heading) };
  });
}

export interface HistoricalMaterialization { version: ProvisionVersion; witness: string; recordSha256: string }

async function materializeSection(options: {
  source: HistoricalSourcePin; xml: string; directory: string; metadata: SectionMetadata; recipe: string;
}): Promise<HistoricalMaterialization> {
  const { source, metadata } = options;
  const compiled = await compileHistoricalSection({ xml: options.xml, releaseId: source.releaseId, section: metadata.section });
  if (!compiled.ok) throw compiled.error;
  const htmlPath = join(options.directory, `${metadata.section}.html`);
  await writeFile(htmlPath, compiled.value.renderedHtml, { flag: 'wx' });
  const result = await execute('python3', [join(root, 'scripts/python/uslm_fidelity.py'),
    '--xml', join(options.directory, 'usc18.xml'), '--html', htmlPath, '--section', metadata.identifier,
    '--expected-source-sha256', source.member.sha256, '--fragment'], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const witness: unknown = JSON.parse(result.stdout);
  if (!witness || typeof witness !== 'object' || !('accepted' in witness) || witness.accepted !== true ||
    !('source_xml_sha256' in witness) || witness.source_xml_sha256 !== source.member.sha256 ||
    !('html_sha256' in witness) || witness.html_sha256 !== digest(compiled.value.renderedHtml)) {
    throw new Error('Independent full-source rendering witness refused the historical section');
  }
  const qualification = { schemaVersion: 'usct.historical-source-qualification/v1', releaseId: source.releaseId,
    archiveSha256: source.archive.sha256, memberName: 'usc18.xml', memberSha256: source.member.sha256,
    sectionIdentifier: metadata.identifier, recipeSha256: options.recipe,
    markdownSha256: digest(compiled.value.bodyMarkdown), htmlSha256: digest(compiled.value.renderedHtml),
    witnessSha256: digest(result.stdout), scope: 'text-lanes-and-list-placement-v1' };
  const identity = digest(JSON.stringify(qualification));
  const version = ProvisionVersionSchema.parse({ provisionVersionId: `pv-olrc-pilot-${identity}`,
    provisionId: `prov-18-${metadata.section}`, normalizedContentHash: qualification.markdownSha256,
    normalizationVersion: 'pinned-olrc-history-v1', uslmIdentifier: metadata.identifier,
    uscTitle: '18', uscChapter: metadata.chapter, uscSection: metadata.section, heading: metadata.heading,
    status: 'active', ...compiled.value, sourceQualification: qualification });
  return { version, witness: result.stdout, recordSha256: historicalRecordDigest(version) };
}

/** No candidate is publishable merely because it can be compiled; catalog admission checks reviewed pins. */
export async function materializePinnedHistory(options: {
  cacheDir: string;
}): Promise<Result<HistoricalMaterialization[]>> {
  const output: HistoricalMaterialization[] = [];
  const recipe = await historicalRecipeDigest();
  for (const releaseId of ['pl-119-73', 'pl-119-142']) {
    const edition = await readPinnedOlrcEdition({ cacheDir: options.cacheDir, releaseId });
    if (!edition.ok) return edition;
    const directory = await mkdtemp(join(tmpdir(), 'usct-history-'));
    try {
      await writeFile(join(directory, 'usc18.xml'), edition.value.xml, { flag: 'wx' });
      const metadata = await execute('python3', [join(root, 'scripts/python/olrc_source_sections.py'),
        '--xml', join(directory, 'usc18.xml'), '--sha256', edition.value.source.member.sha256,
        ...PILOT_SECTIONS.flatMap((section) => ['--section', section])], { timeout: 30_000, maxBuffer: 2 * 1024 ** 2 });
      for (const section of sectionMetadata(metadata.stdout)) output.push(await materializeSection({
        source: edition.value.source, xml: edition.value.xml, directory, metadata: section, recipe }));
    } catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
    finally { await rm(directory, { recursive: true }); }
  }
  return ok(output);
}
