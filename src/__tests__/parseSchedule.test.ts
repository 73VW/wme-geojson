import { describe, it, expect } from "vitest";
import { parseSchedule } from "../csv/parseSchedule";

// Representative subset of the real schedule CSV used by the user.
const SAMPLE_CSV = `distance,start_time,end_time,date,segments
0.0,13:00,13:50,2026-04-29,
1.9,13:02,13:52,2026-04-29,
3.8,13:04,13:55,2026-04-29,201;202;203
10.5,13:15,14:05,2026-04-29,
86.2,14:54,15:52,2026-04-29,
`;

describe("parseSchedule", () => {
  it("parses all rows from the sample CSV", () => {
    const rows = parseSchedule(SAMPLE_CSV);
    expect(rows).toHaveLength(5);
  });

  it("parses the first row correctly", () => {
    const rows = parseSchedule(SAMPLE_CSV);
    expect(rows[0]).toEqual({
      distance: 0.0,
      startTime: "13:00",
      endTime: "13:50",
      date: "2026-04-29",
      segments: null,
    });
  });

  it("parses the last row correctly", () => {
    const rows = parseSchedule(SAMPLE_CSV);
    const last = rows[rows.length - 1];
    expect(last).toEqual({
      distance: 86.2,
      startTime: "14:54",
      endTime: "15:52",
      date: "2026-04-29",
      segments: null,
    });
  });

  it("parses a row with pre-filled segments", () => {
    const rows = parseSchedule(SAMPLE_CSV);
    // Row index 2 has segments 201;202;203
    expect(rows[2].segments).toEqual([201, 202, 203]);
  });

  it("treats empty segments column as null", () => {
    const rows = parseSchedule(SAMPLE_CSV);
    // Row index 0 has an empty segments column
    expect(rows[0].segments).toBeNull();
  });

  it("tolerates rows where the segments column is entirely absent", () => {
    const csv = `distance,start_time,end_time,date,segments\n5.0,08:00,09:00,2026-04-29\n`;
    const rows = parseSchedule(csv);
    expect(rows[0].segments).toBeNull();
  });

  it("tolerates a leading BOM character", () => {
    // BOM: U+FEFF
    const csv = `﻿distance,start_time,end_time,date,segments\n0.0,13:00,13:50,2026-04-29,\n`;
    const rows = parseSchedule(csv);
    expect(rows).toHaveLength(1);
  });

  it("tolerates trailing empty lines", () => {
    const csv = `distance,start_time,end_time,date,segments\n1.0,08:00,09:00,2026-01-01,\n\n\n`;
    const rows = parseSchedule(csv);
    expect(rows).toHaveLength(1);
  });

  it("tolerates CRLF line endings", () => {
    const csv =
      "distance,start_time,end_time,date,segments\r\n2.0,08:00,09:00,2026-01-01,\r\n";
    const rows = parseSchedule(csv);
    expect(rows[0].distance).toBe(2.0);
  });

  it("parses a single-segment value correctly", () => {
    const csv = `distance,start_time,end_time,date,segments\n5.0,08:00,09:00,2026-04-29,42\n`;
    const rows = parseSchedule(csv);
    expect(rows[0].segments).toEqual([42]);
  });

  it("throws on a malformed header", () => {
    const csv = `dist,start,end,date,segs\n0.0,13:00,13:50,2026-04-29,\n`;
    expect(() => parseSchedule(csv)).toThrow(/Unexpected header/);
  });

  it("throws on a non-numeric distance", () => {
    const csv = `distance,start_time,end_time,date,segments\nfoo,13:00,13:50,2026-04-29,\n`;
    expect(() => parseSchedule(csv)).toThrow(/non-numeric distance/);
  });

  it("throws when the CSV is entirely empty", () => {
    expect(() => parseSchedule("")).toThrow();
  });
});
