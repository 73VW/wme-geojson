// Turns closure data into an ordered list of map stops for direct closure
// creation. One stop per sub-line view: that view is the bbox the segments
// were matched in, so centering on it guarantees they are in the data model.
// Pure — no SDK, no DOM.

import type { MapAnchor } from "../domain/types";

export interface ClosureItem {
  startISO: string;
  endISO: string;
  geo: MapAnchor;
  segmentIds: number[];
}

export interface PlannedClosure {
  segmentId: number;
  startMs: number;
  endMs: number;
}

export interface ClosureStop {
  geo: MapAnchor;
  closures: PlannedClosure[];
}

/** "YYYY-MM-DDTHH:MM" (no offset) → Unix ms, interpreted as local time. */
export function isoToMs(iso: string): number {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) throw new Error(`[planClosureStops] Invalid date: "${iso}"`);
  return ms;
}

export function planClosureStops(items: readonly ClosureItem[]): ClosureStop[] {
  const stopsByView = new Map<string, ClosureStop>();
  const seen = new Set<string>();

  for (const item of items) {
    const viewKey = `${item.geo.lon}|${item.geo.lat}|${item.geo.zoom}`;
    const startMs = isoToMs(item.startISO);
    const endMs = isoToMs(item.endISO);

    for (const segmentId of item.segmentIds) {
      const closureKey = `${viewKey}|${segmentId}|${startMs}|${endMs}`;
      if (seen.has(closureKey)) continue;
      seen.add(closureKey);

      let stop = stopsByView.get(viewKey);
      if (!stop) {
        stop = { geo: item.geo, closures: [] };
        stopsByView.set(viewKey, stop);
      }
      stop.closures.push({ segmentId, startMs, endMs });
    }
  }
  return Array.from(stopsByView.values());
}

/** isForward values matching the CSV export's "TWO WAY" direction. */
export function directionsFor(segment: { isAtoB: boolean; isBtoA: boolean }): boolean[] {
  if (segment.isAtoB) return [true];
  if (segment.isBtoA) return [false];
  return [true, false];
}
