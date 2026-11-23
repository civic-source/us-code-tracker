/**
 * Canonical external legal authority URL builders, URL safety validation,
 * and deprecated-URL policy rules shared across web UI, fetchers, transformers,
 * and validation scripts.
 */

export const OLRC_BASE_URL = 'https://uscode.house.gov';
export const OLRC_BROWSE_URL = `${OLRC_BASE_URL}/browse.html`;
export const OLRC_DOWNLOAD_PAGE = `${OLRC_BASE_URL}/download.html`;
export const OLRC_LEGACY_DOWNLOAD_PAGE = `${OLRC_BASE_URL}/download/download.shtml`;
export const OLRC_PRIOR_RELEASE_POINTS_PAGE = `${OLRC_BASE_URL}/priorreleasepoints.html`;
export const OLRC_LEGACY_PRIOR_RELEASE_POINTS_PAGE = `${OLRC_BASE_URL}/download/priorreleasepoints.htm`;
export const OLRC_RELEASE_POINTS_URL = `${OLRC_BASE_URL}/download/releasepoints/`;
export const OLRC_CODIFICATION_URL = `${OLRC_BASE_URL}/codification/legislation.html`;
export const OLRC_CLASSIFICATION_TABLES_URL = `${OLRC_BASE_URL}/classification/tables.html`;

export const GOVINFO_BASE_URL = 'https://www.govinfo.gov';
export const CORNELL_LII_BASE_URL = 'https://www.law.cornell.edu';
export const ECFR_BASE_URL = 'https://www.ecfr.gov';
export const FEDERAL_REGISTER_BASE_URL = 'https://www.federalregister.gov';
export const COURTLISTENER_WEB_BASE_URL = 'https://www.courtlistener.com';

const MAX_SECTION_LENGTH = 64;
const VALID_SECTION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;
const VALID_TITLE_PATTERN = /^0*([1-9]\d?)([a-zA-Z]?)$/;
const VALID_OLRC_TITLE_PATTERN = /^(\d{1,3})([a-zA-Z]?)$/;
const VALID_CONGRESS_PATTERN = /^\d{2,3}$/;
const VALID_LAW_SEGMENT_PATTERN = /^\d+(?:not\d+(?:and\d+)*)?$/i;
const VALID_ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DeprecatedUrlRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly reason: string;
  readonly replacement: string;
}

/**
 * Policy rules blocking URLs known to return 404 upstream (for example after
 * OLRC's November 2026 static site migration or downstream slug renames).
 */
