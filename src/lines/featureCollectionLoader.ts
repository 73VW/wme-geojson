// Loads a GeoJSON source URL into one or more LineEntry objects.
// Phase 7b: handles both a single Feature and a FeatureCollection.

import { length as turfLength } from "@turf/turf";
import type { NormalizedTrack } from "../geojson/types";
import { fetchGeoJson } from "../geojson/Loader";
import { validateFeature, validateFeatureCollection } from "../geojson/validate";
import { normalizeTrack } from "../geojson/normalize";
import { computeDisplayName } from "./displayName";
import { colorForLineId } from "./color";
import type { LineEntry } from "./types";

/**
 * Build a LineEntry from a normalised track. Pure — no fetch, no SDK.
 * `featureIndex` keeps ids stable and unique within a source.
 */
export function buildEntryFromTrack(
  track: NormalizedTrack,
  sourceUrl: string,
  featureIndex: number,
): LineEntry {
  const lengthKm = turfLength(
    { type: "Feature", geometry: track.geometry, properties: null },
    { units: "kilometers" },
  );
  const id = `${sourceUrl}#${featureIndex}`;
  const slowupNumber = extractSlowupNumber(track.rawProperties);

  const entry: LineEntry = {
    id,
    track,
    lengthKm,
    displayName: computeDisplayName({ lengthKm, properties: track.rawProperties }),
    color: colorForLineId(id),
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
  if (slowupNumber !== undefined) {
    entry.slowupNumber = slowupNumber;
  }
  return entry;
}

function extractSlowupNumber(props: Record<string, unknown> | undefined): number | undefined {
  const raw = props?.["slowup_number"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

/**
 * Build the list of LineEntry from an already-fetched GeoJSON payload.
 * Pure — no fetch, no SDK. Accepts either a FeatureCollection (one entry per
 * line feature, Points dropped) or a lone Feature (one entry).
 */
export function buildEntriesFromData(raw: unknown, sourceUrl: string): LineEntry[] {
  const isFeatureCollection =
    !!raw && typeof raw === "object" && (raw as Record<string, unknown>)["type"] === "FeatureCollection";

  if (isFeatureCollection) {
    const features = validateFeatureCollection(raw);
    return features.map((feature, index) =>
      buildEntryFromTrack(normalizeTrack(feature), sourceUrl, index),
    );
  }

  const feature = validateFeature(raw);
  return [buildEntryFromTrack(normalizeTrack(feature), sourceUrl, 0)];
}

/**
 * Fetch a GeoJSON URL and build the list of lines. Handles both a lone
 * Feature and a FeatureCollection.
 */
export async function loadLines(url: string): Promise<LineEntry[]> {
  const raw = await fetchGeoJson(url);
  return buildEntriesFromData(raw, url);
}
