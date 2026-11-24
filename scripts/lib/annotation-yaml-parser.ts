/**
 * Zero-dependency YAML parser for `annotations/title-<N>/section-<N>.yaml` sidecars.
 * Supports both `annotationToYaml` double-quoted output and PyYAML single-quoted /
 * folded plain-scalar output, failing closed on invalid syntax or schema mismatch.
 */

import { PrecedentAnnotationSchema, err, ok, type PrecedentAnnotation, type Result } from '@civic-source/types';

type RawObj = Record<string, unknown>;
const YAML_ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029',
};

const RFC3339_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const REFRESH_BOOL_KEYS = new Set(['retainedPriorSnapshot', 'isStale']);
const REFRESH_INT_KEYS = new Set(['httpStatus', 'completedPages', 'expectedPages']);
const TOP_KEYS = new Set(['targetSection', 'lastSyncedET', 'totalCases']);
const REFRESH_KEYS = new Set([
  'source', 'scope', 'status', 'observedAt', 'lastSuccessAt',
  'retainedPriorSnapshot', 'isStale', 'httpStatus', 'failureKind', 'errorMessage',
  'completedPages', 'expectedPages',
]);

interface ParserState {
  doc: RawObj;
  section: 'top' | 'refreshStatus' | 'cases';
  refreshObj: RawObj | null;
  casesArr: RawObj[] | null;
  currentCase: RawObj | null;
  caseItemIndent: number;
  flowEmptyCases: boolean;
  fold: { obj: RawObj; key: string; indent: number } | null;
}

function normalizeIsoTimestamp(value: unknown, label: string): Result<string> {
  if (typeof value !== 'string' || !RFC3339_OFFSET_RE.test(value)) {
    return err(new Error(`Invalid timestamp for ${label}: ${String(value)}`));
  }
  if (value.endsWith('Z')) return ok(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return err(new Error(`Invalid date value for ${label}: ${value}`));
  return ok(new Date(ms).toISOString());
}

function decodeDoubleQuoted(raw: string): Result<string> {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
    return err(new Error('Unterminated double-quoted YAML scalar'));
  }
  let out = '';
  for (let i = 1; i < raw.length - 1; i += 1) {
    const ch = raw[i]!;
    if (ch === '"') return err(new Error('Unescaped quote inside double-quoted YAML scalar'));
    if (ch !== '\\') { out += ch; continue; }
    i += 1;
    if (i >= raw.length - 1) return err(new Error('Dangling escape in double-quoted YAML scalar'));
    const esc = raw[i]!;
    if (Object.hasOwn(YAML_ESCAPES, esc)) out += YAML_ESCAPES[esc];
    else if (esc === 'x' || esc === 'u' || esc === 'U') {
      const width = esc === 'x' ? 2 : esc === 'u' ? 4 : 8;
      const hex = raw.slice(i + 1, i + 1 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) return err(new Error('Invalid hexadecimal escape in YAML scalar'));
      const point = Number.parseInt(hex, 16);
      if (point > 0x10ffff) return err(new Error('Invalid Unicode code point in YAML scalar'));
      out += String.fromCodePoint(point);
      i += width;
    } else return err(new Error(`Unsupported YAML escape sequence \\${esc}`));
  }
  return ok(out);
}

function decodeSingleQuoted(raw: string): Result<string> {
  if (raw.length < 2 || raw[0] !== "'" || raw[raw.length - 1] !== "'") {
    return err(new Error('Unterminated single-quoted YAML scalar'));
  }
  let out = '';
  for (let i = 1; i < raw.length - 1; i += 1) {
    const ch = raw[i]!;
    if (ch === "'") {
      if (raw[i + 1] !== "'") return err(new Error('Unescaped single quote in YAML scalar'));
      out += "'";
      i += 1;
    } else {
      out += ch;
    }
  }
  return ok(out);
}

function parseScalarValue(rawTrimmed: string): Result<{ value: string; plain: boolean }> {
  if (rawTrimmed === '') return ok({ value: '', plain: true });
  if (rawTrimmed[0] === '"') {
    const r = decodeDoubleQuoted(rawTrimmed);
    return r.ok ? ok({ value: r.value, plain: false }) : r;
  }
  if (rawTrimmed[0] === "'") {
    const r = decodeSingleQuoted(rawTrimmed);
    return r.ok ? ok({ value: r.value, plain: false }) : r;
  }
  if (/^[[\]{}*&!|>]/.test(rawTrimmed)) {
    return err(new Error(`Unsupported YAML construct near "${rawTrimmed.slice(0, 32)}"`));
  }
  return ok({ value: rawTrimmed, plain: true });
}

function parseStrictKeyValue(body: string): Result<{ key: string; rawVal: string }> {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s+(.*))?$/s.exec(body);
  if (!m?.[1]) return err(new Error(`Malformed YAML key-value line: "${body.slice(0, 48)}"`));
  return ok({ key: m[1], rawVal: (m[2] ?? '').trim() });
}

