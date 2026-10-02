// Builds the synthetic single-row schedule used when no CSV is imported.
// The whole track becomes one slice; the existing matching pipeline then
// sub-slices it exactly as it does for a real CSV row.
// Pure — no SDK, no DOM.

import type { CsvRow, ClosureRange } from "./types";
import type { ClosureRowGroup, RowGeo } from "./buildClosuresCsv";

/**
 * Build the one synthetic CsvRow covering an entire track.
 *
 * `distance` is a *start waypoint* in km, not a length: the matcher builds a
 * slice from `distance` to the track's total length. A single row at
 * `distance: 0` therefore yields one slice spanning the whole track — which is
 * exactly the historical single-row-CSV behaviour the pipeline already handles.
 *
 * Time/date fields are left empty: in synthetic mode they are collected at
 * download time via promptClosureWindow, not from the (absent) CSV.
 */
export function buildSyntheticRow(): CsvRow {
  return {
    distance: 0,
    startTime: "",
    endTime: "",
    date: "",
    segments: null,
  };
}

/**
 * Expand CSV-less closure windows into export rows: every window gets its own
 * copy of every segment group. Chunking is left to buildClosuresCsv.
 */
export function buildGlobalClosureRows(
  windows: ReadonlyArray<{ startISO: string; endISO: string }>,
  segmentGroups: ReadonlyArray<{ segmentIds: number[]; geo: RowGeo }>,
): {
  rows: CsvRow[];
  groups: ClosureRowGroup[];
  closuresBySegment: Record<number, ClosureRange[]>;
} {
  const rows: CsvRow[] = [];
  const groups: ClosureRowGroup[] = [];
  const closuresBySegment: Record<number, ClosureRange[]> = {};

  for (const { startISO, endISO } of windows) {
    for (const { segmentIds, geo } of segmentGroups) {
      if (segmentIds.length === 0) continue;
      const rowIndex = rows.length;
      rows.push({
        distance: 0,
        date: startISO.slice(0, 10),
        startTime: startISO.slice(11, 16),
        endTime: endISO.slice(11, 16),
        segments: segmentIds,
      });
      groups.push({ rowIndex, segmentIds, geo });
      for (const id of segmentIds) {
        (closuresBySegment[id] ??= []).push({ startISO, endISO, rowIndex });
      }
    }
  }
  return { rows, groups, closuresBySegment };
}
