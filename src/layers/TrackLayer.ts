import type { WmeSDK } from "wme-sdk-typings";
import type { Position } from "geojson";
import type { NormalizedTrack } from "../geojson/types";
import { logger } from "../utils/logger";
import {
  computeDistanceLabels,
  formatLabelKm,
  type DistanceLabel,
} from "./distanceLabels";

const TRACK_STROKE_COLOR = "#ff00aa";
const TRACK_STROKE_WIDTH = 4;
const TRACK_STROKE_OPACITY = 0.85;

const LABEL_FONT_SIZE = "11px";
const LABEL_FONT_COLOR = "#222222";
const LABEL_OUTLINE_COLOR = "#ffffff";
const LABEL_OUTLINE_WIDTH = 3;
const LABEL_POINT_RADIUS = 2;
const LABEL_POINT_COLOR = "#ff00aa";

const LINE_KIND = "line";
const LABEL_KIND = "label";

/**
 * Wraps the WME SDK layer for displaying a GeoJSON track and its
 * distance-from-start labels.
 *
 * The SDK only supports Point/LineString/Polygon geometries per feature, so a
 * MultiLineString track is drawn as N individual LineString features (one per
 * sub-line) plus one Point feature per vertex carrying the cumulative-distance
 * label.
 *
 * Per-label text cannot be expressed via styleContext (FeatureStyle.label is
 * `string`, not a context key), so each label gets its own styleRule whose
 * predicate matches a unique `featureId` property. Acceptable up to a few
 * hundred labels.
 *
 * setVisibleRange(minKm, maxKm) clears the layer and redraws only the portion
 * of the track within the requested distance window. This is used by the
 * sidebar's range slider.
 */
export class TrackLayer {
  static readonly LAYER_NAME = "wme-geojson-track";

  private currentTrack: NormalizedTrack | null = null;
  private allLabels: DistanceLabel[] = [];
  private totalKm = 0;

  constructor(private readonly wmeSDK: WmeSDK) {}

  /**
   * Create the layer and draw the entire track. Must be called after
   * `wme-ready`. Computes distance labels for every vertex; subsequent calls
   * to setVisibleRange operate on the cached labels.
   */
  draw(track: NormalizedTrack): void {
    this.currentTrack = track;
    this.allLabels = computeDistanceLabels(track.geometry);
    this.totalKm = this.allLabels.length > 0 ? this.allLabels[this.allLabels.length - 1].km : 0;

    this.wmeSDK.Map.addLayer({
      layerName: TrackLayer.LAYER_NAME,
      styleRules: this.buildStyleRules(this.allLabels),
    });

    this.drawFeatures(track, this.allLabels);
  }

  /**
   * Total length of the loaded track in kilometres. Used by the panel to set
   * the slider's max bound.
   */
  getTotalKm(): number {
    return this.totalKm;
  }

  /**
   * Restrict the rendered portion of the track to [minKm, maxKm]. Out-of-range
   * sub-lines and labels are removed; in-range sub-lines are clipped at the
   * window edges via turf.lineSliceAlong (lazy-imported to avoid pulling slice
   * into the initial bundle path when the user never moves the slider).
   *
   * Reuses the original styleRules, so existing labels keep their text. Labels
   * outside the window are simply not added back to the layer.
   */
  setVisibleRange(minKm: number, maxKm: number): void {
    if (!this.currentTrack) return;

    const lo = Math.max(0, Math.min(minKm, maxKm));
    const hi = Math.min(this.totalKm, Math.max(minKm, maxKm));

    const visibleLabels = this.allLabels.filter((l) => l.km >= lo && l.km <= hi);

    this.removeLayerFeatures();
    this.drawTrackInRange(lo, hi);
    this.drawLabels(visibleLabels);
  }

  /**
   * Remove the layer entirely. Never throws.
   */
  destroy(): void {
    try {
      this.wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
    } catch (err) {
      logger.warn("TrackLayer.destroy: failed to remove layer", err);
    }
    this.currentTrack = null;
    this.allLabels = [];
    this.totalKm = 0;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private drawFeatures(track: NormalizedTrack, labels: DistanceLabel[]): void {
    const baseId = track.trackId !== null ? String(track.trackId) : `track-${Date.now()}`;

    track.geometry.coordinates.forEach((lineCoords, index) => {
      this.addLineFeature(`${baseId}-line-${index}`, lineCoords);
    });

    this.drawLabels(labels);
  }

  private drawLabels(labels: DistanceLabel[]): void {
    for (const label of labels) {
      this.addLabelFeature(label);
    }
  }

  /**
   * Slice each sub-line to the requested distance window and add the visible
   * portions back to the layer. Cumulative distance is continuous across
   * sub-lines (matching computeDistanceLabels), so we track an offset per
   * sub-line and clip individually.
   */
  private drawTrackInRange(lo: number, hi: number): void {
    if (!this.currentTrack) return;

    const baseId =
      this.currentTrack.trackId !== null
        ? String(this.currentTrack.trackId)
        : `track-${Date.now()}`;

    let cumulativeKm = 0;

    this.currentTrack.geometry.coordinates.forEach((lineCoords, index) => {
      const lineLengthKm = sumSegmentDistances(lineCoords);
      const subLineStartKm = cumulativeKm;
      const subLineEndKm = cumulativeKm + lineLengthKm;
      cumulativeKm = subLineEndKm;

      const overlapsWindow = subLineEndKm >= lo && subLineStartKm <= hi;
      if (!overlapsWindow) return;

      const localLo = Math.max(0, lo - subLineStartKm);
      const localHi = Math.min(lineLengthKm, hi - subLineStartKm);

      const clippedCoords = sliceLineByDistance(lineCoords, localLo, localHi);
      if (clippedCoords.length < 2) return;

      this.addLineFeature(`${baseId}-line-${index}`, clippedCoords);
    });
  }

  private addLineFeature(featureId: string, lineCoords: Position[]): void {
    // The SDK rejects 3D coords with "Only 2D points are supported" — strip
    // any elevation here even though NormalizedTrack keeps the 3D data intact.
    const coords2d: Position[] = lineCoords.map((c) => [c[0], c[1]]);

    this.wmeSDK.Map.addFeatureToLayer({
      layerName: TrackLayer.LAYER_NAME,
      feature: {
        id: featureId,
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords2d },
        properties: { kind: LINE_KIND, featureId },
      },
    });
  }

