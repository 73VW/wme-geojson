import type { RowGeo } from "../csv/buildClosuresCsv";
import type { ClosuresBySegment } from "../csv/closuresFromSource";

export interface WindowGroup {
  startISO: string;
  endISO: string;
  geo: RowGeo;
  segmentIds: number[];
}

export function groupByWindow(bySegment: readonly ClosuresBySegment[]): WindowGroup[] {
  const map = new Map<string, WindowGroup>();

  for (const entry of bySegment) {
    for (const win of entry.windows) {
      const key = `${win.startISO}|${win.endISO}`;
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
