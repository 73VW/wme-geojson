import { describe, expect, it, vi } from "vitest";
import {
  LazyMatchingPipeline,
  type MapDriver,
  type MatchDriver,
} from "../controller/LazyMatchingPipeline";
import { SourceStore } from "../state/SourceStore";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";
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

  it("rematchCurrent re-runs the matching on the same sub-line without storing anything", async () => {
    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s-rematch", track: track() }));
    const { map, match } = makeDrivers([13, 16, 16]);
    const runMatch = vi.fn(match.runMatch);
    const pipeline = new LazyMatchingPipeline({
      store,
      map,
      match: { runMatch },
      targetZoom: 16,
    });
    await pipeline.stepUntilValidation();
    const before = JSON.stringify(store.getSource());
    const runsBefore = runMatch.mock.calls.length;

    await pipeline.rematchCurrent();

    expect(runMatch.mock.calls.length).toBe(runsBefore + 1);
    expect(map.setSelection).toHaveBeenLastCalledWith(pipeline.getPendingMatched());
    expect(JSON.stringify(store.getSource())).toBe(before);
  });
});
