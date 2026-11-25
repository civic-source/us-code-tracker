import { expect, it } from 'vitest';
import { HistoricalSourceQualificationSchema } from '../index.js';

it('requires archive/member/section/recipe/output/oracle identities for qualified historical text', () => {
  expect(HistoricalSourceQualificationSchema.safeParse({ scope: 'text-lanes-and-list-placement-v1' }).success).toBe(false);
  const value = { schemaVersion: 'usct.historical-source-qualification/v1', releaseId: 'pl-119-73',
    archiveSha256: 'a'.repeat(64), memberName: 'usc18.xml', memberSha256: 'b'.repeat(64),
    sectionIdentifier: '/us/usc/t18/s1001', recipeSha256: 'c'.repeat(64), markdownSha256: 'd'.repeat(64),
    htmlSha256: 'e'.repeat(64), witnessSha256: 'f'.repeat(64), scope: 'text-lanes-and-list-placement-v1' };
  expect(HistoricalSourceQualificationSchema.safeParse(value).success).toBe(true);
  expect(HistoricalSourceQualificationSchema.safeParse({ ...value, memberSha256: 'unverified' }).success).toBe(false);
});
