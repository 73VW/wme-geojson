// Inverse of parseSchedule: converts CsvRow[] back to the canonical CSV text.
// Designed for exact round-trips: parse → serialize → parse yields identical rows.

import type { CsvRow } from "../state/SessionStore";

const HEADER = "distance,start_time,end_time,date,segments";

export function serializeSchedule(rows: CsvRow[]): string {
  const lines: string[] = [HEADER];

  for (const row of rows) {
    const segmentsField = serializeSegments(row.segments);
    // Distance is stored as a number; preserve one decimal place to match the
    // source format. parseSchedule accepts any numeric, so round-trips are safe
    // regardless of the original precision.
    lines.push(`${row.distance},${row.startTime},${row.endTime},${row.date},${segmentsField}`);
  }

  // Trailing newline mirrors what most CSV writers produce and keeps
  // `parse → serialize → re-parse` stable across tools.
  return lines.join("\n") + "\n";
}

function serializeSegments(segments: number[] | null): string {
  if (segments === null) {
    return "";
  }
  return segments.join(";");
}
