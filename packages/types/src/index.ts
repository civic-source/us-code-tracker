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

/**
 * A URL constrained to the http(s) scheme or an empty string. Used for external
 * source URLs that collapse to empty string when failing origin validation without
 * rejecting the entire annotation record (#248).
 */
export const OptionalHttpUrlSchema = z
  .string()
  .refine((u) => u === '' || /^https?:\/\//i.test(u), { message: 'URL must use the http(s) scheme or be empty' });

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
  // Length caps bound untrusted CourtListener-derived strings that flow into
  // the hand-rolled YAML sidecar serialization, so a hostile or accidentally
  // huge value cannot bloat output or widen the injection surface (#232).
  caseName: z.string().max(500),
  citation: z.string().max(200),
  court: z.enum(["SCOTUS", "Appellate", "District"]),
  date: z.string(),
  holdingSummary: z.string().max(500),
  sourceUrl: OptionalHttpUrlSchema,
  impact: PrecedentImpactSchema,
  /** Public Law the statute was current through when this case was decided */
  statuteVersionRef: z.string().max(100).optional(),
  /** Human-readable note about version alignment */
  statuteVersionNote: z.string().max(500).optional(),
});

export const PrecedentAnnotationSchema = z.object({
  targetSection: z.string(),
  lastSyncedET: z.string().datetime(),
  cases: z.array(CaseAnnotationSchema),
});

export type PrecedentAnnotation = z.infer<typeof PrecedentAnnotationSchema>;

// --- Implementing Regulations (eCFR PTOA) schema ---

export const ImplementingRegulationSchema = z.object({
  /** CFR Title number */
  cfrTitle: z.number().int().positive(),
  /** CFR Part number */
  cfrPart: z.number().int().positive(),
  /** Agency name (e.g. "Environmental Protection Agency") */
  agency: z.string().max(300),
  /** Subject description */
  description: z.string().max(500).optional(),
  /** Authoritative eCFR URL */
  ecfrUrl: HttpUrlSchema,
});

export type ImplementingRegulation = z.infer<typeof ImplementingRegulationSchema>;

export const SectionRegulationsSchema = z.object({
  targetSection: z.string(), // e.g. "18-111"
  lastUpdated: z.string().datetime(),
  regulations: z.array(ImplementingRegulationSchema),
});

export type SectionRegulations = z.infer<typeof SectionRegulationsSchema>;

// --- Legislative History (Congress.gov / GovInfo) schema ---

export const LegislativeHistoryItemSchema = z.object({
  /** Public Law identifier, e.g. "PL 104-132" */
  publicLaw: z.string().max(100),
  congress: z.number().int().positive(),
  billNumber: z.string().max(50).optional(),
  enactedDate: z.string().optional(),
  /** Non-partisan CRS summary of the enacted measure */
  crsSummary: z.string().max(3000).optional(),
  statutesAtLargeCitation: z.string().max(100).optional(), // e.g. "110 Stat. 1302"
  statutesAtLargeUrl: OptionalHttpUrlSchema.optional(),
  committeeReports: z.array(z.object({
    reportNumber: z.string().max(100),
    chamber: z.enum(['House', 'Senate', 'Conference']),
    url: OptionalHttpUrlSchema,
  })).default([]),
});

export type LegislativeHistoryItem = z.infer<typeof LegislativeHistoryItemSchema>;

export const SectionLegislativeHistorySchema = z.object({
  targetSection: z.string(),
  lastUpdated: z.string().datetime(),
  history: z.array(LegislativeHistoryItemSchema),
});

export type SectionLegislativeHistory = z.infer<typeof SectionLegislativeHistorySchema>;

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
