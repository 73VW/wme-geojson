// Type definitions for the multi-line FeatureCollection feature.
// Pure types — no SDK, no DOM. Safe to import anywhere.

import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../csv/types";
import type { SessionState } from "../state/SessionStore";
import type { ClosureRowGroup } from "../csv/buildClosuresCsv";

/**
 * SlowUp event detail, fetched from the SchweizMobil refid API.
 * Only the fields the UI consumes are typed; the API returns more.
 * Populated in Phase 7c — declared here so LineEntry stays stable.
 */
export interface SlowupDetails {
  refid: number;
  title: string;
  date: string; // "YYYY-MM-DD"
}

/**
 * Full slowUp event detail used by the "Prepare MTE" popup. Includes the
 * per-language abstract and the urlLink the user pastes into the MTE form.
 * Fetched lazily on popup open — NOT cached on the LineEntry.
 */
export interface SlowupFullDetails {
  refid: number;
  title: string;
  date: string; // "YYYY-MM-DD"
  urlLink: string;
  abstracts: {
    fr: string;
    en: string;
    de: string;
    it: string;
  };
}

/** Coarse matching progress for one line, mirrored from the pipeline. */
export type LineMatchPhase = "idle" | "matching" | "matched";

/** How a line's closure schedule is sourced. */
export type LineMode = "csv" | "synthetic";

/**
 * One line loaded from a GeoJSON source (a lone Feature, or — from Phase 7b —
 * one Feature out of a FeatureCollection).
 */
export interface LineEntry {
  /** Stable id, e.g. `${sourceUrl}#${featureIndex}`. */
  id: string;
  /** Validated, normalised geometry + raw properties. */
  track: NormalizedTrack;
  /** Total track length in kilometres (turf-measured at load time). */
  lengthKm: number;
  /** Display name: slowUp title | properties.name | "Tracé de X km". */
  displayName: string;
  /** Stable preview colour derived from `id` (used from Phase 7b). */
  color: string;
  /** Present when properties carry a `slowup_number` (used from Phase 7c). */
  slowupNumber?: number;
  /** Fetched slowUp detail (Phase 7c). */
  slowupDetails?: SlowupDetails;
  /** SlowUp detail fetch lifecycle (Phase 7c). */
  slowupFetchStatus: "idle" | "loading" | "ok" | "error";
  /** Whether closures come from an imported CSV or a synthetic single row. */
  mode: LineMode;
  /** Parsed CSV rows when `mode === "csv"`. */
  csvRows?: CsvRow[];
  /** Raw CSV text, kept so persistence keys can be derived. */
  csvText?: string;
  /** Coarse matching phase for UI display. */
  matchPhase: LineMatchPhase;
  /** Snapshot of SessionStore state, saved when the user switches away. */
  session?: SessionState;
  /** csvText that accompanied `session` (needed by SessionStore.rehydrate). */
  sessionCsvText?: string;
  /** Pipeline match groups (geo anchors), snapshotted alongside `session`. */
  matchedGroups?: ClosureRowGroup[];
}
