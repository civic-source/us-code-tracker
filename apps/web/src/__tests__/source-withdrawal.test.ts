import { describe, expect, it } from 'vitest';
import withdrawnBodies from './fixtures/withdrawn-current-bodies.json' with { type: 'json' };
import { requiresCurrentSourceFallback } from '../lib/source-withdrawal';

const faultyData = '7297bf86fe00c0f850e1da9df5af5a03383fea70';
describe('current source withdrawal', () => {
  it('withholds the three proven incomplete bodies only for the affected data publication', () => {
    expect(requiresCurrentSourceFallback({ dataCommit: faultyData, title: '18', section: '19', body: withdrawnBodies['19'] })).toBe(true);
    expect(requiresCurrentSourceFallback({ dataCommit: faultyData, title: '18', section: '111', body: withdrawnBodies['111'] })).toBe(true);
    expect(requiresCurrentSourceFallback({ dataCommit: faultyData, title: '18', section: '1001', body: 'Independently accepted corrected body' })).toBe(true);
    expect(requiresCurrentSourceFallback({ dataCommit: faultyData, title: '18', section: '371', body: 'Unrelated legacy control' })).toBe(false);
    expect(requiresCurrentSourceFallback({ dataCommit: 'a'.repeat(40), title: '18', section: '1001', body: 'Independently accepted corrected body' })).toBe(false);
  });
  it('keeps identical faulty bodies withdrawn after an annotation-only or timestamp-only data commit', () => {
    for (const [section, body] of Object.entries(withdrawnBodies)) {
      expect(requiresCurrentSourceFallback({ dataCommit: 'b'.repeat(40), title: '18', section, body })).toBe(true);
      expect(requiresCurrentSourceFallback({ dataCommit: 'b'.repeat(40), title: '18', section,
        body: `---\ngenerated_at: updated-only\n---\n${body}\n` })).toBe(true);
    }
  });
});
