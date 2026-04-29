# WME-geojson — Product Requirements Document

> **Audience.** This document is the source of truth for implementing the `WME-geojson` userscript. It is consumed by AI coding agents (Claude Code) and human reviewers alike. Read [`CLAUDE.md`](./CLAUDE.md) at the repo root **before** acting on this PRD — it defines code conventions and operational guardrails that apply to every palier.
>
> **How to use this PRD.** The document is structured in two parts: a global section (vision, stack, conventions) that applies throughout the project, then one self-contained chapter per **palier** (delivery stage). Each palier has its own scope, contract, definition of done, and explicit list of things that are out of scope. **Implement one palier at a time.** Do not anticipate features from later paliers, even when convenient.

---

## Part 1 — Project-wide

### 1.1 Vision

`WME-geojson` is a userscript for the Waze Map Editor (WME) that helps editors work with externally-defined GeoJSON tracks (typically hiking, cycling, or transit routes). The user passes a GeoJSON URL via a query parameter on the WME URL; the script:

1. Loads and displays the track on the map.
2. Walks the map programmatically to load Waze segments along the entire track (since the WME data model only loads what is in the current viewport at zoom 17+).
3. Identifies which Waze segments correspond to the track via geometric matching.
4. Presents the result as an interactive list and allows the user to select segments individually or all at once.

Primary use case: a Swiss WME editor receives a SchweizMobil track URL from another mapper and wants to verify or edit the corresponding Waze segments along that route.

### 1.2 Non-goals

- Map-matching in the strict GIS sense (Hidden Markov Models, snap-to-road). This is geometric proximity matching, not routing reconstruction.
- Editing segments based on the track. The script identifies and selects; the user edits using the standard WME UI.
- Multiple tracks at once. One track per session.
- Persistence of results across page reloads (until/unless added in a later palier).
- Support for non-WGS84 GeoJSON sources. Reject with clear error.

### 1.3 Tech stack (invariants)

| Concern            | Choice                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Language           | TypeScript 5.6+, strict mode                                                                              |
| Bundler            | Rollup (`@rollup/plugin-typescript`, `node-resolve`, `commonjs`, `json`)                                  |
| SDK types          | `wme-sdk-typings` (latest from web-assets.waze.com)                                                       |
| Geometry           | `@turf/turf` 7+ (rely on tree-shaking; no manual sub-package imports unless bundle size becomes an issue) |
| HTTP               | `GM.xmlHttpRequest` exclusively (CORS bypass; userscript context)                                         |
| i18n               | `i18next` + `i18next-parser` (FR + EN at minimum; DE/IT can follow)                                       |
| Tests              | `vitest`                                                                                                  |
| Lint/format        | `eslint` flat config (`eslint.config.mjs`) + `prettier`                                                   |
| Userscript runtime | Tampermonkey (Greasemonkey untested)                                                                      |

The user maintains another userscript repo, `WME-Switzerland-Helper`, with the same stack. **It is the reference implementation for build pipeline, header structure, rollup config, i18next bootstrapping, and overall layout.** When a convention is not specified in this PRD or in `CLAUDE.md`, mirror `WME-Switzerland-Helper`. When a convention conflicts, this PRD wins.

### 1.4 SDK rules (apply throughout)

- **Always verify SDK signatures via the `context7` MCP server before use.** The SDK is evolving; outdated patterns from older WME scripts (pre-SDK era using `W.model.*`) do not apply.
- Initialize via `unsafeWindow.SDK_INITIALIZED.then(...)` (since `@grant unsafeWindow` is set).
- Wait for the `wme-ready` event before any data model access.
- Wait for `wme-map-data-loaded` after programmatic map moves before reading segment data.
- `Segments.getAll()` returns only segments **currently loaded in the viewport**, never all segments globally. This constraint is the entire reason Palier 3 exists.
- Custom layer names should be prefixed `wme-geojson-` to avoid collisions.

### 1.5 High-level architecture

The codebase is organized to enforce a clean separation between SDK-coupled code and pure logic:

```
┌──────────────────────────────────────────────────┐
│            main.user.ts (entry point)            │
└──────────────────┬───────────────────────────────┘
                   │
       ┌───────────┴────────────┐
       │                        │
┌──────▼─────────┐     ┌────────▼─────────┐
│   controller/  │     │       ui/        │
│ (orchestration)│◄───►│  (presentation)  │
│  uses SDK      │     │   uses DOM       │
└──┬──────────┬──┘     └──────────────────┘
   │          │
┌──▼────┐ ┌───▼──────┐ ┌───────────┐
│layers/│ │matching/ │ │ geojson/  │
│ uses  │ │  pure    │ │   pure    │
│ SDK   │ │ no SDK   │ │  no SDK   │
└───────┘ └──────────┘ └───────────┘
```

Hard rule: `geojson/` and `matching/` import nothing from the SDK or DOM. They are pure modules, testable in plain Node. Any temptation to import from the SDK in those folders is a smell — the orchestration belongs in `controller/`.

### 1.6 Repo layout (target final state)

