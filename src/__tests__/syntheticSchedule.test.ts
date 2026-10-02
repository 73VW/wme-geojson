import { describe, it, expect } from "vitest";
import { buildSyntheticRow, buildGlobalClosureRows } from "../csv/syntheticSchedule";

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

describe("buildGlobalClosureRows", () => {
  const geo = { lon: 6.6, lat: 46.5, zoom: 7 };
  const windows = [
    { startISO: "2026-06-01T09:00", endISO: "2026-06-01T12:00" },
    { startISO: "2026-06-01T14:00", endISO: "2026-06-01T17:30" },
  ];

  it("emits one set of rows per window", () => {
    const out = buildGlobalClosureRows(windows, [
      { segmentIds: [1, 2], geo },
      { segmentIds: [3], geo },
    ]);
    expect(out.rows.map((r) => [r.startTime, r.endTime, r.segments])).toEqual([
      ["09:00", "12:00", [1, 2]],
      ["09:00", "12:00", [3]],
      ["14:00", "17:30", [1, 2]],
      ["14:00", "17:30", [3]],
    ]);
    expect(out.groups.map((g) => g.rowIndex)).toEqual([0, 1, 2, 3]);
    expect(out.closuresBySegment[1]).toEqual([
      { ...windows[0], rowIndex: 0 },
      { ...windows[1], rowIndex: 2 },
    ]);
  });
});
