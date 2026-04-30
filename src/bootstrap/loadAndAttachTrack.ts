// Bootstrap helper: load a GeoJSON track from a URL and wire up the layer,
// controller, and store. Factored out of main.user.ts so the MatchPanel's
// "Load URL" button can re-use the same path without duplicating logic.

import type { WmeSDK } from "wme-sdk-typings";
import { length as turfLength } from "@turf/turf";
import { loadTrack } from "../geojson/Loader";
import { TrackLayer } from "../layers/TrackLayer";
import { WalkController } from "../controller/WalkController";
import { SessionStore } from "../state/SessionStore";
import { logger } from "../utils/logger";
import type { MatchPanel } from "../ui/MatchPanel";

/**
 * Load a GeoJSON track, build the map layer + controller, update the session
 * store, and register them with the panel.
 *
 * On success the store transitions to "track-loaded" and the panel's controller
 * and trackLayer setters are called. On failure the error is surfaced via the
 * panel's error slot rather than thrown, so callers do not need a try/catch.
 */
export async function loadAndAttachTrack(
    url: string,
    wmeSDK: WmeSDK,
    store: SessionStore,
    panel: MatchPanel,
): Promise<void> {
    try {
        const track = await loadTrack(url);

        // GeoJSON reload reuses a fixed SDK layer name, so the previous layer must
        // be removed before the next TrackLayer.draw() attempts to register it.
        try {
            wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
        } catch {
            // No previous layer is the common case on first load.
        }

        const layer = new TrackLayer(wmeSDK);
        layer.draw(track);
        logger.info(`Track drawn (id=${track.trackId ?? "unknown"})`);

        const controller = new WalkController(wmeSDK, track.geometry);

        // Measure track length in km using the canonical turf method.
        const totalKm = turfLength(
            { type: "Feature", geometry: track.geometry, properties: null },
            { units: "kilometers" },
        );

        // Persist URL in the query string so a page reload re-triggers auto-load.
        const currentParams = new URLSearchParams(window.location.search);
        currentParams.set("geojson", url);
        history.replaceState(null, "", `${window.location.pathname}?${currentParams.toString()}`);

        store.setTrack(url, totalKm);
        store.setPhase("track-loaded");

        panel.setController(controller);
        panel.setTrackLayer(layer);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("loadAndAttachTrack: failed to load track", err);
        panel.showLoadError(message);
    }
}
