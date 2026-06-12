import { describe, expect, it, vi } from "vitest";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";

function track(): NormalizedTrack {
  return {
    trackId: null,
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [6.0, 46.0],
          [6.1, 46.0],
        ],
      ],
    },
    rawProperties: {},
  };
}

describe("buildGeojsonSource", () => {
  it("creates a single Line when no CSV is provided", () => {
    const src = buildGeojsonSource({ sourceId: "geo-1", track: track() });
    expect(src.kind).toBe("geojson");
    expect(src.hasCsv).toBe(false);
    expect(src.lines).toHaveLength(1);
    expect(src.lines[0].startISO).toBeUndefined();
    expect(src.lines[0].pendingTail[0].kmA).toBe(0);
    expect(src.lines[0].pendingTail[0].kmB).toBeGreaterThan(0);
  });

  it("creates one Line per work item (waypoint segment) with time windows", () => {
    const rows: CsvRow[] = [
      { distance: 0, startTime: "08:00", endTime: "12:00", date: "2026-05-21", segments: null },
      { distance: 3, startTime: "12:00", endTime: "18:00", date: "2026-05-21", segments: null },
      { distance: 6, startTime: "18:00", endTime: "20:00", date: "2026-05-21", segments: null },
    ];
    const onWarning = vi.fn();
    const src = buildGeojsonSource({ sourceId: "geo-2", track: track(), csvRows: rows, onWarning });
    expect(src.hasCsv).toBe(true);
    // 3 strictly-increasing waypoints → 2 segments → 2 lines.
    expect(src.lines).toHaveLength(2);
    expect(src.lines[0].startISO).toBe("2026-05-21T08:00");
    expect(src.lines[0].endISO).toBe("2026-05-21T12:00");
    expect(src.lines[1].startISO).toBe("2026-05-21T12:00");
    expect(src.lines[1].endISO).toBe("2026-05-21T18:00");
    // No degenerate rows → onWarning must not have been called.
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("calls onWarning and skips the degenerate row when two consecutive distances are equal", () => {
    // Row at index 1 has distance == row at index 2 → zero-length segment → degenerate.
    const rows: CsvRow[] = [
      { distance: 0, startTime: "08:00", endTime: "10:00", date: "2026-05-21", segments: null },
      { distance: 3.2, startTime: "10:00", endTime: "12:00", date: "2026-05-21", segments: null },
      { distance: 3.2, startTime: "12:00", endTime: "14:00", date: "2026-05-21", segments: null },
      { distance: 6, startTime: "14:00", endTime: "18:00", date: "2026-05-21", segments: null },
    ];
    const onWarning = vi.fn();
    const src = buildGeojsonSource({ sourceId: "geo-3", track: track(), csvRows: rows, onWarning });
    expect(src.hasCsv).toBe(true);
    // The degenerate segment (km 3.2–3.2) must be excluded.
    const startISOs = src.lines.map((l) => l.startISO);
    expect(startISOs).not.toContain("2026-05-21T10:00"); // degenerate row skipped
    // onWarning must have been called once, mentioning the row index and km range.
    expect(onWarning).toHaveBeenCalledTimes(1);
    const msg: string = onWarning.mock.calls[0][0];
    expect(msg).toMatch(/row\s+1/i);
    expect(msg).toMatch(/3\.2/);
  });

  it("calls onWarning and skips without a callback (backward-compatible: no throw)", () => {
    // Same degenerate scenario but no onWarning provided → must not throw.
    const rows: CsvRow[] = [
      { distance: 0, startTime: "08:00", endTime: "10:00", date: "2026-05-21", segments: null },
      { distance: 3.2, startTime: "10:00", endTime: "12:00", date: "2026-05-21", segments: null },
      { distance: 3.2, startTime: "12:00", endTime: "14:00", date: "2026-05-21", segments: null },
    ];
    expect(() =>
      buildGeojsonSource({ sourceId: "geo-4", track: track(), csvRows: rows }),
    ).not.toThrow();
  });
});
