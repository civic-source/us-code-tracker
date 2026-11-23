import { describe, expect, it } from 'vitest';
import {
  OLRC_BROWSE_URL,
  OLRC_DOWNLOAD_PAGE,
  OLRC_PRIOR_RELEASE_POINTS_PAGE,
  DEPRECATED_URL_RULES,
  padOlrcTitle,
  normalizeUscTitle,
  normalizeUscSection,
  isSafeHttpsUrl,
  buildOlrcSectionUrl,
  buildOlrcTitleZipUrl,
  buildGovInfoSectionUrl,
  buildGovInfoStatuteUrl,
  buildGovInfoPublicLawUrl,
  buildGovInfoSearchUrl,
  buildCornellSectionUrl,
  buildEcfrPartUrl,
  buildEcfrAuthoritySearchUrl,
  buildFederalRegisterSearchUrl,
  buildCourtListenerSearchUrl,
} from '../external-links.js';

describe('external-links builders & validators', () => {
  describe('padOlrcTitle & normalizeUscTitle', () => {
    it('pads single-digit numeric and appendix titles for OLRC filenames', () => {
      expect(padOlrcTitle(1)).toBe('01');
      expect(padOlrcTitle('1')).toBe('01');
      expect(padOlrcTitle('18')).toBe('18');
      expect(padOlrcTitle('5a')).toBe('05a');
      expect(padOlrcTitle('05A')).toBe('05a');
    });

    it('rejects invalid OLRC titles', () => {
      expect(() => padOlrcTitle('../18')).toThrow();
      expect(() => padOlrcTitle('')).toThrow();
    });

    it('normalizes USC title strings cleanly', () => {
      expect(normalizeUscTitle('01')).toBe('1');
      expect(normalizeUscTitle('05A')).toBe('5a');
      expect(normalizeUscTitle(10)).toBe('10');
      expect(normalizeUscTitle('0')).toBeNull();
      expect(normalizeUscTitle('../10')).toBeNull();
    });
  });

  describe('normalizeUscSection', () => {
    it('preserves case and converts en-dash/em-dash to ASCII hyphens', () => {
      expect(normalizeUscSection('135')).toBe('135');
      expect(normalizeUscSection('3720B')).toBe('3720B');
      expect(normalizeUscSection('470hh')).toBe('470hh');
      expect(normalizeUscSection('460bbbb')).toBe('460bbbb');
      expect(normalizeUscSection('175b')).toBe('175b');
      expect(normalizeUscSection('100\u20131')).toBe('100-1');
      expect(normalizeUscSection('100\u20141')).toBe('100-1');
    });

    it('rejects empty, overly long, or traversal inputs', () => {
      expect(normalizeUscSection('')).toBeNull();
      expect(normalizeUscSection('../secret')).toBeNull();
      expect(normalizeUscSection('100/200')).toBeNull();
      expect(normalizeUscSection('100?q=1')).toBeNull();
      expect(normalizeUscSection('a'.repeat(65))).toBeNull();
    });
  });

  describe('buildOlrcSectionUrl', () => {
    it('builds OLRC Nov-2026 static paths across standard and suffixed citations', () => {
      expect(buildOlrcSectionUrl(10, '135')).toBe('https://uscode.house.gov/us/usc/t10/s135/');
      expect(buildOlrcSectionUrl('18', '175b')).toBe('https://uscode.house.gov/us/usc/t18/s175b/');
      expect(buildOlrcSectionUrl('31', '3720B')).toBe('https://uscode.house.gov/us/usc/t31/s3720B/');
      expect(buildOlrcSectionUrl('16', '470hh')).toBe('https://uscode.house.gov/us/usc/t16/s470hh/');
      expect(buildOlrcSectionUrl('16', '460bbbb')).toBe('https://uscode.house.gov/us/usc/t16/s460bbbb/');
      expect(buildOlrcSectionUrl('18', '100\u20131')).toBe('https://uscode.house.gov/us/usc/t18/s100-1/');
    });

    it('falls back safely to browse page for appendix titles or invalid inputs', () => {
      expect(buildOlrcSectionUrl('5a', '101')).toBe(OLRC_BROWSE_URL);
      expect(buildOlrcSectionUrl('0', '101')).toBe(OLRC_BROWSE_URL);
      expect(buildOlrcSectionUrl('18', '../etc/passwd')).toBe(OLRC_BROWSE_URL);
    });
  });

  describe('buildOlrcTitleZipUrl', () => {
    it('builds valid ZIP release point URLs including exclusions and appendix padding', () => {
      expect(buildOlrcTitleZipUrl(119, '142', '18')).toBe(
        'https://uscode.house.gov/download/releasepoints/us/pl/119/142/xml_usc18@119-142.zip'
      );
      expect(buildOlrcTitleZipUrl('119', '73not60', '5a')).toBe(
        'https://uscode.house.gov/download/releasepoints/us/pl/119/73not60/xml_usc05a@119-73not60.zip'
      );
      expect(buildOlrcTitleZipUrl('119', '102not101and99', 1)).toBe(
        'https://uscode.house.gov/download/releasepoints/us/pl/119/102not101and99/xml_usc01@119-102not101and99.zip'
      );
    });

    it('rejects malformed congress or law segments', () => {
      expect(() => buildOlrcTitleZipUrl('119/../1', '73', '18')).toThrow();
      expect(() => buildOlrcTitleZipUrl('119', '73?x=1', '18')).toThrow();
    });
  });

  describe('GovInfo, Cornell, eCFR, Federal Register, CourtListener builders', () => {
    it('builds GovInfo section, statute, public law, and search URLs', () => {
      expect(buildGovInfoSectionUrl(10, '135')).toBe('https://www.govinfo.gov/link/uscode/10/135');
      expect(buildGovInfoSectionUrl('18', '../bad')).toBe('https://www.govinfo.gov/');
      expect(buildGovInfoStatuteUrl(62, 749)).toBe('https://www.govinfo.gov/link/statute/62/749');
      expect(buildGovInfoPublicLawUrl(104, 292)).toBe('https://www.govinfo.gov/link/plaw/104/public/292');
      expect(buildGovInfoSearchUrl(18, '1001')).toBe(
        'https://www.govinfo.gov/app/search/%7B%22query%22%3A%22%5C%2218%20U.S.C.%201001%5C%22%22%2C%22offset%22%3A0%7D'
      );
    });

    it('builds Cornell LII URLs safely', () => {
      expect(buildCornellSectionUrl('31', '3720B')).toBe('https://www.law.cornell.edu/uscode/text/31/3720B');
      expect(buildCornellSectionUrl('18', 'bad/path')).toBe('https://www.law.cornell.edu/uscode/text');
    });

    it('builds current and point-in-time historical eCFR URLs accurately', () => {
      expect(buildEcfrPartUrl(19, 162)).toBe('https://www.ecfr.gov/current/title-19/part-162');
      expect(buildEcfrPartUrl(19, 162, null)).toBe('https://www.ecfr.gov/current/title-19/part-162');
      // Normal day decrement
      expect(buildEcfrPartUrl(32, 584, '2019-11-11')).toBe('https://www.ecfr.gov/on/2019-11-10/title-32/part-584');
      // Month and year boundary rollover
      expect(buildEcfrPartUrl(43, 3195, '2024-03-01')).toBe('https://www.ecfr.gov/on/2024-02-29/title-43/part-3195');
      expect(buildEcfrPartUrl(43, 3195, '2024-01-01')).toBe('https://www.ecfr.gov/on/2023-12-31/title-43/part-3195');
      // Non-positive ints rejected
      expect(() => buildEcfrPartUrl(0, 10)).toThrow(RangeError);
    });

    it('builds eCFR search, Federal Register search, and CourtListener search URLs', () => {
      expect(buildEcfrAuthoritySearchUrl(18, '1001')).toBe(
        'https://www.ecfr.gov/search?query=18%20U.S.C.%201001&search_type=authority'
      );
      expect(buildFederalRegisterSearchUrl(18, '1001')).toBe(
        'https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=18%20U.S.C.%201001'
      );
      expect(buildCourtListenerSearchUrl(18, '1001')).toBe(
        'https://www.courtlistener.com/?q=18%20U.S.C.%201001'
      );
      expect(
        buildCourtListenerSearchUrl(18, '1001', { exactSectionSymbol: true, opinionsOnly: true })
      ).toBe(
        'https://www.courtlistener.com/?q=%2218%20U.S.C.%20%C2%A7%201001%22&type=o'
      );
    });
  });

  describe('isSafeHttpsUrl & DEPRECATED_URL_RULES', () => {
    it('enforces HTTPS, rejects credentials, and checks optional host allowlist', () => {
      expect(isSafeHttpsUrl(OLRC_DOWNLOAD_PAGE, ['uscode.house.gov'])).toBe(true);
      expect(isSafeHttpsUrl(OLRC_PRIOR_RELEASE_POINTS_PAGE, ['USCODE.HOUSE.GOV'])).toBe(true);
      expect(isSafeHttpsUrl('http://uscode.house.gov/download.html')).toBe(false);
      expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeHttpsUrl('https://user:pass@uscode.house.gov/')).toBe(false);
      expect(isSafeHttpsUrl('https://evil.example/uscode.house.gov', ['uscode.house.gov'])).toBe(false);
    });

    it('detects all deprecated OLRC and DOJ Justice Manual patterns without flagging replacements', () => {
      const deprecated = [
        'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title10-section135&num=0&edition=prelim',
        'https://uscode.house.gov/download/download.shtml',
        'https://uscode.house.gov/download/priorreleasepoints.htm',
        'https://uscode.house.gov/codification/legislation.shtml',
        'https://uscode.house.gov/classification/tables.shtml',
        'https://www.justice.gov/jm/jm-9-42000-fraud-against-government',
      ];
      for (const bad of deprecated) {
        expect(DEPRECATED_URL_RULES.some((r) => r.pattern.test(bad))).toBe(true);
      }

      const valid = [
        'https://uscode.house.gov/us/usc/t10/s135/',
        'https://uscode.house.gov/download.html',
        'https://uscode.house.gov/priorreleasepoints.html',
        'https://uscode.house.gov/codification/legislation.html',
        'https://uscode.house.gov/classification/tables.html',
        'https://www.justice.gov/jm/jm-9-42000-fraud-against-the-government',
      ];
      for (const good of valid) {
        expect(DEPRECATED_URL_RULES.some((r) => r.pattern.test(good))).toBe(false);
      }

      const unrelatedHosts = [
        'https://evil.example/?u=uscode.house.gov/download/download.shtml',
        'https://evil.example/?u=uscode.house.gov/view.xhtml',
        'https://evil-uscode.house.gov/view.xhtml',
        'https://evil.example/justice.gov/jm/jm-9-42000-fraud-against-government',
      ];
      for (const external of unrelatedHosts) {
        expect(DEPRECATED_URL_RULES.some((r) => r.pattern.test(external))).toBe(false);
      }
    });
  });
});
