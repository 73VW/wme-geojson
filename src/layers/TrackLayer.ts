import type { WmeSDK } from "wme-sdk-typings";
import type { Position } from "geojson";
import type { NormalizedTrack } from "../geojson/types";
import { logger } from "../utils/logger";
import { computeDistanceLabels, formatLabelKm, type DistanceLabel } from "./distanceLabels";

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

  // Filtering state. setVisibleRange and setVisibleDistances each update one
  // dimension; redraw() reads both, so the filters compose as an intersection.
  private currentRangeLo = 0;
  private currentRangeHi = 0;
  // Allowed distance buckets, encoded as `Math.round(km * 10)` (i.e. 100-m
  // resolution). Starts as an empty set (no labels shown) — Lot 2 requires
  // that labels are hidden by default until the CSV is loaded and its distances
  // are passed via setVisibleDistances(). null would show all labels, so we
  // use an empty Set instead to suppress all labels initially.
  private currentDistanceKeys: ReadonlySet<number> | null = new Set<number>();

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

    this.currentRangeLo = 0;
    this.currentRangeHi = this.totalKm;
    // Start with no labels visible — caller must invoke setVisibleDistances()
    // with the CSV distances to opt in (Lot 2 default-hidden requirement).
    this.currentDistanceKeys = new Set<number>();

    this.wmeSDK.Map.addLayer({
      layerName: TrackLayer.LAYER_NAME,
      // styleContext resolves "${key}" placeholders inside style values at
      // render time. We use it to derive each label's text from its own
      // properties — without it, FeatureStyle.label is a fixed string and we
      // would need one styleRule per label point (1000+ rules on a dense
      // SchweizMobil track), which made the slider take seconds per tick.
      styleContext: {
        getLabel: ({ feature }) => {
          const km = feature?.properties.km;
          return typeof km === "number" ? formatLabelKm(km) : "";
        },
      },
      styleRules: this.buildStyleRules(),
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
   * Return the MultiLineString geometry of the currently-drawn track, or null
   * if no track has been drawn yet. Used by MatchingPipeline to build the
   * NormalizedTrack it needs for bbox bisection without re-reading from disk.
   */
  getTrackGeometry(): NormalizedTrack["geometry"] | null {
    return this.currentTrack?.geometry ?? null;
  }

  /**
   * Restrict the rendered portion of the track to [minKm, maxKm]. Out-of-range
   * sub-lines and labels are removed; in-range sub-lines are clipped at the
   * window edges. Composes with setVisibleDistances as an intersection.
   */
  setVisibleRange(minKm: number, maxKm: number): void {
    if (!this.currentTrack) return;
    this.currentRangeLo = Math.max(0, Math.min(minKm, maxKm));
    this.currentRangeHi = Math.min(this.totalKm, Math.max(minKm, maxKm));
    this.redraw();
  }

  /**
   * Restrict which labels are rendered to those whose distance, rounded to the
   * nearest 100 m, matches one of `distancesKm`. Pass `null` (or empty) to
   * disable the list filter and show every label in the visible range. The
   * track stroke is unaffected — only labels are filtered. Composes with
   * setVisibleRange as an intersection.
   */
  setVisibleDistances(distancesKm: ReadonlyArray<number> | null): void {
    if (!this.currentTrack) return;
    if (!distancesKm || distancesKm.length === 0) {
      this.currentDistanceKeys = null;
    } else {
      // Encode each distance as round(km * 10) so the lookup is a plain
      // integer-set membership; comparing floats directly would miss matches
      // due to representation drift (0.1 + 0.2 ≠ 0.3 etc).
      const keys = new Set<number>();
      for (const d of distancesKm) {
        if (Number.isFinite(d)) keys.add(Math.round(d * 10));
      }
      this.currentDistanceKeys = keys;
    }
    this.redraw();
  }

  /**
   * How many of the cached labels would be rendered under the current filters.
   * Lets the panel show a "X / Y matched" counter without triggering a redraw.
   */
  countVisibleLabels(): number {
    return this.filterLabels().length;
  }

  /**
   * Return the labels that pass both active filters (range + distance list),
   * as a readonly array. The panel uses this to compute bbox views without
   * re-running the filter logic itself. The returned array is sorted by km
   * ascending (inherited from allLabels order and the Map.values() iteration).
   */
  getVisibleLabels(): readonly DistanceLabel[] {
    return this.filterLabels();
  }

  /**
   * Whether a distance-list filter is currently active (i.e.
   * setVisibleDistances was last called with a non-empty array).
   * The bbox-views section should only appear when a list is active.
   */
  hasDistanceFilter(): boolean {
    return this.currentDistanceKeys !== null;
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
   * Re-render the layer from the cached track + label set under the current
   * filter state (range + distance list). Clearing instead of dropping the
   * layer keeps the styleContext + styleRules registered, so this only costs
   * the per-feature insert.
   */
  private redraw(): void {
    if (!this.currentTrack) return;

    this.wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: TrackLayer.LAYER_NAME });
    this.drawTrackInRange(this.currentRangeLo, this.currentRangeHi);
    this.drawLabels(this.filterLabels());
  }

  /**
   * Apply both filters (range + optional distance list) to the cached labels.
   */
  private filterLabels(): DistanceLabel[] {
    const lo = this.currentRangeLo;
    const hi = this.currentRangeHi;
    const keys = this.currentDistanceKeys;
    return Array.from(
      this.allLabels
        .reduce((acc, l) => {
          if (l.km < lo || l.km > hi) return acc;

          const k = Math.round(l.km * 10);
          if (keys && !keys.has(k)) return acc;

          const prev = acc.get(k);
          if (!prev || l.km > prev.km) {
            acc.set(k, l);
          }

          return acc;
        }, new Map())
        .values(),
    );
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

  /**
   * Two styleRules total: one for the track stroke (LineStrings tagged
   * `kind: "line"`), one for the labels (Points tagged `kind: "label"`). The
   * label text comes from `${getLabel}` which the SDK resolves per-feature
   * against the styleContext registered at draw().
   */
  private buildStyleRules() {
    return [
      {
        predicate: (props: { kind?: string | number | null }) => props.kind === LINE_KIND,
        style: {
          strokeColor: TRACK_STROKE_COLOR,
          strokeWidth: TRACK_STROKE_WIDTH,
          strokeOpacity: TRACK_STROKE_OPACITY,
          strokeLinecap: "round" as const,
        },
      },
      {
        predicate: (props: { kind?: string | number | null }) => props.kind === LABEL_KIND,
        style: {
          label: "${getLabel}",
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
      },
    ];
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
