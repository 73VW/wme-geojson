// Pure CSV builder for the Advanced Closures import format.
// No SDK, no DOM — safe to import in Node test environments.

import type { CsvRow, ClosureRange } from "../state/SessionStore";

export interface FinalFields {
  reason: string; // e.g. "Tour de Romandie 2026"
  ignoreTraffic: boolean; // serialized as "Yes" | "No"
  mteId: string; // optional, "" if absent
  comment: string; // optional, "" if absent
}

export interface RowGeo {
  // Per-CsvRow geometry context, captured during matching (Lot 3).
  // Indexed in the same order as SessionState.csvRows.
  lon: number;
  lat: number;
  zoom: number; // integer, WME zoom level used for the bbox view
}

export interface ClosureRowGroup {
  rowIndex: number;
  segmentIds: number[];
  geo: RowGeo;
}

// The Advanced Closures script parses by exact header text — do not modify.
const CLOSURES_CSV_HEADER =
  "header,reason,start date (yyyy-mm-dd hh:mm),end date (yyyy-mm-dd hh:mm),direction (A to B|B to A|TWO WAY),ignore trafic (Yes|No),segment IDs (id1;id2;...),lon/lat (like in a permalink: lon=xxx&lat=yyy),zoom (2 to 10),MTE ID,comment (optional)";

const DIRECTION = "TWO WAY";
const ROW_KIND = "add";
const LON_LAT_DECIMAL_PLACES = 5;
const MAX_SEGMENTS_PER_ROW = 10;

// ISO datetime strings are stored as "YYYY-MM-DDTHH:MM"; the output format
// wants "YYYY-MM-DD HH:MM" (space instead of T).
function isoToDisplayDateTime(iso: string): string {
  return iso.replace("T", " ");
}

function formatLonLat(lon: number, lat: number): string {
  return `lon=${lon.toFixed(LON_LAT_DECIMAL_PLACES)}&lat=${lat.toFixed(LON_LAT_DECIMAL_PLACES)}`;
}

// Validate that no field that will be dropped into a raw CSV column contains
// a comma — the Advanced Closures script uses a naive comma split.
function assertNoComma(value: string, fieldName: string): void {
  if (value.includes(",")) {
    throw new Error(
      `[buildClosuresCsv] Field "${fieldName}" contains a comma which would break the CSV parser: "${value}"`,
    );
  }
}

function buildDataRow(
  segmentIds: number[],
  startISO: string,
  endISO: string,
  geo: RowGeo,
  fields: FinalFields,
): string {
  const ignoreTrafficValue = fields.ignoreTraffic ? "Yes" : "No";
  const segmentsField = segmentIds.join(";");
  const lonLatField = formatLonLat(geo.lon, geo.lat);
  const startDisplay = isoToDisplayDateTime(startISO);
  const endDisplay = isoToDisplayDateTime(endISO);

  return [
    ROW_KIND,
    fields.reason,
    startDisplay,
    endDisplay,
    DIRECTION,
    ignoreTrafficValue,
    segmentsField,
    lonLatField,
    String(geo.zoom),
    fields.mteId,
    fields.comment,
  ].join(",");
}

function chunkSegmentIds(segmentIds: readonly number[]): number[][] {
  const chunks: number[][] = [];

  for (let start = 0; start < segmentIds.length; start += MAX_SEGMENTS_PER_ROW) {
    chunks.push(segmentIds.slice(start, start + MAX_SEGMENTS_PER_ROW));
  }

  return chunks;
}

// Merge overlapping ClosureRange entries for a single segment.
// Two ranges with end(A) === start(B) are NOT considered overlapping (spec §D).
// Returns the merged ranges, sorted by startISO.
function mergeRanges(ranges: ClosureRange[]): ClosureRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) =>
    a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0,
  );

  const merged: ClosureRange[] = [];
  // Use the rowIndex of the first range in each group so callers can trace
  // the merge back to a source row (used for picking the RowGeo).
  let currentStart = sorted[0].startISO;
  let currentEnd = sorted[0].endISO;
  let currentRowIndex = sorted[0].rowIndex;

  for (let i = 1; i < sorted.length; i++) {
    const range = sorted[i];
    // Strictly-greater-than: touching boundaries do not merge (spec §D).
    const overlaps = range.startISO < currentEnd;
    if (overlaps) {
      // Extend the current group's end if the incoming range reaches further.
      if (range.endISO > currentEnd) {
        currentEnd = range.endISO;
      }
    } else {
      merged.push({
        startISO: currentStart,
        endISO: currentEnd,
        rowIndex: currentRowIndex,
      });
      currentStart = range.startISO;
      currentEnd = range.endISO;
      currentRowIndex = range.rowIndex;
    }
  }
  merged.push({
    startISO: currentStart,
    endISO: currentEnd,
    rowIndex: currentRowIndex,
  });

  return merged;
}

// True when the merged set has the same shape (same count, same boundaries)
// as the original sorted set — meaning no two ranges actually overlapped.
function noMergeOccurred(
  original: ClosureRange[],
  merged: ClosureRange[],
): boolean {
  if (original.length !== merged.length) {
    return false;
  }
  for (let i = 0; i < original.length; i++) {
    if (
      original[i].startISO !== merged[i].startISO ||
      original[i].endISO !== merged[i].endISO
    ) {
      return false;
    }
  }
  return true;
}

