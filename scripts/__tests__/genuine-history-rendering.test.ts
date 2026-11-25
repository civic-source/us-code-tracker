import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compileHistoricalSection } from '../lib/olrc-history-materialize.js';

describe('historical source compilation boundary', () => {
  it('preserves real section1001 continuation, notes and source credit without constructed tables', async () => {
    const xml = await readFile('scripts/__tests__/fixtures/genuine-olrc/pl-119-73-1001.xml', 'utf8');
    const result = await compileHistoricalSection({ xml, releaseId: 'pl-119-73', section: '1001' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.renderedHtml).toContain('shall be fined');
    expect(result.value.renderedHtml).toContain('Editorial Notes');
    expect(result.value.renderedHtml).not.toContain('<table');
    expect(result.value.renderedHtml).not.toContain('175b');
  });
  it('refuses an unqualified source edition or missing target', async () => {
    const xml = await readFile('scripts/__tests__/fixtures/genuine-olrc/pl-119-73-1001.xml', 'utf8');
    expect((await compileHistoricalSection({ xml, releaseId: 'pl-116-220', section: '1001' })).ok).toBe(false);
    expect((await compileHistoricalSection({ xml, releaseId: 'pl-119-73', section: '111' })).ok).toBe(false);
  });
});
