import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
const execute = promisify(execFile);
const repository = process.cwd();
interface TaskPlan { taskId: string; hash: string; dependencies: string[] }

async function isolatedWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'usct-build-contract-'));
  const paths = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'turbo.json',
    'apps/web/package.json', ...['types', 'shared', 'fetcher', 'transformer', 'annotator'].map(name => `packages/${name}/package.json`)];
  for (const path of paths) {
    const target = join(directory, path); await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repository, path), target);
  }
  await mkdir(join(directory, 'data/olrc-history-pilot'), { recursive: true });
  await writeFile(join(directory, 'data/olrc-history-pilot/materializations.json'), '{"cacheSentinel":"original"}\n', { flag: 'wx' });
  await execute('git', ['init', '-q', directory]);
  return directory;
}

async function webPlan(directory: string): Promise<TaskPlan[]> {
  const result = await execute('pnpm', ['exec', 'turbo', '--cwd', directory, 'run', 'build', 'test', 'typecheck', '--filter=@civic-source/web', '--dry=json'],
    { cwd: repository, timeout: 30_000, maxBuffer: 4 * 1024 ** 2 });
  const value = JSON.parse(result.stdout) as { tasks: TaskPlan[] };
  return value.tasks.filter(task => task.taskId.startsWith('@civic-source/web#'));
}

describe('historical web build contract', () => {
  it('orders all web consumers after the existing transformer workspace build', async () => {
    const directory = await isolatedWorkspace();
    try {
      const tasks = await webPlan(directory); expect(tasks).toHaveLength(3);
      for (const task of tasks) expect(task.dependencies).toContain('@civic-source/transformer#build');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
  it('invalidates every web consumer without replacing tracked source materializations', async () => {
    const originalPath = join(repository, 'data/olrc-history-pilot/materializations.json');
    const original = await readFile(originalPath);
    const directory = await isolatedWorkspace();
    try {
      const before = await webPlan(directory);
      await writeFile(join(directory, 'data/olrc-history-pilot/materializations.json'), '{"cacheSentinel":"changed"}\n');
      const after = await webPlan(directory);
      for (const task of before) expect(after.find(item => item.taskId === task.taskId)?.hash).not.toBe(task.hash);
    } finally { await rm(directory, { recursive: true, force: true }); }
    expect(await readFile(originalPath)).toEqual(original);
  }, 90_000);
});
