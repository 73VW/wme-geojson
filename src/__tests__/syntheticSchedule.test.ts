import { describe, it, expect } from "vitest";
import { buildSyntheticRow } from "../csv/syntheticSchedule";

describe("buildSyntheticRow", () => {
  it("produces one row carrying the track length as distance", () => {
    const row = buildSyntheticRow(24.3);
    expect(row.distance).toBe(24.3);
  });

  it("leaves time and date fields empty until the closure window is set", () => {
    const row = buildSyntheticRow(10);
    expect(row.startTime).toBe("");
    expect(row.endTime).toBe("");
    expect(row.date).toBe("");
  });

  it("starts with no validated segments", () => {
    const row = buildSyntheticRow(10);
    expect(row.segments).toBeNull();
  });

  it("throws on a non-positive length", () => {
    expect(() => buildSyntheticRow(0)).toThrow();
    expect(() => buildSyntheticRow(-3)).toThrow();
  });
});
