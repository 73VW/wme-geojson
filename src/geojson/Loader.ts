import type { NormalizedTrack } from "./types";
import { TrackLoadError } from "./types";
import { validateFeature } from "./validate";
import { normalizeTrack } from "./normalize";

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Load, validate, and normalise a GeoJSON track from a URL.
 *
 * Uses GM.xmlHttpRequest for the fetch to bypass CORS restrictions in the
 * userscript context. Throws TrackLoadError on any failure.
 */
export function loadTrack(url: string): Promise<NormalizedTrack> {
  return fetchJson(url).then((data) => {
    const feature = validateFeature(data);
    return normalizeTrack(feature);
  });
}

/**
 * Wrap GM.xmlHttpRequest in a Promise.
 * Rejects with TrackLoadError on non-2xx status, network error, or timeout.
 */
function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const hostname = safeHostname(url);

    GM.xmlHttpRequest({
      method: "GET",
      url,
      responseType: "json",
      timeout: FETCH_TIMEOUT_MS,
      onload(response) {
        const isSuccess = response.status >= 200 && response.status < 300;
        if (!isSuccess) {
          reject(
            new TrackLoadError(
              `HTTP ${response.status} fetching GeoJSON from ${hostname}.`,
            ),
          );
          return;
        }
        resolve(response.response);
      },
      onerror(response) {
        reject(
          new TrackLoadError(
            `Network error fetching GeoJSON from ${hostname}: ${response.statusText || "unknown error"}.`,
          ),
        );
      },
      ontimeout() {
        reject(
          new TrackLoadError(
            `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching GeoJSON from ${hostname}.`,
          ),
        );
      },
    });
  });
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
