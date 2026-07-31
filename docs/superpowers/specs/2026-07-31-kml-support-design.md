# KML file support — design

**Date:** 2026-07-31
**Status:** approved

## Goal

Accept `.kml` files (e.g. `E01.kml`, a Tour de France stage export) as an input
source for lines, alongside the existing `.geojson` and `.gpx` file upload.

## Scope

- File upload only — same scope as GPX. The URL input stays GeoJSON-only.
- Only `Placemark` elements containing a `LineString` become lines. Point
  placemarks (sprints, towns, collect zones) are ignored, consistent with the
  existing loader which drops Points from GeoJSON FeatureCollections.

## Design

Mirror of the existing GPX path (`src/geojson/gpxToGeoJson.ts`), no new
dependency.

### New: `src/geojson/kmlToGeoJson.ts`

`kmlToGeoJson(kmlText: string): unknown`

- Parse with the browser's `DOMParser` (`application/xml`).
- Iterate elements by tag name so the KML namespace doesn't matter.
- For each `Placemark` that contains a `LineString`: parse its
  `<coordinates>` text — whitespace-separated `lon,lat[,alt]` tuples — into
  `[lon, lat]` pairs, and emit
  `{ type: "Feature", geometry: { type: "MultiLineString", coordinates: [...] }, properties: { name } }`
  where `name` is the Placemark's `<name>` text (or `null`).
- Placemarks without a LineString are skipped.
- No LineString anywhere → throw `Error("KML file contains no LineStrings")`.
- One line feature → return it alone; several → wrap in a
  `FeatureCollection`. Same contract as `gpxToGeoJson`.

### Changed: `src/lines/featureCollectionLoader.ts`

`buildEntriesFromText` gains a `.kml` extension branch routing to
`kmlToGeoJson`, before the JSON fallback — same shape as the `.gpx` branch.

### Changed: `src/ui/views/LinesListView.ts`

- `fileInput.accept = ".geojson,.gpx,.kml"`
- Button label: `📂 Choisir un fichier (.geojson / .gpx / .kml)`

## Error handling

Malformed XML or a KML with no LineString throws from `kmlToGeoJson`; the
existing file-upload error path (same one GPX uses) surfaces it.

## Testing

One unit test file for `kmlToGeoJson` in `src/__tests__`, same style as the
existing tests: a minimal KML with one LineString placemark and one Point
placemark → exactly one MultiLineString feature with the right name and
coordinates; a KML with no LineString → throws. Verify parsing works against
`E01.kml`'s structure (namespaced `<kml xmlns="http://www.opengis.net/kml/2.2">`).
