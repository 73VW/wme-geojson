// Loads a GeoJSON source URL into one or more LineEntry objects.
// Phase 7b: handles both a single Feature and a FeatureCollection.

import { length as turfLength } from "@turf/turf";
import type { MultiLineString } from "geojson";
import type { NormalizedTrack } from "../geojson/types";
import { fetchGeoJson } from "../geojson/Loader";
import { gpxToGeoJson } from "../geojson/gpxToGeoJson";
import { validateFeature, validateFeatureCollection } from "../geojson/validate";
import { normalizeTrack } from "../geojson/normalize";
import { computeDisplayName } from "./displayName";
import { colorForLineId } from "./color";
import type { LineEntry } from "./types";

/**
 * Build a LineEntry from a normalised track and a precomputed stable id.
 * Pure — no fetch, no SDK.
 */
export function buildEntryFromTrack(track: NormalizedTrack, id: string): LineEntry {
  const lengthKm = turfLength(
    { type: "Feature", geometry: track.geometry, properties: null },
    { units: "kilometers" },
  );
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

interface GroupedTrack {
  id: string;
  track: NormalizedTrack;
}

function extractSlowupNumber(props: Record<string, unknown> | undefined): number | undefined {
  const raw = props?.["slowup_number"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

function groupFeaturesIntoTracks(
  features: ReturnType<typeof validateFeatureCollection>,
  sourceUrl: string,
): GroupedTrack[] {
  interface Slot {
    id: string;
    coordinates: MultiLineString["coordinates"];
    rawProperties?: Record<string, unknown>;
  }

  const slots: Slot[] = [];
  const slotBySlowup = new Map<number, Slot>();

  features.forEach((feature, index) => {
    const track = normalizeTrack(feature);
    const slowupNumber = extractSlowupNumber(track.rawProperties);

    if (slowupNumber !== undefined) {
      const existing = slotBySlowup.get(slowupNumber);
      if (existing) {
        existing.coordinates.push(...track.geometry.coordinates);
        return;
      }
    }

    const slot: Slot = {
      id:
        slowupNumber !== undefined
          ? `${sourceUrl}#slowup-${slowupNumber}`
          : `${sourceUrl}#${index}`,
      coordinates: [...track.geometry.coordinates],
      rawProperties: track.rawProperties,
    };

    slots.push(slot);

    if (slowupNumber !== undefined) {
      slotBySlowup.set(slowupNumber, slot);
    }
  });

  return slots.map((slot) => {
    const track: NormalizedTrack = {
      trackId: null,
      geometry: { type: "MultiLineString", coordinates: slot.coordinates },
    };

    if (slot.rawProperties !== undefined) {
      track.rawProperties = slot.rawProperties;
    }

    return { id: slot.id, track };
  });
}

/**
 * Build the list of LineEntry from an already-fetched GeoJSON payload.
 * Pure — no fetch, no SDK. Accepts either a FeatureCollection (one entry per
 * line feature, Points dropped) or a lone Feature (one entry).
 */
export function buildEntriesFromData(raw: unknown, sourceUrl: string): LineEntry[] {
  const isFeatureCollection =
    !!raw &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>)["type"] === "FeatureCollection";

  if (isFeatureCollection) {
    const features = validateFeatureCollection(raw);
    return groupFeaturesIntoTracks(features, sourceUrl).map(({ id, track }) =>
      buildEntryFromTrack(track, id),
    );
  }

  const feature = validateFeature(raw);
  return [buildEntryFromTrack(normalizeTrack(feature), `${sourceUrl}#0`)];
}

/**
 * Parse file text content into LineEntry[].
 * Detects format by filename extension (.gpx → GPX, else → GeoJSON).
 */
export function buildEntriesFromText(text: string, filename: string): LineEntry[] {
  if (filename.toLowerCase().endsWith(".gpx")) {
    const raw = gpxToGeoJson(text);
    return buildEntriesFromData(raw, filename);
  }
  const raw: unknown = JSON.parse(text);
  return buildEntriesFromData(raw, filename);
}

/**
 * Fetch a GeoJSON URL and build the list of lines. Handles both a lone
 * Feature and a FeatureCollection.
 */
export async function loadLines(url: string): Promise<LineEntry[]> {
  const raw = await fetchGeoJson(url);
  return buildEntriesFromData(raw, url);
}
