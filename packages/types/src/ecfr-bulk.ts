import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const title = z.number().int().min(1).max(50);
const titles = z.array(title).min(1).refine((values) => new Set(values).size === values.length, 'Duplicate CFR titles');

export const EcfrBulkBlobSchema = z.object({ sha256: digest, byteLength: z.number().int().nonnegative() }).strict();
export type EcfrBulkBlob = z.infer<typeof EcfrBulkBlobSchema>;

export const EcfrBulkSourceSchema = z.object({
  title,
  url: z.string().url(),
  blob: EcfrBulkBlobSchema,
  lastModified: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  amendmentDateText: z.string().nullable().default(null),
}).strict().refine((value) => value.url === `https://www.govinfo.gov/bulkdata/ECFR/title-${value.title}/ECFR-title${value.title}.xml`, 'Unexpected source URL');
export type EcfrBulkSource = z.infer<typeof EcfrBulkSourceSchema>;

export const EcfrBulkAuthoritySchema = z.object({
  cfrTitle: title,
  sourceSha256: digest,
  ordinal: z.number().int().positive(),
  nodePath: z.string().min(1),
  scope: z.string().min(1),
  part: z.string().nullable(),
  section: z.string().nullable(),
  heading: z.string(),
  agency: z.string(),
  tag: z.enum(['AUTH', 'SECAUTH', 'PARAUTH']),
  rawText: z.string().max(131072),
  text: z.string().max(131072),
  sourceLine: z.number().int().positive(),
}).strict();
export type EcfrBulkAuthority = z.infer<typeof EcfrBulkAuthoritySchema>;

export const EcfrBulkExtractedTitleSchema = z.object({
  schemaVersion: z.literal('usct.ecfr-bulk-title/v1'),
  cfrTitle: title,
  sourceSha256: digest,
  amendmentDateText: z.string().nullable(),
  authorities: z.array(EcfrBulkAuthoritySchema),
}).strict();
export type EcfrBulkExtractedTitle = z.infer<typeof EcfrBulkExtractedTitleSchema>;

export const EcfrBulkIndexSchema = z.object({
  schemaVersion: z.literal('usct.ecfr-bulk-index/v1'),
  extractorVersion: z.string().min(1),
  extractorDigest: digest,
  titles: z.array(EcfrBulkExtractedTitleSchema),
}).strict();
export type EcfrBulkIndex = z.infer<typeof EcfrBulkIndexSchema>;

export const EcfrBulkSnapshotSchema = z.object({
  schemaVersion: z.literal('usct.ecfr-bulk-snapshot/v1'),
  snapshotId: digest,
  capturedAt: z.string().datetime(),
  inventoryTitles: titles,
  selectedTitles: titles,
  sources: z.array(EcfrBulkSourceSchema).min(1),
  extractorVersion: z.string().min(1),
  extractorDigest: digest,
  index: EcfrBulkBlobSchema,
  producerRevision: z.string().optional(),
}).strict().superRefine((value, context) => {
  const found = value.sources.map((source) => source.title);
  if (new Set(found).size !== found.length || found.length !== value.selectedTitles.length ||
      value.selectedTitles.some((item) => !found.includes(item) || !value.inventoryTitles.includes(item))) {
    context.addIssue({ code: 'custom', message: 'Selected source inventory is incomplete or inconsistent' });
  }
});
export type EcfrBulkSnapshot = z.infer<typeof EcfrBulkSnapshotSchema>;

export const EcfrBulkHitSchema = z.object({
  authority: EcfrBulkAuthoritySchema,
  matchedCitation: z.string().min(1),
  matchType: z.enum(['single', 'range']),
  extractionState: z.literal('candidate'),
  editorialReview: z.literal('unreviewed'),
}).strict();

export const EcfrBulkProjectionSchema = z.object({
  schemaVersion: z.literal('usct.ecfr-bulk-projection/v1'),
  snapshotId: digest,
  indexSha256: digest,
  projectionVersion: z.string().min(1),
  uscTitle: z.string().regex(/^[1-9][0-9]*[a-zA-Z]?$/),
  cohort: z.array(z.string().regex(/^[a-zA-Z0-9-]+$/)),
  inventoryCfrTitles: titles,
  searchedCfrTitles: titles,
  corpusComplete: z.boolean(),
  sections: z.array(z.object({ section: z.string().min(1), hits: z.array(EcfrBulkHitSchema) }).strict()),
  unresolvedCitationCount: z.number().int().nonnegative(),
}).strict();
export type EcfrBulkProjection = z.infer<typeof EcfrBulkProjectionSchema>;

export const EcfrBulkArchiveSchema = z.object({
  schemaVersion: z.literal('usct.ecfr-bulk-archive/v1'),
  snapshot: EcfrBulkSnapshotSchema,
  products: z.array(EcfrBulkBlobSchema),
  blobs: z.array(EcfrBulkBlobSchema),
}).strict();
export type EcfrBulkArchive = z.infer<typeof EcfrBulkArchiveSchema>;
