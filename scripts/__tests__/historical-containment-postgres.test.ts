import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryPostgresLexical } from '../lib/postgres-bridge.js';

const directories: string[] = [];
const priorPath = process.env['PYTHONPATH'];
afterEach(async () => {
  if (priorPath === undefined) delete process.env['PYTHONPATH'];
  else process.env['PYTHONPATH'] = priorPath;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('excludes previously persisted constructed PostgreSQL rows before the result limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'withdrawn-pg-'));
  directories.push(directory);
  // Only the database transport is substituted; the public query executes its real Python filter.
  await writeFile(join(directory, 'psycopg2.py'), `
class Cursor:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, args=None): self.sql = sql
    def fetchall(self):
        if 'FROM provision_versions' in self.sql:
            return [('pv-18-1001-pl-119-73', 'prov-18-1001', '18', '1001', 'Withdrawn', 'constructed', {'evidenceIds': []}, 10),
                    ('pv-18-371-pl-119-73', 'prov-18-371', '18', '371', 'Retained', 'control', {'evidenceIds': []}, 1)]
        return []
class Connection:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def cursor(self): return Cursor()
    def close(self): pass
def connect(url): return Connection()
`);
  process.env['PYTHONPATH'] = directory;
  const result = await queryPostgresLexical({ query: 'control', releaseId: 'pl-119-73', limit: 1 }, 'fixture://transport');
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.map((hit) => hit.provisionVersionId)).toEqual(['pv-18-371-pl-119-73']);
});