  private addLabelFeature(label: DistanceLabel): void {
    const featureId = labelFeatureId(label);
    this.wmeSDK.Map.addFeatureToLayer({
      layerName: TrackLayer.LAYER_NAME,
      feature: {
        id: featureId,
        type: "Feature",
        geometry: { type: "Point", coordinates: label.coord },
        properties: { kind: LABEL_KIND, featureId, km: label.km },
      },
    });
  }

  private removeLayerFeatures(): void {
    // The SDK has no "clear all features" API exposed by name we know of, so
    // we drop the whole layer and re-add it with the same styleRules. Cheaper
    // than tracking and removing individual feature IDs and reliable in case
    // a previous draw failed mid-way.
    try {
      this.wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
    } catch (err) {
      logger.warn("TrackLayer.removeLayerFeatures: removeLayer failed", err);
    }
    this.wmeSDK.Map.addLayer({
      layerName: TrackLayer.LAYER_NAME,
      styleRules: this.buildStyleRules(this.allLabels),
    });
  }

  /**
   * Build the styleRules array: one rule for the track stroke and one rule per
   * label point so each can carry its own `label` text. Predicates match by the
   * unique `featureId` property, which we set on every feature.
   */
  private buildStyleRules(labels: DistanceLabel[]) {
    const rules = [];

    rules.push({
      predicate: (props: { kind?: string | number | null }) => props.kind === LINE_KIND,
      style: {
        strokeColor: TRACK_STROKE_COLOR,
        strokeWidth: TRACK_STROKE_WIDTH,
        strokeOpacity: TRACK_STROKE_OPACITY,
        strokeLinecap: "round" as const,
      },
    });

    for (const label of labels) {
      const featureId = labelFeatureId(label);
      rules.push({
        predicate: (props: { featureId?: string | number | null }) => props.featureId === featureId,
        style: {
          label: formatLabelKm(label.km),
          fontSize: LABEL_FONT_SIZE,
          fontColor: LABEL_FONT_COLOR,
          fontFamily: "sans-serif",
          labelOutlineColor: LABEL_OUTLINE_COLOR,
          labelOutlineWidth: LABEL_OUTLINE_WIDTH,
          labelYOffset: -10,
          pointRadius: LABEL_POINT_RADIUS,
          fillColor: LABEL_POINT_COLOR,
          fillOpacity: 1,
          strokeColor: LABEL_OUTLINE_COLOR,
          strokeWidth: 1,
        },
      });
    }

    return rules;
  }
}

function labelFeatureId(label: DistanceLabel): string {
  return `label-${label.subLineIndex}-${label.vertexIndex}`;
}

function sumSegmentDistances(line: Position[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    total += haversineKm(a[0], a[1], b[0], b[1]);
  }
  return total;
}

/**
 * Take a slice of a LineString from `loKm` to `hiKm` measured along the line.
 * Edge points are interpolated linearly between the surrounding vertices so the
 * clipped line starts/ends exactly at the requested distances.
 *
 * Inlined rather than calling turf.lineSliceAlong because the latter requires
 * wrapping the line in a Feature and pulls a noticeable chunk of bundle code
 * we do not otherwise use.
 */
function sliceLineByDistance(line: Position[], loKm: number, hiKm: number): Position[] {
  if (line.length < 2 || hiKm <= loKm) return [];

  const result: Position[] = [];
  let cumulative = 0;
  let started = false;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segLen = haversineKm(a[0], a[1], b[0], b[1]);
    const segStart = cumulative;
    const segEnd = cumulative + segLen;

    if (segEnd < loKm) {
      cumulative = segEnd;
      continue;
    }
    if (segStart > hiKm) break;

    if (!started) {
      const t = segLen === 0 ? 0 : Math.max(0, loKm - segStart) / segLen;
      result.push(interpolatePosition(a, b, t));
      started = true;
    }

    if (segEnd <= hiKm) {
      result.push(b);
    } else {
      const t = segLen === 0 ? 1 : Math.max(0, hiKm - segStart) / segLen;
      result.push(interpolatePosition(a, b, t));
      break;
    }

    cumulative = segEnd;
  }

  return result;
}

function interpolatePosition(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Haversine distance in kilometres. Inlined to keep the slice helper free of
 * turf imports, since it runs once per slider tick and the maths is trivial.
 */
function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
