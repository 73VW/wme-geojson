import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../csv/types";
import {
  bboxOfMultiLineString,
  computeMatchingWorkItems,
  multiLineLengthKm,
  sliceMultiLineByDistance,
} from "../matching/trackPortions";
import type { Line, Source } from "./types";

export interface BuildGeojsonSourceInput {
  sourceId: string;
  track: NormalizedTrack;
  csvRows?: CsvRow[];
}

function bbox4(geometry: import("geojson").MultiLineString): [number, number, number, number] | null {
  const box = bboxOfMultiLineString(geometry);
  if (!box) return null;
  return [box[0], box[1], box[2], box[3]];
}

export function buildGeojsonSource(input: BuildGeojsonSourceInput): Source {
  const fullLengthKm = multiLineLengthKm(input.track.geometry);
  const lines: Line[] = [];

  if (!input.csvRows || input.csvRows.length === 0) {
    const bbox = bbox4(input.track.geometry);
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
    const bbox = bbox4(geom);
    if (!bbox) return;
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
