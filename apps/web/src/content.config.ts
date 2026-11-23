import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const statutes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content-data/statutes' }),
  schema: z.object({
    title: z.string(),
    usc_title: z.union([z.string(), z.number()]).transform((val) => String(val)),
    usc_section: z.string(),
    chapter: z.number(),
    current_through: z.string(),
    classification: z.string(),
    generated_at: z.string().optional(),
    status: z.enum(['active', 'repealed', 'reserved', 'omitted', 'transferred', 'renumbered']).default('active'),
  }),
});

const annotations = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './content-data/annotations' }),
  schema: z.object({
    targetSection: z.string(),
    lastSyncedET: z.string(),
    totalCases: z.number().optional(),
    refreshStatus: z.object({
      source: z.string(),
      scope: z.string(),
      status: z.enum(['success-empty', 'success-nonempty', 'partial', 'failed', 'absent', 'not_collected']),
      observedAt: z.string(),
      lastSuccessAt: z.string().optional(),
      retainedPriorSnapshot: z.boolean().default(false),
      isStale: z.boolean().default(false),
      httpStatus: z.number().optional(),
      failureKind: z.string().optional(),
      errorMessage: z.string().optional(),
    }).optional(),
    cases: z.array(z.object({
      caseName: z.string(),
      citation: z.string().optional(),
      court: z.string(),
      date: z.string(),
      holdingSummary: z.string().optional(),
      retrievalExcerpt: z.string().optional(),
      reviewedProposition: z.string().optional(),
      supportingOpinionPassage: z.string().optional(),
      retrievalQuery: z.string().optional(),
      retrievedAt: z.string().optional(),
      extractionState: z.enum(['candidate', 'verified', 'rejected']).optional(),
      editorialReview: z.enum(['unreviewed', 'accepted', 'disputed', 'superseded']).optional(),
      versionAlignmentState: z.enum(['verified', 'candidate', 'ambiguous', 'unknown']).optional(),
      sourceUrl: z
        .string()
        .refine((u) => u === '' || /^https?:\/\//i.test(u), {
          message: 'sourceUrl must use the http(s) scheme',
        })
        .optional(),
      impact: z.string().optional(),
      statuteVersionRef: z.string().optional(),
      statuteVersionNote: z.string().optional(),
    })).default([]),
  }),
});

const regulations = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './content-data/regulations' }),
  schema: z.object({
    targetSection: z.string(),
    lastUpdated: z.string().optional(),
    refreshStatus: z.object({
      source: z.string(),
      scope: z.string(),
      status: z.enum(['success-empty', 'success-nonempty', 'partial', 'failed', 'absent', 'not_collected']),
      observedAt: z.string(),
      lastSuccessAt: z.string().optional(),
      retainedPriorSnapshot: z.boolean().default(false),
      isStale: z.boolean().default(false),
      httpStatus: z.number().optional(),
      failureKind: z.string().optional(),
      errorMessage: z.string().optional(),
    }).optional(),
    regulations: z.array(z.object({
      cfrTitle: z.number(),
      cfrPart: z.number(),
      agency: z.string(),
      description: z.string().optional(),
      ecfrUrl: z.string().refine((u) => /^https?:\/\//i.test(u), {
        message: 'ecfrUrl must use the http(s) scheme',
      }),
      extractionState: z.enum(['candidate', 'verified', 'rejected']).default('candidate'),
      editorialReview: z.enum(['unreviewed', 'accepted', 'disputed', 'superseded']).default('unreviewed'),
      relationshipType: z.enum(['text_match_candidate', 'cites', 'authority_citation', 'implements_verified']).default('text_match_candidate'),
      discoveryQuery: z.string().optional(),
      matchingEvidence: z.string().optional(),
      verifiedAuthorityText: z.string().optional(),
      retrievedAt: z.string().optional(),
    })).default([]),
  }),
});

const legislativeHistory = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './content-data/legislative' }),
  schema: z.object({
    targetSection: z.string(),
    lastUpdated: z.string().optional(),
    history: z.array(z.object({
      publicLaw: z.string(),
      congress: z.number(),
      billNumber: z.string().optional(),
      enactedDate: z.string().optional(),
      effectiveDateNote: z.string().optional(),
      applicabilityState: z.enum(['known', 'conditional', 'disputed', 'unknown']).optional(),
      crsSummary: z.string().optional(),
      enactedTextExcerpt: z.string().optional(),
      sourceCreditText: z.string().optional(),
      extractionState: z.enum(['candidate', 'verified', 'rejected']).optional(),
      editorialReview: z.enum(['unreviewed', 'accepted', 'disputed', 'superseded']).optional(),
      statutesAtLargeCitation: z.string().optional(),
      statutesAtLargeUrl: z.string().optional(),
      committeeReports: z.array(z.object({
        reportNumber: z.string(),
        chamber: z.enum(['House', 'Senate', 'Conference']),
        url: z.string(),
      })).default([]),
    })).default([]),
  }),
});

export const collections = { statutes, annotations, regulations, legislativeHistory };
