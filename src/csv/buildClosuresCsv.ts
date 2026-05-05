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
  comment: string,
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
    comment,
  ].join(",");
}

function buildRowDescription(rows: readonly CsvRow[], rowIndex: number): string {
  const row = rows[rowIndex];
  if (!row) {
    return `ligne ${rowIndex + 1}`;
  }

  return `ligne ${rowIndex + 1} | ${row.date} ${row.startTime}-${row.endTime} | ${row.distance} km`;
}

function buildCommentWithRowDescription(
  fields: FinalFields,
  rows: readonly CsvRow[],
  rowIndex: number,
): string {
  const rowDescription = buildRowDescription(rows, rowIndex);

  if (fields.comment.length === 0) {
    return rowDescription;
  }

  return `${fields.comment} - ${rowDescription}`;
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
function noMergeOccurred(original: ClosureRange[], merged: ClosureRange[]): boolean {
  if (original.length !== merged.length) {
    return false;
  }
  for (let i = 0; i < original.length; i++) {
    if (original[i].startISO !== merged[i].startISO || original[i].endISO !== merged[i].endISO) {
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

  const closureGroups = normalizeClosureGroups(rows, rowGeosOrGroups);

  interface SegmentClosureEntry {
    segmentId: number;
    rowIndex: number;
    startISO: string;
    endISO: string;
    geo: RowGeo;
    groupOrder: number;
  }

  const plainEntries: SegmentClosureEntry[] = [];
  const mergedEntries: SegmentClosureEntry[] = [];

  for (const [segIdStr, ranges] of Object.entries(closuresBySegment)) {
    const segId = Number(segIdStr);
    const sortedOriginal = [...ranges].sort((a, b) =>
      a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0,
    );
    const merged = mergeRanges(ranges);

    const targetEntries = noMergeOccurred(sortedOriginal, merged) ? plainEntries : mergedEntries;
    const rangesToEmit = noMergeOccurred(sortedOriginal, merged) ? sortedOriginal : merged;

    for (const range of rangesToEmit) {
      const groupMatch = findGroupForSegment(closureGroups, range.rowIndex, segId);
      targetEntries.push({
        segmentId: segId,
        rowIndex: range.rowIndex,
        startISO: range.startISO,
        endISO: range.endISO,
        geo: groupMatch.geo,
        groupOrder: groupMatch.groupOrder,
      });
    }
  }

  const outputLines: string[] = [CLOSURES_CSV_HEADER];

  const groupedPlainRows = groupSegmentEntries(plainEntries);
  groupedPlainRows
    .sort((left, right) => {
      if (left.rowIndex !== right.rowIndex) {
        return left.rowIndex - right.rowIndex;
      }
      if (left.groupOrder !== right.groupOrder) {
        return left.groupOrder - right.groupOrder;
      }
      return left.startISO < right.startISO ? -1 : left.startISO > right.startISO ? 1 : 0;
    })
    .forEach((row) => {
      for (const segmentChunk of chunkSegmentIds(row.segmentIds)) {
        outputLines.push(
          buildDataRow(
            segmentChunk,
            row.startISO,
            row.endISO,
            row.geo,
            finalFields,
            buildCommentWithRowDescription(finalFields, rows, row.rowIndex),
          ),
        );
      }
    });

  mergedEntries.sort((a, b) => {
    if (a.segmentId !== b.segmentId) {
      return a.segmentId - b.segmentId;
    }
    return a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0;
  });

  mergedEntries.forEach((entry) => {
    outputLines.push(
      buildDataRow(
        [entry.segmentId],
        entry.startISO,
        entry.endISO,
        entry.geo,
        finalFields,
        buildCommentWithRowDescription(finalFields, rows, entry.rowIndex),
      ),
    );
  });

  return outputLines.join("\n") + "\n";
}

interface GroupedSegmentRow {
  rowIndex: number;
  startISO: string;
  endISO: string;
  geo: RowGeo;
  groupOrder: number;
  segmentIds: number[];
}

function groupSegmentEntries(
  entries: ReadonlyArray<{
    rowIndex: number;
    startISO: string;
    endISO: string;
    geo: RowGeo;
    groupOrder: number;
    segmentId: number;
  }>,
): GroupedSegmentRow[] {
  const rowsByKey = new Map<string, GroupedSegmentRow>();

  entries.forEach((entry) => {
    const key = [
      entry.rowIndex,
      entry.startISO,
      entry.endISO,
      entry.geo.lon,
      entry.geo.lat,
      entry.geo.zoom,
      entry.groupOrder,
    ].join("|");

    const existing = rowsByKey.get(key);
    if (existing) {
      if (!existing.segmentIds.includes(entry.segmentId)) {
        existing.segmentIds.push(entry.segmentId);
      }
      return;
    }

    rowsByKey.set(key, {
      rowIndex: entry.rowIndex,
      startISO: entry.startISO,
      endISO: entry.endISO,
      geo: entry.geo,
      groupOrder: entry.groupOrder,
      segmentIds: [entry.segmentId],
    });
  });

  return Array.from(rowsByKey.values());
}

function normalizeClosureGroups(
  rows: readonly CsvRow[],
  rowGeosOrGroups: readonly RowGeo[] | readonly ClosureRowGroup[],
): ClosureRowGroup[] {
  if (rowGeosOrGroups.length === 0) {
    return [];
  }

  if (isClosureRowGroupArray(rowGeosOrGroups)) {
    return dedupeClosureGroups(
      rowGeosOrGroups.map((group) => ({
        rowIndex: group.rowIndex,
        segmentIds: [...group.segmentIds],
        geo: group.geo,
      })),
    );
  }

  const rowGeos = rowGeosOrGroups;
  return dedupeClosureGroups(
    rows.flatMap((row, rowIndex) => {
      if (row.segments === null || row.segments.length === 0) {
        return [];
      }

      const geo = rowGeos[rowIndex];
      if (!geo) {
        throw new Error(`[buildClosuresCsv] Missing RowGeo for row ${rowIndex}`);
      }

      return [{ rowIndex, segmentIds: [...row.segments], geo }];
    }),
  );
}

function dedupeClosureGroups(groups: readonly ClosureRowGroup[]): ClosureRowGroup[] {
  const ownerByRowAndSegment = new Map<string, number>();

  groups.forEach((group, groupIndex) => {
    group.segmentIds.forEach((segmentId) => {
      ownerByRowAndSegment.set(`${group.rowIndex}:${segmentId}`, groupIndex);
    });
  });

  return groups
    .map((group, groupIndex) => {
      const seenSegmentIds = new Set<number>();
      const segmentIds = group.segmentIds.filter((segmentId) => {
        if (seenSegmentIds.has(segmentId)) {
          return false;
        }
        seenSegmentIds.add(segmentId);

        return ownerByRowAndSegment.get(`${group.rowIndex}:${segmentId}`) === groupIndex;
      });

      return {
        rowIndex: group.rowIndex,
        segmentIds,
        geo: group.geo,
      };
    })
    .filter((group) => group.segmentIds.length > 0);
}

function isClosureRowGroupArray(
  value: readonly RowGeo[] | readonly ClosureRowGroup[],
): value is readonly ClosureRowGroup[] {
  const first = value[0];
  return (
    typeof first === "object" && first !== null && "rowIndex" in first && "segmentIds" in first
  );
}

function findGroupForSegment(
  groups: readonly ClosureRowGroup[],
  rowIndex: number,
  segmentId: number,
): { geo: RowGeo; groupOrder: number } {
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (group.rowIndex === rowIndex && group.segmentIds.includes(segmentId)) {
      return { geo: group.geo, groupOrder: groupIndex };
    }
  }

  const fallbackGroupIndex = groups.findIndex((group) => group.rowIndex === rowIndex);
  if (fallbackGroupIndex !== -1) {
    return { geo: groups[fallbackGroupIndex].geo, groupOrder: fallbackGroupIndex };
  }

  throw new Error(
    `[buildClosuresCsv] Missing export group geo for row ${rowIndex} and segment ${segmentId}`,
  );
}