export const DEPRECATED_URL_RULES: readonly DeprecatedUrlRule[] = [
  {
    id: 'olrc-view-xhtml',
    pattern: /uscode\.house\.gov\/view\.xhtml/i,
    reason: 'Legacy OLRC JSF viewer returns HTTP 404 after site migration',
    replacement: 'https://uscode.house.gov/us/usc/t{title}/s{section}/',
  },
  {
    id: 'olrc-download-shtml',
    pattern: /uscode\.house\.gov\/download\/download\.shtml/i,
    reason: 'Legacy OLRC download page returns HTTP 404',
    replacement: OLRC_DOWNLOAD_PAGE,
  },
  {
    id: 'olrc-prior-htm',
    pattern: /uscode\.house\.gov\/download\/priorreleasepoints\.htm(?!l)/i,
    reason: 'Legacy OLRC prior release points page returns HTTP 404',
    replacement: OLRC_PRIOR_RELEASE_POINTS_PAGE,
  },
  {
    id: 'olrc-codification-shtml',
    pattern: /uscode\.house\.gov\/codification\/legislation\.shtml/i,
    reason: 'Legacy OLRC codification page returns HTTP 404',
    replacement: OLRC_CODIFICATION_URL,
  },
  {
    id: 'olrc-classification-shtml',
    pattern: /uscode\.house\.gov\/classification\/tables\.shtml/i,
    reason: 'Legacy OLRC classification tables page returns HTTP 404',
    replacement: OLRC_CLASSIFICATION_TABLES_URL,
  },
  {
    id: 'doj-jm-fraud-typo',
    pattern: /justice\.gov\/jm\/jm-9-42000-fraud-against-government(?:[/?#]|$)/i,
    reason: 'DOJ Justice Manual 9-42.000 URL requires "-the-" in slug',
    replacement: 'https://www.justice.gov/jm/jm-9-42000-fraud-against-the-government',
  },
];

/**
 * Zero-pad the numeric run of an OLRC title token to at least two digits while
 * keeping any appendix letter suffix (e.g., "1" -> "01", "5a" -> "05a").
 */
export function padOlrcTitle(title: string | number): string {
  const trimmed = String(title).trim();
  const match = VALID_OLRC_TITLE_PATTERN.exec(trimmed);
  if (!match?.[1]) {
    throw new Error(`Invalid OLRC title identifier: "${trimmed}"`);
  }
  const paddedDigits = match[1].padStart(2, '0');
  const suffix = (match[2] ?? '').toLowerCase();
  return `${paddedDigits}${suffix}`;
}

/**
 * Normalize a U.S. Code title into canonical non-zero-padded form
 * (e.g., "01" -> "1", "05a" -> "5a"), or return null if invalid.
 */
export function normalizeUscTitle(title: string | number): string | null {
  const trimmed = String(title).trim();
  const match = VALID_TITLE_PATTERN.exec(trimmed);
  if (!match?.[1]) return null;
  const suffix = (match[2] ?? '').toLowerCase();
  return `${match[1]}${suffix}`;
}

/**
 * Normalize a U.S. Code section identifier (collapsing en/em dashes to ASCII
 * hyphens to match OLRC static paths) and reject path-traversal tokens.
 */
export function normalizeUscSection(section: string): string | null {
  const normalized = section.trim().replace(/[\u2013\u2014]/g, '-');
  if (normalized.length === 0 || normalized.length > MAX_SECTION_LENGTH) {
    return null;
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('..')) {
    return null;
  }
  if (!VALID_SECTION_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Verify that a URL uses HTTPS, embeds no credentials, and optionally matches
 * an explicit hostname allowlist.
 */
export function isSafeHttpsUrl(rawUrl: string, allowedHosts?: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (!allowedHosts || allowedHosts.length === 0) return true;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
}

/**
 * Build an OLRC static section URL (`/us/usc/t{title}/s{section}/`).
 * Appendix titles (suffixed with a letter like `5a`) use act-scoped subpaths on
 * OLRC rather than `/s{section}/`, so they resolve safely to `OLRC_BROWSE_URL`.
 */
export function buildOlrcSectionUrl(uscTitle: string | number, uscSection: string): string {
  const normTitle = normalizeUscTitle(uscTitle);
  const normSection = normalizeUscSection(uscSection);
  if (!normTitle || !normSection) return OLRC_BROWSE_URL;
  if (/[a-z]$/.test(normTitle)) return OLRC_BROWSE_URL;
  return `${OLRC_BASE_URL}/us/usc/t${normTitle}/s${encodeURIComponent(normSection)}/`;
}

/**
 * Build a canonical OLRC USLM ZIP release download URL.
 * Rejects malformed Congress or law segments to prevent path traversal/SSRF.
 */
export function buildOlrcTitleZipUrl(
  congress: string | number,
  lawSegment: string | number,
  title: string | number
): string {
  const cleanCongress = String(congress).trim();
  if (!VALID_CONGRESS_PATTERN.test(cleanCongress)) {
    throw new Error(`Invalid OLRC congress number: "${cleanCongress}"`);
  }
  const cleanLaw = String(lawSegment).trim().toLowerCase();
  if (!VALID_LAW_SEGMENT_PATTERN.test(cleanLaw)) {
    throw new Error(`Invalid OLRC law segment: "${cleanLaw}"`);
  }
  const paddedTitle = padOlrcTitle(title);
  return `${OLRC_RELEASE_POINTS_URL}us/pl/${cleanCongress}/${cleanLaw}/xml_usc${paddedTitle}@${cleanCongress}-${cleanLaw}.zip`;
}

/** Build a GovInfo U.S. Code link-service URL for a title and section. */
export function buildGovInfoSectionUrl(uscTitle: string | number, uscSection: string): string {
  const normTitle = normalizeUscTitle(uscTitle);
  const normSection = normalizeUscSection(uscSection);
  if (!normTitle || !normSection) return `${GOVINFO_BASE_URL}/`;
  return `${GOVINFO_BASE_URL}/link/uscode/${normTitle}/${encodeURIComponent(normSection)}`;
}

/** Build a GovInfo Statutes at Large link-service URL. */
export function buildGovInfoStatuteUrl(volume: string | number, page: string | number): string {
  const cleanVol = String(volume).trim();
  const cleanPage = String(page).trim();
  if (!/^\d+$/.test(cleanVol) || !/^\d+$/.test(cleanPage)) {
    throw new Error(`Invalid Statutes at Large reference: ${cleanVol} Stat. ${cleanPage}`);
  }
  return `${GOVINFO_BASE_URL}/link/statute/${cleanVol}/${cleanPage}`;
}

/** Build a GovInfo Public Law link-service URL. */
export function buildGovInfoPublicLawUrl(
  congress: string | number,
  lawNumber: string | number
): string {
  const cleanCongress = String(congress).trim();
  const cleanLaw = String(lawNumber).trim();
  if (!/^\d+$/.test(cleanCongress) || !/^\d+$/.test(cleanLaw)) {
    throw new Error(`Invalid Public Law reference: Pub. L. ${cleanCongress}-${cleanLaw}`);
  }
  return `${GOVINFO_BASE_URL}/link/plaw/${cleanCongress}/public/${cleanLaw}`;
}

/** Build a GovInfo search URL scoped to the given U.S. Code citation. */
export function buildGovInfoSearchUrl(uscTitle: string | number, uscSection: string): string {
  const normTitle = normalizeUscTitle(uscTitle) ?? String(uscTitle).trim();
  const normSection = normalizeUscSection(uscSection) ?? uscSection.trim();
  const payload = JSON.stringify({ query: `"${normTitle} U.S.C. ${normSection}"`, offset: 0 });
  return `${GOVINFO_BASE_URL}/app/search/${encodeURIComponent(payload)}`;
}

/** Build a Cornell LII U.S. Code section URL. */
export function buildCornellSectionUrl(uscTitle: string | number, uscSection: string): string {
  const normTitle = normalizeUscTitle(uscTitle);
  const normSection = normalizeUscSection(uscSection);
  if (!normTitle || !normSection) return `${CORNELL_LII_BASE_URL}/uscode/text`;
  return `${CORNELL_LII_BASE_URL}/uscode/text/${normTitle}/${encodeURIComponent(normSection)}`;
}

/**
 * Subtract one UTC calendar day from a validated YYYY-MM-DD date string.
 * Used to resolve removed eCFR parts to their last active historical snapshot.
 */
function previousUtcDate(isoDate: string): string | null {
  const match = VALID_ISO_DATE_PATTERN.exec(isoDate.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  const prev = new Date(Date.UTC(year, month - 1, day - 1));
  const y = String(prev.getUTCFullYear()).padStart(4, '0');
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const d = String(prev.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build an eCFR part URL. When `endsOn` is provided (for removed/superseded
 * parts whose `/current/` URL returns 404), points to the `/on/{date}/`
 * point-in-time snapshot one day before `endsOn`.
 */
export function buildEcfrPartUrl(
  cfrTitle: number,
  cfrPart: number,
  endsOn?: string | null
): string {
  if (!Number.isInteger(cfrTitle) || cfrTitle <= 0 || !Number.isInteger(cfrPart) || cfrPart <= 0) {
    throw new RangeError(`Invalid CFR title/part: ${cfrTitle} CFR Part ${cfrPart}`);
  }
  const priorDate = endsOn ? previousUtcDate(endsOn) : null;
  if (priorDate) {
    return `${ECFR_BASE_URL}/on/${priorDate}/title-${cfrTitle}/part-${cfrPart}`;
  }
  return `${ECFR_BASE_URL}/current/title-${cfrTitle}/part-${cfrPart}`;
}

/** Build an eCFR authority-table search URL for a U.S. Code citation. */
export function buildEcfrAuthoritySearchUrl(
  uscTitle: string | number,
  uscSection: string
): string {
  const normTitle = normalizeUscTitle(uscTitle) ?? String(uscTitle).trim();
  const normSection = normalizeUscSection(uscSection) ?? uscSection.trim();
  return `${ECFR_BASE_URL}/search?query=${encodeURIComponent(`${normTitle} U.S.C. ${normSection}`)}&search_type=authority`;
}

/** Build a Federal Register search URL for a U.S. Code citation. */
export function buildFederalRegisterSearchUrl(
  uscTitle: string | number,
  uscSection: string
): string {
  const normTitle = normalizeUscTitle(uscTitle) ?? String(uscTitle).trim();
  const normSection = normalizeUscSection(uscSection) ?? uscSection.trim();
  return `${FEDERAL_REGISTER_BASE_URL}/documents/search?conditions%5Bterm%5D=${encodeURIComponent(`${normTitle} U.S.C. ${normSection}`)}`;
}

/** Build a CourtListener web search URL for a U.S. Code citation. */
export function buildCourtListenerSearchUrl(
  uscTitle: string | number,
  uscSection: string,
  opts?: { exactSectionSymbol?: boolean; opinionsOnly?: boolean }
): string {
  const normTitle = normalizeUscTitle(uscTitle) ?? String(uscTitle).trim();
  const normSection = normalizeUscSection(uscSection) ?? uscSection.trim();
  const query = opts?.exactSectionSymbol
    ? `"${normTitle} U.S.C. § ${normSection}"`
    : `${normTitle} U.S.C. ${normSection}`;
  const typeParam = opts?.opinionsOnly ? '&type=o' : '';
  return `${COURTLISTENER_WEB_BASE_URL}/?q=${encodeURIComponent(query)}${typeParam}`;
}
