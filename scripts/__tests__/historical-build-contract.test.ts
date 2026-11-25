import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const execute = promisify(execFile);
interface TaskPlan { taskId: string; hash: string; dependencies: string[] }
async function webPlan(): Promise<TaskPlan[]> {
  const result = await execute('pnpm', ['exec', 'turbo', 'run', 'build', 'test', 'typecheck', '--filter=@civic-source/web', '--dry=json'],
    { timeout: 30_000, maxBuffer: 64 * 1024 ** 2 });
  const value = JSON.parse(result.stdout) as { tasks: TaskPlan[] };
  return value.tasks.filter(task => task.taskId.startsWith('@civic-source/web#'));
}

describe('historical web build contract', () => {
  it('orders all web consumers after the existing transformer workspace build', async () => {
    const tasks = await webPlan();
    expect(tasks).toHaveLength(3);
    for (const task of tasks) expect(task.dependencies).toContain('@civic-source/transformer#build');
  }, 30_000);
  it('invalidates every web consumer when the reviewed root source materialization changes', async () => {
    const path = 'data/olrc-history-pilot/materializations.json';
    const original = await readFile(path); const mode = (await stat(path)).mode & 0o777;
    await mkdir(join(process.cwd(), '.workbench'), { recursive: true });
    const temporary = await mkdtemp(join(process.cwd(), '.workbench/cache-contract-'));
    const replacement = join(temporary, 'source.json');
    const before = await webPlan();
    try {
      // Atomic whitespace-only replacement keeps concurrent readers on identical valid JSON values.
      await writeFile(replacement, Buffer.concat([original, Buffer.from('\n')]), { flag: 'wx', mode });
      await chmod(replacement, mode); await rename(replacement, path);
      const after = await webPlan();
      for (const task of before) expect(after.find(item => item.taskId === task.taskId)?.hash).not.toBe(task.hash);
    } finally {
      await writeFile(replacement, original, { flag: 'wx', mode });
      await chmod(replacement, mode); await rename(replacement, path);
      await rm(temporary, { recursive: true });
    }
    expect(await readFile(path)).toEqual(original);
  }, 90_000);
});
