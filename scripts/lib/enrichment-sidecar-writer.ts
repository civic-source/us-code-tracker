import { constants } from 'node:fs';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SectionRegulationsSchema, err, ok, type Result } from '@civic-source/types';
import { parseAnnotationYaml } from './annotation-yaml-parser.js';

interface ReviewMarker {
  extractionState?: string | undefined;
  editorialReview?: string | undefined;
}

function parsePriorEntries(filePath: string, raw: string): Result<ReviewMarker[]> {
  if (filePath.endsWith('.yaml')) {
    const parsed = parseAnnotationYaml(raw);
    return parsed.ok ? ok(parsed.value.cases) : parsed;
  }
  try {
    const parsed = SectionRegulationsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? ok(parsed.data.regulations) : err(new Error(parsed.error.message));
  } catch (error: unknown) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

async function openSidecar(filePath: string): Promise<{ file: FileHandle; created: boolean }> {
  try {
    return { file: await open(filePath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644), created: true };
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    return { file: await open(filePath, constants.O_RDWR | constants.O_NOFOLLOW), created: false };
  }
}

async function validateReplacement(file: FileHandle, filePath: string): Promise<Result<void>> {
  const stat = await file.stat();
  if (!stat.isFile() || stat.nlink !== 1) return err(new Error('Refusing linked or non-regular sidecar target'));
  const parsed = parsePriorEntries(filePath, await file.readFile('utf-8'));
  if (!parsed.ok) return err(new Error('Refusing to overwrite an unreadable sidecar'));
  if (parsed.value.some((c) => c.extractionState === 'verified' || (c.editorialReview && c.editorialReview !== 'unreviewed')))
    return err(new Error('Refusing to overwrite an editorially reviewed sidecar'));
  return ok(undefined);
}

async function writeContents(file: FileHandle, content: string): Promise<void> {
  const data = Buffer.from(content, 'utf-8');
  let position = 0;
  while (position < data.length) {
    const { bytesWritten } = await file.write(data, position, data.length - position, position);
    if (bytesWritten === 0) throw new Error('Sidecar write made no progress');
    position += bytesWritten;
  }
  await file.truncate(data.length);
}

/** Validate and write through one descriptor so a path swap cannot redirect the write. */
export async function writeEnrichmentSidecar(filePath: string, content: string): Promise<Result<void>> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const { file, created } = await openSidecar(filePath);
    try {
      if (!created) {
        const guard = await validateReplacement(file, filePath);
        if (!guard.ok) return guard;
      }
      await writeContents(file, content);
      return ok(undefined);
    } finally {
      await file.close();
    }
  } catch (error: unknown) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
