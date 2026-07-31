# KML File Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept `.kml` files as a file-upload input source for lines, alongside `.geojson` and `.gpx`.

**Architecture:** Mirror of the existing GPX path: a small `DOMParser`-based converter turns KML text into a GeoJSON Feature/FeatureCollection, and `buildEntriesFromText` routes `.kml` files through it. Point placemarks are ignored; only LineStrings become lines.

**Tech Stack:** TypeScript, browser `DOMParser` (no new dependency), vitest with happy-dom for the tests.

## Global Constraints

- No new dependencies.
- Spec: `docs/superpowers/specs/2026-07-31-kml-support-design.md`.
- Test command: `npx vitest run src/__tests__/kmlToGeoJson.test.ts`.
- Vitest default environment is `node` (no DOMParser); the new test file must carry a `// @vitest-environment happy-dom` docblock on its first line.

---

### Task 1: `kmlToGeoJson` converter

**Files:**
- Create: `src/geojson/kmlToGeoJson.ts`
- Test: `src/__tests__/kmlToGeoJson.test.ts`

**Interfaces:**
- Consumes: nothing (pure function over a string).
- Produces: `kmlToGeoJson(kmlText: string): unknown` — returns a GeoJSON `Feature` (one line placemark) or `FeatureCollection` (several), throws `Error("KML file contains no LineStrings")` otherwise. Task 2 imports it from `../geojson/kmlToGeoJson`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/kmlToGeoJson.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { kmlToGeoJson } from "../geojson/kmlToGeoJson";

const KML = `<?xml version="1.0" encoding="utf-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name><![CDATA[Stage]]></name>
    <Placemark>
      <name>Sprint</name>
      <Point><coordinates>6.87,46.75,1</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Trace</name>
      <LineString>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>6.62,46.50,1
          6.63,46.51,2 6.64,46.52</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

describe("kmlToGeoJson", () => {
  it("converts the LineString placemark and ignores Points", () => {
    const raw = kmlToGeoJson(KML) as {
      type: string;
      geometry: { type: string; coordinates: number[][][] };
      properties: { name: string | null };
    };
    expect(raw.type).toBe("Feature");
    expect(raw.geometry.type).toBe("MultiLineString");
    expect(raw.geometry.coordinates).toEqual([
      [
        [6.62, 46.5],
        [6.63, 46.51],
        [6.64, 46.52],
      ],
    ]);
    expect(raw.properties.name).toBe("Trace");
  });

  it("wraps several line placemarks in a FeatureCollection", () => {
    const twoLines = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>A</name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>
      <Placemark><name>B</name><LineString><coordinates>5,6 7,8</coordinates></LineString></Placemark>
    </Document></kml>`;
    const raw = kmlToGeoJson(twoLines) as { type: string; features: unknown[] };
    expect(raw.type).toBe("FeatureCollection");
    expect(raw.features).toHaveLength(2);
  });

  it("throws when the KML contains no LineString", () => {
    const pointsOnly = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark>
    </Document></kml>`;
    expect(() => kmlToGeoJson(pointsOnly)).toThrow("KML file contains no LineStrings");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kmlToGeoJson.test.ts`
Expected: FAIL — cannot resolve `../geojson/kmlToGeoJson`.

- [ ] **Step 3: Write the implementation**

Create `src/geojson/kmlToGeoJson.ts`:

```ts
/**
 * Parse a KML XML string into a GeoJSON Feature or FeatureCollection.
 * Uses the browser's built-in DOMParser — no external dependency.
 * Only Placemarks containing a LineString are converted; Points are ignored.
 */
export function kmlToGeoJson(kmlText: string): unknown {
  const doc = new DOMParser().parseFromString(kmlText, "application/xml");
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/kmlToGeoJson.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/geojson/kmlToGeoJson.ts src/__tests__/kmlToGeoJson.test.ts
git commit -m "feat(lines): add KML to GeoJSON converter"
```

---

### Task 2: Wire `.kml` into file upload

**Files:**
- Modify: `src/lines/featureCollectionLoader.ts:137-144` (`buildEntriesFromText`)
- Modify: `src/ui/views/LinesListView.ts:106` and `src/ui/views/LinesListView.ts:111`
- Test: `src/__tests__/kmlToGeoJson.test.ts` (extend)

**Interfaces:**
- Consumes: `kmlToGeoJson(kmlText: string): unknown` from `../geojson/kmlToGeoJson` (Task 1).
- Produces: `buildEntriesFromText(text, filename)` now handles filenames ending in `.kml` (case-insensitive). No signature change.

- [ ] **Step 1: Write the failing test**

Append to the `describe` block in `src/__tests__/kmlToGeoJson.test.ts` (add the import at the top of the file):

```ts
import { buildEntriesFromText } from "../lines/featureCollectionLoader";
```

```ts
  it("routes .kml files through buildEntriesFromText", () => {
    const entries = buildEntriesFromText(KML, "E01.kml");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.track.geometry.type).toBe("MultiLineString");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kmlToGeoJson.test.ts`
Expected: FAIL — the new test throws (`JSON.parse` on KML text: `Unexpected token '<'`).

- [ ] **Step 3: Add the `.kml` branch**

In `src/lines/featureCollectionLoader.ts`, add next to the existing gpx import:

```ts
import { kmlToGeoJson } from "../geojson/kmlToGeoJson";
```

Replace the body of `buildEntriesFromText` (currently lines 137–144):

```ts
/**
 * Parse file text content into LineEntry[].
 * Detects format by filename extension (.gpx → GPX, .kml → KML, else → GeoJSON).
 */
export function buildEntriesFromText(text: string, filename: string): LineEntry[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gpx")) {
    return buildEntriesFromData(gpxToGeoJson(text), filename);
  }
  if (lower.endsWith(".kml")) {
    return buildEntriesFromData(kmlToGeoJson(text), filename);
  }
  const raw: unknown = JSON.parse(text);
  return buildEntriesFromData(raw, filename);
}
```

- [ ] **Step 4: Update the file picker UI**

In `src/ui/views/LinesListView.ts`:

Line 106: `fileInput.accept = ".geojson,.gpx";` → `fileInput.accept = ".geojson,.gpx,.kml";`

Line 111: `text: "📂 Choisir un fichier (.geojson / .gpx)",` → `text: "📂 Choisir un fichier (.geojson / .gpx / .kml)",`

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS (new file: 4 tests).

- [ ] **Step 6: Verify against the real E01.kml**

Run from the repo root:

```bash
npx tsx -e '
import { kmlToGeoJson } from "./src/geojson/kmlToGeoJson";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
globalThis.DOMParser = new Window().DOMParser;
const raw = kmlToGeoJson(readFileSync("E01.kml", "utf8"));
console.log(JSON.stringify(raw).slice(0, 200));
'
```

Expected: prints a `Feature` (or `FeatureCollection`) with `MultiLineString` geometry and real coordinates around lon 6.6 / lat 46.5 — no throw. (If `tsx` is unavailable, skip: the unit tests already cover the namespaced-KML structure.)

- [ ] **Step 7: Commit**

```bash
git add src/lines/featureCollectionLoader.ts src/ui/views/LinesListView.ts src/__tests__/kmlToGeoJson.test.ts
git commit -m "feat(lines): accept .kml files in the file picker"
```
