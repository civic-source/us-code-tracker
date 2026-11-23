import type { PrecedentAnnotation } from '@civic-source/types';

/** A single case annotation — extracted from PrecedentAnnotation.cases array */
export type CaseAnnotation = PrecedentAnnotation['cases'][number];

/** Re-export for convenience */
export type PrecedentData = PrecedentAnnotation;

export interface CuratedTopicDataset {
  schemaVersion: 'usct.curated-topic/v1';
  topicSlug: string;
  title: string;
  summary: string;
  scopeNote: string;
  curator: string;
  lastReviewedAt: string;
  currentReleaseId: string;
  memberProvisions: Array<{
    provisionId: string;
    citation: string;
    heading: string;
    url: string;
    roleInTopic: string;
    extractionState: 'verified';
    editorialReview: 'accepted';
    legacyDerived: boolean;
  }>;
  relatedAuthorities: Array<{
    authorityId: string;
    label: string;
    authorityKind: string;
    relationshipType: string;
    targetCitation: string;
    extractionState: string;
    editorialReview: string;
    summary: string;
    sourceUrl: string;
  }>;
  changeEvents: Array<{
    eventId: string;
    eventKind: string;
    occurredAt: string;
    releaseId: string;
    affectedCitation: string;
    title: string;
    summary: string;
    diffUrl?: string;
    evidenceLocator: string;
    artifactSha256?: string;
  }>;
}
