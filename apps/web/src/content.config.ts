import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const statutes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content-data/statutes' }),
  schema: z.object({
    title: z.string(),
    usc_title: z.number(),
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
    })).default([]),
  }),
});

export const collections = { statutes, annotations };
