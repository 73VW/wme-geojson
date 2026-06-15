import { describe, expect, it, vi } from "vitest";
import {
  LazyMatchingPipeline,
  type MapDriver,
  type MatchDriver,
} from "../controller/LazyMatchingPipeline";
import { SourceStore } from "../state/SourceStore";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";
import type { MultiLineString } from "geojson";
import type { Source, SubLine } from "../domain/types";

function track(): NormalizedTrack {
  return {
    trackId: null,
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [6.0, 46.0],
          [6.4, 46.0],
        ],
      ],
    }, // ~ 31km
    rawProperties: {},
  };
}

function makeDrivers(zoomSchedule: number[]): {
  map: MapDriver;
  match: MatchDriver;
  segmentsByCall: number[][];
} {
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

  // BUG B scenario 1: back() then stepUntilValidation() re-presents the previous sub-line
  it("back() then stepUntilValidation() re-presents sub-line 0 after validating it", async () => {
    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s-back1", track: track() }));
    const { map, match } = makeDrivers([13, 16, 16, 16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    // Step to sub-line 0 and validate it
    await pipeline.stepUntilValidation();
    const sub0 = store.getSource()!.lines[0].subLines[0];
    expect(sub0).toBeDefined();
    const kmA0 = sub0.kmA;
    const kmB0 = sub0.kmB;
    pipeline.validate();

    // Step to sub-line 1 (or wherever next)
    await pipeline.stepUntilValidation();
    const cursorBefore = store.getSource()!.cursor!;
    expect(cursorBefore.subLineIndex).toBeGreaterThanOrEqual(1);

    // Back() should un-validate sub-line 0 and remove it so next step re-presents it
    pipeline.back();

    // stepUntilValidation() must re-present sub-line 0 (not advance further)
    await pipeline.stepUntilValidation();
    const cursorAfter = store.getSource()!.cursor!;
    expect(cursorAfter.lineIndex).toBe(0);
    expect(cursorAfter.subLineIndex).toBe(0);
    // The re-presented sub-line must start at or before the original kmA and be unvalidated
    const subRerun = store.getSource()!.lines[0].subLines[cursorAfter.subLineIndex];
    expect(subRerun.kmA).toBeCloseTo(kmA0, 5);
    expect(subRerun.validated).toBe(false);
  });

  // BUG B scenario 2: cross-line back — first sub-line of line N → last sub-line of line N-1
  it("back from first sub-line of line 1 re-presents last sub-line of line 0", async () => {
    const store = new SourceStore();
    const csvRows: CsvRow[] = [
      { distance: 0, startTime: "08:00", endTime: "12:00", date: "2026-05-21", segments: null },
      { distance: 15, startTime: "12:00", endTime: "18:00", date: "2026-05-21", segments: null },
      { distance: 30, startTime: "18:00", endTime: "20:00", date: "2026-05-21", segments: null },
    ];
    store.hydrate(buildGeojsonSource({ sourceId: "s-back2", track: track(), csvRows }));
    const { map, match } = makeDrivers([16, 16, 16, 16, 16, 16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    // Validate all sub-lines of line 0
    await pipeline.stepUntilValidation();
    pipeline.validate();
    // line 0 should now be done (all validated, no pending tail)
    while (
      store.getSource()!.lines[0].pendingTail.length > 0 ||
      store.getSource()!.lines[0].subLines.some((s) => !s.validated)
    ) {
      await pipeline.stepUntilValidation();
      pipeline.validate();
    }

    // Now advance to line 1 sub-line 0
    await pipeline.stepUntilValidation();
    const cursorLine1 = store.getSource()!.cursor!;
    expect(cursorLine1.lineIndex).toBe(1);
    expect(cursorLine1.subLineIndex).toBe(0);

    const line0LastIdx = store.getSource()!.lines[0].subLines.length - 1;

    // back() should un-validate last sub-line of line 0
    pipeline.back();

    // stepUntilValidation() must re-present the last sub-line of line 0
    await pipeline.stepUntilValidation();
    const cursorAfterBack = store.getSource()!.cursor!;
    expect(cursorAfterBack.lineIndex).toBe(0);
    // The sub-line should be unvalidated (re-presented)
    const rerunSub = store.getSource()!.lines[0].subLines[cursorAfterBack.subLineIndex];
    expect(rerunSub.validated).toBe(false);
    // sub-line index should be at or near where the last one was
    expect(cursorAfterBack.subLineIndex).toBeLessThanOrEqual(line0LastIdx);
  });

  // BUG B scenario 3: back() at the very beginning is a no-op
  it("back() before any step is a no-op", () => {
    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s-back3", track: track() }));
    const { map, match } = makeDrivers([16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    // No cursor yet — should not throw
    expect(() => pipeline.back()).not.toThrow();
    expect(store.getSource()!.cursor).toBeNull();
  });

  // BUG A: large geometry (200k points) does not throw RangeError
  it("evaluateZoom does not throw RangeError for large geometries", async () => {
    const pointCount = 200_000;
    const coords: [number, number][] = Array.from({ length: pointCount }, (_, i) => [
      6.0 + (i / pointCount) * 0.4,
      46.0,
    ]);
    const largeTrack: NormalizedTrack = {
      trackId: null,
      geometry: {
        type: "MultiLineString",
        coordinates: [coords],
      } as MultiLineString,
      rawProperties: {},
    };

    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s-large", track: largeTrack }));
    const { map, match } = makeDrivers([16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    // Should not throw RangeError
    await expect(pipeline.stepUntilValidation()).resolves.toBeUndefined();
  });

  it("does not create a 201st sub-line when line already has 200 and clears pendingTail", async () => {
    // Build a source manually: one line with 200 validated sub-lines + a remaining pendingTail
    const geometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [6.0, 46.0],
          [6.4, 46.0],
        ],
      ],
    };
    const subLines: SubLine[] = Array.from({ length: 200 }, (_, i) => ({
      index: i,
      kmA: i * 0.1,
      kmB: (i + 1) * 0.1,
      bbox: [6.0, 46.0, 6.4, 46.0],
      view: { lon: 6.2, lat: 46.0, zoom: 16 },
      segmentIds: [i + 1],
      validated: true,
    }));
    const source: Source = {
      schemaVersion: 1,
      sourceId: "s-cap",
      kind: "geojson",
      hasCsv: false,
      lines: [
        {
          index: 0,
          bbox: [6.0, 46.0, 6.4, 46.0],
          geometry,
          lengthKm: 31,
          subLines,
          pendingTail: [{ kmA: 20, kmB: 31 }],
        },
      ],
      cursor: null,
    };
    const store = new SourceStore();
    store.hydrate(source);
    const { map, match } = makeDrivers([16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    // stepUntilValidation must not throw and must not create sub-line 201
    await pipeline.stepUntilValidation();

    const line = store.getSource()!.lines[0];
    expect(line.subLines.length).toBe(200);
    expect(line.pendingTail).toHaveLength(0);
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
