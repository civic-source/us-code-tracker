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
    cases: z.array(z.object({
      caseName: z.string(),
      citation: z.string().optional(),
      court: z.string(),
      date: z.string(),
      holdingSummary: z.string().optional(),
      // Constrain to http(s) (or empty) so a malformed annotation can't inject
      // a `javascript:`/`data:` URL that the precedent UI renders as an href (#210).
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
    regulations: z.array(z.object({
      cfrTitle: z.number(),
      cfrPart: z.number(),
      agency: z.string(),
      description: z.string().optional(),
      ecfrUrl: z.string().refine((u) => /^https?:\/\//i.test(u), {
        message: 'ecfrUrl must use the http(s) scheme',
      }),
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
      crsSummary: z.string().optional(),
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
