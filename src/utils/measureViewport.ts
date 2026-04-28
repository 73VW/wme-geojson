/**
 * measureViewport — measures the WME viewport size in degrees at zoom level 17.
 *
 * This is the SDK-coupled counterpart to src/matching/viewportSize.ts.  It
 * navigates the map to a known reference point at z17, waits for the map to
 * settle, then reads Map.getMapExtent() to measure the visible BBox.
 *
 * The result is cached on the instance so the measurement only happens once
 * per WalkController lifetime (screen resolution doesn't change mid-walk).
 */
import type { WmeSDK } from "wme-sdk-typings";
import { computeViewportSizeDeg, type ViewportSizeDeg } from "../matching/viewportSize";
import { waitForMapIdle } from "./waitForMapIdle";
import { logger } from "./logger";

/** Zoom level at which WME reliably loads segment data. */
const SEGMENT_ZOOM_LEVEL = 17 as const;

/**
 * Reference point for the measurement: centre of Switzerland, well within
 * the WME-supported area and guaranteed to have map tiles at z17.
 */
const REFERENCE_POINT = { lon: 8.23, lat: 46.82 };

/**
 * Navigate to the reference point at z17, wait for idle, and return the
 * viewport size in degrees.  The caller is responsible for caching.
 */
export async function measureViewportAtZ17(wmeSDK: WmeSDK): Promise<ViewportSizeDeg> {
  logger.info("measureViewport: navigating to reference point at z17 to measure viewport size");

  wmeSDK.Map.setMapCenter({
    lonLat: REFERENCE_POINT,
    zoomLevel: SEGMENT_ZOOM_LEVEL,
  });

  // Use waitForMapIdle's default timeout (single source of truth).
  await waitForMapIdle(wmeSDK);

  const extent = wmeSDK.Map.getMapExtent();
  const size = computeViewportSizeDeg(extent);

  logger.info(
    `measureViewport: lonSpan=${size.lonSpan.toFixed(4)}°, latSpan=${size.latSpan.toFixed(4)}°`,
  );

  return size;
}
