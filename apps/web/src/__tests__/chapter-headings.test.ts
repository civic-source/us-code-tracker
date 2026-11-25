import { describe, expect, it } from 'vitest';
import { officialChapterHeading } from '../lib/chapter-headings';

describe('publisher-witnessed chapter labels', () => {
  it('uses the two exact release-bound official headings and no inferred headings', () => {
    expect(officialChapterHeading('pl-119-142', '18', '1')).toBe('GENERAL PROVISIONS');
    expect(officialChapterHeading('pl-119-142', '18', '7')).toBe('ASSAULT');
    expect(officialChapterHeading('pl-119-73', '18', '7')).toBeNull();
    expect(officialChapterHeading('pl-119-142', '26', '7')).toBeNull();
    expect(officialChapterHeading('pl-119-142', '18', '0')).toBeNull();
  });
});
