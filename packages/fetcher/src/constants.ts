/** OLRC US Code release point URLs and configuration */

export const OLRC_BASE_URL = 'https://uscode.house.gov';
export const OLRC_DOWNLOAD_PAGE = `${OLRC_BASE_URL}/download/download.shtml`;
export const OLRC_PRIOR_RELEASE_POINTS_PAGE = `${OLRC_BASE_URL}/download/priorreleasepoints.htm`;
export const OLRC_RELEASE_POINTS_URL = `${OLRC_BASE_URL}/download/releasepoints/`;

/**
 * Build a URL for an individual title's XML ZIP download.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{law}/xml_usc{title}@{congress}-{law}.zip
 */
export function titleXmlUrl(congress: string, law: string, title: string): string {
  // OLRC zero-pads the *numeric run* to two digits, keeping any letter suffix
  // (e.g. title "5a" -> "xml_usc05a"). `title.padStart(2, '0')` pads to a total
  // length of two, so it is a no-op on "5a" and would wrongly yield "xml_usc5a".
  const paddedTitle = title.replace(/^(\d+)/, (digits) => digits.padStart(2, '0'));
  return `${OLRC_RELEASE_POINTS_URL}us/pl/${congress}/${law}/xml_usc${paddedTitle}@${congress}-${law}.zip`;
}

/**
 * Build a URL for the all-titles XML ZIP download for a release point.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{law}/xml_uscAll@{congress}-{law}.zip
 */
export function allTitlesXmlUrl(congress: string, law: string): string {
  return `${OLRC_RELEASE_POINTS_URL}us/pl/${congress}/${law}/xml_uscAll@${congress}-${law}.zip`;
}

/**
 * Maximum number of bytes to accept from a single download.
 *
 * Guards CI runners against OOM from a maliciously or accidentally huge
 * response. The bound is deliberately generous: the all-titles USC archive
 * can be ~100-150 MB, so 300 MiB leaves ample headroom for legitimate
 * downloads while still capping runaway responses.
 */
export const MAX_DOWNLOAD_BYTES = 314572800; // 300 MiB

/**
 * Maximum number of bytes to accept from a single *decompressed* ZIP entry.
 *
 * This is deliberately decoupled from {@link MAX_DOWNLOAD_BYTES}, which bounds
 * the *compressed* download. XML inflates roughly 10-20x, so the all-titles
 * archive (~100-150 MB compressed) can decompress well past 300 MiB —
 * reusing the compressed cap as the inflate cap would false-drop legitimate
 * large titles (#226). 1 GiB still bounds a decompression bomb (the inflate is
 * aborted via `maxOutputLength`) while leaving ample headroom for real data.
 */
export const MAX_DECOMPRESSED_BYTES = 1073741824; // 1 GiB

/** Path for hash storage relative to working directory */
export const HASH_STORE_DIR = '.openlaw-git';
export const HASH_STORE_FILE = 'hashes.json';
