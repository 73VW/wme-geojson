import { describe, it, expect } from "vitest";
import { buildSyntheticRow } from "../csv/syntheticSchedule";

describe("buildSyntheticRow", () => {
  it("starts the slice at distance 0 so it spans the whole track", () => {
    const row = buildSyntheticRow();
    expect(row.distance).toBe(0);
  });

  it("leaves time and date fields empty until the closure window is set", () => {
    const row = buildSyntheticRow();
    expect(row.startTime).toBe("");
    expect(row.endTime).toBe("");
    expect(row.date).toBe("");
  });

  it("starts with no validated segments", () => {
    const row = buildSyntheticRow();
    expect(row.segments).toBeNull();
  });
});
