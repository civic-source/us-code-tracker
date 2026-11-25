import { createHash } from 'node:crypto';
import { mkdir, open, lstat, readdir, readFile, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XmlToMarkdownAdapter, parseUslmXml, findElements, extractTextFromNodes } from '@civic-source/transformer';
import { normalizeUscTitle } from '@civic-source/shared';
import { err, ok, type Result } from '@civic-source/types';

const MAX_XML_BYTES = 128 * 1024 * 1024;
const OUTPUT_RESERVE_BYTES = 16 * 1024 * 1024;

export interface SourceCorrectionOptions {
  sourceXml: string;
  expectedSha256: string;
  title: string;
  sections: string[];
  releaseLabel: string;
  generatedAt: string;
  outputDirectory: string;
}

export interface SourceCorrectionCandidate {
  schemaVersion: 'usct.source-correction-candidate/v1';
  state: 'candidate';
  source: { sha256: string; byteLength: number };
  title: string;
  sections: string[];
  releaseLabel: string;
  generatedAt: string;
  compilerDistributions: Record<string, string>;
  dependencyLockSha256: string;
  candidateProducerSha256: string;
  files: Array<{ path: string; sha256: string }>;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateOptions(options: SourceCorrectionOptions): void {
  if (!/^[0-9a-f]{64}$/.test(options.expectedSha256)) throw new Error('Expected XML SHA-256 is required');
  if (normalizeUscTitle(options.title) !== options.title) throw new Error('A canonical title is required');
  if (!options.sections.length || options.sections.length > 100
    || options.sections.some((s) => !/^\d+[A-Za-z0-9-]*$/.test(s))
    || new Set(options.sections).size !== options.sections.length) {
    throw new Error('Scope must contain 1–100 distinct whole section identifiers');
  }
  if (!/^PL \d+-\d+(?:not\d+)*$/.test(options.releaseLabel)) throw new Error('Publisher release label is required');
  const date = new Date(options.generatedAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== options.generatedAt) {
    throw new Error('A fixed canonical ISO generation timestamp is required');
  }
}

async function readPinnedXml(options: SourceCorrectionOptions): Promise<Buffer> {
  const file = await open(options.sourceXml, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new Error('Source XML must be a regular file');
    const chunks: Buffer[] = [];
    let length = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65_536, MAX_XML_BYTES + 1 - length));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > MAX_XML_BYTES) throw new Error('Source XML exceeds 128 MiB');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== options.expectedSha256) throw new Error('Pinned XML SHA-256 mismatch');
    return bytes;
  } finally {
    await file.close();
  }
}

async function compilerDistributions(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of ['@civic-source/transformer', '@civic-source/shared', '@civic-source/types']) {
    const directory = dirname(fileURLToPath(import.meta.resolve(name)));
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name).sort();
    if (!entries.length) throw new Error(`Built compiler distribution is missing: ${name}`);
    const digest = createHash('sha256');
    for (const entry of entries) digest.update(`${entry}\0`).update(await readFile(join(directory, entry))).update('\0');
    result[name] = digest.digest('hex');
  }
  return result;
}

async function requireFreshOutput(output: string): Promise<void> {
  try {
    await lstat(output);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Output already exists; choose a fresh candidate directory');
}

function selectedFiles(xml: string, options: SourceCorrectionOptions): Array<{ path: string; content: string }> {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD and entity declarations are prohibited');
  requireSourceRelease(xml, options.releaseLabel);
  const result = new XmlToMarkdownAdapter(options.releaseLabel).transformToFiles(xml);
  if (!result.ok) throw result.error;
  return [...options.sections].sort().map((section) => {
    const identity = `/us/usc/t${options.title}/s${section}`;
    const matches = result.value.filter((file) => file.uslmIdentifier === identity);
    if (matches.length !== 1) throw new Error(`Selected section is absent or ambiguous: ${identity}`);
    const file = matches[0]!;
    if (!/^statutes\/title-[\da-z]+\/chapter-[A-Za-z0-9-]+\/section-[A-Za-z0-9-]+\.md$/.test(file.path)) {
      throw new Error('Compiler returned an unsafe candidate path');
    }
    if (!/^generated_at: .+$/m.test(file.content)) throw new Error('Compiler generation timestamp field is missing');
    const content = file.content.replace(/^generated_at: .+$/m, `generated_at: "${options.generatedAt}"`);
    return { path: file.path, content };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function requireSourceRelease(xml: string, release: string): void {
  const parsed = parseUslmXml(xml);
  if (!parsed.ok) throw parsed.error;
  const documents = [...findElements(parsed.value.root, 'uscDoc'), ...findElements(parsed.value.root, 'lawDoc')];
  if (documents.length !== 1) throw new Error('Source document identity is missing or ambiguous');
  const metadata = findElements(documents[0]!.children, 'meta');
  if (metadata.length !== 1) throw new Error('Source publication metadata is missing or ambiguous');
  const publications = findElements(metadata[0]!.children, 'docPublicationName');
  if (publications.length !== 1 || extractTextFromNodes(publications[0]!.children) !== `Online@${release.slice(3)}`) {
    throw new Error('Requested release differs from the source publication identity');
  }
}

/** Stage a replayable candidate; validation and publication are separate operations. */
export async function prepareSourceCorrection(options: SourceCorrectionOptions): Promise<Result<SourceCorrectionCandidate>> {
  try {
    validateOptions(options);
    const output = resolve(options.outputDirectory);
    await requireFreshOutput(output);
    const bytes = await readPinnedXml(options);
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const files = selectedFiles(xml, options);
    const candidate: SourceCorrectionCandidate = {
      schemaVersion: 'usct.source-correction-candidate/v1', state: 'candidate',
      source: { sha256: sha256(bytes), byteLength: bytes.byteLength },
      title: options.title, sections: [...options.sections].sort(), releaseLabel: options.releaseLabel,
      generatedAt: options.generatedAt, compilerDistributions: await compilerDistributions(),
      dependencyLockSha256: sha256(await readFile(new URL('../../pnpm-lock.yaml', import.meta.url))),
      candidateProducerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      files: files.map((file) => ({ path: file.path, sha256: sha256(file.content) })),
    };
    const manifest = `${JSON.stringify(candidate, null, 2)}\n`;
    const required = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), Buffer.byteLength(manifest));
    const capacity = await statfs(dirname(output), { bigint: true });
    if (capacity.bavail * capacity.bsize < BigInt(required + OUTPUT_RESERVE_BYTES)) {
      throw new Error('Insufficient output capacity including 16 MiB reserve');
    }
    await mkdir(output, { mode: 0o700 });
    for (const file of files) {
      const target = join(output, file.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.content, { flag: 'wx' });
    }
    await writeFile(join(output, 'candidate-manifest.json'), manifest, { flag: 'wx' });
    return ok(candidate);
  } catch (error: unknown) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
