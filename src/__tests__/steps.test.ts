import { describe, expect, it } from "vitest";
import { frontierStep, navigableSteps, neighbour, sameIds, sameStep } from "../domain/steps";
import type { Line, Source, SubLine } from "../domain/types";

function sub(index: number, validated: boolean): SubLine {
  return {
    index,
    kmA: index,
    kmB: index + 1,
    bbox: [0, 0, 0, 0],
    view: { lon: 0, lat: 0, zoom: 16 },
    segmentIds: validated ? [index] : [],
    validated,
  };
}

function line(index: number, subLines: SubLine[], pending = false): Line {
  return {
    index,
    bbox: [0, 0, 0, 0],
    geometry: { type: "MultiLineString", coordinates: [] },
    lengthKm: 10,
    subLines,
    pendingTail: pending ? [{ kmA: subLines.length, kmB: 10 }] : [],
  };
}

function source(lines: Line[]): Source {
  return { schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv: false, lines, cursor: null };
}

const at = (lineIndex: number, subLineIndex: number) => ({ lineIndex, subLineIndex });

describe("navigableSteps", () => {
  it("lists validated sub-lines across lines, in matching order", () => {
    const src = source([line(0, [sub(0, true), sub(1, true)]), line(1, [sub(0, true)])]);
    expect(navigableSteps(src, true)).toEqual([at(0, 0), at(0, 1), at(1, 0)]);
  });

  it("ends at the frontier, included only on request", () => {
    const src = source([line(0, [sub(0, true), sub(1, false)], true), line(1, [])]);
    expect(navigableSteps(src, false)).toEqual([at(0, 0)]);
    expect(navigableSteps(src, true)).toEqual([at(0, 0), at(0, 1)]);
    expect(frontierStep(src)).toEqual(at(0, 1));
  });

  it("stops at a line not cut yet, without a frontier", () => {
    const src = source([line(0, [sub(0, true)], true), line(1, [sub(0, true)])]);
    expect(navigableSteps(src, true)).toEqual([at(0, 0)]);
    expect(frontierStep(src)).toBeNull();
  });

  it("is empty without a source", () => {
    expect(navigableSteps(null, true)).toEqual([]);
  });
});

describe("neighbour", () => {
  const steps = [at(0, 0), at(0, 1), at(1, 0)];
  it("moves back and forth and stops at both ends", () => {
    expect(neighbour(steps, at(0, 1), -1)).toEqual(at(0, 0));
    expect(neighbour(steps, at(0, 1), 1)).toEqual(at(1, 0));
    expect(neighbour(steps, at(0, 0), -1)).toBeNull();
    expect(neighbour(steps, at(1, 0), 1)).toBeNull();
  });
  it("from nowhere, goes back to the last step only", () => {
    expect(neighbour(steps, null, -1)).toEqual(at(1, 0));
    expect(neighbour(steps, null, 1)).toBeNull();
  });
});

describe("sameIds / sameStep", () => {
  it("compares segment ids as sets", () => {
    expect(sameIds([3, 1, 2], [1, 2, 3])).toBe(true);
    expect(sameIds([1, 2], [1, 2, 3])).toBe(false);
    expect(sameIds([1, 1, 2], [2, 1])).toBe(true);
  });
  it("compares steps by position", () => {
    expect(sameStep(at(0, 1), at(0, 1))).toBe(true);
    expect(sameStep(at(0, 1), null)).toBe(false);
  });
});
