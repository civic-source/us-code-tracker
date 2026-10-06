import { describe, it, expect } from 'vitest';
import { computeWordDiff, tokenizeWords } from '../lib/word-diff';

describe('word-diff (Myers algorithm)', () => {
  it('tokenizes words, whitespace, and punctuation', () => {
    const tokens = tokenizeWords('Sec. 101(a) -- Definitions;');
    expect(tokens).toEqual(['Sec', '.', ' ', '101', '(', 'a', ')', ' ', '-', '-', ' ', 'Definitions', ';']);
  });

  it('handles identical strings', () => {
    const diff = computeWordDiff('No changes made here.', 'No changes made here.');
    expect(diff).toEqual([{ type: 'context', text: 'No changes made here.' }]);
  });

  it('handles empty strings', () => {
    expect(computeWordDiff('', '')).toEqual([]);
    expect(computeWordDiff('', 'new text')).toEqual([
      { type: 'add', text: 'new' },
      { type: 'add', text: ' ' },
      { type: 'add', text: 'text' },
    ]);
    expect(computeWordDiff('old text', '')).toEqual([
      { type: 'del', text: 'old' },
      { type: 'del', text: ' ' },
      { type: 'del', text: 'text' },
    ]);
  });

  it('accurately identifies word substitutions', () => {
    const oldText = 'The Attorney General shall report annually to Congress.';
    const newText = 'The Attorney General shall report quarterly to Congress.';

    const diff = computeWordDiff(oldText, newText);

    const oldReconstructed = diff.filter((t) => t.type !== 'add').map((t) => t.text).join('');
    const newReconstructed = diff.filter((t) => t.type !== 'del').map((t) => t.text).join('');

    expect(oldReconstructed).toBe(oldText);
    expect(newReconstructed).toBe(newText);

    expect(diff.some((t) => t.type === 'del' && t.text === 'annually')).toBe(true);
    expect(diff.some((t) => t.type === 'add' && t.text === 'quarterly')).toBe(true);
  });

  it('handles legislative amendments accurately', () => {
    const oldText =
      'Section 101. The Commission consists of 5 members appointed by the President by and with the advice and consent of the Senate.';
    const newText =
      'Section 101. The Commission consists of 7 members appointed by the President, with the advice and consent of the Senate, for terms of six years.';

    const diff = computeWordDiff(oldText, newText);

    const oldReconstructed = diff.filter((t) => t.type !== 'add').map((t) => t.text).join('');
    const newReconstructed = diff.filter((t) => t.type !== 'del').map((t) => t.text).join('');

    expect(oldReconstructed).toBe(oldText);
    expect(newReconstructed).toBe(newText);
  });

  it('handles large inputs without UI lag', () => {
    const base = 'The Secretary of the Treasury shall issue regulations governing financial instruments under this title. '.repeat(40);
    const modified = 'The Secretary of the Treasury, in consultation with the Board of Governors, shall issue regulations governing designated financial instruments under this title. '.repeat(40);

    const start = performance.now();
    const diff = computeWordDiff(base, modified);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100); // Myers SES with prefix/suffix strip is extremely fast (<100ms)

    const oldReconstructed = diff.filter((t) => t.type !== 'add').map((t) => t.text).join('');
    const newReconstructed = diff.filter((t) => t.type !== 'del').map((t) => t.text).join('');

    expect(oldReconstructed).toBe(base);
    expect(newReconstructed).toBe(modified);
  });

  it('gracefully triggers safety fallback cap on gigantic differences', () => {
    const oldText = 'a '.repeat(1000);
    const newText = 'b '.repeat(1000);

    const diff = computeWordDiff(oldText, newText);

    // Should complete cleanly without crashing or hanging
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.some((t) => t.type === 'del')).toBe(true);
    expect(diff.some((t) => t.type === 'add')).toBe(true);
  });
});
