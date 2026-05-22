import { describe, expect, it } from "vitest";
import { closuresFromSource } from "../csv/closuresFromSource";
import type { Source } from "../domain/types";

function srcWithMatches(hasCsv: boolean): Source {
  return {
    schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv,
    cursor: null,
    lines: [
      {
        index: 0, bbox: [0,0,1,1], lengthKm: 5,
        geometry: { type: "MultiLineString", coordinates: [[[0,0],[1,1]]] },
        startISO: hasCsv ? "2026-05-21T08:00" : undefined,
        endISO: hasCsv ? "2026-05-21T12:00" : undefined,
        pendingTail: [],
        subLines: [
          {
            index: 0, kmA: 0, kmB: 5, bbox: [0,0,1,1],
            view: { lon: 0.5, lat: 0.5, zoom: 16 },
            segmentIds: [100, 101], validated: true,
          },
        ],
      },
      {
        index: 1, bbox: [0,0,1,1], lengthKm: 3,
        geometry: { type: "MultiLineString", coordinates: [[[0,0],[1,1]]] },
        startISO: hasCsv ? "2026-05-21T10:00" : undefined,
        endISO: hasCsv ? "2026-05-21T14:00" : undefined,
        pendingTail: [],
        subLines: [
          {
            index: 0, kmA: 0, kmB: 3, bbox: [0,0,1,1],
            view: { lon: 0.5, lat: 0.5, zoom: 16 },
            segmentIds: [101, 102], validated: true,
          },
        ],
      },
    ],
  };
}

describe("closuresFromSource", () => {
  it("non-CSV: unique segments, no times", () => {
    const out = closuresFromSource(srcWithMatches(false));
    expect(out.mode).toBe("global-times");
    if (out.mode !== "global-times") throw new Error("wrong mode");
    expect(out.segmentIds.slice().sort((a, b) => a - b)).toEqual([100, 101, 102]);
  });

  it("CSV: groups by segment with merged overlapping windows", () => {
    const out = closuresFromSource(srcWithMatches(true));
    expect(out.mode).toBe("per-line-times");
    if (out.mode !== "per-line-times") throw new Error("wrong mode");
    const seg101 = out.bySegment.find((s) => s.segmentId === 101)!;
    // 08:00-12:00 overlaps 10:00-14:00 → merged 08:00-14:00
    expect(seg101.windows).toEqual([
      { startISO: "2026-05-21T08:00", endISO: "2026-05-21T14:00" },
    ]);
  });
});
