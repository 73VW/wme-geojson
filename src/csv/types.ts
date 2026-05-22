// Shared CSV/closure domain types. Pure types — no SDK, no DOM.
// Extracted from SessionStore so they can outlive the legacy session store.

export interface CsvRow {
  distance: number; // km
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  date: string; // "YYYY-MM-DD"
  segments: number[] | null; // null = not yet validated
}

export interface ClosureRange {
  startISO: string; // "YYYY-MM-DDTHH:MM"
  endISO: string;
  rowIndex: number;
}
