/**
 * bboxViews.ts — Pure (SDK-free) helper that clusters visible distance labels
 * into viewport-sized bounding boxes and computes the best integer zoom for
 * each cluster.
 *
 * Design constraints
 * ──────────────────
 * • No SDK imports.  The caller reads `Map.getMapExtent()` + `Map.getZoomLevel()`
 *   and passes the derived lon/lat spans in.
 * • The fit-check scales the current viewport extent analytically (one zoom step
 *   doubles the span) so we never need to navigate the map to a reference zoom.
 *
 * Latitude-cosine caveat
 * ──────────────────────
 * Longitude degrees shrink with latitude (1° lon ≈ cos(lat) × 111 km), while
 * latitude degrees stay nearly constant.  A viewport whose pixel width equals
 * its pixel height therefore shows a wider lon-span than lat-span at any
 * latitude above the equator.  The fit-check below ignores this projection
 * effect and treats lon-spans and lat-spans symmetrically (both must fit
 * within `spanAtZoom`).  This is acceptable because:
 *   a) Switzerland sits around 46°N where cos(46°) ≈ 0.69 — the asymmetry is
 *      constant across the target region and does not change which cluster wins.
 *   b) We are computing integer-zoom buckets (±1 zoom = ×2 span); a cosine
 *      correction of 0.69 is well within that band.
 *   c) The WME viewport is not square anyway, so a perfectly-fitted box would
 *      require both pixel dimensions — which we do not have here.
 */

export interface BboxView {
  centerLon: number;
  centerLat: number;
  zoom: number;
}

export interface ComputeBboxViewsArgs {
  labels: ReadonlyArray<{ coord: [number, number]; km: number }>;
  viewportLonSpanAtCurrentZoom: number;
  viewportLatSpanAtCurrentZoom: number;
  currentZoom: number;
  minZoom: number; // 14
  maxZoom: number; // 18
}

/**
 * Cluster labels greedily in track order and compute the best integer zoom for
 * each cluster.
 *
 * Algorithm:
 *  1. Start a new cluster with the first label.
 *  2. For each subsequent label, tentatively extend the cluster bbox.
 *  3. If the extended bbox still fits at `minZoom`, add the label to the
 *     cluster; otherwise, close the cluster and start a fresh one.
 *  4. For each closed cluster, compute the highest integer zoom in
 *     [minZoom, maxZoom] at which the bbox fits, using the analytical
 *     formula derived from the current viewport extent.
 */
export function computeBboxViews(args: ComputeBboxViewsArgs): BboxView[] {
  const {
    labels,
    viewportLonSpanAtCurrentZoom,
    viewportLatSpanAtCurrentZoom,
    currentZoom,
    minZoom,
    maxZoom,
  } = args;

  if (labels.length === 0) return [];

  // Helper: lon/lat span of a viewport at integer zoom z, derived analytically
  // from the known span at currentZoom.  One zoom-out step doubles the span.
  const lonSpanAtZoom = (z: number): number =>
    viewportLonSpanAtCurrentZoom * Math.pow(2, currentZoom - z);
  const latSpanAtZoom = (z: number): number =>
    viewportLatSpanAtCurrentZoom * Math.pow(2, currentZoom - z);

  /** True iff the bbox (bLon × bLat degrees) fits inside the viewport at z. */
  const fitsAtZoom = (bLon: number, bLat: number, z: number): boolean =>
    lonSpanAtZoom(z) >= bLon && latSpanAtZoom(z) >= bLat;

  /** Highest integer zoom in [minZoom, maxZoom] at which the bbox fits. */
  const bestZoom = (bLon: number, bLat: number): number => {
    if (bLon === 0 && bLat === 0) {
      // Single-point cluster — always fits at maxZoom.
      return maxZoom;
    }
    // z = floor(currentZoom - log2(max(bLon/vpLon, bLat/vpLat)))
    const ratio = Math.max(
      bLon / viewportLonSpanAtCurrentZoom,
      bLat / viewportLatSpanAtCurrentZoom,
    );
    const z = Math.floor(currentZoom - Math.log2(ratio));
    return Math.min(maxZoom, Math.max(minZoom, z));
  };

  const views: BboxView[] = [];

  // Current cluster state
  let clusterMinLon = labels[0].coord[0];
  let clusterMaxLon = labels[0].coord[0];
  let clusterMinLat = labels[0].coord[1];
  let clusterMaxLat = labels[0].coord[1];

  const closeCluster = () => {
    const centerLon = (clusterMinLon + clusterMaxLon) / 2;
    const centerLat = (clusterMinLat + clusterMaxLat) / 2;
    const bLon = clusterMaxLon - clusterMinLon;
    const bLat = clusterMaxLat - clusterMinLat;
    views.push({ centerLon, centerLat, zoom: bestZoom(bLon, bLat) });
  };

  for (let i = 1; i < labels.length; i++) {
    const [lon, lat] = labels[i].coord;

    // Tentative bbox after adding this label
    const tMinLon = Math.min(clusterMinLon, lon);
    const tMaxLon = Math.max(clusterMaxLon, lon);
    const tMinLat = Math.min(clusterMinLat, lat);
    const tMaxLat = Math.max(clusterMaxLat, lat);
    const tBLon = tMaxLon - tMinLon;
    const tBLat = tMaxLat - tMinLat;

    if (fitsAtZoom(tBLon, tBLat, minZoom)) {
      // Fits — keep extending the current cluster
      clusterMinLon = tMinLon;
      clusterMaxLon = tMaxLon;
      clusterMinLat = tMinLat;
      clusterMaxLat = tMaxLat;
    } else {
      // Does not fit at minZoom — close and start a new cluster
      closeCluster();
      clusterMinLon = lon;
      clusterMaxLon = lon;
      clusterMinLat = lat;
      clusterMaxLat = lat;
    }
  }

  // Close the last (possibly only) cluster
  closeCluster();

  return views;
}