function coerceRefreshField(key: string, val: string): Result<string | number | boolean> {
  if (REFRESH_BOOL_KEYS.has(key)) {
    if (val === 'true') return ok(true);
    if (val === 'false') return ok(false);
    return err(new Error(`Expected boolean for refreshStatus.${key}, got "${val}"`));
  }
  if (REFRESH_INT_KEYS.has(key)) {
    if (!/^-?\d+$/.test(val)) return err(new Error(`Expected integer for refreshStatus.${key}, got "${val}"`));
    return ok(Number.parseInt(val, 10));
  }
  return ok(val);
}

function stepRefreshLine(st: ParserState, indent: number, trimmed: string): Result<void> {
  const kv = parseStrictKeyValue(trimmed);
  if (!kv.ok) return kv;
  if (!REFRESH_KEYS.has(kv.value.key)) return err(new Error(`Unknown refreshStatus key: ${kv.value.key}`));
  const sc = parseScalarValue(kv.value.rawVal);
  if (!sc.ok) return sc;
  const coerced = coerceRefreshField(kv.value.key, sc.value.value);
  if (!coerced.ok) return coerced;
  st.refreshObj![kv.value.key] = coerced.value;
  if (sc.value.plain && typeof coerced.value === 'string') {
    st.fold = { obj: st.refreshObj!, key: kv.value.key, indent };
  }
  return ok(undefined);
}

function stepCasesLine(st: ParserState, indent: number, trimmed: string): Result<void> {
  if (trimmed === '-' || /^-\s+/.test(trimmed)) {
    if (st.flowEmptyCases) return err(new Error('Unexpected sequence item after cases: []'));
    if (st.caseItemIndent !== -1 && indent !== st.caseItemIndent) {
      return err(new Error('Inconsistent case sequence indentation'));
    }
    st.caseItemIndent = indent;
    const kv = parseStrictKeyValue(trimmed.replace(/^-\s*/, ''));
    if (!kv.ok) return kv;
    const sc = parseScalarValue(kv.value.rawVal);
    if (!sc.ok) return sc;
    st.currentCase = { [kv.value.key]: sc.value.value };
    st.casesArr!.push(st.currentCase);
    if (sc.value.plain) st.fold = { obj: st.currentCase, key: kv.value.key, indent: indent + 2 };
    return ok(undefined);
  }
  if (!st.currentCase || indent !== st.caseItemIndent + 2) {
    return err(new Error(`Unexpected indented YAML line in cases: "${trimmed}"`));
  }
  const kv = parseStrictKeyValue(trimmed);
  if (!kv.ok) return kv;
  const sc = parseScalarValue(kv.value.rawVal);
  if (!sc.ok) return sc;
  st.currentCase[kv.value.key] = sc.value.value;
  if (sc.value.plain) st.fold = { obj: st.currentCase, key: kv.value.key, indent };
  return ok(undefined);
}

function stepTopLine(st: ParserState, line: string, indent: number, trimmed: string): Result<void> {
  if (indent !== 0) return err(new Error(`Unexpected top-level indentation: "${line}"`));
  const kv = parseStrictKeyValue(trimmed);
  if (!kv.ok) return kv;
  const { key, rawVal } = kv.value;
  if (key === 'refreshStatus') {
    if (rawVal !== '') return err(new Error('refreshStatus must be a mapping block'));
    st.section = 'refreshStatus';
    st.refreshObj = {};
    st.doc.refreshStatus = st.refreshObj;
    return ok(undefined);
  }
  if (key === 'cases') {
    if (rawVal !== '' && rawVal !== '[]') return err(new Error(`Invalid cases value "${rawVal}"; expected [] or block list`));
    st.section = 'cases';
    st.casesArr = [];
    st.doc.cases = st.casesArr;
    st.flowEmptyCases = rawVal === '[]';
    st.caseItemIndent = -1;
    st.currentCase = null;
    return ok(undefined);
  }
  if (!TOP_KEYS.has(key)) return err(new Error(`Unexpected top-level annotation key: ${key}`));
  st.section = 'top';
  const sc = parseScalarValue(rawVal);
  if (!sc.ok) return sc;
  if (key === 'totalCases') {
    if (!/^\d+$/.test(sc.value.value)) return err(new Error(`Expected non-negative integer totalCases, got "${sc.value.value}"`));
    st.doc.totalCases = Number.parseInt(sc.value.value, 10);
  } else {
    st.doc[key] = sc.value.value;
  }
  return ok(undefined);
}

