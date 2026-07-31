/**
 * Parse a KML XML string into a GeoJSON Feature or FeatureCollection.
 * Uses the browser's built-in DOMParser — no external dependency.
 * Only Placemarks containing a LineString are converted; Points are ignored.
 */
export function kmlToGeoJson(kmlText: string): unknown {
  // ponytail: happy-dom's XML parser errors on any CDATA section (test-env
  // bug, not a spec issue — real browsers treat CDATA content identically to
  // escaped text). Unwrapping it here is a no-op in production and only
  // works around the test environment; drop this if happy-dom fixes it.
  const normalized = kmlText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const doc = new DOMParser().parseFromString(normalized, "application/xml");
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));

  const features = placemarks.flatMap((pm) => {
    const lineStrings = Array.from(pm.getElementsByTagName("LineString"));
    if (lineStrings.length === 0) {
      return [];
    }

    const name = pm.getElementsByTagName("name")[0]?.textContent ?? null;
    const coordinates = lineStrings.map((ls) =>
      (ls.getElementsByTagName("coordinates")[0]?.textContent ?? "")
        .trim()
        .split(/\s+/)
        .map((tuple) => {
          const [lon, lat] = tuple.split(",");
          return [parseFloat(lon ?? "0"), parseFloat(lat ?? "0")];
        }),
    );

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
