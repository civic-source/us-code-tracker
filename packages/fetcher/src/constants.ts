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
  const paddedTitle = title.padStart(2, '0');
  return `${OLRC_RELEASE_POINTS_URL}us/pl/${congress}/${law}/xml_usc${paddedTitle}@${congress}-${law}.zip`;
}

/**
 * Build a URL for the all-titles XML ZIP download for a release point.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{law}/xml_uscAll@{congress}-{law}.zip
 */
export function allTitlesXmlUrl(congress: string, law: string): string {
  return `${OLRC_RELEASE_POINTS_URL}us/pl/${congress}/${law}/xml_uscAll@${congress}-${law}.zip`;
}

/** Path for hash storage relative to working directory */
export const HASH_STORE_DIR = '.openlaw-git';
export const HASH_STORE_FILE = 'hashes.json';
