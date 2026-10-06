/**
 * Compares two US Code section strings in natural legal order.
 * Uses Unicode Collation with numeric sorting, avoiding JavaScript's
 * parseFloat() scientific notation pitfalls (e.g. Title 42 Section 2000e-1
 * being mistakenly evaluated as 2000 * 10^-1 = 200).
 *
 * Examples:
 * - '101' < '101a' < '102'
 * - '2000a' < '2000e' < '2000e-1' < '2000e-2' < '2000f' < '2001'
 * - '1-1' < '1-2' < '2'
 */
export function compareSectionNumbers(a: string, b: string): number {
  if (a === b) return 0;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