function normalizeAndValidateAnnotation(doc: RawObj): Result<PrecedentAnnotation> {
  const syncedRes = normalizeIsoTimestamp(doc.lastSyncedET, 'lastSyncedET');
  if (!syncedRes.ok) return syncedRes;
  doc.lastSyncedET = syncedRes.value;
  if (doc.refreshStatus && typeof doc.refreshStatus === 'object') {
    const rf = doc.refreshStatus as RawObj;
    const obsRes = normalizeIsoTimestamp(rf.observedAt, 'refreshStatus.observedAt');
    if (!obsRes.ok) return obsRes;
    rf.observedAt = obsRes.value;
    if (rf.lastSuccessAt !== undefined) {
      const lsRes = normalizeIsoTimestamp(rf.lastSuccessAt, 'refreshStatus.lastSuccessAt');
      if (!lsRes.ok) return lsRes;
      rf.lastSuccessAt = lsRes.value;
    }
  }
  if (!Array.isArray(doc.cases)) return err(new Error('Annotation YAML missing cases array'));
  for (let i = 0; i < doc.cases.length; i += 1) {
    const c = doc.cases[i] as RawObj;
    if (c.retrievedAt !== undefined) {
      const retRes = normalizeIsoTimestamp(c.retrievedAt, `cases[${i}].retrievedAt`);
      if (!retRes.ok) return retRes;
      c.retrievedAt = retRes.value;
    }
  }
  const parsed = PrecedentAnnotationSchema.safeParse(doc);
  return parsed.success ? ok(parsed.data) : err(new Error(`Annotation schema invalid: ${parsed.error.message}`));
}

function quotedScalarIsClosed(raw: string): boolean {
  const quote = raw[0];
  for (let i = 1; i < raw.length; i += 1) {
    if (quote === '"' && raw[i] === '\\') { i += 1; continue; }
    if (raw[i] !== quote) continue;
    if (quote === "'" && raw[i + 1] === "'") { i += 1; continue; }
    return true;
  }
  return false;
}

/** Fold quoted continuation lines before the mapping parser consumes logical lines. */
function foldQuotedLines(raw: string): Result<string[]> {
  const logical: string[] = [];
  let pending: { prefix: string; scalar: string; indent: number } | null = null;
  let blanks = 0;
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const indent = /^ */.exec(line)![0].length;
    if (line[indent] === '\t') return err(new Error('Tabs are forbidden in YAML indentation'));
    if (pending) {
      if (!line.trim()) { blanks += 1; continue; }
      if (indent <= pending.indent) return err(new Error('Invalid quoted scalar continuation indentation'));
      const trailingSlashes = /\\+$/.exec(pending.scalar)?.[0].length ?? 0;
      const escapedBreak = pending.scalar[0] === '"' && trailingSlashes % 2 === 1;
      if (escapedBreak) pending.scalar = pending.scalar.slice(0, -1);
      pending.scalar += (blanks ? '\n'.repeat(blanks) : escapedBreak ? '' : ' ') + line.trim();
      blanks = 0;
      if (!quotedScalarIsClosed(pending.scalar)) continue;
      logical.push(pending.prefix + pending.scalar);
      pending = null;
      continue;
    }
    const match = /^( *(?:-\s+)?[A-Za-z_][A-Za-z0-9_]*:\s+)(['"][\s\S]*)$/.exec(line);
    if (match?.[1] && match[2] && !quotedScalarIsClosed(match[2])) {
      pending = { prefix: match[1], scalar: match[2], indent: indent + (line.trimStart().startsWith('- ') ? 2 : 0) };
    } else logical.push(line);
  }
  return pending ? err(new Error('Unterminated quoted YAML scalar')) : ok(logical);
}

/** Parse and validate an annotation YAML sidecar without external YAML dependencies. */
export function parseAnnotationYaml(raw: string): Result<PrecedentAnnotation> {
  if (!raw || raw.includes('\0')) return err(new Error('Annotation YAML is empty or contains NUL bytes'));
  const lines = foldQuotedLines(raw);
  if (!lines.ok) return lines;
  const st: ParserState = {
    doc: {}, section: 'top', refreshObj: null, casesArr: null,
    currentCase: null, caseItemIndent: -1, flowEmptyCases: false, fold: null,
  };
  for (const line of lines.value) {
    if (!line.trim()) continue;
    const indent = /^ */.exec(line)![0].length;
    if (line[indent] === '\t') return err(new Error('Tabs are forbidden in YAML indentation'));
    const trimmed = line.slice(indent).trimEnd();
    if (st.fold && indent > st.fold.indent) {
      st.fold.obj[st.fold.key] = st.fold.obj[st.fold.key] ? `${String(st.fold.obj[st.fold.key])} ${trimmed}` : trimmed;
      continue;
    }
    st.fold = null;
    const step =
      st.section === 'refreshStatus' && indent > 0
        ? stepRefreshLine(st, indent, trimmed)
        : st.section === 'cases' && (indent > 0 || trimmed.startsWith('-'))
          ? stepCasesLine(st, indent, trimmed)
          : stepTopLine(st, line, indent, trimmed);
    if (!step.ok) return step;
  }
  return normalizeAndValidateAnnotation(st.doc);
}
