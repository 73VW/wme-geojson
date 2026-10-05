// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { StepReview, reviewControlsFor } from "../controller/StepReview";
import { SourceStore } from "../state/SourceStore";
import type { Source, SubLine } from "../domain/types";

function sub(index: number, ids: number[], validated = true): SubLine {
  return {
    index,
    kmA: index,
    kmB: index + 1,
    bbox: [0, 0, 0, 0],
    view: { lon: 7 + index, lat: 46, zoom: 17 },
    segmentIds: ids,
    validated,
  };
}

function setup(matchResult: number[] = [10, 11]) {
  const source: Source = {
    schemaVersion: 1,
    sourceId: "s",
    kind: "geojson",
    hasCsv: false,
    cursor: { lineIndex: 0, subLineIndex: 2 },
    lines: [
      {
        index: 0,
        bbox: [0, 0, 0, 0],
        geometry: { type: "MultiLineString", coordinates: [] },
        lengthKm: 10,
        subLines: [sub(0, [1, 2]), sub(1, [3, 4]), sub(2, [], false)],
        pendingTail: [{ kmA: 3, kmB: 10 }],
      },
    ],
  };
  const store = new SourceStore();
  store.hydrate(source);
  let selection: number[] = [];
  const map = {
    setMapCenter: vi.fn(),
    waitIdle: vi.fn(async () => {}),
    setSelection: vi.fn((ids: number[]) => {
      selection = ids;
    }),
    getSelection: () => selection,
  };
  const match = { runMatchFor: vi.fn(async () => matchResult) };
  const onChange = vi.fn();
  const review = new StepReview({ store, map, match, onChange });
  return { review, store, map, match, onChange, select: (ids: number[]) => (selection = ids) };
}

const step1 = { lineIndex: 0, subLineIndex: 1 };

describe("StepReview", () => {
  it("opens a validated sub-line on its map view, clean", async () => {
    const { review, map, onChange } = setup();
    await review.open(step1);
    expect(map.setMapCenter).toHaveBeenCalledWith(8, 46, 17);
    expect(review.state).toEqual({ step: step1, dirty: false, busy: false });
    expect(onChange).toHaveBeenCalled();
  });

  it("refuses to open a sub-line that is not validated", async () => {
    const { review } = setup();
    await review.open({ lineIndex: 0, subLineIndex: 2 });
    expect(review.state).toBeNull();
  });

  it("selects the stored segments of the reviewed sub-line", async () => {
    const { review, map } = setup();
    await review.open(step1);
    review.selectMatched();
    expect(map.setSelection).toHaveBeenLastCalledWith([3, 4]);
  });

  it("re-matches into the selection without storing, dirty only if different", async () => {
    const { review, map, match, store } = setup([4, 3]);
    await review.open(step1);
    await review.rematch();
    expect(match.runMatchFor).toHaveBeenCalledWith(step1);
    expect(map.setSelection).toHaveBeenLastCalledWith([4, 3]);
    expect(review.state?.dirty).toBe(false);
    expect(store.getSource()!.lines[0].subLines[1].segmentIds).toEqual([3, 4]);

    const other = setup([3, 4, 5]);
    await other.review.open(step1);
    await other.review.rematch();
    expect(other.review.state?.dirty).toBe(true);
  });

  it("tracks selection changes against the stored ids, ignoring order", async () => {
    const { review } = setup();
    await review.open(step1);
    review.selectionChanged([4, 3]);
    expect(review.state?.dirty).toBe(false);
    review.selectionChanged([3, 4, 9]);
    expect(review.state?.dirty).toBe(true);
  });

  it("saves the selection into that sub-line only, keeping later ones and the cursor", async () => {
    const { review, store, select } = setup();
    await review.open(step1);
    select([3, 4, 9]);
    review.selectionChanged([3, 4, 9]);
    review.save();
    const src = store.getSource()!;
    expect(src.lines[0].subLines.map((s) => s.segmentIds)).toEqual([[1, 2], [3, 4, 9], []]);
    expect(src.lines[0].subLines).toHaveLength(3);
    expect(src.cursor).toEqual({ lineIndex: 0, subLineIndex: 2 });
    expect(review.state?.dirty).toBe(false);
  });

  it("cancel puts the stored selection back", async () => {
    const { review, map } = setup();
    await review.open(step1);
    review.selectionChanged([9]);
    review.cancel();
    expect(map.setSelection).toHaveBeenLastCalledWith([3, 4]);
    expect(review.state?.dirty).toBe(false);
  });

  it("closes", async () => {
    const { review } = setup();
    await review.open(step1);
    review.close();
    expect(review.state).toBeNull();
  });
});

describe("reviewControlsFor", () => {
  const step = { lineIndex: 0, subLineIndex: 0 };
  it("hides everything outside a review", () => {
    const c = reviewControlsFor(null);
    expect([c.selectMatched, c.rematch, c.save, c.cancel].every((b) => !b.visible)).toBe(true);
  });
  it("offers select / re-match while clean, save / cancel once dirty", () => {
    const clean = reviewControlsFor({ step, dirty: false, busy: false });
    expect(clean.selectMatched.visible && clean.rematch.visible).toBe(true);
    expect(clean.save.visible || clean.cancel.visible).toBe(false);
    const dirty = reviewControlsFor({ step, dirty: true, busy: false });
    expect(dirty.save.visible && dirty.cancel.visible).toBe(true);
  });
  it("disables everything while re-matching", () => {
    const busy = reviewControlsFor({ step, dirty: false, busy: true });
    expect(busy.selectMatched.enabled || busy.rematch.enabled).toBe(false);
  });
});
