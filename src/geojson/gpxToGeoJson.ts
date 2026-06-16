/**
 * Parse a GPX XML string into a GeoJSON Feature or FeatureCollection.
 * Uses the browser's built-in DOMParser — no external dependency.
 */
export function gpxToGeoJson(gpxText: string): unknown {
  const doc = new DOMParser().parseFromString(gpxText, "application/xml");
  const tracks = Array.from(doc.querySelectorAll("trk"));

  if (tracks.length === 0) {
    throw new Error("GPX file contains no tracks");
  }

  const features = tracks.map((trk) => {
    const name = trk.querySelector("name")?.textContent ?? null;
    const coordinates = Array.from(trk.querySelectorAll("trkseg")).map((seg) =>
      Array.from(seg.querySelectorAll("trkpt")).map((pt) => [
        parseFloat(pt.getAttribute("lon") ?? "0"),
        parseFloat(pt.getAttribute("lat") ?? "0"),
      ]),
    );

    return {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates },
      properties: { name },
    };
  });

  if (features.length === 1) {
    return features[0];
  }

  return { type: "FeatureCollection", features };
}
