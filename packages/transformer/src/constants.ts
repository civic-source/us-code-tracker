/** USLM XML element names and transformer configuration */

/** Structural USLM element names (hierarchy order) */
export const USLM_ELEMENTS = {
  /** Top-level document wrapper (USLM 2.0) */
  lawDoc: 'lawDoc',
  /** Top-level document wrapper (USLM 1.0, used by OLRC) */
  uscDoc: 'uscDoc',
  /** Main content wrapper (USLM 1.0 wraps content in <main>) */
  main: 'main',
  /** Title of the US Code (e.g., Title 26) */
  title: 'title',
  /** Subtitle grouping */
  subtitle: 'subtitle',
  /** Chapter grouping */
  chapter: 'chapter',
  /** Subchapter grouping */
  subchapter: 'subchapter',
  /** Part grouping */
  part: 'part',
  /** Subpart grouping */
  subpart: 'subpart',
  /** Division grouping */
  division: 'division',
  /** Individual section — primary unit of law */
  section: 'section',
  /** Subsection within a section */
  subsection: 'subsection',
  /** Paragraph within a subsection */
  paragraph: 'paragraph',
  /** Subparagraph */
  subparagraph: 'subparagraph',
  /** Clause */
  clause: 'clause',
  /** Subclause */
  subclause: 'subclause',
  /** Heading element */
  heading: 'heading',
  /** Section number/identifier */
  num: 'num',
  /** Content/text wrapper */
  content: 'content',
  /** Chapeau (introductory text before a list) */
  chapeau: 'chapeau',
  /** Note element */
  note: 'note',
  /** Cross-reference */
  ref: 'ref',
  /** Table element */
  table: 'table',
} as const;

/** Indentation per nesting level (in spaces) */
export const INDENT_PER_LEVEL = 2;

/** Maximum nesting depth for safety (prevent runaway recursion) */
export const MAX_NESTING_DEPTH = 20;
