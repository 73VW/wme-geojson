import { describe, expect, it } from "vitest";
import { sliceStrokeWidth } from "../layers/TrackLayer";

describe("sliceStrokeWidth", () => {
  it("thins the highlighted sub-line as the map zooms in, so the segments stay visible", () => {
    expect(sliceStrokeWidth(14)).toBe(7);
    expect(sliceStrokeWidth(15)).toBe(7);
    expect(sliceStrokeWidth(16)).toBe(5);
    expect(sliceStrokeWidth(17)).toBe(3);
    expect(sliceStrokeWidth(20)).toBe(3);
  });
});
