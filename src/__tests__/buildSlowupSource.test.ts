import { describe, expect, it } from "vitest";
import { buildSlowupSource } from "../domain/buildSlowupSource";
import type { NormalizedTrack } from "../geojson/types";

function track(coords: number[][][]): NormalizedTrack {
  return {
    trackId: null,
    geometry: { type: "MultiLineString", coordinates: coords },
    rawProperties: {},
  };
}

describe("buildSlowupSource", () => {
  it("creates one Line per merged chain", () => {
    // Two well-separated pieces (gap >> 50m) → 2 lines.
    const t = track([
      [
        [6.0, 46.0],
        [6.01, 46.0],
      ],
      [
        [7.0, 47.0],
        [7.01, 47.0],
      ],
    ]);
    const src = buildSlowupSource({ sourceId: "slowup-1", track: t });
    expect(src.kind).toBe("slowup");
    expect(src.hasCsv).toBe(false);
    expect(src.lines).toHaveLength(2);
    expect(src.lines[0].index).toBe(0);
    expect(src.lines[1].index).toBe(1);
    expect(src.lines[0].pendingTail).toEqual([{ kmA: 0, kmB: src.lines[0].lengthKm }]);
    expect(src.lines[0].subLines).toEqual([]);
    expect(src.cursor).toBeNull();
  });

  it("collapses small endpoint gaps into a single Line", () => {
    // Two pieces whose endpoints are within 50 m.
    const t = track([
      [
        [6.0, 46.0],
        [6.001, 46.0],
      ],
      [
        [6.0010003, 46.0],
        [6.002, 46.0],
      ],
    ]);
    const src = buildSlowupSource({ sourceId: "slowup-2", track: t });
    expect(src.lines).toHaveLength(1);
  });
});
