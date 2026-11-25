import { describe, expect, it } from 'vitest';
import { retainedCitation } from '../lib/published-citation';

const collection = 'olrc-pilot-' + 'a'.repeat(64);
const entry = { publisherReleaseId: 'pl-119-73', releaseId: collection, uscTitle: '18', uscSection: '1001',
  historicalUrl: '/us-code-tracker/history/pl-119-73/18/1001/',
  sourceQualification: { releaseId: 'pl-119-73', sectionIdentifier: '/us/usc/t18/s1001' },
  subsectionAnchorIds: ['subsec-a', 'subsec-a-1'] };

describe('source-qualified cold historical routes', () => {
  it('uses only the declared same-edition static route and actual subsection anchors', () => {
    expect(retainedCitation([entry], collection, { display: '18 U.S.C. 1001', title: '18', section: '1001', pinpoint: ['a', '1'] }, '/us-code-tracker/'))
      .toEqual({ ok: true, value: '/us-code-tracker/history/pl-119-73/18/1001/#subsec-a-1' });
  });
  it('refuses missing or conflicting edition, section, duplicate source and unavailable pinpoint', () => {
    for (const altered of [ { ...entry, historicalUrl: '/us-code-tracker/history/pl-119-142/18/1001/' },
      { ...entry, sourceQualification: { ...entry.sourceQualification, releaseId: 'pl-119-142' } },
      { ...entry, sourceQualification: { ...entry.sourceQualification, sectionIdentifier: '/us/usc/t18/s111' } } ]) {
      expect(retainedCitation([altered], collection, { display: '18 U.S.C. 1001', title: '18', section: '1001' }, '/us-code-tracker/').ok).toBe(false);
    }
    expect(retainedCitation([entry, entry], collection, { display: '18 U.S.C. 1001', title: '18', section: '1001' }, '/us-code-tracker/').ok).toBe(false);
    expect(retainedCitation([entry], collection, { display: '18 U.S.C. 1001', title: '18', section: '1001', pinpoint: ['z'] }, '/us-code-tracker/').ok).toBe(false);
    expect(retainedCitation([{ ...entry, sourceQualification: undefined }], collection, { display: '18 U.S.C. 1001', title: '18', section: '1001' }, '/us-code-tracker/').ok).toBe(false);
  });
});
