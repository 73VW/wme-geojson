import { describe, expect, it } from "vitest";
import { isMatchingComplete } from "../domain/isMatchingComplete";
import type { Line, Source, SubLine } from "../domain/types";

function sub(validated: boolean): SubLine {
  return {
    index: 0,
    kmA: 0,
    kmB: 1,
    bbox: [0, 0, 1, 1],
    view: { lon: 0, lat: 0, zoom: 17 },
    segmentIds: validated ? [1] : [],
    validated,
  };
}

function line(subLines: SubLine[], pendingTail: Line["pendingTail"] = []): Line {
  return {
    index: 0,
    bbox: [0, 0, 1, 1],
    geometry: { type: "MultiLineString", coordinates: [] },
    lengthKm: 1,
    subLines,
    pendingTail,
  };
}

function source(lines: Line[]): Source {
  return { schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv: false, lines, cursor: null };
}

describe("isMatchingComplete", () => {
  it("is false without a source", () => {
    expect(isMatchingComplete(null)).toBe(false);
  });
  it("is false when a sub-line is not validated", () => {
    expect(isMatchingComplete(source([line([sub(true), sub(false)])]))).toBe(false);
  });
  it("is false while a pending tail remains", () => {
    expect(isMatchingComplete(source([line([sub(true)], [{ kmA: 1, kmB: 2 }])]))).toBe(false);
  });
  it("is false when a line has no sub-line yet", () => {
    expect(isMatchingComplete(source([line([sub(true)]), line([])]))).toBe(false);
  });
  it("is true when every sub-line of every line is validated", () => {
    expect(isMatchingComplete(source([line([sub(true)]), line([sub(true)])]))).toBe(true);
  });
});
