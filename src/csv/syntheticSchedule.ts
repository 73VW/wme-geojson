// Builds the synthetic single-row schedule used when no CSV is imported.
// The whole track becomes one slice; the existing matching pipeline then
// sub-slices it exactly as it does for a real CSV row.
// Pure — no SDK, no DOM.

import type { CsvRow } from "./types";

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