The structure below is the **final** state after all paliers. Each palier creates the subset it needs — do not pre-create empty folders for future paliers.

```
WME-geojson/
├── CLAUDE.md
├── AGENTS.md → CLAUDE.md
├── README.md
├── README.fr.md
├── header.js
├── header-dev.js
├── main.user.ts
├── package.json
├── tsconfig.json
├── rollup.config.mjs
├── eslint.config.mjs
├── i18next-parser.config.js
├── vitest.config.ts
├── translate-readme.js
├── .prettierrc
├── .gitignore
├── locales/
│   ├── i18n.ts
│   ├── en/common.json
│   └── fr/common.json
├── src/
│   ├── geojson/
│   │   ├── Loader.ts
│   │   ├── normalize.ts
│   │   ├── validate.ts
│   │   └── types.ts
│   ├── matching/
│   │   ├── GridWalker.ts
│   │   ├── SegmentMatcher.ts
│   │   ├── viewportSize.ts
│   │   └── types.ts
│   ├── layers/
│   │   ├── TrackLayer.ts
│   │   └── styles.ts
│   ├── controller/
│   │   ├── WalkController.ts
│   │   └── walkStates.ts
│   ├── ui/
│   │   ├── MatchPanel.ts
│   │   └── modal.ts
│   ├── utils/
│   │   ├── queryParams.ts
│   │   ├── waitForMapIdle.ts
│   │   └── logger.ts
│   └── __tests__/
│       ├── normalize.test.ts
│       ├── validate.test.ts
│       ├── GridWalker.test.ts
│       └── SegmentMatcher.test.ts
└── releases/
    └── release-X.Y.Z.user.js
```

### 1.7 Build pipeline

Mirror `WME-Switzerland-Helper`'s build setup. Required `package.json` scripts:

| Script         | Purpose                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `compile`      | `rollup -c`                                                                  |
| `build`        | `compile` then `concat`                                                      |
| `concat`       | Prepend `header.js` to Rollup output → `releases/release-${version}.user.js` |
| `release`      | Bump version in `header.js` then `build`                                     |
| `test`         | `vitest run`                                                                 |
| `test:watch`   | `vitest`                                                                     |
| `lint`         | `eslint . --fix`                                                             |
| `format`       | `prettier --write .`                                                         |
| `watch`        | Concurrent: rollup --watch + i18next + prettier + eslint                     |
| `makemessages` | `i18next` (extract translation keys)                                         |

Output: ES module bundle, **unminified** (userscripts are typically distributed unminified for review and trust).

### 1.8 Header strategy

`header.js` (production):

```
// ==UserScript==
// @name         WME GeoJSON
// @namespace    wme-sdk-scripts
// @version      X.Y.Z
// @description  Load a GeoJSON track from a URL query parameter and identify matching Waze segments.
// @author       <user fills in>
// @match        https://www.waze.com/editor*
// @match        https://beta.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/*/editor*
// @exclude      https://www.waze.com/user/editor*
// @exclude      https://beta.waze.com/user/editor*
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      *
// @updateURL    <user fills in>
// @downloadURL  <user fills in>
// ==/UserScript==
```

About `@connect *`: the user passes arbitrary URLs via query param, so the script must be able to fetch from any host. Document this explicitly in the README to manage user expectations on the Tampermonkey install warning.

`header-dev.js`: same metadata but with `@require file://...` for local dev iteration. Mirror `WME-Switzerland-Helper`.

### 1.9 i18n bootstrap

At project bootstrap (Palier 1), set up `i18next` with FR (default) and EN. Keys live in `locales/{en,fr}/common.json`. `locales/i18n.ts` initializes i18next at script startup. Even if a palier has no user-facing strings yet, set up the system properly so adding strings later is a one-line change.

