import type { WmeSDK } from "wme-sdk-typings";
import type { Position } from "geojson";
import type { NormalizedTrack } from "../geojson/types";
import { logger } from "../utils/logger";

// Visible at all zoom levels
const TRACK_STROKE_COLOR = "#ff00aa";
const TRACK_STROKE_WIDTH = 4;
const TRACK_STROKE_OPACITY = 0.85;

/**
 * Wraps the WME SDK layer for displaying a GeoJSON track.
 *
 * The SDK only supports Point/LineString/Polygon geometries per feature, so a
 * MultiLineString track is drawn as N individual LineString features — one per
 * sub-line.  Feature IDs are derived from the trackId with a sub-line index
 * suffix to keep them unique.
 */
export class TrackLayer {
  static readonly LAYER_NAME = "wme-geojson-track";

  constructor(private readonly wmeSDK: WmeSDK) {}

  /**
   * Create the layer and draw all sub-lines of the track.
   * Must be called after `wme-ready`.
   */
  draw(track: NormalizedTrack): void {
    this.wmeSDK.Map.addLayer({
      layerName: TrackLayer.LAYER_NAME,
      styleRules: [
        {
          // No predicate → rule applies to all features in the layer
          style: {
            strokeColor: TRACK_STROKE_COLOR,
            strokeWidth: TRACK_STROKE_WIDTH,
            strokeOpacity: TRACK_STROKE_OPACITY,
            strokeLinecap: "round",
          },
        },
      ],
    });

    const baseId =
      track.trackId !== null ? String(track.trackId) : `track-${Date.now()}`;

    // Add one LineString feature per sub-line in the MultiLineString
    track.geometry.coordinates.forEach((lineCoords, index) => {
      const featureId = `${baseId}-${index}`;

      this.wmeSDK.Map.addFeatureToLayer({
        layerName: TrackLayer.LAYER_NAME,
        feature: {
          id: featureId,
          type: "Feature",
          geometry: {
            type: "LineString",
            // 3D coords (lon, lat, ele) are passed through untouched; OpenLayers
            // and the SDK ignore the third dimension when rendering in 2D.
            coordinates: lineCoords as Position[],
          },
        },
      });
    });
  }

  /**
   * Remove the layer and all its features from the map.
   * Never throws — any error is caught and warned so the caller can always
   * proceed (e.g. during page unload or after an unexpected SDK error).
   */
  destroy(): void {
    try {
      this.wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
    } catch (err) {
      logger.warn("TrackLayer.destroy: failed to remove layer", err);
    }
  }
}
