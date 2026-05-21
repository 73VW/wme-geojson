import { describe, expect, it } from "vitest";
import type { Source, Line, SubLine } from "../domain/types";

describe("domain types", () => {
  it("constructs a Source with no lines", () => {
    const source: Source = {
      schemaVersion: 1,
      sourceId: "test",
      kind: "geojson",
      hasCsv: false,
      lines: [],
      cursor: null,
    };
    expect(source.schemaVersion).toBe(1);
    expect(source.cursor).toBeNull();
  });

  it("constructs a Line with one pending range and no sub-lines", () => {
    const line: Line = {
      index: 0,
      bbox: [0, 0, 1, 1],
      geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
      lengthKm: 1.4,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: 1.4 }],
    };
    expect(line.pendingTail).toHaveLength(1);
  });

  it("constructs a SubLine with empty segments and validated=false", () => {
    const sub: SubLine = {
      index: 0,
      kmA: 0,
      kmB: 1.4,
      bbox: [0, 0, 1, 1],
      view: { lon: 0.5, lat: 0.5, zoom: 16 },
      segmentIds: [],
      validated: false,
    };
    expect(sub.segmentIds).toEqual([]);
    expect(sub.validated).toBe(false);
  });
});
