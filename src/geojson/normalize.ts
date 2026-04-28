import type { Feature, LineString, MultiLineString } from "geojson";
import type { NormalizedTrack } from "./types";

type SupportedFeature = Feature<LineString | MultiLineString>;

/**
 * Normalise a validated GeoJSON Feature into a NormalizedTrack.
 *
 * Rules:
 *   - LineString → wrapped in a MultiLineString with a single sub-line.
 *   - MultiLineString → passed through as-is.
 *   - 3D coordinates ([lon, lat, ele]) are preserved untouched.
 *   - `id` field (string or number) becomes `trackId`; absent / wrong type → null.
 *   - `properties` (non-null object) becomes `rawProperties`; absent → omitted.
 */
export function normalizeTrack(feature: SupportedFeature): NormalizedTrack {
  const geometry = toMultiLineString(feature.geometry);
  const trackId = extractTrackId(feature);
  const rawProperties = extractRawProperties(feature);

  const track: NormalizedTrack = { trackId, geometry };
  if (rawProperties !== undefined) {
    track.rawProperties = rawProperties;
  }

  return track;
}

function toMultiLineString(geometry: LineString | MultiLineString): MultiLineString {
  if (geometry.type === "MultiLineString") {
    // Pass through — preserve all sub-lines and any 3D coordinates
    return geometry;
  }

  // Wrap single LineString in a MultiLineString container
  return {
    type: "MultiLineString",
    coordinates: [geometry.coordinates],
  };
}

function extractTrackId(feature: SupportedFeature): string | number | null {
  // GeoJSON Feature.id is typed as string|number|undefined in @types/geojson
  const id = (feature as unknown as Record<string, unknown>)["id"];
  if (typeof id === "string" || typeof id === "number") {
    return id;
  }
  return null;
}

function extractRawProperties(feature: SupportedFeature): Record<string, unknown> | undefined {
  const props = feature.properties;
  if (props !== null && typeof props === "object") {
    return props as Record<string, unknown>;
  }
  return undefined;
}
