import type { Source } from "./types";

/**
 * True once every line of the source is fully cut into sub-lines and each
 * sub-line has been validated (or skipped — a skip validates with no
 * segments). Sub-lines are created lazily, so a non-empty pendingTail means
 * matching is not over.
 */
export function isMatchingComplete(source: Source | null): boolean {
  if (!source || source.lines.length === 0) return false;
  return source.lines.every((line) => {
    const fullyCut = line.pendingTail.length === 0 && line.subLines.length > 0;
    return fullyCut && line.subLines.every((sub) => sub.validated);
  });
}
