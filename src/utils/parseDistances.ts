/**
 * Parse a free-form list of kilometre distances pasted by the user.
 *
 * Accepts commas, spaces, tabs, and newlines as separators (any combination),
 * skips blanks and non-numeric tokens silently, and deduplicates while
 * preserving first-seen order so the matched-count display in the UI lines up
 * with what the user typed.
 *
 * Examples:
 *   "0.5, 1.2, 3.4"      → [0.5, 1.2, 3.4]
 *   "0.5 1.2\n3.4"       → [0.5, 1.2, 3.4]
 *   "0.5,,1.2,abc,1.2"   → [0.5, 1.2]
 *   ""                   → []
 *
 * The values are kept as-is (no rounding) so the caller can decide how to
 * bucket them. Distance-list filtering in TrackLayer rounds to 100 m, but a
 * future caller might want a different tolerance.
 */
export function parseDistanceList(input: string): number[] {
  const tokens = input.split(/[\s,;]+/);
  const seen = new Set<number>();
  const result: number[] = [];

  for (const token of tokens) {
    if (token === "") continue;
    const value = Number(token);
    if (!Number.isFinite(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}
