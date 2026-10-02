// Adds road closures directly in the WME data model, stop by stop.
// addClosure only works on segments present in the data model, so each stop
// first centers the map on the sub-line view the segments were matched in.
// Failures are collected, not thrown: one locked segment must not lose the
// rest of a long run, and hasClosure makes a re-run safe.

import { directionsFor, type ClosureStop } from "../csv/planClosureStops";
import type { MapAnchor } from "../domain/types";

export interface ClosureDriver {
  setMapCenter(lon: number, lat: number, zoom: number): void;
  waitIdle(): Promise<void>;
  /** null when the segment is not in the data model. */
  getSegment(segmentId: number): { isAtoB: boolean; isBtoA: boolean } | null;
  /** null when the MTE is not in the data model. */
  getTrafficEventName(id: string): string | null;
  hasClosure(c: { segmentId: number; isForward: boolean; startMs: number; endMs: number }): boolean;
  addClosure(c: {
    segmentId: number;
    isForward: boolean;
    startMs: number;
    endMs: number;
    description: string;
    isPermanent: boolean;
    trafficEventId: string | null;
  }): void;
}

export interface ApplyOptions {
  /** Used when no MTE is linked; otherwise the MTE name is the description. */
  description: string;
  isPermanent: boolean;
  trafficEventId: string | null;
}

export interface ClosureFailure {
  segmentId: number;
  reason: string;
  /** View of the stop where it failed — lets the UI build a permalink. */
  geo: MapAnchor;
}

export interface ApplyReport {
  added: number;
  skipped: number;
  failures: ClosureFailure[];
}

export async function applyClosures(
  stops: readonly ClosureStop[],
  options: ApplyOptions,
  driver: ClosureDriver,
  onProgress?: (stopIndex: number, stopCount: number) => void,
): Promise<ApplyReport> {
  const report: ApplyReport = { added: 0, skipped: 0, failures: [] };
  const { trafficEventId, isPermanent } = options;
  // A segment crossing a sub-line cut sits in two views. Track what this run
  // added instead of trusting getAll() to return unsaved closures.
  const addedKeys = new Set<string>();
  // A segment on a sub-line cut can be missing at the edge of one view and
  // closed from the next: such "not loaded" failures are dropped at the end.
  const notLoaded: ClosureFailure[] = [];
  const reachedSegments = new Set<number>();

  for (const [index, stop] of stops.entries()) {
    driver.setMapCenter(stop.geo.lon, stop.geo.lat, stop.geo.zoom);
    await driver.waitIdle();

    let description = options.description;
    if (trafficEventId !== null) {
      const mteName = driver.getTrafficEventName(trafficEventId);
      if (mteName === null) {
        for (const { segmentId } of stop.closures) {
          notLoaded.push({ segmentId, reason: `MTE ${trafficEventId} not loaded`, geo: stop.geo });
        }
        onProgress?.(index + 1, stops.length);
        continue;
      }
      description = mteName || description;
    }

    for (const closure of stop.closures) {
      const segment = driver.getSegment(closure.segmentId);
      if (!segment) {
        notLoaded.push({
          segmentId: closure.segmentId,
          reason: "segment not loaded",
          geo: stop.geo,
        });
        continue;
      }
      reachedSegments.add(closure.segmentId);
      for (const isForward of directionsFor(segment)) {
        const directed = { ...closure, isForward };
        const key = `${closure.segmentId}|${isForward}|${closure.startMs}|${closure.endMs}`;
        if (addedKeys.has(key) || driver.hasClosure(directed)) {
          report.skipped++;
          continue;
        }
        try {
          driver.addClosure({ ...directed, description, isPermanent, trafficEventId });
          addedKeys.add(key);
          report.added++;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          report.failures.push({ segmentId: closure.segmentId, reason, geo: stop.geo });
        }
      }
    }
    onProgress?.(index + 1, stops.length);
  }
  const stillMissing = notLoaded.filter((failure) => !reachedSegments.has(failure.segmentId));
  report.failures.push(...stillMissing);
  return report;
}
