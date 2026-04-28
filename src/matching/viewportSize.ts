/**
 * viewportSize.ts — pure helper for computing viewport span in degrees.
 *
 * Architectural note: The PRD layout places this file under src/matching/.
 * The SDK-coupled "measure the live viewport" logic lives in
 * src/utils/measureViewport.ts (controller layer), which calls setMapCenter,
 * waits for map-idle, then reads getMapExtent().  That function returns a raw
 * BBox, which is then passed to computeViewportSizeDeg() here.
 *
 * This keeps src/matching/ SDK-free and testable in plain Node: the SDK never
 * leaks into this file, and the measurer never leaks turf geometry into the
 * controller layer.
 */
import type { BBox } from "geojson";

export interface ViewportSizeDeg {
  lonSpan: number;
  latSpan: number;
}

/**
 * Compute the geographic span of a viewport from a GeoJSON BBox.
 * BBox format: [minLon, minLat, maxLon, maxLat].
 */
export function computeViewportSizeDeg(extent: BBox): ViewportSizeDeg {
  const [minLon, minLat, maxLon, maxLat] = extent;
  return {
    lonSpan: maxLon - minLon,
    latSpan: maxLat - minLat,
  };
}
