import type { Feature, LineString, MultiLineString, Position } from "geojson";
import { TrackLoadError } from "./types";

type SupportedGeometry = LineString | MultiLineString;
type SupportedFeature = Feature<SupportedGeometry>;

/**
 * Validate that a parsed JSON value is a GeoJSON Feature with a supported geometry type.
 *
 * Supported geometry types: LineString, MultiLineString.
 * Throws TrackLoadError for anything else.
 */
export function validateFeature(raw: unknown): SupportedFeature {
  if (!raw || typeof raw !== "object") {
    throw new TrackLoadError("Response is not a JSON object.");
  }

  const obj = raw as Record<string, unknown>;

  if (obj["type"] !== "Feature") {
    throw new TrackLoadError(
      `Expected a GeoJSON Feature, got type="${String(obj["type"])}" instead.`,
    );
  }

  const geometry = obj["geometry"];
  if (!geometry || typeof geometry !== "object") {
    throw new TrackLoadError("GeoJSON Feature has no geometry.");
  }

  const geo = geometry as Record<string, unknown>;
  const geoType = geo["type"];

  if (geoType !== "LineString" && geoType !== "MultiLineString") {
    throw new TrackLoadError(
      `GeoJSON has invalid or unsupported geometry type: "${String(geoType)}". ` +
        `Expected "LineString" or "MultiLineString".`,
    );
  }

  // CRS sanity check: examine the first coordinate.
  // A projected CRS like LV95 would produce coordinates such as [2600000, 1200000],
  // which are far outside the WGS84 range of lon ∈ [-180, 180] and lat ∈ [-90, 90].
  const firstCoord = extractFirstCoordinate(geo, geoType as "LineString" | "MultiLineString");
  if (firstCoord !== null) {
    assertWgs84Coordinate(firstCoord);
  }

  return raw as SupportedFeature;
}

/**
 * Validate a GeoJSON FeatureCollection and return its line features.
 *
 * Features whose geometry is not LineString/MultiLineString (Points, etc.)
 * are dropped silently — a slowUp FeatureCollection mixes route lines with
 * marker points and only the lines are matchable. Each surviving feature is
 * run through the same per-feature validation as validateFeature (geometry
 * type + WGS84 CRS sanity check). Throws TrackLoadError when raw is not a
 * FeatureCollection or when zero line features survive.
 */
export function validateFeatureCollection(raw: unknown): SupportedFeature[] {
  if (!raw || typeof raw !== "object") {
    throw new TrackLoadError("Response is not a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj["type"] !== "FeatureCollection") {
    throw new TrackLoadError(
      `Expected a GeoJSON FeatureCollection, got type="${String(obj["type"])}" instead.`,
    );
  }
  const features = obj["features"];
  if (!Array.isArray(features)) {
    throw new TrackLoadError("FeatureCollection has no features array.");
  }

  const lines: SupportedFeature[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const geometry = (feature as Record<string, unknown>)["geometry"];
    if (!geometry || typeof geometry !== "object") continue;
    const geoType = (geometry as Record<string, unknown>)["type"];
    if (geoType !== "LineString" && geoType !== "MultiLineString") {
      // Drop Point / Polygon / etc. — only route lines are matchable.
      continue;
    }
    // Reuse the single-feature validator for the geometry + CRS checks.
    lines.push(validateFeature(feature));
  }

  if (lines.length === 0) {
    throw new TrackLoadError("FeatureCollection contains no LineString/MultiLineString features.");
  }
  return lines;
}

function extractFirstCoordinate(
  geo: Record<string, unknown>,
  geoType: "LineString" | "MultiLineString",
): Position | null {
  const coords = geo["coordinates"];
  if (!Array.isArray(coords)) return null;

  if (geoType === "LineString") {
    const firstPoint = coords[0];
    if (Array.isArray(firstPoint)) return firstPoint as Position;
  } else {
    // MultiLineString: coords is an array of lines
    const firstLine = coords[0];
    if (Array.isArray(firstLine)) {
      const firstPoint = firstLine[0];
      if (Array.isArray(firstPoint)) return firstPoint as Position;
    }
  }

  return null;
}

/**
 * Guard against projected CRS coordinates being silently passed through.
 * SchweizMobil (LV95) uses easting ~2,600,000 and northing ~1,200,000 which
 * are obviously outside WGS84 bounds.
 */
function assertWgs84Coordinate(coord: Position): void {
  const lon = coord[0];
  const lat = coord[1];

  if (typeof lon !== "number" || typeof lat !== "number") return;

  const lonInRange = lon >= -180 && lon <= 180;
  const latInRange = lat >= -90 && lat <= 90;

  if (!lonInRange || !latInRange) {
    throw new TrackLoadError(
      `First coordinate [${lon}, ${lat}] is outside WGS84 bounds. ` +
        `coordinates appear to be in a projected CRS (LV95?) instead of WGS84.`,
    );
  }
}