Detection of language: use `wmeSDK.Settings.getLocale()` if available, else fall back to `navigator.language`, else default to French (the user's primary language).

### 1.10 Logging

Single logger module (`src/utils/logger.ts`), prefix `[WME-geojson]`:

```ts
export const logger = {
  info: (msg: string, ...args: unknown[]) => console.info("[WME-geojson]", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn("[WME-geojson]", msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error("[WME-geojson]", msg, ...args),
  debug: (msg: string, ...args: unknown[]) => console.debug("[WME-geojson]", msg, ...args),
};
```

Use throughout the codebase. Internal-only logs are not internationalized. User-facing UI strings always go through i18next.

### 1.11 Hypothesis changelog

This section gets appended to as paliers are implemented. Each entry records an assumption that turned out to be different in reality, so subsequent paliers can plan accordingly.

**Palier 1**

- The SDK's `FeatureStyle` interface (`wme-sdk-typings/index.d.ts:75`) exposes `strokeLinecap` (`"butt" | "round" | "square"`) but **no `strokeLinejoin`**. The PRD §Palier 1 spec asks for "round line join"; the closest the SDK supports is `strokeLinecap: "round"`, which is what `TrackLayer` uses. If true round joins at vertices are needed, it would require dropping into raw OpenLayers, which we are not doing.
- The SDK's `SdkFeatureGeometry` is `Point | LineString | Polygon` — `MultiLineString` is **not** a valid SDK feature geometry. `TrackLayer.draw` therefore decomposes a `MultiLineString` into N individual `LineString` features, suffixing IDs with the sub-line index. This stays internal to `layers/`; downstream paliers continue to manipulate `NormalizedTrack.geometry` as a `MultiLineString`.
- `context7` MCP did not index the official `wme-sdk-typings` package (only a third-party SDK extension). SDK signatures were verified by reading `node_modules/wme-sdk-typings/index.d.ts` directly. Apply the same fallback in future paliers.
- `i18next-parser@9.x` is npm-deprecated in favour of `i18next-cli`. Kept as-is for now; revisit only if it breaks.

**Palier 2**

- The SDK exposes `Map.zoomToExtent({ bbox })` (typings line 4042), not `fitBounds`. It accepts a GeoJSON `BBox` `[minLon, minLat, maxLon, maxLat]` directly, which is exactly what `turf.bbox()` returns — no conversion needed.
- `Sidebar.registerScriptTab()` resolves to `{ tabLabel, tabPane }` as already-mounted `HTMLElement`s. The label element accepts `textContent`; tab labels are short, so no localisation is necessary at this stage.
- The state-machine transition table needed to be more permissive than the obvious `idle → walking → done → idle`: Stop puts the controller in `cancelled`, and the user must be able to retry without reloading. So `cancelled → walking` and `error → walking` were added. Worth keeping in mind for Palier 3 — when the real walk starts, the same retry path applies.

**Palier 3**

- SDK signatures used: `Map.getMapExtent()` returns a `BBox` (line ~4007). `Map.setMapCenter({ lonLat, zoomLevel? })` — `LonLat` is `{ lat, lon }` (note `lon`, not `lng`). `DataModel.Segments.getAll()` returns `Segment[]` with `id: number` and `geometry: LineString`. `State.isMapLoading()` exists and is reliable; `waitForMapIdle` polls it (100ms interval) with a 10s hard timeout that _resolves_ (does not reject) so the walk continues on slow tiles.
- The PRD layout puts `viewportSize.ts` under `src/matching/`, but the live measurement requires the SDK. Split into two files to keep the SDK-free invariant of `matching/` intact: `src/matching/viewportSize.ts` is a pure helper that converts a `BBox` to `{ lonSpan, latSpan }`; `src/utils/measureViewport.ts` does the SDK navigation and delegates. Future paliers should not move SDK code into `matching/`.
- Cell ordering in `GridWalker.planWalk` uses greedy nearest-neighbour from the first track vertex. O(N²) but N < 200 for realistic tracks at z17, so cost is sub-millisecond. Handles doubled-back tracks and disconnected MultiLineStrings naturally.
- Re-runs (clicking Start after Done/Cancelled/Error) clear the controller's `matchedIds` + `geometryCache` and the panel's results list at the `walking` transition, so a second walk does not accumulate stale items.

**Palier 5**

- `Editing.setSelection` is synchronous in the SDK typings and accepts an arbitrary-length `ids: number[]`. Empirically it should still be wrapped in `try/catch` because dense selections may surface internal WME exceptions; the controller throws on failure so the panel can render a per-attempt inline error.
- The 200-segment confirmation threshold lives as `LARGE_SELECTION_THRESHOLD` exported from `src/ui/MatchPanel.ts`. Promotion to a UI-configurable setting is explicitly Palier 6.

**Post-release fix (0.5.1)**

- The Palier 1 assumption "the SDK ignores the third dimension when rendering in 2D" was wrong: `Map.addFeatureToLayer` rejects 3D coordinates with `Only 2D points are supported` (observed live on a SchweizMobil track with elevation). `TrackLayer.draw` now strips the elevation to `[lon, lat]` before the SDK call, while `NormalizedTrack.geometry` still carries the original 3D data for turf consumers.

**Palier 4**

- `wmeSDK.Editing.setSelection` expects `{ selection: { ids: number[], objectType: "segment" } }`. The string literal `"segment"` is the value of `ObjectType.SEGMENT` (typings line 173). The type discriminant `Selection$1` at line 299–326 confirms the exact shape. No import of `ObjectType` is required — passing the string literal directly satisfies TypeScript.
- `wmeSDK.DataModel.Segments.findSegment({ segmentId: number })` is **async** — returns `Promise<Segment>` (typings line 2391–2396). Must be awaited.
- `wme-selection-changed` event payload is `undefined` per `SdkEvents` (typings line 4982). To read the selection after the event fires, use `wmeSDK.Editing.getSelection()` (typings line 3812), **not** `wmeSDK.State.getSelection()` — `State` does not expose `getSelection`. The initial implementation incorrectly called `State.getSelection()` and was caught by the TypeScript compiler during build.
- `wmeSDK.Events.on({ eventName, eventHandler })` returns a cleanup function (`() => void`) — use it directly as the `unsubscribeSelectionChanged` handle; no need for `Events.off`.
- Architecture choice: `focusSegment(id)` was added to `WalkController` rather than implementing the SDK calls inline in the panel. Rationale: it calls `setMapCenter`, `waitForMapIdle`, `setSelection`, and `findSegment` — all SDK-layer concerns that must not live in `ui/` per the repo architecture contract.
- Highlight marker choice: CSS class `wme-geojson-active` only (no text mutation). The `panel.results.active` i18n key is present in the locale files as specified; if a visible text label is ever wanted, a CSS `::after` rule can render it without any JS change.

---

## Part 2 — Paliers

Each palier below is a self-contained brief. Implement them in order. Validate manually after each before starting the next.

---

### Palier 0 — API discovery (DONE)

Outcome: confirmed that `https://schweizmobil.ch/api/6/tracks/{id}` returns a valid `Feature<MultiLineString>` in WGS84, no auth required, with optional 3D coordinates (`[lon, lat, ele]`). This validates the design assumption that the `Loader` can be simple and CRS-conversion-free for SchweizMobil. Logged as the baseline for `validate.ts` heuristics.

---

### Palier 1 — Track loading and display

**Goal.** Detect a `geojson` query parameter, fetch the GeoJSON, validate it, and draw it on the map. No UI, no buttons, no walking. The user must be able to open the example URL and see their track on the map.

#### Functional contract

1. On WME page load, after `wme-ready`:
   - Read `window.location.search` for a `geojson` parameter.
   - If absent → log info, do nothing else.
   - If present → decode, validate as URL, proceed.

2. Fetch the URL via `GM.xmlHttpRequest({ method: "GET", url, responseType: "json", timeout: 30000 })`. Wrap in a Promise. Throw `TrackLoadError` on non-2xx status, network error, or timeout, with a descriptive message including the status and URL host.

3. Validate the response is a GeoJSON `Feature` with `geometry.type` ∈ `{"LineString", "MultiLineString"}`. Reject anything else.

4. **CRS sanity check.** Examine the first coordinate. If `lon ∉ [-180, 180]` or `lat ∉ [-90, 90]`, throw `TrackLoadError` with a message that explicitly mentions "coordinates appear to be in a projected CRS (LV95?) instead of WGS84". This is a critical guard — silent failure here would produce nonsense in every downstream palier.

5. Normalize:
   - `LineString` → wrap in a `MultiLineString` with a single line.
   - `MultiLineString` → pass through.
   - Preserve 3D coordinates (`[lon, lat, ele]`) untouched. Turf and the SDK both ignore the third dimension for 2D operations.
   - Extract `id` from the payload as `trackId` if it's a string or number; else `null`.
   - Extract `properties` as `rawProperties` if it's a non-null object; else omit.

6. Create a custom layer named `wme-geojson-track` and draw the track:
   - Style: stroke 4px, color `#ff00aa` (magenta, distinct from WME's orange), opacity 0.85, round line join.
   - The layer is visible at all zoom levels.
   - Use `track.trackId` as feature ID if available, else generate `"track-${Date.now()}"`.

#### Module contracts

`src/geojson/types.ts`:

```ts
import type { MultiLineString } from "geojson";

export interface NormalizedTrack {
  trackId: string | number | null;
  geometry: MultiLineString;
  rawProperties?: Record<string, unknown>;
}

export class TrackLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrackLoadError";
  }
}
```

`src/geojson/Loader.ts`: exposes `loadTrack(url: string): Promise<NormalizedTrack>`. Internally orchestrates fetch → validate → normalize.

`src/geojson/validate.ts`: pure functions, no side effects. Throws `TrackLoadError` on rejection.

`src/geojson/normalize.ts`: pure functions. Takes a validated GeoJSON Feature, returns a `NormalizedTrack`.

`src/layers/TrackLayer.ts`:

```ts
export class TrackLayer {
  static readonly LAYER_NAME = "wme-geojson-track";
  constructor(private readonly wmeSDK: WmeSDK) {}
  draw(track: NormalizedTrack): void;
  destroy(): void;
}
```

`destroy()` must never throw; wrap in try/catch and log warnings.

`src/utils/queryParams.ts`: `getGeojsonUrlFromLocation(): string | null`. Reads `URLSearchParams`, returns decoded value if present and parseable as URL; else `null` (with `logger.warn` if invalid URL).

`main.user.ts`:

```ts
unsafeWindow.SDK_INITIALIZED.then(initScript);

async function initScript() {
  const wmeSDK = unsafeWindow.getWmeSdk({ scriptId: "wme-geojson", scriptName: "WME GeoJSON" });
  await initI18n(wmeSDK);

  const url = getGeojsonUrlFromLocation();
  if (!url) {
    logger.info("No geojson query param, idle.");
    return;
  }

  await wmeSDK.Events.once({ eventName: "wme-ready" });

  try {
    const track = await loadTrack(url);
    const layer = new TrackLayer(wmeSDK);
    layer.draw(track);
    logger.info(`Track drawn (id=${track.trackId ?? "unknown"})`);
  } catch (err) {
    logger.error("Failed to load and draw track", err);
  }
}
```

#### Tests required (vitest)

`src/__tests__/normalize.test.ts`:

- LineString input → MultiLineString output with one line, coordinates preserved.
- MultiLineString input → passthrough, all sublines preserved.
- 3D coordinates → preserved (third element intact).
- `id: 1764963942` in payload → `trackId === 1764963942`.
- No `id` field → `trackId === null`.

Use a fixture inspired by the real SchweizMobil response (synthetic minimal version is fine).

#### i18n keys (Palier 1)

Bootstrap only. No user-facing strings yet. Place placeholder error keys for future use:

```json
{
  "errors": {
    "fetchFailed": "Failed to fetch GeoJSON track from URL.",
    "invalidGeometry": "GeoJSON has invalid or unsupported geometry type."
  }
}
```

#### Out of scope (do not implement at Palier 1)

- Sidebar panel, buttons, modal dialogs.
- Any walking, panning, or zooming logic.
- Any segment fetching, matching, or selection.
- Persistence (localStorage).
- "Center on track" button.
- Progress display.
- Error UI (errors go to console only).

#### Definition of Done

- [ ] `npm install` succeeds.
- [ ] `npm run build` produces `releases/release-0.1.0.user.js`.
- [ ] `npm test` passes (≥4 normalize tests).
- [ ] `npm run lint` passes.
- [ ] Manually: install the userscript, open `https://beta.waze.com/fr/editor/?env=row&lon=7.1255&lat=46.1258&zoom=8&geojson=https%3A%2F%2Fschweizmobil.ch%2Fapi%2F6%2Ftracks%2F1764963942` — the track is visible (zoom out to Switzerland to see it).
- [ ] Without `geojson` param, the script is silent (no errors, no UI).
- [ ] The `[WME-geojson]` log prefix is visible in the console for lifecycle events.

#### Validation checkpoint (user verifies before Palier 2)

Before declaring Palier 1 done, the user manually verifies:

1. Track displays on the example URL.
2. Custom track URLs (any GeoJSON LineString or MultiLineString in WGS84) work.
3. Invalid URLs / non-WGS84 / non-Feature payloads produce clear console errors with actionable messages.
4. Removing the query param leaves WME unchanged.

---

### Palier 2 — UI panel scaffold

**Goal.** Add a sidebar panel with the controls needed for Paliers 3-5: state display, "Start matching" button, "Stop" button, "Center on track" button, progress display, results list (empty), "Select all" button. Buttons are wired but no-op (or trigger console logs only). No walking or matching logic yet.

#### Functional contract

1. After Palier 1 successfully draws the track, register a sidebar panel via `wmeSDK.Sidebar.registerScriptTab` (verify exact API via context7).

2. Panel content:
   - **Title**: "WME GeoJSON" (i18n key).
   - **Track info**: `Track ID: ${trackId}` and `Length: ${km} km` (computed via `turf.length`).
   - **Status badge**: `Idle | Walking | Done | Cancelled | Error`. Idle initially.
   - **Buttons**:
     - "Center on track" — always enabled when a track is loaded. Computes track bbox, calls `wmeSDK.Map.fitBounds` (or equivalent — verify via context7).
     - "Start matching" — enabled in `Idle` and `Done` states.
     - "Stop" — visible only in `Walking` state.
     - "Select all matched" — disabled (no matches yet).
   - **Progress area**: empty. Will show `X / Y cells visited` in Palier 3.
   - **Results list**: empty. Will populate in Palier 4.

3. Wiring: the sidebar is a "view" of an internal `WalkController` that doesn't exist yet. For Palier 2, create a minimal stub controller in `src/controller/WalkController.ts` exposing:

   ```ts
   export type WalkState = "idle" | "walking" | "done" | "cancelled" | "error";
   export class WalkController {
     state: WalkState = "idle";
     start(): void { logger.info("WalkController.start (stub)"); }
     stop(): void { logger.info("WalkController.stop (stub)"); }
     onStateChange(cb: (s: WalkState) => void): () => void { ... }
   }
   ```

   The stub validates the wiring without yet doing the real work.

4. The "Center on track" button **does work** at Palier 2 — it's pure SDK + turf, no walking involved. Verify the SDK method for centering on a bbox via context7 (likely `Map.setMapCenter` with computed center, or a `fitBounds`-equivalent).

#### Module contracts

`src/controller/walkStates.ts`: `WalkState` type and helpers (state transition validators, `isTransitionAllowed`, etc.).

`src/controller/WalkController.ts`: stub at this palier. Real implementation in Palier 3.

`src/ui/MatchPanel.ts`:

```ts
export class MatchPanel {
  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly controller: WalkController,
    private readonly track: NormalizedTrack,
    private readonly trackLayer: TrackLayer,
  ) {}
  mount(): void;
  unmount(): void;
}
```

DOM-only, no business logic. Listens to `controller.onStateChange` to update its display.

#### i18n keys (Palier 2)

```json
{
  "panel": {
    "title": "WME GeoJSON",
    "trackInfo": {
      "id": "Track ID: {{id}}",
      "length": "Length: {{km}} km"
    },
    "status": {
      "idle": "Idle",
      "walking": "Walking…",
      "done": "Done",
      "cancelled": "Cancelled",
      "error": "Error"
    },
    "buttons": {
      "centerOnTrack": "Center on track",
      "start": "Start matching",
      "stop": "Stop",
      "selectAll": "Select all matched"
    },
    "progress": {
      "empty": "Not started",
      "running": "{{visited}} / {{total}} cells"
    }
  }
}
```

Provide French translations.

#### Out of scope

- Real walking logic (walk the map, fetch segments, match). Only stub controller.
- Real matching results display. Empty list at Palier 2.
- Any segment selection.

#### Definition of Done

- [ ] Sidebar appears on page load when track is present.
- [ ] All buttons render and are wired (with no-op or stub behavior).
- [ ] "Center on track" works for real (uses turf.bbox + SDK fitBounds-equivalent).
- [ ] Status badge reflects stub state changes (manually trigger `start()` from console to verify).
- [ ] No regressions on Palier 1 functionality.
- [ ] `npm test` and `npm run lint` pass.

#### Validation checkpoint

User verifies: panel visible, layout sensible, "Center on track" works, state transitions visible when stub `start()/stop()` are triggered manually from console.

---

### Palier 3 — Walking and matching

**Goal.** Implement the core: compute a grid of viewport cells covering the track, walk the map cell-by-cell, fetch segments at each cell, match them against the track, accumulate the matched IDs. Update the panel progress in real time.

#### Functional contract

1. **`viewportSize.ts`** — measures the viewport size in degrees at zoom 17. Strategy: at the first walk, snapshot `wmeSDK.Map.getMapExtent()` after `setMapCenter` to a known point at z17 and after `wme-map-data-loaded`. Cache the result for the session. The size depends on screen resolution, so it must be measured dynamically rather than hardcoded.

2. **`GridWalker.ts`** — pure module:

   ```ts
   export interface Cell {
     index: number;
     center: { lat: number; lon: number };
     bbox: BBox; // [west, south, east, north]
   }
   export interface PlanWalkArgs {
     track: MultiLineString;
     viewportSizeDeg: { lonSpan: number; latSpan: number };
     bufferMeters: number; // default 15
     overlapRatio: number; // default 0.2 (20% overlap between adjacent cells)
   }
   export function planWalk(args: PlanWalkArgs): Cell[];
   ```

   Algorithm:
   - Compute track bbox via `turf.bbox`.
   - Buffer the track by `bufferMeters` via `turf.buffer`.
   - Generate a grid of cells of size `viewportSizeDeg * (1 - overlapRatio)` covering the bbox.
   - Filter cells whose bbox does not intersect the buffered track (`turf.booleanIntersects`).
   - Order cells by first-intersection-with-track to roughly follow the track's direction (minimizes back-and-forth panning).
   - Return ordered list.

3. **`SegmentMatcher.ts`** — pure module:

   ```ts
   export interface MatchArgs {
     segments: Segment[];
     bufferedTrack: Feature<Polygon | MultiPolygon>;
   }
   export function matchSegments(args: MatchArgs): Set<number>; // segment IDs
   ```

   For each segment, test `turf.booleanIntersects(segment.geometry, bufferedTrack)`. Return matching IDs as a Set (deduplication is implicit).

4. **`WalkController.ts`** — full implementation, replaces Palier 2 stub:
   - State machine: `idle → walking → (done | cancelled | error)`. Transitions are explicit; invalid transitions throw.
   - On `start()`:
     1. Lock state to `walking`.
     2. Measure viewport size (cached).
     3. Plan walk via `GridWalker.planWalk`.
     4. For each cell:
        - Check `aborted` flag; if true, transition to `cancelled` and return.
        - `wmeSDK.Map.setMapCenter({ lonLat: cell.center, zoomLevel: 17 })`.
        - `await waitForMapIdle(...)` (port from Switzerland-Helper).
        - `const segments = wmeSDK.DataModel.Segments.getAll()`.
        - `const newIds = matchSegments({ segments, bufferedTrack })`.
        - For each new ID, cache the segment's geometry (for Palier 4 click-to-recenter).
        - Add new IDs to the global Set.
        - Emit progress event (`onProgress(visited, total, newIds[])`).
        - `await new Promise(r => setTimeout(r, 50))` to yield to the UI thread.
     5. Transition to `done`.
   - On `stop()`: set `aborted = true`. The walk loop will catch this between cells.
   - On error in any cell: log, skip, continue. Errors throw only if catastrophic (e.g. SDK crash). Final state is `done` with logged warnings, not `error`, unless catastrophic.

5. **`MatchPanel`** updates:
   - Subscribe to `controller.onProgress` and update progress text live.
   - Subscribe to `controller.onMatchFound` and append matched IDs to the results list.
   - Each list item: "Segment {id}" — clickable button (clicking does nothing yet at Palier 3; Palier 4 wires it).
   - Status badge updates with state transitions.
   - "Stop" button visible during walk; clicking calls `controller.stop()`.

6. **Cancellation guarantees**:
   - `stop()` aborts at the next cell boundary. The current cell's `setMapCenter` and `waitForMapIdle` may complete before abort takes effect. This is acceptable.
   - User leaving the page during a walk: the script does not fight it. The walk silently dies. Don't try to persist state at this palier.

#### Module contracts (additions)

`src/matching/types.ts`: shared types (`Cell`, `MatchArgs`, etc.).

`src/utils/waitForMapIdle.ts`: port from Switzerland-Helper. Polls `wmeSDK.State.isMapLoading()` with a fallback timeout. Should also wait briefly after loading completes to let `wme-map-data-loaded` propagate.

`src/controller/WalkController.ts` real implementation. Define event API:

```ts
onProgress(cb: (visited: number, total: number, newIds: number[]) => void): () => void;
onMatchFound(cb: (id: number, geometry: LineString) => void): () => void;
onStateChange(cb: (state: WalkState) => void): () => void;
```

#### Tests required

`src/__tests__/GridWalker.test.ts`:

- Simple horizontal LineString (1 km) → cells cover only along the line.
- LineString that doubles back → cells deduplicated, no duplicate visits.
- MultiLineString with 2 disconnected sublines → cells cover both, none in between.
- Bbox of cells, when unioned, contains the buffered track.

`src/__tests__/SegmentMatcher.test.ts`:

- Segment fully inside buffer → matched.
- Segment fully outside buffer → not matched.
- Segment crossing the buffer at one point → matched.
- Multiple segments with mixed in/out → only matching IDs returned.

#### i18n keys (Palier 3 additions)

```json
{
  "panel": {
    "results": {
      "empty": "No matches yet.",
      "count": "{{count}} segment(s) matched",
      "item": "Segment {{id}}"
    }
  }
}
```

#### Out of scope

- Click-to-recenter on a segment (Palier 4).
- "Select all" button functionality (Palier 5).
- Configurable buffer / tolerance (Palier 6 if needed).
- Auto-pause if user moves the map manually (Palier 6).
- Persistence of partial results (Palier 6).

#### Definition of Done

- [ ] Click "Start matching" → carte se déplace, cellule par cellule.
- [ ] Progress updates live in the panel.
- [ ] "Stop" works between cells (within the current cell's duration).
- [ ] Results list populates with segment IDs as they're found.
- [ ] On a real SchweizMobil track (5-10 km), the walk completes and produces a reasonable list of matched segments (manual visual verification: the matched segments cover the track).
- [ ] No regressions on Paliers 1-2.
- [ ] `npm test` passes, including new `GridWalker` and `SegmentMatcher` tests.

#### Validation checkpoint

User verifies on at least 2 real tracks: short urban track (~2 km) and longer rural track (~10 km). Spot-check that matched segments visually align with the drawn track. Note any false positives (parallel roads attracted by the buffer) or false negatives (gaps).

---

### Palier 4 — Clickable results

**Goal.** Make the results list interactive: clicking a segment ID centers the map on that segment and selects it in WME.

#### Functional contract

1. Each result list item becomes a button:
   - Click handler:
     1. Look up cached geometry for the ID (cached during the walk).
     2. Compute the segment's center: `turf.center` on the geometry.
     3. `wmeSDK.Map.setMapCenter({ lonLat: center, zoomLevel: 17 })`.
     4. `await waitForMapIdle(...)`.
     5. `wmeSDK.Editing.setSelection({ selection: { ids: [id], objectType: "segment" } })`.
   - If the segment is no longer in the data model (cache miss in current viewport): try `wmeSDK.DataModel.Segments.findSegment({ segmentId: id })` (which fetches from external sources). If still fails, log a warning and show a brief inline error in the list item ("Segment unavailable").

2. Visual feedback: the currently-selected segment in the list is highlighted (CSS class). Listen to `wme-selection-changed` events to keep highlight in sync.

3. The geometry cache (introduced in Palier 3) is used here. If for some reason the cache wasn't populated (e.g. user pasted IDs externally — not supported but defensive), fall back to `findSegment`.

#### Module contracts (additions)

`MatchPanel`:

- Add `onItemClick(id: number)` handler.
- Subscribe to `wme-selection-changed` to highlight active item.

`WalkController`:

- Expose `getCachedGeometry(id: number): LineString | null`.

#### Tests required

No new pure-logic tests. The click logic is SDK-coupled; manual validation only.

#### i18n keys (Palier 4 additions)

```json
{
  "panel": {
    "results": {
      "unavailable": "Segment unavailable",
      "active": "(active)"
    }
  }
}
```

#### Out of scope

- Multi-select via shift-click in the list (Palier 6 if requested).
- "Select all" (Palier 5).

#### Definition of Done

- [ ] Click on a list item → map recenters and segment is selected in WME.
- [ ] Selected segment is visually marked in the list.
- [ ] Out-of-viewport segments work via `findSegment` fallback.
- [ ] No regressions.
- [ ] `npm test` passes.

#### Validation checkpoint

User clicks several items in the list, verifies recenter + selection work end-to-end on real tracks.

---

### Palier 5 — Select all

**Goal.** Add the "Select all matched" button, with a safety confirmation for large selections.

#### Functional contract

1. The "Select all matched" button is enabled when results count > 0.

2. Click handler:
   - If count > 200, show a modal: "You are about to select {count} segments. Large selections may be slow or fail. Continue?" with Confirm/Cancel buttons.
   - On confirm (or count ≤ 200): `wmeSDK.Editing.setSelection({ selection: { ids: allMatchedIds, objectType: "segment" } })`.
   - Wrap in try/catch; on failure, log error and show an inline error in the panel ("Selection failed: {{error}}"), but keep the list intact so the user can still click items individually.

3. The 200 threshold is configurable in code (constant), not exposed in UI. If the user repeatedly hits the threshold, we'll consider exposing it in Palier 6.

#### Module contracts

No new modules. Update `MatchPanel` and `WalkController` (if needed for state).

#### Tests required

None new. SDK-coupled, manually validated.

#### i18n keys

```json
{
  "panel": {
    "buttons": {
      "selectAllConfirm": "Select all"
    },
    "modal": {
      "largeSelectionWarning": "You are about to select {{count}} segments. Large selections may be slow or fail. Continue?"
    },
    "errors": {
      "selectionFailed": "Selection failed: {{error}}"
    }
  }
}
```

#### Out of scope

- Configurable threshold in UI.
- Bulk operations on the selection (e.g. apply road type to all matched). The user uses standard WME UI for that.

#### Definition of Done

- [ ] Button enabled when ≥1 match.
- [ ] ≤200 segments: instant selection, no modal.
- [ ] > 200 segments: modal warning, confirm proceeds, cancel does nothing.
- [ ] Selection failures are caught and displayed without breaking the panel.
- [ ] `npm test` passes.
- [ ] Manual validation on a real track with >50 matched segments.

---

### Palier 6 — Production hardening (optional, on demand)

**Goal.** Polish for daily use. Implement only items the user explicitly requests after using the script in real conditions.

Candidate features (each is independently scoped — implement à la carte):

#### 6.1 Persistence and resume

- Cache the matched IDs in `localStorage` keyed by hash of the GeoJSON URL.
- On script load, if a cached result exists for the URL, offer to restore it ("Found previous results from {{date}}. Restore?").
- Useful when the user closes and reopens the page mid-edit.

#### 6.2 Auto-pause on manual map movement

- Distinguish programmatic `setMapCenter` calls from user-initiated `wme-map-move-end`.
- During a walk, if the user manually moves the map, pause the walk and show a "Resume" button.
- Avoids fighting the user.

#### 6.3 Configurable buffer tolerance

- Add a number input to the panel: "Match tolerance (m)" with default 15, range 5–50.
- Re-running matching with a different tolerance is allowed (clears previous results).

#### 6.4 Directional matching

- Optional checkbox "Match direction-aware".
- When enabled, in addition to spatial intersection, compute the bearing of the segment vs the bearing of the closest track section. Reject segments whose bearing differs by more than a threshold (e.g. 30°).
- Reduces false positives on parallel roads / contre-allées.

#### 6.5 Segment metadata in list

- Resolve `primaryStreetID → Streets.getById(streetId).name` for each matched segment.
- List items show "Segment {id} — {streetName}" instead of just the ID.

#### 6.6 Length filter

- Optional minimum segment length filter (default 0). Useful to ignore tiny stub segments at intersections.

#### Out of scope (forever, unless reopened)

- Strict map-matching (HMM). Use a real map-matching service if needed.
- Editing operations (apply road type, lock, etc.). Use standard WME UI.
- Multiple tracks at once.
- Server-side persistence or sync.

---

## Part 3 — Project-wide acceptance criteria

The full project is "shipped 1.0" when:

- [ ] All paliers 1-5 complete and validated.
- [ ] README.md (English) and README.fr.md exist with: install instructions, usage, Tampermonkey notes (especially `@connect *` warning), example URL, troubleshooting.
- [ ] Tampermonkey-installable from a public release URL (GitHub raw or Greasy Fork).
- [ ] No console errors on normal usage.
- [ ] Code passes `npm run lint` and `npm test`.
- [ ] Cognitive load principles from `CLAUDE.md` are visibly respected throughout.

## Part 4 — Working agreement with the implementing agent

- **Ask before guessing.** Any deviation from this PRD or `CLAUDE.md`, surface it as a question.
- **Implement one palier at a time.** Do not start Palier N+1 until the user confirms Palier N is validated.
- **Update the hypothesis changelog** at the end of each palier with anything the implementation revealed (different SDK signature, unexpected behavior, etc.).
- **Verify SDK calls via context7 MCP.** No exceptions.
- **Mirror `WME-Switzerland-Helper`** for any convention not specified here.
- **Write self-contained commits.** Each palier should be a clean diff a reviewer can read in one sitting.
