// Coarse matching progress of one line, read from its persisted Source.
// Sub-lines are created lazily, so their total count is unknown until the
// end: progress is the validated share of the track length instead.

import { isMatchingComplete } from "./isMatchingComplete";
import type { Source } from "./types";

export type LineProgress =
  | { kind: "notStarted" }
  | { kind: "inProgress"; percent: number }
  | { kind: "done" };

export function lineProgress(source: Source | null): LineProgress {
  if (!source) return { kind: "notStarted" };
  if (isMatchingComplete(source)) return { kind: "done" };

  const totalKm = source.lines.reduce((sum, line) => sum + line.lengthKm, 0);
  const validatedKm = source.lines.reduce(
    (sum, line) =>
      sum +
      line.subLines
        .filter((subLine) => subLine.validated)
        .reduce((lineSum, subLine) => lineSum + (subLine.kmB - subLine.kmA), 0),
    0,
  );
  if (validatedKm <= 0 || totalKm <= 0) return { kind: "notStarted" };

  // 0 % would read as "not started" and 100 % as "done": keep 1..99.
  const percent = Math.min(99, Math.max(1, Math.round((validatedKm / totalKm) * 100)));
  return { kind: "inProgress", percent };
}
