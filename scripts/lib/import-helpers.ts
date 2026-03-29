/**
 * Shared helpers for the historical import script:
 * state persistence, git operations, and ZIP download/extraction.
 */

import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';

import type { Logger } from '../../packages/shared/src/index.js';
import type { TokenBucket } from '../../packages/shared/src/index.js';

import { titleZipUrl, type ReleasePointId } from './release-points.js';

const execFileAsync = promisify(execFile);

const STATE_FILE = '.import-state.json';
const RATE_LIMIT_BACKOFF_MS = 30_000;

// --- Types ---

export interface ImportState {
  lastCompletedReleasePoint: string | null;
  manifests: Record<string, Record<string, string>>;
}

// --- State management ---

export async function loadState(repo: string): Promise<ImportState> {
  try {
    const raw = await readFile(join(repo, STATE_FILE), 'utf-8');
    return JSON.parse(raw) as ImportState;
  } catch {
    return { lastCompletedReleasePoint: null, manifests: {} };
  }
}

export async function saveState(repo: string, state: ImportState): Promise<void> {
  await writeFile(join(repo, STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// --- Git operations ---

export async function gitCommit(repo: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: repo, timeout: 30_000 });
  await execFileAsync('git', ['commit', '-m', message, '--allow-empty'], {
    cwd: repo,
    timeout: 30_000,
  });
}

export async function gitTag(repo: string, tag: string): Promise<void> {
  await execFileAsync('git', ['tag', tag], { cwd: repo, timeout: 10_000 });
}

// --- Download + extract ---

function findXmlFile(dir: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.xml')) return fullPath;
    if (entry.isDirectory()) {
      const found = findXmlFile(fullPath);
      if (found) return found;
    }
  }
  return null;
}

async function fetchWithRateRetry(
  url: string,
  log: Logger
): Promise<Response | null> {
  const response = await fetch(url);
  if (response.ok) return response;
  if (response.status === 404) return null;
  if (response.status === 429) {
    log.warn('Rate limited, waiting 30s', { url });
    await new Promise<void>((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
    const retry = await fetch(url);
    return retry.ok ? retry : null;
  }
  log.warn('Download failed', { url, status: response.status });
  return null;
}

export async function downloadAndExtractXml(
  rp: ReleasePointId,
  paddedTitle: string,
  rateLimiter: TokenBucket,
  log: Logger
): Promise<string | null> {
  const url = titleZipUrl(rp, paddedTitle);
  const tmpZip = `/tmp/usc-hist-${paddedTitle}-${rp.congress}-${rp.law}.zip`;
  const tmpDir = `/tmp/usc-hist-${paddedTitle}-${rp.congress}-${rp.law}`;

  await rateLimiter.waitAndConsume();

  try {
    const response = await fetchWithRateRetry(url, log);
    if (!response) return null;

    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      log.warn('Invalid ZIP', { url });
      return null;
    }

    await writeFile(tmpZip, buf);
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    await execFileAsync('unzip', ['-o', '-q', tmpZip, '-d', tmpDir], { timeout: 60_000 });

    const xmlPath = findXmlFile(tmpDir);
    if (!xmlPath) return null;

    return await readFile(xmlPath, 'utf-8');
  } finally {
    await rm(tmpZip, { force: true }).catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
