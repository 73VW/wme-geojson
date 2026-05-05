// Observable store for the CSV-driven closures pipeline session.
// Kept entirely SDK- and DOM-free so it can be tested in plain Node.

import { save as persistenceSave } from "../persistence/sessionStorage";
import { logger } from "../utils/logger";

export type SessionPhase = "no-track" | "track-loaded" | "csv-loaded" | "matching" | "done";

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

export interface SessionState {
  phase: SessionPhase;
  geojsonUrl: string | null;
  trackLengthKm: number | null;
  csvRows: CsvRow[];
  currentIndex: number;
  closuresBySegment: Record<number, ClosureRange[]>;
}

const INITIAL_STATE: SessionState = {
  phase: "no-track",
  geojsonUrl: null,
  trackLengthKm: null,
  csvRows: [],
  currentIndex: 0,
  closuresBySegment: {},
};

// Tiny EventEmitter typed for a single argument — mirrors WalkController's pattern.
type Listener = (state: SessionState) => void;

export class SessionStore {
  private state: SessionState = { ...INITIAL_STATE, closuresBySegment: {} };
  private readonly listeners = new Map<number, Listener>();
  private nextId = 0;

  // Raw CSV text kept alongside the parsed rows so the persistence key can be
  // computed without the caller having to re-pass it on every mutation.
  private csvText: string | null = null;

  getState(): Readonly<SessionState> {
    return this.state;
  }

  // Returns an unsubscribe function so callers manage their own lifecycle.
  subscribe(fn: Listener): () => void {
    const id = this.nextId++;
    this.listeners.set(id, fn);
    return () => {
      this.listeners.delete(id);
    };
  }

  setPhase(p: SessionPhase): void {
    this.mutate({ phase: p });
  }

  setTrack(url: string, lengthKm: number): void {
    const trackChanged = this.state.geojsonUrl !== null && this.state.geojsonUrl !== url;

    if (!trackChanged) {
      this.mutate({ geojsonUrl: url, trackLengthKm: lengthKm });
      return;
    }

    // Track changes invalidate CSV row ownership and any persisted closures,
    // so the session must restart from a clean track-loaded state.
    this.csvText = null;
    this.mutate({
      phase: "track-loaded",
      geojsonUrl: url,
      trackLengthKm: lengthKm,
      csvRows: [],
      currentIndex: 0,
      closuresBySegment: {},
    });
  }

  /**
   * Load a new set of CSV rows and record the raw CSV text.
   * The raw text is needed to derive the localStorage key for auto-save.
   * Resets index and closures — stale closures from a previous CSV import
   * would silently accumulate against wrong row indices.
   */
  setCsvRows(rows: CsvRow[], csvText: string): void {
    this.csvText = csvText;
    const resetRows = rows.map((row) => ({
      ...row,
      segments: null,
    }));
    this.mutate({
      csvRows: resetRows,
      currentIndex: 0,
      closuresBySegment: {},
    });
  }

  validateRow(index: number, segments: number[], startISO: string, endISO: string): void {
    const rows = this.state.csvRows;
    if (index < 0 || index >= rows.length) {
      throw new Error(
        `[SessionStore] validateRow: index ${index} out of range (${rows.length} rows)`,
      );
    }

    // Write segments back into the row at the given index.
    const updatedRows = rows.map((row, i) => (i === index ? { ...row, segments } : row));

    // Advance the cursor only when the caller validates exactly the current row;
    // out-of-order validation is allowed but does not move the cursor forward.
    const nextIndex =
      index === this.state.currentIndex ? this.state.currentIndex + 1 : this.state.currentIndex;

    // Build closure entries: one ClosureRange per segment per validated row.
    const closuresBySegment = { ...this.state.closuresBySegment };
    const range: ClosureRange = { startISO, endISO, rowIndex: index };
    for (const segId of segments) {
      const existing = closuresBySegment[segId];
      if (existing) {
        closuresBySegment[segId] = [...existing, range];
      } else {
        closuresBySegment[segId] = [range];
      }
    }

    this.mutate({
      csvRows: updatedRows,
      currentIndex: nextIndex,
      closuresBySegment,
    });
  }

  rewindToRow(index: number): void {
    const rows = this.state.csvRows;
    if (index < 0 || index >= rows.length) {
      throw new Error(
        `[SessionStore] rewindToRow: index ${index} out of range (${rows.length} rows)`,
      );
    }

    const updatedRows = rows.map((row, rowIndex) =>
      rowIndex >= index ? { ...row, segments: null } : row,
    );

    const closuresBySegment: Record<number, ClosureRange[]> = {};
    updatedRows.forEach((row, rowIndex) => {
      if (row.segments === null || row.segments.length === 0) {
        return;
      }

      const range: ClosureRange = {
        startISO: `${row.date}T${row.startTime}`,
        endISO: `${row.date}T${row.endTime}`,
        rowIndex,
      };

      row.segments.forEach((segId) => {
        const existing = closuresBySegment[segId];
        if (existing) {
          closuresBySegment[segId] = [...existing, range];
        } else {
          closuresBySegment[segId] = [range];
        }
      });
    });

    this.mutate({
      csvRows: updatedRows,
      currentIndex: index,
      closuresBySegment,
    });
  }

  /**
   * Rehydrate the store from a previously persisted state.
   * Used by the resume banner when the user chooses "Continue" after reload.
   * The csvText is stored so subsequent mutations can still auto-save.
   */
  rehydrate(state: SessionState, csvText: string): void {
    this.csvText = csvText;
    // Replace state wholesale and notify — same notify path as mutate so
    // subscribers (including the panel) see the restored state immediately.
    this.state = { ...state };
    this.notify();
  }

  reset(): void {
    this.csvText = null;
    this.state = { ...INITIAL_STATE, closuresBySegment: {} };
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mutate(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
    this.tryAutoSave();
  }

  private notify(): void {
    for (const listener of this.listeners.values()) {
      try {
        listener(this.state);
      } catch {
        // Subscribers must not crash the store. Errors are intentionally
        // swallowed here; each subscriber owns its own error boundary.
      }
    }
  }

  /**
   * Persist the current state to localStorage after every meaningful mutation.
   * Only saves when both a geojsonUrl and non-empty csvRows are present —
   * otherwise there is no meaningful key and the save is a no-op.
   * Wrapped in try/catch so persistence failures never crash the store.
   */
  private tryAutoSave(): void {
    const { geojsonUrl, csvRows } = this.state;
    const hasUrl = geojsonUrl !== null;
    const hasCsvRows = csvRows.length > 0;
    const hasCsvText = this.csvText !== null;

    if (!hasUrl || !hasCsvRows || !hasCsvText) {
      return;
    }

    try {
      persistenceSave(this.state, this.csvText as string);
    } catch (err) {
      // Persistence is best-effort — a quota error or sandboxed environment
      // must not crash the store or interrupt the matching pipeline.
      logger.warn("[SessionStore] auto-save failed", err);
    }
  }
}
