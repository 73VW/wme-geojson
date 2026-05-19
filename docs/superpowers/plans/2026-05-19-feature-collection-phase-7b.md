# FeatureCollection Phase 7b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a GeoJSON `FeatureCollection` as N selectable lines (dropping Point features), preview all lines on the map in distinct colours, and preserve each line's matching state across selection switches.

**Architecture:** `loadLines` gains a `FeatureCollection` branch that drops non-line features and builds one `LineEntry` per surviving feature. A new lightweight `LinesPreviewLayer` draws every line in its own colour while no line is selected; the existing single-line `TrackLayer` takes over once a line is selected. Per-line state is preserved by snapshotting the `SessionStore` state and pipeline match groups onto the outgoing `LineEntry` when switching lines, and rehydrating them when switching back.

**Tech Stack:** TypeScript 5.6 strict, Rollup, `@turf/turf`, WME SDK custom layers, `vitest`.

**Scope note:** Phase 7b of the spec `docs/superpowers/specs/2026-05-18-feature-collection-design.md`. SlowUp detail fetching is Phase 7c and out of scope here. Phase 7a (sub-tab split, synthetic matching) is complete and on branch `feature/feature-collection-support`.

**Baseline:** `npx tsc --noEmit` reports ONE pre-existing error in `src/__tests__/waitForMapIdle.test.ts` — that is the only acceptable tsc error. Tests currently: 246 passing. Do NOT use top-level `await` in test files (project tsconfig is `module: ES6`); use `beforeAll`.

---

## File structure

**Created:**
- `src/layers/LinesPreviewLayer.ts` — SDK layer drawing every loaded line in its own colour.
- `src/__tests__/featureCollection.test.ts` — tests for FeatureCollection validation + entry building.

**Modified:**
- `src/geojson/validate.ts` — add `validateFeatureCollection`.
- `src/geojson/Loader.ts` — export the fetch helper so `loadLines` can reuse it.
- `src/lines/featureCollectionLoader.ts` — `loadLines` handles `FeatureCollection`; add pure `buildEntriesFromData`.
- `src/lines/types.ts` — `LineEntry` gains `session` / `sessionCsvText` / `matchedGroups` for per-line state.
- `src/ui/MatchPanel.ts` — own a `LinesPreviewLayer`; drive it from registry events.
- `src/ui/subtabs/MatchingSubTab.ts` — snapshot/restore per-line matching state on selection change.

---

## Task 1: `validateFeatureCollection`

**Files:**
- Modify: `src/geojson/validate.ts`
- Test: `src/__tests__/featureCollection.test.ts`

**Context:** `validate.ts` already exports `validateFeature(raw)` which validates a single GeoJSON `Feature<LineString|MultiLineString>`, does a WGS84 CRS sanity check, and throws `TrackLoadError` otherwise. Phase 7b adds `validateFeatureCollection(raw)` which accepts a `FeatureCollection`, **drops** features whose geometry is not `LineString`/`MultiLineString` (Points etc.), validates each surviving feature with the existing per-feature checks, and returns them. It throws `TrackLoadError` if `raw` is not a `FeatureCollection` or if zero line features survive.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/featureCollection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateFeatureCollection } from "../geojson/validate";
import { TrackLoadError } from "../geojson/types";

const lineFeature = (coords: number[][]) => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates: coords },
  properties: {},
});
const pointFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [7, 46] },
  properties: {},
};

