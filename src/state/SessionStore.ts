// Observable store for the CSV-driven closures pipeline session.
// Kept entirely SDK- and DOM-free so it can be tested in plain Node.

export type SessionPhase =
  | "no-track"
  | "track-loaded"
  | "csv-loaded"
  | "matching"
  | "done";

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
    this.mutate({ geojsonUrl: url, trackLengthKm: lengthKm });
  }

  setCsvRows(rows: CsvRow[]): void {
    // Reset index and closures when new rows are loaded — stale closures from a
    // previous CSV import would silently accumulate against wrong row indices.
    this.mutate({
      csvRows: rows,
      currentIndex: 0,
      closuresBySegment: {},
    });
  }

  validateRow(
    index: number,
    segments: number[],
    startISO: string,
    endISO: string,
  ): void {
    const rows = this.state.csvRows;
    if (index < 0 || index >= rows.length) {
      throw new Error(
        `[SessionStore] validateRow: index ${index} out of range (${rows.length} rows)`,
      );
    }

    // Write segments back into the row at the given index.
    const updatedRows = rows.map((row, i) =>
      i === index ? { ...row, segments } : row,
    );

    // Advance the cursor only when the caller validates exactly the current row;
    // out-of-order validation is allowed but does not move the cursor forward.
    const nextIndex =
      index === this.state.currentIndex
        ? this.state.currentIndex + 1
        : this.state.currentIndex;

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

  reset(): void {
    this.state = { ...INITIAL_STATE, closuresBySegment: {} };
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mutate(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
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
}
