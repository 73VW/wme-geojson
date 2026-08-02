import type { RowGeo } from "../csv/buildClosuresCsv";
import type { ClosuresBySegment } from "../csv/closuresFromSource";
import type { CsvRow } from "../csv/types";

export interface WindowGroup {
  startISO: string;
  endISO: string;
  geo: RowGeo;
  segmentIds: number[];
}

/**
 * Map a closure window back to the roadbook row it was derived from: window
 * startISO values are built verbatim as `${row.date}T${row.startTime}`
 * (merged windows keep the earliest contributing row's start). Falls back to
 * row 0 when nothing matches, which should not happen in practice.
 */
export function roadbookRowIndex(startISO: string, rows: readonly CsvRow[]): number {
  const index = rows.findIndex((row) => `${row.date}T${row.startTime}` === startISO);
  return index === -1 ? 0 : index;
}

export function groupByWindow(bySegment: readonly ClosuresBySegment[]): WindowGroup[] {
  const map = new Map<string, WindowGroup>();

  for (const entry of bySegment) {
    for (const win of entry.windows) {
      // Geo is part of the key: segments matched in different sub-line views
      // must stay in separate rows so Advanced Closures loads each segment
      // inside the bbox that actually contains it.
      const key = `${win.startISO}|${win.endISO}|${win.geo.lon}|${win.geo.lat}|${win.geo.zoom}`;
      const existing = map.get(key);
      if (existing) {
        existing.segmentIds.push(entry.segmentId);
      } else {
        map.set(key, {
          startISO: win.startISO,
          endISO: win.endISO,
          geo: win.geo,
          segmentIds: [entry.segmentId],
        });
      }
    }
  }

  return Array.from(map.values());
}
