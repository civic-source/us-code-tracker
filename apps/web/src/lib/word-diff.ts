/**
 * Myers' diff algorithm for word-level intraline redline comparison.
 *
 * Implements Eugene W. Myers' $O(ND)$ Shortest Edit Script (SES) algorithm
 * with $O(N)$ common prefix/suffix optimization and safety threshold fallback.
 */

export interface WordToken {
  type: 'context' | 'add' | 'del';
  text: string;
}

/**
 * Tokenize text into words, whitespace sequences, and individual punctuation marks.
 */
export function tokenizeWords(text: string): string[] {
  if (!text) return [];
  return text.match(/\w+|\s+|[^\w\s]/g) || [];
}

/**
 * Maximum product of tokens (N * M) or token count before falling back to
 * block-level diffing to guarantee the UI thread is never locked.
 */
const MAX_MYERS_CELLS = 250_000;
const MAX_TOTAL_TOKENS = 1_500;

/**
 * Compute word-level diff between two text strings using Myers' algorithm.
 */
export function computeWordDiff(oldText: string, newText: string): WordToken[] {
  if (oldText === newText) {
    return oldText.length > 0 ? [{ type: 'context', text: oldText }] : [];
  }

  const a = tokenizeWords(oldText);
  const b = tokenizeWords(newText);
  const n = a.length;
  const m = b.length;

  if (n === 0) {
    return b.map((text) => ({ type: 'add' as const, text }));
  }
  if (m === 0) {
    return a.map((text) => ({ type: 'del' as const, text }));
  }

  // 1. Fast common prefix strip: O(min(N, M))
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) {
    prefix++;
  }

  // 2. Fast common suffix strip: O(min(N, M))
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    a[n - 1 - suffix] === b[m - 1 - suffix]
  ) {
    suffix++;
  }

  const result: WordToken[] = [];
  for (let i = 0; i < prefix; i++) {
    result.push({ type: 'context', text: a[i]! });
  }

  const midA = a.slice(prefix, n - suffix);
  const midB = b.slice(prefix, m - suffix);
  const midN = midA.length;
  const midM = midB.length;

  if (midN === 0 && midM === 0) {
    // Exact match apart from prefix/suffix
  } else if (midN === 0) {
    for (const text of midB) {
      result.push({ type: 'add', text });
    }
  } else if (midM === 0) {
    for (const text of midA) {
      result.push({ type: 'del', text });
    }
  } else if (midN * midM > MAX_MYERS_CELLS || midN + midM > MAX_TOTAL_TOKENS) {
    // Safety cap fallback for extremely massive structural diffs
    for (const text of midA) result.push({ type: 'del', text });
    for (const text of midB) result.push({ type: 'add', text });
  } else {
    // 3. Myers' SES on the remaining divergent middle slice
    const max = midN + midM;
    const vOffset = max;
    const v = new Int32Array(2 * max + 1);
    v[vOffset + 1] = 0;
    const trace: Int32Array[] = [];

    let reached = false;
    for (let d = 0; d <= max; d++) {
      trace.push(new Int32Array(v));
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[vOffset + k - 1]! < v[vOffset + k + 1]!)) {
          x = v[vOffset + k + 1]!; // insertion (down)
        } else {
          x = v[vOffset + k - 1]! + 1; // deletion (right)
        }
        let y = x - k;

        while (x < midN && y < midM && midA[x] === midB[y]) {
          x++;
          y++;
        }
        v[vOffset + k] = x;

        if (x >= midN && y >= midM) {
          reached = true;
          break;
        }
      }
      if (reached) break;
    }

    // 4. Backtrack through trace history to reconstruct edit operations
    let currX = midN;
    let currY = midM;
    const midTokens: WordToken[] = [];

    for (let d = trace.length - 1; d > 0; d--) {
      const prevV = trace[d]!;
      const k = currX - currY;

      let prevK: number;
      if (k === -d || (k !== d && prevV[vOffset + k - 1]! < prevV[vOffset + k + 1]!)) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = prevV[vOffset + prevK]!;
      const prevY = prevX - prevK;

      // Diagonal snake items (context matches)
      while (currX > prevX && currY > prevY) {
        currX--;
        currY--;
        midTokens.unshift({ type: 'context', text: midA[currX]! });
      }

      if (d > 0) {
        if (currX === prevX) {
          // Insertion
          currY--;
          midTokens.unshift({ type: 'add', text: midB[currY]! });
        } else {
          // Deletion
          currX--;
          midTokens.unshift({ type: 'del', text: midA[currX]! });
        }
      }
    }

    // Any remaining leading items
    while (currX > 0 && currY > 0) {
      currX--;
      currY--;
      midTokens.unshift({ type: 'context', text: midA[currX]! });
    }
    while (currX > 0) {
      currX--;
      midTokens.unshift({ type: 'del', text: midA[currX]! });
    }
    while (currY > 0) {
      currY--;
      midTokens.unshift({ type: 'add', text: midB[currY]! });
    }

    result.push(...midTokens);
  }

  // 5. Append common suffix
  for (let i = n - suffix; i < n; i++) {
    result.push({ type: 'context', text: a[i]! });
  }

  return result;
}
