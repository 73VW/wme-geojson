import { describe, expect, it } from "vitest";
import {
  formatSubLineLabel,
  mergeSubLineState,
  subLineStateFromStep,
  type SubLineState,
} from "../ui/subtabs/sublineDebug";
import type { PipelineStepEvent } from "../controller/MatchingPipeline";

describe("sublineDebug", () => {
  it("extracts sub-line state from processing/matched/waiting step events", () => {
    const processing: PipelineStepEvent = {
      key: "processingLeaf",
      rowIndex: 2,
      values: { index: 2, total: 4, kmA: 10.1, kmB: 10.7 },
    };
    const matched: PipelineStepEvent = {
      key: "leafMatched",
      rowIndex: 2,
      values: { index: 2, total: 4, count: 6 },
    };

    expect(subLineStateFromStep(processing)).toEqual({
      index: 2,
      total: 4,
      kmA: 10.1,
      kmB: 10.7,
      status: "processing",
    });

    expect(subLineStateFromStep(matched)).toEqual({
      index: 2,
      total: 4,
      status: "matched",
    });
  });

  it("returns null for non sub-line step events", () => {
    const event: PipelineStepEvent = {
      key: "planningDone",
      rowIndex: 0,
      values: { count: 3 },
    };
    expect(subLineStateFromStep(event)).toBeNull();
  });

  it("merges updates by sub-line index while preserving deterministic order", () => {
    const start: SubLineState[] = [
      { index: 2, total: 3, kmA: 1.5, kmB: 2.2, status: "processing" },
    ];

    const withFirst = mergeSubLineState(start, {
      index: 1,
      total: 3,
      kmA: 1,
      kmB: 1.5,
      status: "processing",
    });

    expect(withFirst.map((line) => line.index)).toEqual([1, 2]);

    const updatedSecond = mergeSubLineState(withFirst, {
      index: 2,
      total: 3,
      status: "matched",
    });

    expect(updatedSecond).toEqual([
      { index: 1, total: 3, kmA: 1, kmB: 1.5, status: "processing" },
      { index: 2, total: 3, kmA: 1.5, kmB: 2.2, status: "matched" },
    ]);
  });

  it("formats a readable label for one sub-line", () => {
    expect(
      formatSubLineLabel({ index: 3, total: 5, kmA: 14.2, kmB: 14.88, status: "processing" }),
    ).toBe("3/5 - 14.20 -> 14.88 km");
  });
});
