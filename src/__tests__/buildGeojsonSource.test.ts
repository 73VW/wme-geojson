import { describe, expect, it } from "vitest";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";

function track(): NormalizedTrack {
  return {
    trackId: null,
    geometry: { type: "MultiLineString", coordinates: [[[6.0, 46.0], [6.1, 46.0]]] },
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
    const src = buildGeojsonSource({ sourceId: "geo-2", track: track(), csvRows: rows });
    expect(src.hasCsv).toBe(true);
    // 3 strictly-increasing waypoints → 2 segments → 2 lines.
    expect(src.lines).toHaveLength(2);
    expect(src.lines[0].startISO).toBe("2026-05-21T08:00");
    expect(src.lines[0].endISO).toBe("2026-05-21T12:00");
    expect(src.lines[1].startISO).toBe("2026-05-21T12:00");
    expect(src.lines[1].endISO).toBe("2026-05-21T18:00");
  });
});
