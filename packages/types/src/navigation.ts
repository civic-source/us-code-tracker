import { z } from 'zod';

export const RouteIdentitySchema = z.strictObject({
  publicationId: z.string().min(1).max(160),
  acceptedDataCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  releaseId: z.string().regex(/^pl-\d+-[0-9a-z-]+$/),
  titleId: z.string().regex(/^\d+[a-z]?$/),
});
export type RouteIdentity = z.infer<typeof RouteIdentitySchema>;

export const RouteIndexSchema = z.strictObject({
  schemaVersion: z.literal('usct.route-index/v1'),
  identity: RouteIdentitySchema,
  entries: z.array(z.strictObject({
    section: z.string().regex(/^\d+[a-zA-Z]*(?:-\d+[a-zA-Z]*)*$/),
    path: z.string().regex(/^title-\d+[a-z]?\/chapter-\d+[a-zA-Z-]*\/section-[0-9a-zA-Z-]+$/),
    disposition: z.string().min(1).max(80),
  })).max(20000),
});
export type RouteIndex = z.infer<typeof RouteIndexSchema>;
