// src/domain/types.ts
export interface Bbox4 {
  readonly bbox: [number, number, number, number];
}
export interface MapAnchor {
  lon: number;
  lat: number;
  zoom: number;
}

export interface MatchedSegment {
  segmentId: number;
}

export interface SubLine {
  /** 0-based, stable within its parent Line. */
  index: number;
  /** Distance along the parent Line, in km. */
  kmA: number;
  kmB: number;
  bbox: [number, number, number, number];
  /** Map anchor used to drive matching for this sub-line. */
  view: MapAnchor;
  /** Validated segment ids (empty until validated === true). */
  segmentIds: number[];
  /** Whether the operator validated the matching for this sub-line. */
  validated: boolean;
}

export interface Line {
  /** 0-based, stable within its parent Source. */
  index: number;
  bbox: [number, number, number, number];
  /** ISO timestamps, only when the Source has CSV-derived time windows. */
  startISO?: string;
  endISO?: string;
  /** Geometry slice covered by this Line (already km-sliced for CSV mode, full for non-CSV). */
  geometry: import("geojson").MultiLineString;
  lengthKm: number;
  /** Sub-lines created so far (lazy: may grow during matching). */
  subLines: SubLine[];
  /** Pending [kmA,kmB] ranges within this Line that have not been fitted into sub-lines yet. */
  pendingTail: Array<{ kmA: number; kmB: number }>;
}

export type SourceKind = "geojson" | "slowup";

export interface Source {
  schemaVersion: 1;
  /** Stable id derived from URL+featureIndex (GeoJSON) or slowup refid (Slowup). */
  sourceId: string;
  kind: SourceKind;
  hasCsv: boolean;
  lines: Line[];
  /** Resume point. null when no line has been started yet. */
  cursor: { lineIndex: number; subLineIndex: number } | null;
}