describe("validateFeatureCollection", () => {
  it("returns the line features and drops Point features", () => {
    const fc = {
      type: "FeatureCollection",
      features: [lineFeature([[7, 46], [7.01, 46]]), pointFeature],
    };
    const result = validateFeatureCollection(fc);
    expect(result).toHaveLength(1);
    expect(result[0].geometry.type).toBe("LineString");
  });

  it("keeps both LineString and MultiLineString features", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        lineFeature([[7, 46], [7.01, 46]]),
        {
          type: "Feature",
          geometry: { type: "MultiLineString", coordinates: [[[7, 46], [7.02, 46]]] },
          properties: {},
        },
      ],
    };
    expect(validateFeatureCollection(fc)).toHaveLength(2);
  });

  it("throws when raw is not a FeatureCollection", () => {
    expect(() => validateFeatureCollection({ type: "Feature" })).toThrow(TrackLoadError);
  });

  it("throws when no line features survive", () => {
    const fc = { type: "FeatureCollection", features: [pointFeature] };
    expect(() => validateFeatureCollection(fc)).toThrow(TrackLoadError);
  });

  it("rejects a line feature with projected (non-WGS84) coordinates", () => {
    const fc = {
      type: "FeatureCollection",
      features: [lineFeature([[2600000, 1200000], [2600100, 1200100]])],
    };
    expect(() => validateFeatureCollection(fc)).toThrow(TrackLoadError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/featureCollection.test.ts`
Expected: FAIL — `validateFeatureCollection` is not exported.

- [ ] **Step 3: Implement**

In `src/geojson/validate.ts`, append (the existing `validateFeature` and helpers stay unchanged):

```ts
/**
 * Validate a GeoJSON FeatureCollection and return its line features.
 *
 * Features whose geometry is not LineString/MultiLineString (Points, etc.)
 * are dropped silently — a slowUp FeatureCollection mixes route lines with
 * marker points and only the lines are matchable. Each surviving feature is
 * run through the same per-feature validation as validateFeature (geometry
 * type + WGS84 CRS sanity check). Throws TrackLoadError when raw is not a
 * FeatureCollection or when zero line features survive.
 */
export function validateFeatureCollection(raw: unknown): SupportedFeature[] {
  if (!raw || typeof raw !== "object") {
    throw new TrackLoadError("Response is not a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj["type"] !== "FeatureCollection") {
    throw new TrackLoadError(
      `Expected a GeoJSON FeatureCollection, got type="${String(obj["type"])}" instead.`,
    );
  }
  const features = obj["features"];
  if (!Array.isArray(features)) {
    throw new TrackLoadError("FeatureCollection has no features array.");
  }

  const lines: SupportedFeature[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const geometry = (feature as Record<string, unknown>)["geometry"];
    if (!geometry || typeof geometry !== "object") continue;
    const geoType = (geometry as Record<string, unknown>)["type"];
    if (geoType !== "LineString" && geoType !== "MultiLineString") {
      // Drop Point / Polygon / etc. — only route lines are matchable.
      continue;
    }
    // Reuse the single-feature validator for the geometry + CRS checks.
    lines.push(validateFeature(feature));
  }

  if (lines.length === 0) {
    throw new TrackLoadError("FeatureCollection contains no LineString/MultiLineString features.");
  }
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/featureCollection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/geojson/validate.ts src/__tests__/featureCollection.test.ts
git commit -m "feat(geojson): validate FeatureCollection, dropping non-line features"
```

---

## Task 2: `loadLines` handles `FeatureCollection`

**Files:**
- Modify: `src/geojson/Loader.ts`
- Modify: `src/lines/featureCollectionLoader.ts`
- Test: `src/__tests__/featureCollection.test.ts`

**Context:** `loadLines(url)` currently does `loadTrack(url)` (single Feature) and wraps the result in one `LineEntry`. Phase 7b: after fetching, detect `FeatureCollection` vs `Feature` and build N entries. The fetch in `Loader.ts` (`fetchJson`) is currently private — export it so `loadLines` can fetch once and branch. The branching/entry-building logic goes into a pure, testable `buildEntriesFromData(raw, url)`.

- [ ] **Step 1: Export the fetch helper from `Loader.ts`**

In `src/geojson/Loader.ts`, rename the private `fetchJson` to an exported `fetchGeoJson` (update the internal call site in `loadTrack`):

```ts
/**
 * Fetch and JSON-parse a GeoJSON URL via GM.xmlHttpRequest (CORS bypass).
 * Rejects with TrackLoadError on non-2xx status, network error, or timeout.
 * Exported so the multi-line loader can fetch once and branch on the payload.
 */
export function fetchGeoJson(url: string): Promise<unknown> {
  // ... existing fetchJson body unchanged ...
}
```

`loadTrack` keeps working: `return fetchGeoJson(url).then((data) => { ... })`.

- [ ] **Step 2: Write the failing test**

Append to `src/__tests__/featureCollection.test.ts`:

```ts
import { beforeAll } from "vitest";
import i18next from "i18next";
import { buildEntriesFromData } from "../lines/featureCollectionLoader";

beforeAll(async () => {
  await i18next.init({
    lng: "fr",
    resources: {
      fr: { translation: { panel: { lines: { fallbackName: "Tracé de {{km}} km" } } } },
    },
  });
});

describe("buildEntriesFromData", () => {
  const url = "https://example.com/x.geojson";

  it("builds one entry per line feature of a FeatureCollection", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [0.009, 0]] }, properties: { name: "A" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[1, 0], [1.009, 0]] }, properties: { name: "B" } },
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries.map((e) => e.displayName)).toEqual(["A", "B"]);
  });

  it("gives every entry a stable, unique id", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [0.009, 0]] }, properties: {} },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[1, 0], [1.009, 0]] }, properties: {} },
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries.map((e) => e.id)).toEqual([`${url}#0`, `${url}#1`]);
  });

  it("still handles a lone Feature payload (one entry)", () => {
    const feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[0, 0], [0.009, 0]] },
      properties: { name: "Solo" },
    };
    const entries = buildEntriesFromData(feature, url);
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName).toBe("Solo");
  });

  it("assigns distinct colours to distinct entries", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [0.009, 0]] }, properties: {} },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[1, 0], [1.009, 0]] }, properties: {} },
      ],
    };
    const [a, b] = buildEntriesFromData(fc, url);
    expect(a.color).not.toBe(b.color);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/featureCollection.test.ts`
Expected: FAIL — `buildEntriesFromData` is not exported.

- [ ] **Step 4: Implement**

In `src/lines/featureCollectionLoader.ts`:
- Update the import line `import { loadTrack } from "../geojson/Loader";` to `import { fetchGeoJson } from "../geojson/Loader";`.
- Add imports: `import { validateFeature } from "../geojson/validate";`, `import { validateFeatureCollection } from "../geojson/validate";`, `import { normalizeTrack } from "../geojson/normalize";`.
- Add the pure builder and rewrite `loadLines`:

```ts
/**
 * Build the list of LineEntry from an already-fetched GeoJSON payload.
 * Pure — no fetch, no SDK. Accepts either a FeatureCollection (one entry per
 * line feature, Points dropped) or a lone Feature (one entry).
 */
