import { describe, expect, it, vi } from "vitest";
import { LazyMatchingPipeline, type MapDriver, type MatchDriver } from "../controller/LazyMatchingPipeline";
import { SourceStore } from "../state/SourceStore";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";

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
});
