import { createHash } from 'node:crypto';

/** SHA-256 hex digest of a string */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** A file with its path and content hash */
export interface HashedFile {
  path: string;
  hash: string;
}

/** Result of comparing two sets of files */
export interface DeltaResult {
  /** Files that are new or have changed content */
  changed: string[];
  /** Files that existed before but are not in the new set */
  deleted: string[];
  /** Files that are identical to the previous version */
  unchanged: string[];
}

/**
 * Build a hash manifest from an array of {path, content} pairs.
 * Returns a map of path -> SHA-256 hash.
 */
export function buildManifest(
  files: ReadonlyArray<{ path: string; content: string }>
): Map<string, string> {
  const manifest = new Map<string, string>();
  for (const file of files) {
    manifest.set(file.path, hashContent(file.content));
  }
  return manifest;
}

/**
 * Compare a new file manifest against a previous one.
 * Identifies changed, deleted, and unchanged files.
 */
export function detectDelta(
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>
): DeltaResult {
  const changed: string[] = [];
  const unchanged: string[] = [];
  const deleted: string[] = [];

  // Check current files against previous
  for (const [path, hash] of current) {
    const prevHash = previous.get(path);
    if (prevHash === undefined || prevHash !== hash) {
      changed.push(path);
    } else {
      unchanged.push(path);
    }
  }

  // Check for deletions (in previous but not in current)
  for (const path of previous.keys()) {
    if (!current.has(path)) {
      deleted.push(path);
    }
  }

  return { changed, deleted, unchanged };
}