export function buildEntriesFromData(raw: unknown, sourceUrl: string): LineEntry[] {
  const isFeatureCollection =
    !!raw && typeof raw === "object" && (raw as Record<string, unknown>)["type"] === "FeatureCollection";

  if (isFeatureCollection) {
    const features = validateFeatureCollection(raw);
    return features.map((feature, index) =>
      buildEntryFromTrack(normalizeTrack(feature), sourceUrl, index),
    );
  }

  const feature = validateFeature(raw);
  return [buildEntryFromTrack(normalizeTrack(feature), sourceUrl, 0)];
}

/**
 * Fetch a GeoJSON URL and build the list of lines. Handles both a lone
 * Feature and a FeatureCollection.
 */
export async function loadLines(url: string): Promise<LineEntry[]> {
  const raw = await fetchGeoJson(url);
  return buildEntriesFromData(raw, url);
}
```

(`buildEntryFromTrack` and `extractSlowupNumber` are unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/featureCollection.test.ts`
Expected: PASS (9 tests total in the file).

- [ ] **Step 6: Full suite + tsc**

Run: `npm test` — all pass. `npx tsc --noEmit` — only the baseline `waitForMapIdle` error.

- [ ] **Step 7: Commit**

```bash
git add src/geojson/Loader.ts src/lines/featureCollectionLoader.ts src/__tests__/featureCollection.test.ts
git commit -m "feat(lines): load FeatureCollection into one entry per line"
```

---

## Task 3: `LinesPreviewLayer`

**Files:**
- Create: `src/layers/LinesPreviewLayer.ts`

