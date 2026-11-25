import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@civic-source/types';

const execFileAsync = promisify(execFile);

export async function runPythonPgScript<T>(script: string, payload: unknown, dbUrl: string): Promise<Result<T>> {
  let directory: string | undefined;
  let result: Result<T>;
  try {
    directory = await mkdtemp(join(tmpdir(), 'usct-pg-payload-'));
    const path = join(directory, 'payload.json');
    await writeFile(path, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
    const { stdout } = await execFileAsync('python3', ['-c', script, dbUrl], {
      maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PG_PAYLOAD_FILE: path },
    });
    const parsed = JSON.parse(stdout.trim()) as { ok: boolean; data?: T; error?: string };
    result = parsed.ok ? ok(parsed.data as T) : err(new Error(parsed.error ?? 'PostgreSQL operation failed'));
  } catch (error: unknown) {
    result = err(error instanceof Error ? error : new Error(String(error)));
  }
  if (directory) {
    try { await rm(directory, { recursive: true }); }
    catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
  }
  return result;
}
