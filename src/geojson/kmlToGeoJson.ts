/**
 * Parse a KML XML string into a GeoJSON Feature or FeatureCollection.
 * Uses the browser's built-in DOMParser — no external dependency.
 * Only Placemarks containing a LineString are converted; Points are ignored.
 */
// Matches elements by local name regardless of namespace prefix (e.g. <kml:Placemark>).
// getElementsByTagName("Placemark") only matches the unprefixed qualified name, so
// namespace-prefixed KML (common from ArcGIS/GeoServer exports) would otherwise yield
// zero matches. getElementsByTagNameNS("*", ...) returns 0 in happy-dom, so filter by
// localName instead — works in both happy-dom and real browsers.
const byLocalName = (root: Element | Document, name: string) =>
  Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === name);

export function kmlToGeoJson(kmlText: string): unknown {
  // ponytail: happy-dom's XML parser errors on any CDATA section (test-env
  // bug, not a spec issue — real browsers parse CDATA fine). Unwrap-and-escape
  // to plain escaped text so the result is semantically identical XML in every
  // parser; drop this if happy-dom fixes it.
  const normalized = kmlText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
    content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
  const doc = new DOMParser().parseFromString(normalized, "application/xml");
  const placemarks = byLocalName(doc, "Placemark");

  const features = placemarks.flatMap((pm) => {
    const lineStrings = byLocalName(pm, "LineString");
    if (lineStrings.length === 0) {
      return [];
    }

    const name = byLocalName(pm, "name")[0]?.textContent ?? null;
    const coordinates = lineStrings
      .map((ls) =>
        (byLocalName(ls, "coordinates")[0]?.textContent ?? "")
          .trim()
          .replace(/\s*,\s*/g, ",") // tolerate "lon, lat, alt"
          .split(/\s+/)
          .map((tuple) => tuple.split(",").map(Number))
          .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
          .map((c) => [c[0], c[1]] as number[]),
      )
      .filter((line) => line.length >= 2); // drop sub-lines left with <2 valid points

    if (coordinates.length === 0) {
      return [];
    }

    return [
      {
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates },
        properties: { name },
      },
    ];
  });

  if (features.length === 0) {
    throw new Error("KML file contains no LineStrings");
  }

  if (features.length === 1) {
    return features[0];
  }

  return { type: "FeatureCollection", features };
}