**Context:** When the user has loaded lines but not yet selected one, every line is shown on the map in its own colour (`entry.color`). This is a lightweight, label-free layer, distinct from `TrackLayer` (which handles the single selected line with km labels). It uses its own SDK layer name so the two never collide. Per-feature colour is driven by a `styleContext` function — the same technique `TrackLayer` uses for per-feature labels (see `TrackLayer.draw`'s `styleContext.getLabel` + `strokeColor`/`label` style rule).

- [ ] **Step 1: Implement**

Create `src/layers/LinesPreviewLayer.ts`:

```ts
import type { WmeSDK } from "wme-sdk-typings";
import type { Position } from "geojson";
import type { LineEntry } from "../lines/types";
import { logger } from "../utils/logger";

const PREVIEW_STROKE_WIDTH = 4;
const PREVIEW_STROKE_OPACITY = 0.85;
const PREVIEW_KIND = "preview-line";

/**
 * SDK layer that draws every loaded line in its own colour, used while no
 * single line is selected. Label-free and filter-free — TrackLayer handles the
 * selected line. Uses its own layer name so it never collides with TrackLayer.
 */
export class LinesPreviewLayer {
  static readonly LAYER_NAME = "wme-geojson-preview";

  private layerAdded = false;

  constructor(private readonly wmeSDK: WmeSDK) {}

  /**
   * Draw every entry's geometry, each in entry.color. Re-drawing replaces the
   * previous content. Pass an empty list to clear.
   */
  draw(entries: readonly LineEntry[]): void {
    this.ensureLayer();
    this.wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: LinesPreviewLayer.LAYER_NAME });

    entries.forEach((entry) => {
      entry.track.geometry.coordinates.forEach((lineCoords, lineIndex) => {
        if (lineCoords.length < 2) return;
        // The SDK rejects 3D coords — strip elevation to [lon, lat].
        const coords2d: Position[] = lineCoords.map((c) => [c[0], c[1]]);
        const featureId = `${entry.id}-line-${lineIndex}`;
        this.wmeSDK.Map.addFeatureToLayer({
          layerName: LinesPreviewLayer.LAYER_NAME,
          feature: {
            id: featureId,
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords2d },
            properties: { kind: PREVIEW_KIND, color: entry.color },
          },
        });
      });
    });
  }

  /** Remove the layer. Never throws. */
  destroy(): void {
    try {
      this.wmeSDK.Map.removeLayer({ layerName: LinesPreviewLayer.LAYER_NAME });
    } catch (err) {
      logger.warn("LinesPreviewLayer.destroy: failed to remove layer", err);
    }
    this.layerAdded = false;
  }

  private ensureLayer(): void {
    if (this.layerAdded) return;
    this.wmeSDK.Map.addLayer({
      layerName: LinesPreviewLayer.LAYER_NAME,
      // styleContext resolves "${getColor}" per-feature at render time, so all
      // lines share a single style rule regardless of how many colours appear.
      styleContext: {
        getColor: ({ feature }) => {
          const color = feature?.properties.color;
          return typeof color === "string" ? color : "#ff00aa";
        },
      },
      styleRules: [
        {
          predicate: (props: { kind?: string | number | null }) => props.kind === PREVIEW_KIND,
          style: {
            strokeColor: "${getColor}",
            strokeWidth: PREVIEW_STROKE_WIDTH,
            strokeOpacity: PREVIEW_STROKE_OPACITY,
            strokeLinecap: "round" as const,
          },
        },
      ],
    });
    this.layerAdded = true;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: only the baseline `waitForMapIdle` error. If the SDK typings reject the `styleContext`/`styleRules` shape, mirror EXACTLY how `src/layers/TrackLayer.ts` types its `addLayer` call (read `TrackLayer.draw` and `buildStyleRules`) — the shapes must match what TrackLayer already compiles with.

- [ ] **Step 3: Commit**

```bash
git add src/layers/LinesPreviewLayer.ts
git commit -m "feat(layers): add LinesPreviewLayer for multi-colour line preview"
```

---

## Task 4: Wire the preview layer into the shell

**Files:**
- Modify: `src/ui/MatchPanel.ts`

**Context:** The `MatchPanel` shell owns SDK-coupled coordination. It will own a `LinesPreviewLayer` and drive it from `LineRegistry` events: show all lines while nothing is selected, hide the preview once a line is selected (the `MatchingSubTab` then draws that line via `TrackLayer`). Selection-driven, not tab-driven — per the design, once a line is selected only that line shows.

- [ ] **Step 1: Implement**

In `src/ui/MatchPanel.ts`:
- Add import: `import { LinesPreviewLayer } from "../layers/LinesPreviewLayer";`
- Add a private field: `private previewLayer: LinesPreviewLayer | null = null;`
- In `mount()`, after `this.matchingSubTab` is created and before `logger.info("MatchPanel shell mounted")`, add:

```ts
    this.previewLayer = new LinesPreviewLayer(this.wmeSDK);
    this.registry.onLinesChanged(() => this.refreshPreview());
    this.registry.onSelectedLineChanged((entry) => {
      if (entry) {
        this.previewLayer?.destroy();
      } else {
        this.refreshPreview();
      }
    });
```

- Add the private method:

```ts
  /** Show the multi-colour preview only while no line is selected. */
  private refreshPreview(): void {
    if (!this.previewLayer) return;
    if (this.registry.getSelected() !== null) {
      this.previewLayer.destroy();
      return;
    }
    const entries = this.registry.getAll();
    if (entries.length === 0) {
      this.previewLayer.destroy();
    } else {
      this.previewLayer.draw(entries);
    }
  }
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: tsc only the baseline error; all tests pass.
Run: `npm run build` — succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/MatchPanel.ts
git commit -m "feat(ui): show multi-colour line preview until a line is selected"
```

---

## Task 5: Per-line matching-state preservation

**Files:**
- Modify: `src/lines/types.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

**Context:** Matching state lives in three places, all rebuilt when a line is selected: `SessionStore` (csv rows + matched segments + closures), the `MatchingPipeline` (matched groups with geo anchors), and `WalkController` (geometry cache — disposable). To preserve a line's progress across switches, snapshot the `SessionStore` state and the pipeline's matched groups onto the outgoing `LineEntry`, and rehydrate them when the line is selected again. `SessionStore` already exposes `getState()` and `rehydrate(state, csvText)`.

The `WalkController` geometry cache is intentionally NOT preserved — clicking a result for an off-screen segment falls back to `findSegment`, so losing the cache only costs a lookup.

- [ ] **Step 1: Add `getEntryById` to `LineRegistry` (TDD)**

Append to `src/__tests__/LineRegistry.test.ts` a test inside the existing `describe("LineRegistry", ...)` block:

```ts
  it("getEntryById returns the entry or null", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a"), makeEntry("b")]);
    expect(reg.getEntryById("b")?.id).toBe("b");
    expect(reg.getEntryById("missing")).toBeNull();
  });
```

Run `npx vitest run src/__tests__/LineRegistry.test.ts` — the new test FAILS (`getEntryById` is not a function).

Then in `src/lines/LineRegistry.ts` add the method (next to `getSelected`):

```ts
  /** Look up an entry by id, or null if unknown. */
  getEntryById(id: string): LineEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }
```

Run the test again — PASS.

- [ ] **Step 2: Extend `LineEntry`**

In `src/lines/types.ts`, add imports at the top:

```ts
import type { SessionState } from "../state/SessionStore";
import type { ClosureRowGroup } from "../csv/buildClosuresCsv";
```

Add three optional fields to the `LineEntry` interface (after `matchPhase`):

```ts
  /** Snapshot of SessionStore state, saved when the user switches away. */
  session?: SessionState;
  /** csvText that accompanied `session` (needed by SessionStore.rehydrate). */
  sessionCsvText?: string;
  /** Pipeline match groups (geo anchors), snapshotted alongside `session`. */
  matchedGroups?: ClosureRowGroup[];
```

- [ ] **Step 3: Snapshot on switch-away, rehydrate on switch-to**

In `src/ui/subtabs/MatchingSubTab.ts`, `onSelectedLineChanged(entry)`. The method currently, for a non-null `entry`, early-returns when `entry.id === this.attachedLineId`, then attaches a controller/layer, calls `store.setTrack`, and sets up CSV or synthetic mode.

Replace the attach logic so that **before** changing `attachedLineId`, the outgoing line is snapshotted, and the incoming line is rehydrated when it has a saved session:

- Right after the `if (entry.id === this.attachedLineId) return;` guard and **before** `this.attachedLineId = entry.id;`, snapshot the previous line:

```ts
    // Snapshot the outgoing line's matching state so returning to it restores
    // the work in progress.
    if (this.attachedLineId !== null) {
      this.registry.updateEntry(this.attachedLineId, {
        session: this.store.getState(),
        sessionCsvText: this.registry.getEntryById(this.attachedLineId)?.csvText ?? "",
        matchedGroups: this.pipeline ? [...this.pipeline.getMatchedGroups()] : undefined,
      });
    }
    this.attachedLineId = entry.id;
```

- Then, where the method currently sets up the schedule (`if (entry.mode === "csv" && entry.csvRows) { ... } else { ... }`), wrap it so a saved session is restored instead:

```ts
    if (entry.session) {
      // Returning to a line worked on earlier — restore its full state.
      this.store.rehydrate(entry.session, entry.sessionCsvText ?? "");
      const isCsv = entry.mode === "csv";
      this.setSyntheticBannerVisible(!isCsv);
      this.setRemoveCsvVisible(isCsv);
    } else if (entry.mode === "csv" && entry.csvRows) {
      this.store.setCsvRows(entry.csvRows, entry.csvText ?? "");
      this.store.setPhase("csv-loaded");
      this.setSyntheticBannerVisible(false);
      this.setRemoveCsvVisible(true);
    } else {
      this.store.setCsvRows([buildSyntheticRow()], "");
      this.store.setPhase("csv-loaded");
      this.setSyntheticBannerVisible(true);
      this.setRemoveCsvVisible(false);
    }
```

> **Note:** keep the existing `store.setTrack(entry.id, entry.lengthKm)` call BEFORE this block. `setTrack` resets csv/closure state when the URL changes — that is fine, because the very next line either rehydrates or sets fresh rows.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: tsc only the baseline error; all tests pass (existing `LineRegistry.test.ts` still green).

- [ ] **Step 5: Commit**

```bash
git add src/lines/types.ts src/lines/LineRegistry.ts src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat: preserve per-line matching state across selection switches"
```

---

## Task 6: Download falls back to snapshotted match groups

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

**Context:** `getExportClosureGroups` reads `this.pipeline?.getMatchedGroups()`. After switching away and back to a line, `this.pipeline` is the freshly-attached line's pipeline (or `null`), so a previously-matched line's groups would be lost at download time. Fall back to the `matchedGroups` snapshot stored on the selected `LineEntry` (Task 5).

- [ ] **Step 1: Implement**

In `src/ui/subtabs/MatchingSubTab.ts`, `getExportClosureGroups`. It currently starts with:

```ts
    const closureGroups = (this.pipeline?.getMatchedGroups() ?? []) as ClosureRowGroup[];
```

Replace that line with:

```ts
    // After a line switch the live pipeline belongs to a different line; fall
    // back to the match groups snapshotted on the selected entry (Task 5).
    const snapshotGroups = this.registry.getSelected()?.matchedGroups ?? [];
    const closureGroups = (this.pipeline?.getMatchedGroups() ?? snapshotGroups) as ClosureRowGroup[];
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc only the baseline error; all tests pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts
git commit -m "fix(ui): export closures from snapshotted groups after a line switch"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Test suite** — `npm test`, all pass including `featureCollection.test.ts`.
- [ ] **Step 2: Lint** — `npm run lint`. Pre-existing issues in `WalkController.ts` / `SegmentMatcher.ts` are baseline noise; confirm no NEW issues in Phase 7b files.
- [ ] **Step 3: Build** — `npm run build`, `releases/release-*.user.js` produced.
- [ ] **Step 4: Manual validation checklist** (user performs in a live WME session):
  - [ ] Loading `https://schweizmobil.ch/api/4/slowups.geojson` lists N lines, each with a distinct colour pill.
  - [ ] All lines are drawn on the map in their colours while no line is selected.
  - [ ] Selecting a line hides the preview and draws only that line (magenta).
  - [ ] Match line A, switch to line B, return to A — A's matched segments and progress are intact, and A's closures CSV still downloads.
  - [ ] Point features in the source are not shown and do not appear as lines.
  - [ ] A lone-`Feature` URL still works exactly as in Phase 7a.
- [ ] **Step 5: Commit** any changelog note if the implementation diverged from this plan.

---

## Self-review notes

- **Spec coverage:** Phase 7b spec items — FeatureCollection parsing with Point-dropping (Tasks 1–2), N entries in the registry (Task 2; `LineRegistry` already stores a list), multi-colour preview (Tasks 3–4), per-line state preserved across switches (Tasks 5–6), lone-Feature still supported (Task 2). SlowUp details are Phase 7c, excluded.
- **Type consistency:** `buildEntriesFromData`, `validateFeatureCollection`, `LinesPreviewLayer.LAYER_NAME`, `LineEntry.session/sessionCsvText/matchedGroups`, and `LineRegistry.getEntryById` are used consistently across tasks.
- **Risk:** Task 5 is the deepest — the snapshot/rehydrate timing depends on `setSelected` having already updated `selectedId` before `onSelectedLineChanged` fires (it does — `LineRegistry.setSelected` emits after assigning), so `updateEntry` on the outgoing id does not re-fire the selection handler.
