import type { SdkFeature, WmeSDK } from "wme-sdk-typings";
import type { Position } from "geojson";
import type { LineEntry } from "../lines/types";
import { logger } from "../utils/logger";

const PREVIEW_STROKE_WIDTH = 4;
const PREVIEW_STROKE_OPACITY = 0.85;
const PREVIEW_KIND = "preview-line";

/**
 * SDK layer that draws every loaded line in its own colour, used while no
 * single line is selected. Label-free and filter-free — TrackLayer handles the
 * selected line. Uses its own layer name so it never collides with TrackLayer.
 */
export class LinesPreviewLayer {
  static readonly LAYER_NAME = "wme-geojson-preview";

  private layerAdded = false;

  constructor(private readonly wmeSDK: WmeSDK) {}

  /**
   * Draw every entry's geometry, each in entry.color. Re-drawing replaces the
   * previous content. Pass an empty list to clear.
   */
  draw(entries: readonly LineEntry[]): void {
    this.ensureLayer();
    this.wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: LinesPreviewLayer.LAYER_NAME });

    // One SDK call: each addFeatureToLayer call re-renders the whole layer.
    const features: SdkFeature[] = [];
    entries.forEach((entry) => {
      entry.track.geometry.coordinates.forEach((lineCoords, lineIndex) => {
        if (lineCoords.length < 2) return;
        // The SDK rejects 3D coords — strip elevation to [lon, lat].
        const coords2d: Position[] = lineCoords.map((c) => [c[0], c[1]]);
        features.push({
          id: `${entry.id}-line-${lineIndex}`,
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords2d },
          properties: { kind: PREVIEW_KIND, color: entry.color },
        });
      });
    });
    if (features.length > 0) {
      this.wmeSDK.Map.addFeaturesToLayer({ layerName: LinesPreviewLayer.LAYER_NAME, features });
    }
  }

  /** Remove the layer. Never throws. */
  destroy(): void {
    try {
      this.wmeSDK.Map.removeLayer({ layerName: LinesPreviewLayer.LAYER_NAME });
    } catch (err) {
      logger.warn("LinesPreviewLayer.destroy: failed to remove layer", err);
    }
    this.layerAdded = false;
  }

  private ensureLayer(): void {
    if (this.layerAdded) return;
    this.wmeSDK.Map.addLayer({
      layerName: LinesPreviewLayer.LAYER_NAME,
      // styleContext resolves "${getColor}" per-feature at render time, so all
      // lines share a single style rule regardless of how many colours appear.
      styleContext: {
        getColor: ({ feature }) => {
          const color = feature?.properties.color;
          return typeof color === "string" ? color : "#ff00aa";
        },
      },
      styleRules: [
        {
          predicate: (props: { kind?: string | number | null }) => props.kind === PREVIEW_KIND,
          style: {
            strokeColor: "${getColor}",
            strokeWidth: PREVIEW_STROKE_WIDTH,
            strokeOpacity: PREVIEW_STROKE_OPACITY,
            strokeLinecap: "round" as const,
          },
        },
      ],
    });
    this.layerAdded = true;
  }
}
