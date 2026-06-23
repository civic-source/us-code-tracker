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

// --- Shared field schemas ---

/**
 * A URL constrained to the http(s) scheme. Plain `z.url()` accepts dangerous
 * schemes such as `javascript:` and `data:`; several of these values are later
 * rendered as `href`s or used to download content, so we reject anything that
 * is not http/https at the validation boundary (defense-in-depth — see #210).
 */
export const HttpUrlSchema = z
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'URL must use the http(s) scheme' });

// --- Release Point schema ---

export const ReleasePointSchema = z.object({
  /** Title number (e.g., "26" for Internal Revenue Code) */
  title: z.string().min(1),
  /** Public law reference (e.g., "PL 118-200") */
  publicLaw: z.string(),
  /** Release date in ISO 8601 datetime format (ET timezone) */
  dateET: z.string().datetime(),
  /** URL to the USLM XML download for this release */
  uslmUrl: HttpUrlSchema,
  /** SHA-256 hex digest for integrity verification (64 hex characters) */
  sha256Hash: z.string().length(64),
});

export type ReleasePoint = z.infer<typeof ReleasePointSchema>;

// --- Precedent Annotation schema ---

/** Impact classification for how a case affects the statute */
export const PrecedentImpactSchema = z.enum([
  'interpretation',
  'unconstitutional',
  'narrowed',
  'historical',
]);

export type PrecedentImpact = z.infer<typeof PrecedentImpactSchema>;

export const CaseAnnotationSchema = z.object({
  caseName: z.string(),
  citation: z.string(),
  court: z.enum(["SCOTUS", "Appellate", "District"]),
  date: z.string(),
  holdingSummary: z.string().max(500),
  sourceUrl: HttpUrlSchema,
  impact: PrecedentImpactSchema,
  /** Public Law the statute was current through when this case was decided */
  statuteVersionRef: z.string().optional(),
  /** Human-readable note about version alignment */
  statuteVersionNote: z.string().optional(),
});

export const PrecedentAnnotationSchema = z.object({
  targetSection: z.string(),
  lastSyncedET: z.string().datetime(),
  cases: z.array(CaseAnnotationSchema),
});

export type PrecedentAnnotation = z.infer<typeof PrecedentAnnotationSchema>;

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
