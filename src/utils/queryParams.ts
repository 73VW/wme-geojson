import { logger } from "./logger";

/**
 * Read the `geojson` query parameter from the current page URL.
 *
 * Returns the decoded URL string if the parameter is present and valid.
 * Returns null if the parameter is absent (silent) or present but not a
 * valid URL (logs a warning so the user knows why nothing loaded).
 */
export function getGeojsonUrlFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("geojson");

  if (raw === null) {
    // Parameter absent — normal operation, nothing to do
    return null;
  }

  const decoded = decodeURIComponent(raw);
  const isValidUrl = isAbsoluteUrl(decoded);

  if (!isValidUrl) {
    logger.warn(
      `"geojson" query parameter is present but not a valid URL: "${decoded}". ` +
        `Expected an absolute URL starting with http:// or https://.`,
    );
    return null;
  }

  return decoded;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
