import {
  OLRC_BASE_URL,
  OLRC_DOWNLOAD_PAGE,
  OLRC_LEGACY_DOWNLOAD_PAGE,
  OLRC_PRIOR_RELEASE_POINTS_PAGE,
  OLRC_LEGACY_PRIOR_RELEASE_POINTS_PAGE,
  OLRC_RELEASE_POINTS_URL,
  buildOlrcTitleZipUrl,
} from '@civic-source/shared';

/** OLRC US Code release point URLs and configuration */
export {
  OLRC_BASE_URL,
  OLRC_DOWNLOAD_PAGE,
  OLRC_LEGACY_DOWNLOAD_PAGE,
  OLRC_PRIOR_RELEASE_POINTS_PAGE,
  OLRC_LEGACY_PRIOR_RELEASE_POINTS_PAGE,
  OLRC_RELEASE_POINTS_URL,
};

/**
 * Build a URL for an individual title's XML ZIP download.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{law}/xml_usc{title}@{congress}-{law}.zip
 */
export function titleXmlUrl(congress: string, law: string, title: string): string {
  return buildOlrcTitleZipUrl(congress, law, title);
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
 * Maximum number of bytes to accept from a single *decompressed* `.xml` entry.
 *
 * `extractXmlFromZip` returns the first `.xml` entry of a single-title ZIP, so
 * this bounds *one title's* inflated XML — not a whole archive. It is decoupled
 * from {@link MAX_DOWNLOAD_BYTES} (which bounds the *compressed* download)
 * because XML inflates roughly 10-20x: a title whose compressed entry sits well
 * under the download cap can still inflate past 300 MiB, and reusing the
 * compressed cap as the inflate cap would false-drop it. The largest single USC
 * title decompresses to well under 500 MiB, so this leaves ample headroom for
 * real data while strictly staying within V8 MAX_STRING_LENGTH (~512 MB) to
 * avoid RangeError during buffer-to-string decoding.
 */
export const MAX_DECOMPRESSED_BYTES = 524288000; // 500 MiB

/** Path for hash storage relative to working directory */
export const HASH_STORE_DIR = '.openlaw-git';
export const HASH_STORE_FILE = 'hashes.json';
