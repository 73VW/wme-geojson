import type { MapAnchor } from "../domain/types";

/** WME permalink selecting one segment, on the same editor host and env as `currentHref`. */
export function segmentPermalink(currentHref: string, view: MapAnchor, segmentId: number): string {
  const current = new URL(currentHref);
  const url = new URL(current.origin + current.pathname);
  const env = current.searchParams.get("env");
  if (env) url.searchParams.set("env", env);
  url.searchParams.set("lon", String(view.lon));
  url.searchParams.set("lat", String(view.lat));
  url.searchParams.set("zoomLevel", String(view.zoom));
  url.searchParams.set("segments", String(segmentId));
  return url.toString();
}
