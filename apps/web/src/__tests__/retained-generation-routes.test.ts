import { describe, expect, it } from 'vitest';
import { retainedCitation } from '../lib/published-citation';

const collection = `olrc-pilot-${'a'.repeat(64)}`;
const other = `olrc-pilot-${'b'.repeat(64)}`;
const base = '/us-code-tracker/';
const jump = { title: '18', section: '111', display: '18 U.S.C. §111' };
const entry = {
  releaseId: collection, publisherReleaseId: 'pl-119-73', uscTitle: '18', uscSection: '111',
  historicalUrl: `${base}history/collection/${collection}/18/111/`,
  sourceQualification: { releaseId: 'pl-119-73', sectionIdentifier: '/us/usc/t18/s111' },
};

describe('source-qualified retained generation citation identity', () => {
  it('opens its exact immutable collection rather than the active publisher alias', () => {
    expect(retainedCitation([entry], collection, jump, base)).toEqual({ ok: true, value: entry.historicalUrl });
  });

  it('refuses a publisher alias or another generation even with identical publisher and section', () => {
    for (const historicalUrl of [
      `${base}history/pl-119-73/18/111/`, `${base}history/collection/${other}/18/111/`,
    ]) {
      expect(retainedCitation([{ ...entry, historicalUrl }], collection, jump, base).ok).toBe(false);
    }
  });

  it('retains exact source member, publisher and unique-record admission checks', () => {
    expect(retainedCitation([entry, entry], collection, jump, base).ok).toBe(false);
    expect(retainedCitation([{ ...entry, publisherReleaseId: 'pl-119-142' }], collection, jump, base).ok).toBe(false);
    expect(retainedCitation([{ ...entry, sourceQualification: { ...entry.sourceQualification,
      sectionIdentifier: '/us/usc/t18/s112' } }], collection, jump, base).ok).toBe(false);
    expect(retainedCitation([entry], other, jump, base).ok).toBe(false);
  });
});
