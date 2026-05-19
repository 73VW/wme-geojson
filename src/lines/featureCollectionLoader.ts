// Loads a GeoJSON source URL into one or more LineEntry objects.
// Phase 7a: handles a single Feature only (reuses geojson/Loader.loadTrack).
// Phase 7b will add the FeatureCollection branch.

import { length as turfLength } from "@turf/turf";
import type { NormalizedTrack } from "../geojson/types";
import { loadTrack } from "../geojson/Loader";
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
 * Fetch a GeoJSON URL and build the list of lines.
 * Phase 7a: the URL must resolve to a single Feature.
 */
export async function loadLines(url: string): Promise<LineEntry[]> {
  const track = await loadTrack(url);
  return [buildEntryFromTrack(track, url, 0)];
}
