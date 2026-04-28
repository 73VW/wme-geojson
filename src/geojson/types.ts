import type { MultiLineString } from "geojson";

/**
 * A validated and normalised GeoJSON track ready for display and matching.
 * All line strings are stored as MultiLineString for uniform downstream handling.
 */
export interface NormalizedTrack {
  trackId: string | number | null;
  geometry: MultiLineString;
  rawProperties?: Record<string, unknown>;
}

/**
 * Thrown when a track cannot be loaded or validated.
 * Carries a descriptive message and the original cause for logging.
 */
export class TrackLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrackLoadError";
  }
}
