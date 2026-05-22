import { describe, expect, it, vi } from "vitest";
import { LazyMatchingPipeline, type MapDriver, type MatchDriver } from "../controller/LazyMatchingPipeline";
import { SourceStore } from "../state/SourceStore";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";

function track(): NormalizedTrack {
  return {
    trackId: null,
    geometry: { type: "MultiLineString", coordinates: [[[6.0, 46.0], [6.4, 46.0]]] }, // ~ 31km
    rawProperties: {},
  };
}

function makeDrivers(zoomSchedule: number[]): { map: MapDriver; match: MatchDriver; segmentsByCall: number[][] } {
  let call = 0;
  const segmentsByCall: number[][] = [[111], [222]];
  return {
    map: {
      zoomToExtent: vi.fn(),
      setMapCenter: vi.fn(),
      getZoomLevel: () => zoomSchedule[Math.min(call, zoomSchedule.length - 1)] as number,
      setSelection: vi.fn(),
      waitIdle: vi.fn().mockResolvedValue(undefined),
    },
    match: {
      runMatch: async () => {
        const ids = segmentsByCall[call] ?? [];
        call += 1;
        return ids;
      },
    },
    segmentsByCall,
  };
}

describe("LazyMatchingPipeline", () => {
  it("creates sub-lines lazily and validates each one", async () => {
    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s", track: track() }));
    const { map, match } = makeDrivers([13, 16, 16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    await pipeline.stepUntilValidation();
    pipeline.validate();
    await pipeline.stepUntilValidation();
    pipeline.validate();

    const src = store.getSource()!;
    expect(src.lines[0].subLines.length).toBeGreaterThanOrEqual(1);
    expect(src.lines[0].subLines.every((s) => s.validated)).toBe(true);
  });

  it("back from sub-line 1 of line 2 lands on the last sub-line of line 1", async () => {
    const store = new SourceStore();
    // Two lines via CSV waypoints; each line short enough to fit at z16 in one shot.
    const csvRows: CsvRow[] = [
      { distance: 0, startTime: "08:00", endTime: "12:00", date: "2026-05-21", segments: null },
      { distance: 15, startTime: "12:00", endTime: "18:00", date: "2026-05-21", segments: null },
      { distance: 30, startTime: "18:00", endTime: "20:00", date: "2026-05-21", segments: null },
    ];
    store.hydrate(
      buildGeojsonSource({ sourceId: "s2", track: track(), csvRows }),
    );
    const { map, match } = makeDrivers([16, 16, 16, 16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    await pipeline.stepUntilValidation();
    pipeline.validate(); // line 0 done

    await pipeline.stepUntilValidation();
    // Now on line 1 sub-line 0. Press back.
    pipeline.back();
    const cursor1 = store.getSource()!.cursor!;
    expect(cursor1.lineIndex).toBe(0);
    expect(cursor1.subLineIndex).toBe(store.getSource()!.lines[0].subLines.length - 1);

    // Validate without changes → should advance back into line 1 sub-line 0.
    pipeline.validate();
    await pipeline.stepUntilValidation();
    const cursor2 = store.getSource()!.cursor!;
    expect(cursor2.lineIndex).toBe(1);
  });

  it("rerunCurrent drops the current sub-line and recomputes from the merged range", async () => {
    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s3", track: track() }));
    const zoomSeq = [13, 16, 13, 16];
    const map: MapDriver = {
      zoomToExtent: vi.fn(),
      setMapCenter: vi.fn(),
      getZoomLevel: () => zoomSeq.shift() ?? 16,
      setSelection: vi.fn(),
      waitIdle: vi.fn().mockResolvedValue(undefined),
    };
    const match: MatchDriver = { runMatch: async () => [] };
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    await pipeline.stepUntilValidation();
    const before = store.getSource()!.lines[0].subLines.length;
    pipeline.rerunCurrent();
    // Current sub-line dropped; pendingTail head should again cover what it covered.
    expect(store.getSource()!.lines[0].subLines.length).toBe(before - 1);
    await pipeline.stepUntilValidation();
    expect(store.getSource()!.lines[0].subLines.length).toBe(before);
  });
});
