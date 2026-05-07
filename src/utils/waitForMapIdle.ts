/**
 * waitForMapIdle — resolves when WME has finished loading map data.
 *
 * Strategy:
 *  1. Poll State.isMapLoading() every POLL_INTERVAL_MS until it returns false.
 *  2. Listen for wme-map-data-loaded and require a quiet settle window after
 *     the last observed map-data event while isMapLoading() remains false.
 *  3. A hard timeout (default 10 s) causes the promise to resolve anyway so
 *     the walk loop never hangs — the current cell's segment data may be
 *     incomplete but the walk continues.
 */
import type { WmeSDK } from "wme-sdk-typings";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 100;
const DEFAULT_SETTLE_DELAY_MS = 150;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface WaitForMapIdleOptions {
  /** Maximum time to wait in ms before resolving anyway. Default 10 000. */
  timeoutMs?: number;
  /** Quiet delay after WME reports idle and the last map-data-loaded event. Default 150. */
  settleDelayMs?: number;
}

/**
 * Wait until WME reports the map is no longer loading, then settle briefly.
 * Always resolves (never rejects); on timeout it logs a warning and continues.
 */
export function waitForMapIdle(wmeSDK: WmeSDK, opts: WaitForMapIdleOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleDelayMs = opts.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;

  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMapDataLoaded: (() => void) | null = null;

    function done(reason: "loaded" | "timeout"): void {
      if (settled) return;
      settled = true;
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      unsubscribeMapDataLoaded?.();
      unsubscribeMapDataLoaded = null;
      if (reason === "timeout") {
        logger.warn("waitForMapIdle: timed out after", timeoutMs, "ms — continuing anyway");
      }
      resolve();
    }

    // Hard timeout — always resolves so the walk loop keeps going.
    const timeoutId = setTimeout(() => done("timeout"), timeoutMs);

    const scheduleSettleCheck = (): void => {
      if (settled) return;
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
      }

      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (settled) return;
        if (wmeSDK.State.isMapLoading()) {
          poll();
          return;
        }
        clearTimeout(timeoutId);
        done("loaded");
      }, settleDelayMs);
    };

    const eventsApi = (wmeSDK as unknown as {
      Events?: {
        on?: (args: { eventName: string; eventHandler: () => void }) => () => void;
      };
    }).Events;
    try {
      unsubscribeMapDataLoaded =
        eventsApi?.on?.({
          eventName: "wme-map-data-loaded",
          eventHandler: () => {
            if (!wmeSDK.State.isMapLoading()) {
              scheduleSettleCheck();
            }
          },
        }) ?? null;
    } catch (err) {
      logger.warn("waitForMapIdle: failed to subscribe to wme-map-data-loaded", err);
    }

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
        // Map reports idle. Resolve only after a quiet window; later
        // wme-map-data-loaded events restart this same settle timer.
        scheduleSettleCheck();
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
  });
}
