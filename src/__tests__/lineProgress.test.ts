import { describe, expect, it } from "vitest";
import { lineProgress } from "../domain/lineProgress";
import type { Line, Source, SubLine } from "../domain/types";

function sub(kmA: number, kmB: number, validated: boolean): SubLine {
  return {
    index: 0,
    kmA,
    kmB,
    bbox: [0, 0, 0, 0],
    view: { lon: 0, lat: 0, zoom: 16 },
    segmentIds: validated ? [1] : [],
    validated,
  };
}

function line(lengthKm: number, subLines: SubLine[], pendingTail: Line["pendingTail"]): Line {
  return {
    index: 0,
    bbox: [0, 0, 0, 0],
    geometry: { type: "MultiLineString", coordinates: [] },
    lengthKm,
    subLines,
    pendingTail,
  };
}

function source(lines: Line[]): Source {
  return { schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv: false, lines, cursor: null };
}

describe("lineProgress", () => {
  it("is not started without a persisted source", () => {
    expect(lineProgress(null)).toEqual({ kind: "notStarted" });
  });

  it("is not started while nothing is validated", () => {
    const src = source([line(10, [sub(0, 4, false)], [{ kmA: 4, kmB: 10 }])]);
    expect(lineProgress(src)).toEqual({ kind: "notStarted" });
  });

  it("reports the validated share of the track, across lines", () => {
    const src = source([
      line(10, [sub(0, 4, true)], [{ kmA: 4, kmB: 10 }]),
      line(10, [sub(0, 2, true), sub(2, 5, false)], [{ kmA: 5, kmB: 10 }]),
    ]);
    expect(lineProgress(src)).toEqual({ kind: "inProgress", percent: 30 });
  });

  it("never rounds to 0 % or 100 % before the matching is complete", () => {
    const tiny = source([line(100, [sub(0, 0.1, true)], [{ kmA: 0.1, kmB: 100 }])]);
    expect(lineProgress(tiny)).toEqual({ kind: "inProgress", percent: 1 });
    const almost = source([line(100, [sub(0, 99.9, true)], [{ kmA: 99.9, kmB: 100 }])]);
    expect(lineProgress(almost)).toEqual({ kind: "inProgress", percent: 99 });
  });

  it("is done once every sub-line is cut and validated", () => {
    const src = source([line(10, [sub(0, 10, true)], [])]);
    expect(lineProgress(src)).toEqual({ kind: "done" });
  });
});
