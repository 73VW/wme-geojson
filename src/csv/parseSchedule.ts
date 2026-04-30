// Pure CSV parser for the roadbook schedule format.
// No SDK, no DOM — safe to import in Node test environments.

import type { CsvRow } from "../state/SessionStore";

const EXPECTED_HEADER = "distance,start_time,end_time,date,segments";

// Column indices are constants so any future column reorder surfaces as a
// compile-time problem rather than a silent data shift.
const COL_DISTANCE = 0;
const COL_START_TIME = 1;
const COL_END_TIME = 2;
const COL_DATE = 3;
const COL_SEGMENTS = 4;
const MIN_REQUIRED_COLUMNS = 4; // segments column may be omitted entirely

export function parseSchedule(text: string): CsvRow[] {
  // Strip UTF-8 BOM (0xEF 0xBB 0xBF appears when Excel saves as UTF-8 CSV).
  const stripped = text.startsWith("﻿") ? text.slice(1) : text;

  const lines = stripped.split(/\r?\n/);

  // Skip leading blank lines before the header.
  let headerIndex = 0;
  while (headerIndex < lines.length && lines[headerIndex].trim() === "") {
    headerIndex++;
  }

  if (headerIndex >= lines.length) {
    throw new Error("[parseSchedule] CSV is empty or contains only blank lines");
  }

  const headerLine = lines[headerIndex].trim();
  if (headerLine !== EXPECTED_HEADER) {
    throw new Error(
      `[parseSchedule] Unexpected header: "${headerLine}". Expected: "${EXPECTED_HEADER}"`,
    );
  }

  const rows: CsvRow[] = [];

  for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    // Trailing empty lines at the end of the file are fine to skip.
    if (raw.trim() === "") {
      continue;
    }

    const cols = raw.split(",");
    if (cols.length < MIN_REQUIRED_COLUMNS) {
      throw new Error(
        `[parseSchedule] Line ${lineIndex + 1} has ${cols.length} column(s); at least ${MIN_REQUIRED_COLUMNS} required: "${raw}"`,
      );
    }

    const distanceRaw = cols[COL_DISTANCE].trim();
    const distance = Number(distanceRaw);
    if (!Number.isFinite(distance)) {
      throw new Error(
        `[parseSchedule] Line ${lineIndex + 1}: non-numeric distance "${distanceRaw}"`,
      );
    }

    const startTime = cols[COL_START_TIME].trim();
    const endTime = cols[COL_END_TIME].trim();
    const date = cols[COL_DATE].trim();

    // The segments column may be absent (row has exactly 4 cols) or present
    // but empty (row has 5 cols with an empty string).
    const segmentsRaw =
      cols.length > COL_SEGMENTS ? cols[COL_SEGMENTS].trim() : "";

    const segments = parseSegments(segmentsRaw);

    rows.push({ distance, startTime, endTime, date, segments });
  }

  return rows;
}

function parseSegments(raw: string): number[] | null {
  if (raw === "") {
    return null;
  }

  return raw.split(";").map((part) => {
    const n = Number(part.trim());
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`[parseSchedule] Invalid segment ID: "${part.trim()}"`);
    }
    return n;
  });
}
