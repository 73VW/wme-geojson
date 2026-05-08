import { describe, it, expect } from "vitest";
import { effectiveSampleSpacing, effectiveSampleSpacingProjection } from "../matching/sampleSpacing";

describe("effectiveSampleSpacing (SegmentMatcher / BUFFERED, floor 10 m)", () => {
  it("returns 10 m for very short segments (< 100 m)", () => {
    expect(effectiveSampleSpacing(0)).toBe(10);
    expect(effectiveSampleSpacing(1)).toBe(10);
    expect(effectiveSampleSpacing(50)).toBe(10);
    expect(effectiveSampleSpacing(99)).toBe(10);
  });

  it("boundary at 100 m transitions to 12 m tier", () => {
    expect(effectiveSampleSpacing(99)).toBe(10);
    expect(effectiveSampleSpacing(100)).toBe(12);
  });

  it("returns 12 m for medium segments (100–299 m)", () => {
    expect(effectiveSampleSpacing(100)).toBe(12);
    expect(effectiveSampleSpacing(200)).toBe(12);
    expect(effectiveSampleSpacing(299)).toBe(12);
  });

  it("boundary at 300 m transitions to 15 m tier", () => {
    expect(effectiveSampleSpacing(299)).toBe(12);
    expect(effectiveSampleSpacing(300)).toBe(15);
  });

  it("returns 15 m for long segments (>= 300 m)", () => {
    expect(effectiveSampleSpacing(300)).toBe(15);
    expect(effectiveSampleSpacing(500)).toBe(15);
    expect(effectiveSampleSpacing(1000)).toBe(15);
  });
});

describe("effectiveSampleSpacingProjection (WalkController / projection cache, floor 8 m)", () => {
  it("returns 8 m for very short segments (< 100 m)", () => {
    expect(effectiveSampleSpacingProjection(0)).toBe(8);
    expect(effectiveSampleSpacingProjection(1)).toBe(8);
    expect(effectiveSampleSpacingProjection(50)).toBe(8);
    expect(effectiveSampleSpacingProjection(99)).toBe(8);
  });

  it("boundary at 100 m transitions to 12 m tier", () => {
    expect(effectiveSampleSpacingProjection(99)).toBe(8);
    expect(effectiveSampleSpacingProjection(100)).toBe(12);
  });

  it("returns 12 m for medium segments (100–299 m)", () => {
    expect(effectiveSampleSpacingProjection(100)).toBe(12);
    expect(effectiveSampleSpacingProjection(200)).toBe(12);
    expect(effectiveSampleSpacingProjection(299)).toBe(12);
  });

  it("boundary at 300 m transitions to 15 m tier", () => {
    expect(effectiveSampleSpacingProjection(299)).toBe(12);
    expect(effectiveSampleSpacingProjection(300)).toBe(15);
  });

  it("returns 15 m for long segments (>= 300 m)", () => {
    expect(effectiveSampleSpacingProjection(300)).toBe(15);
    expect(effectiveSampleSpacingProjection(500)).toBe(15);
    expect(effectiveSampleSpacingProjection(1000)).toBe(15);
  });
});