export function buildClosuresCsv(
  rows: readonly CsvRow[],
  rowGeosOrGroups: readonly RowGeo[] | readonly ClosureRowGroup[],
  closuresBySegment: Readonly<Record<number, ClosureRange[]>>,
  finalFields: FinalFields,
): string {
  assertNoComma(finalFields.reason, "reason");
  assertNoComma(finalFields.comment, "comment");
  assertNoComma(finalFields.mteId, "mteId");

  // --- Phase 1: classify each segment as "keep in original rows" or "deduplicate".
  //
  // Segments with no overlapping ranges stay in their original rows unchanged.
  // Segments with at least one overlap are removed from every original row and
  // get dedicated merged-range rows appended at the end.

  const closureGroups = normalizeClosureGroups(rows, rowGeosOrGroups);

  // Set of segment IDs that need to be stripped from original rows.
  const segmentsToStrip = new Set<number>();

  // For segments that overlap: the merged ranges with their chosen RowGeo.
  // Each entry is one merged row to emit at the end.
  interface MergedRow {
    segmentId: number;
    startISO: string;
    endISO: string;
    geo: RowGeo;
  }
  const mergedRows: MergedRow[] = [];

  for (const [segIdStr, ranges] of Object.entries(closuresBySegment)) {
    const segId = Number(segIdStr);
    const sortedOriginal = [...ranges].sort((a, b) =>
      a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0,
    );
    const merged = mergeRanges(ranges);

    if (noMergeOccurred(sortedOriginal, merged)) {
      // No overlap — segment stays in its original rows; nothing to strip.
      continue;
    }

    // At least one overlap occurred: strip from original rows and emit
    // one dedicated row per merged range.
    segmentsToStrip.add(segId);

    for (const mergedRange of merged) {
      const geo = findGroupGeoForSegment(closureGroups, mergedRange.rowIndex, segId);
      mergedRows.push({
        segmentId: segId,
        startISO: mergedRange.startISO,
        endISO: mergedRange.endISO,
        geo,
      });
    }
  }

  // --- Phase 2: emit original rows (with stripped segments removed).

  const outputLines: string[] = [CLOSURES_CSV_HEADER];

  closureGroups.forEach((group) => {
    if (group.segmentIds.length === 0) {
      // Row has no validated segments — skip it entirely.
      return;
    }

    const row = rows[group.rowIndex];

    const remainingSegments = group.segmentIds.filter(
      (id) => !segmentsToStrip.has(id),
    );

    if (remainingSegments.length === 0) {
      // All segments in this row were moved to merged-range rows — skip.
      return;
    }

    const startISO = `${row.date}T${row.startTime}`;
    const endISO = `${row.date}T${row.endTime}`;

    for (const segmentChunk of chunkSegmentIds(remainingSegments)) {
      outputLines.push(
        buildDataRow(segmentChunk, startISO, endISO, group.geo, finalFields),
      );
    }
  });

  // --- Phase 3: append merged-range rows ordered by (segmentId, startISO).

  mergedRows.sort((a, b) => {
    if (a.segmentId !== b.segmentId) {
      return a.segmentId - b.segmentId;
    }
    return a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0;
  });

  for (const mergedRow of mergedRows) {
    for (const segmentChunk of chunkSegmentIds([mergedRow.segmentId])) {
      outputLines.push(
        buildDataRow(
          segmentChunk,
          mergedRow.startISO,
          mergedRow.endISO,
          mergedRow.geo,
          finalFields,
        ),
      );
    }
  }

  return outputLines.join("\n") + "\n";
}

function normalizeClosureGroups(
  rows: readonly CsvRow[],
  rowGeosOrGroups: readonly RowGeo[] | readonly ClosureRowGroup[],
): ClosureRowGroup[] {
  if (rowGeosOrGroups.length === 0) {
    return [];
  }

  if (isClosureRowGroupArray(rowGeosOrGroups)) {
    return rowGeosOrGroups.map((group) => ({
      rowIndex: group.rowIndex,
      segmentIds: [...group.segmentIds],
      geo: group.geo,
    }));
  }

  const rowGeos = rowGeosOrGroups;
  return rows.flatMap((row, rowIndex) => {
    if (row.segments === null || row.segments.length === 0) {
      return [];
    }

    const geo = rowGeos[rowIndex];
    if (!geo) {
      throw new Error(
        `[buildClosuresCsv] Missing RowGeo for row ${rowIndex}`,
      );
    }

    return [{ rowIndex, segmentIds: [...row.segments], geo }];
  });
}

function isClosureRowGroupArray(
  value: readonly RowGeo[] | readonly ClosureRowGroup[],
): value is readonly ClosureRowGroup[] {
  const first = value[0];
  return typeof first === "object" && first !== null && "rowIndex" in first && "segmentIds" in first;
}

function findGroupGeoForSegment(
  groups: readonly ClosureRowGroup[],
  rowIndex: number,
  segmentId: number,
): RowGeo {
  const matchingGroup = groups.find(
    (group) => group.rowIndex === rowIndex && group.segmentIds.includes(segmentId),
  );
  if (matchingGroup) {
    return matchingGroup.geo;
  }

  const fallbackGroup = groups.find((group) => group.rowIndex === rowIndex);
  if (fallbackGroup) {
    return fallbackGroup.geo;
  }

  throw new Error(
    `[buildClosuresCsv] Missing export group geo for row ${rowIndex} and segment ${segmentId}`,
  );
}
