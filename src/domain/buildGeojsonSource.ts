import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../csv/types";
import {
  bbox4OfMultiLineString,
  computeMatchingWorkItems,
  multiLineLengthKm,
  sliceMultiLineByDistance,
} from "../matching/trackPortions";
import type { Line, Source } from "./types";

export interface BuildGeojsonSourceInput {
  sourceId: string;
  track: NormalizedTrack;
  csvRows?: CsvRow[];
  onWarning?: (message: string) => void;
}

export function buildGeojsonSource(input: BuildGeojsonSourceInput): Source {
  const fullLengthKm = multiLineLengthKm(input.track.geometry);
  const lines: Line[] = [];

  if (!input.csvRows || input.csvRows.length === 0) {
    const bbox = bbox4OfMultiLineString(input.track.geometry);
    if (!bbox) throw new Error("buildGeojsonSource: empty bbox");
    lines.push({
      index: 0,
      bbox,
      geometry: input.track.geometry,
      lengthKm: fullLengthKm,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: fullLengthKm }],
    });
    return {
      schemaVersion: 1,
      sourceId: input.sourceId,
      kind: "geojson",
      hasCsv: false,
      lines,
      cursor: null,
    };
  }

  const workItems = computeMatchingWorkItems(input.csvRows, fullLengthKm);
  workItems.forEach((item, idx) => {
    const geom = sliceMultiLineByDistance(input.track.geometry, item.kmA, item.kmB);
    const bbox = bbox4OfMultiLineString(geom);
    if (!bbox) {
      input.onWarning?.(
        `CSV row ${item.rowIndex} skipped: degenerate portion (km ${item.kmA}–${item.kmB})`,
      );
      return;
    }
    const row = input.csvRows![item.rowIndex];
    lines.push({
      index: idx,
      bbox,
      geometry: geom,
      lengthKm: item.kmB - item.kmA,
      startISO: `${row.date}T${row.startTime}`,
      endISO: `${row.date}T${row.endTime}`,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: item.kmB - item.kmA }],
    });
  });

  return {
    schemaVersion: 1,
    sourceId: input.sourceId,
    kind: "geojson",
    hasCsv: true,
    lines,
    cursor: null,
  };
}
