import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatReleaseTag,
  getCurrentReleaseDisplay,
  resolveDefaultReceiptCandidates,
} from '../lib/release-currency';

describe('release-currency helper', () => {
  it('formats standard, exclusion, and revision PL tags', () => {
    expect(formatReleaseTag('pl-119-142')).toEqual({
      tag: 'pl-119-142',
      shortLabel: 'PL 119-142',
      formalLabel: 'Pub. L. 119-142',
    });

    expect(formatReleaseTag('pl-119-102not101')).toEqual({
      tag: 'pl-119-102not101',
      shortLabel: 'PL 119-102not101',
      formalLabel: 'Pub. L. 119-102not101',
    });

    expect(formatReleaseTag('pl-119-73-rev2')).toEqual({
      tag: 'pl-119-73-rev2',
      shortLabel: 'PL 119-73',
      formalLabel: 'Pub. L. 119-73',
      dataRevision: 2,
    });
  });

  it('falls back cleanly for non-PL or malformed strings', () => {
    expect(formatReleaseTag('commit-7297bf86fe00').shortLabel).toBe('PL 119-142');
    expect(formatReleaseTag('pl-119-../etc').shortLabel).toBe('PL 119-142');
    expect(formatReleaseTag('').formalLabel).toBe('Pub. L. 119-142');
  });

  it('reads current publication-receipt.json and handles missing or invalid files', () => {
    const candidates = resolveDefaultReceiptCandidates();
    expect(candidates.some((p) => p.endsWith('apps/web/public/publication-receipt.json'))).toBe(true);

    const current = getCurrentReleaseDisplay();
    expect(current.tag).toMatch(/^pl-\d+-/);
    expect(current.shortLabel).toContain('PL ');

    const dir = mkdtempSync(join(tmpdir(), 'usct-receipt-'));
    try {
      const validPath = join(dir, 'valid.json');
      writeFileSync(validPath, JSON.stringify({ acceptedDataTag: 'pl-120-99' }), 'utf-8');
      expect(getCurrentReleaseDisplay(validPath)).toEqual({
        tag: 'pl-120-99',
        shortLabel: 'PL 120-99',
        formalLabel: 'Pub. L. 120-99',
      });

      const malformedPath = join(dir, 'bad.json');
      writeFileSync(malformedPath, '{not valid json', 'utf-8');
      expect(getCurrentReleaseDisplay(malformedPath).shortLabel).toBe('PL 119-142');
      expect(getCurrentReleaseDisplay(join(dir, 'missing.json')).shortLabel).toBe('PL 119-142');

      // Verify cwd-based resolution works even when chunk dirname moves (simulating dist/.prerender/chunks/)
      const fakeCwd = join(dir, 'repo');
      mkdirSync(join(fakeCwd, 'apps/web/public'), { recursive: true });
      writeFileSync(join(fakeCwd, 'apps/web/public/publication-receipt.json'), JSON.stringify({ acceptedDataTag: 'pl-120-5' }), 'utf-8');
      const prevCwd = process.cwd();
      try {
        process.chdir(fakeCwd);
        const fakeCandidates = resolveDefaultReceiptCandidates();
        expect(fakeCandidates).toContain(join(fakeCwd, 'apps/web/public/publication-receipt.json'));
      } finally {
        process.chdir(prevCwd);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
