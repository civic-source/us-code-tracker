import { z } from 'zod';

// --- Result type ---

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// --- Release Point schema ---

export const ReleasePointSchema = z.object({
  /** Title number (e.g., "26" for Internal Revenue Code) */
  title: z.string().min(1),
  /** Release date in YYYY-MM-DD format */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** URL to the XML download for this release */
  xmlUrl: z.string().url(),
  /** Optional hash for integrity verification */
  hash: z.string().optional(),
});

export type ReleasePoint = z.infer<typeof ReleasePointSchema>;

// --- Interfaces ---

/** Fetches US Code release points from the OLRC */
export interface IUsCodeFetcher {
  /** List available release points, optionally filtered by title */
  listReleasePoints(title?: string): Promise<Result<ReleasePoint[]>>;
  /** Download XML content for a specific release point */
  fetchXml(releasePoint: ReleasePoint): Promise<Result<string>>;
}

/** Converts OLRC XML to Markdown */
export interface IXmlToMarkdownAdapter {
  /** Transform a single XML document to Markdown */
  transform(xml: string): Result<string>;
}
