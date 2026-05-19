// Builds the synthetic single-row schedule used when no CSV is imported.
// The whole track becomes one slice; the existing matching pipeline then
// sub-slices it exactly as it does for a real CSV row.
// Pure — no SDK, no DOM.

import type { CsvRow } from "../state/SessionStore";

/**
 * Build the one synthetic CsvRow covering an entire track.
 *
 * `distance` carries the full track length in km. Time/date fields are left
 * empty: in synthetic mode they are collected at download time via
 * promptClosureWindow, not from the (absent) CSV.
 */
export function buildSyntheticRow(trackLengthKm: number): CsvRow {
  if (!(trackLengthKm > 0)) {
    throw new Error(
      `[syntheticSchedule] track length must be positive, got ${trackLengthKm}`,
    );
  }
  return {
    distance: trackLengthKm,
    startTime: "",
    endTime: "",
    date: "",
    segments: null,
  };
}
