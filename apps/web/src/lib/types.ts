export interface CaseAnnotation {
  caseName: string;
  citation: string;
  court: 'SCOTUS' | 'Appellate' | 'District';
  date: string;
  holdingSummary: string;
  url: string;
}

export interface PrecedentData {
  targetSection: string;
  lastSyncedET: string;
  cases: CaseAnnotation[];
}
