/**
 * waitForMapIdle — resolves when WME has finished loading map data.
 *
 * Strategy (mirrors WME-Switzerland-Helper's pattern):
 *  1. Poll State.isMapLoading() every POLL_INTERVAL_MS until it returns false.
 *  2. After loading completes, wait one extra SHORT_SETTLE_MS tick to allow the
 *     wme-map-data-loaded event to propagate and segment data to stabilise.
 *  3. A hard timeout (default 10 s) causes the promise to resolve anyway so
 *     the walk loop never hangs — the current cell's segment data may be
 *     incomplete but the walk continues.
 *
 * Note: State.isMapLoading() exists in wme-sdk-typings (index.d.ts line 4570)
 * so we use it exclusively.  The wme-map-data-loaded event is used as a
 * secondary settle hint rather than the primary mechanism.
 */
import type { WmeSDK } from "wme-sdk-typings";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 100;
const SETTLE_DELAY_MS = 150;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface WaitForMapIdleOptions {
  /** Maximum time to wait in ms before resolving anyway. Default 10 000. */
  timeoutMs?: number;
}

/**
 * Wait until WME reports the map is no longer loading, then settle briefly.
 * Always resolves (never rejects); on timeout it logs a warning and continues.
 */
export function waitForMapIdle(wmeSDK: WmeSDK, opts: WaitForMapIdleOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    let settled = false;

    function done(reason: "loaded" | "timeout"): void {
      if (settled) return;
      settled = true;
      if (reason === "timeout") {
        logger.warn("waitForMapIdle: timed out after", timeoutMs, "ms — continuing anyway");
      }
      resolve();
    }

    // Hard timeout — always resolves so the walk loop keeps going.
    const timeoutId = setTimeout(() => done("timeout"), timeoutMs);

    function poll(): void {
      if (settled) return;

      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        clearTimeout(timeoutId);
        done("timeout");
        return;
      }

      const loading = wmeSDK.State.isMapLoading();
      if (!loading) {
        // Map finished loading — give it a brief settle before resolving.
        setTimeout(() => {
          clearTimeout(timeoutId);
          done("loaded");
        }, SETTLE_DELAY_MS);
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
  });
}
