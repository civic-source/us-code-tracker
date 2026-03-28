/** OLRC US Code release point URLs and configuration */

export const OLRC_BASE_URL = 'https://uscode.house.gov';
export const OLRC_DOWNLOAD_PAGE = `${OLRC_BASE_URL}/download/download.shtml`;
export const OLRC_RELEASE_POINTS_URL = `${OLRC_BASE_URL}/download/releasepoints/`;

/**
 * Build a URL for an individual title's XML ZIP download.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{title}.zip
 */
export function titleXmlUrl(releasePoint: string, title: string): string {
  return `${OLRC_RELEASE_POINTS_URL}us/pl/${releasePoint}/${title}.zip`;
}

/** Maximum retry attempts for network requests */
export const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubles each retry) */
export const BASE_BACKOFF_MS = 1000;

/** Path for hash storage relative to working directory */
export const HASH_STORE_DIR = '.openlaw-git';
export const HASH_STORE_FILE = 'hashes.json';

/** IANA timezone for all date operations */
export const TIMEZONE = 'America/New_York';
