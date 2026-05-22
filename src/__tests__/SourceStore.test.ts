import { describe, expect, it } from "vitest";
import { SourceStore } from "../state/SourceStore";
import type { Source, SubLine } from "../domain/types";

function srcWithOneLine(): Source {
  return {
    schemaVersion: 1,
    sourceId: "s1",
    kind: "geojson",
    hasCsv: false,
    lines: [{
      index: 0,
      bbox: [0, 0, 1, 1],
      geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
      lengthKm: 2,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: 2 }],
    }],
    cursor: null,
  };
}

function makeSub(index: number, kmA: number, kmB: number): SubLine {
  return {
    index,
    kmA,
    kmB,
    bbox: [0, 0, 1, 1],
    view: { lon: 0.5, lat: 0.5, zoom: 16 },
    segmentIds: [],
    validated: false,
  };
}

describe("SourceStore", () => {
  it("hydrates with the provided source and exposes it via getSource()", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    expect(store.getSource()?.sourceId).toBe("s1");
  });

  it("addSubLine appends to the line, trims pendingTail, sets cursor", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), { kmA: 1, kmB: 2 });
    const src = store.getSource()!;
    expect(src.lines[0].subLines).toHaveLength(1);
    expect(src.lines[0].pendingTail).toEqual([{ kmA: 1, kmB: 2 }]);
    expect(src.cursor).toEqual({ lineIndex: 0, subLineIndex: 0 });
  });

  it("validateSubLine stores segment ids and marks validated", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), null);
    store.validateSubLine(0, 0, [101, 102]);
    const sub = store.getSource()!.lines[0].subLines[0];
    expect(sub.validated).toBe(true);
    expect(sub.segmentIds).toEqual([101, 102]);
  });

  it("rewindCursor(line, sub) drops nothing but moves the cursor backwards", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), { kmA: 1, kmB: 2 });
    store.validateSubLine(0, 0, [1]);
    store.addSubLine(0, makeSub(1, 1, 2), null);
    store.rewindCursor(0, 0);
    expect(store.getSource()!.cursor).toEqual({ lineIndex: 0, subLineIndex: 0 });
    expect(store.getSource()!.lines[0].subLines).toHaveLength(2);
  });

  it("rerunSubLine drops the current sub-line and merges its range back onto pendingTail head", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), { kmA: 1, kmB: 2 });
    store.validateSubLine(0, 0, [42]);
    store.addSubLine(0, makeSub(1, 1, 1.5), { kmA: 1.5, kmB: 2 });
    store.rerunSubLine(0, 1);
    const line = store.getSource()!.lines[0];
    expect(line.subLines).toHaveLength(1);
    expect(line.pendingTail).toEqual([{ kmA: 1, kmB: 2 }]);
  });

  it("emits onChange after each mutation", () => {
    const store = new SourceStore();
    const seen: number[] = [];
    store.onChange(() => seen.push(seen.length));
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), null);
    store.validateSubLine(0, 0, [1]);
    expect(seen.length).toBe(3);
  });
});
