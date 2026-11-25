import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('runs the public standalone, prepared and bounded batch oracle controls in normal verification', () => {
  const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s',
    resolve('scripts/python'), '-p', 'test_uslm_fidelity*.py'],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 ** 2 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 30_000);
