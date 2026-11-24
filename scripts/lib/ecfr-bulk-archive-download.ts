import { spawn } from 'node:child_process';
import { open, unlink } from 'node:fs/promises';
import { err, ok, type Result } from '@civic-source/types';
import { storeError } from './ecfr-bulk-capacity.js';

export interface GithubDownloadAsset { id: number; name: string; size: number; url: string }
export type GithubAssetDownloader = (asset: GithubDownloadAsset, destination: string) => Promise<Result<void>>;

/** Bound subprocess stdout before writing so a misleading asset size cannot exhaust disk. */
export async function downloadCommandBounded(
  executable: string, args: readonly string[], destination: string, maxBytes: number,
): Promise<Result<void>> {
  let created = false;
  let result: Result<void>;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid download byte limit');
    const file = await open(destination, 'wx', 0o600); created = true;
    const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    let stderr = ''; let spawnError: Error | undefined;
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    const ended = new Promise<number | null>((resolve) => {
      child.on('error', (error) => { spawnError = error; });
      child.on('close', resolve);
    });
    let byteLength = 0;
    try {
      for await (const chunk of child.stdout) {
        const bytes = chunk as Buffer; byteLength += bytes.length;
        if (byteLength > maxBytes) throw new Error('Downloaded asset exceeds byte limit');
        await file.writeFile(bytes);
      }
      const code = await ended;
      if (spawnError) throw spawnError;
      if (code !== 0) throw new Error(`Asset download failed: ${stderr}`);
      if (byteLength !== maxBytes) throw new Error('Downloaded asset length differs from declared size');
      await file.sync(); result = ok(undefined);
    } catch (error: unknown) {
      child.kill('SIGKILL'); await ended; result = err(storeError(error));
    } finally { await file.close(); }
  } catch (error: unknown) { result = err(storeError(error)); }
  if (!result.ok && created) {
    try { await unlink(destination); }
    catch (error: unknown) { return err(storeError(error)); }
  }
  return result;
}

export const downloadGithubAsset: GithubAssetDownloader = (asset, destination) =>
  downloadCommandBounded('gh', ['api', asset.url, '-H', 'Accept: application/octet-stream'], destination, asset.size);
