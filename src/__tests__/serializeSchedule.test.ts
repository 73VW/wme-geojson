import { describe, it, expect } from "vitest";
import { parseSchedule } from "../csv/parseSchedule";
import { serializeSchedule } from "../csv/serializeSchedule";
import type { CsvRow } from "../state/SessionStore";

const SAMPLE_CSV = `distance,start_time,end_time,date,segments
0.0,13:00,13:50,2026-04-29,
1.9,13:02,13:52,2026-04-29,
3.8,13:04,13:55,2026-04-29,201;202;203
86.2,14:54,15:52,2026-04-29,
`;

describe("serializeSchedule", () => {
  it("produces output that re-parses to identical rows", () => {
    const original = parseSchedule(SAMPLE_CSV);
    const serialized = serializeSchedule(original);
    const roundTripped = parseSchedule(serialized);
    expect(roundTripped).toEqual(original);
  });

  it("serializes null segments as an empty field", () => {
    const rows: CsvRow[] = [
      {
        distance: 0.0,
        startTime: "08:00",
        endTime: "09:00",
        date: "2026-01-01",
        segments: null,
      },
    ];
    const out = serializeSchedule(rows);
    // The segments column should be present but empty (trailing comma on the data row)
    expect(out).toContain("0,08:00,09:00,2026-01-01,\n");
  });

  it("serializes non-null segments joined by semicolons", () => {
    const rows: CsvRow[] = [
      {
        distance: 3.8,
        startTime: "13:04",
        endTime: "13:55",
        date: "2026-04-29",
        segments: [201, 202, 203],
      },
    ];
    const out = serializeSchedule(rows);
    expect(out).toContain("201;202;203");
  });

  it("produces a trailing newline", () => {
    const rows: CsvRow[] = [
      {
        distance: 1.0,
        startTime: "08:00",
        endTime: "09:00",
        date: "2026-01-01",
        segments: null,
      },
    ];
    const out = serializeSchedule(rows);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("round-trips after mutating a row's segments", () => {
    const original = parseSchedule(SAMPLE_CSV);
    // Simulate a user validating the first row
    const mutated = original.map((row, i) => (i === 0 ? { ...row, segments: [999, 1000] } : row));
    const reparsed = parseSchedule(serializeSchedule(mutated));
    expect(reparsed[0].segments).toEqual([999, 1000]);
    // Unmodified rows survive the round-trip unchanged
    expect(reparsed[1]).toEqual(original[1]);
    expect(reparsed[2]).toEqual(original[2]);
  });

  it("serializes an empty rows array with just the header", () => {
    const out = serializeSchedule([]);
    expect(out.trim()).toBe("distance,start_time,end_time,date,segments");
  });
});
