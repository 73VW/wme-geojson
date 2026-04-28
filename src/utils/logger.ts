/**
 * Centralised logging for WME-geojson.
 * All console output is prefixed with [WME-geojson] for easy filtering.
 * Internal-only messages are not internationalised.
 */
export const logger = {
  info: (msg: string, ...args: unknown[]) => console.info("[WME-geojson]", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn("[WME-geojson]", msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error("[WME-geojson]", msg, ...args),
  debug: (msg: string, ...args: unknown[]) => console.debug("[WME-geojson]", msg, ...args),
};
