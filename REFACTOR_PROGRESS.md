# Refactor progress — CSV-driven closures pipeline

> **Audience.** This file is the single source of truth for the in-flight
> refactor that turns this script into a CSV-driven closure-generation
> pipeline. It is committed at every milestone so any AI (or human) can
> resume work after a context-window flush, a session change, or an
> unscheduled stop.
>
> Read this file *first*. Then read [HANDOFF.md](HANDOFF.md) for the
> repo's permanent state, [claude.md](claude.md) / [agents.md](agents.md)
> for conventions, and the full plan at
> `~/.claude/plans/hey-alors-copilot-a-enchanted-sonnet.md` (only on the
> machine that ran the planning session — the relevant content is also
> embedded below).

**Target version:** `0.10.0` (current released: `0.9.0`).

---

## 1. Goal in 5 lines

The script currently loads a GeoJSON track and lets the user trigger
per-view segment matching. We are turning it into a **CSV-driven
pipeline**: import a schedule CSV (distance/start_time/end_time/date),
walk every distance cell with auto-matching + user validation, persist
matched segment IDs back into the CSV, and finally export an **advanced
closures CSV** importable in the WME Advanced Closures script.
Overlapping closures on the same segment are deduplicated by emitting a
dedicated row per merged time range.

## 2. Frozen user decisions (do not re-litigate)

| Decision | Choice |
|---|---|
| UI style | Native Waze Web Components (`wz-button`, `wz-text-input`, …) |
| Enriched-input CSV | Downloadable at any time during the session, plus the final closures CSV |
| Persistence | `localStorage`, scoped per `(geojsonUrl, csvFingerprint)`; reset on track/CSV change |
| Resume after reload | Auto-resume at the last unvalidated row; "restart from scratch" button always available |
| Direction | `TWO WAY` hard-coded |
| Final prompts | Only `Reason`, `Ignore traffic`, `MTE ID`, `Comment` are prompted (globally applied). Per-row `lon/lat`, `zoom`, `start_date`, `end_date`, `segments` are derived |
| Track tab return | After every `Editing.setSelection`, the userscript tab must be re-activated (default WME side-effect opens the edit panel) |

## 3. Architecture invariants

Same as `HANDOFF.md` §2:

- `src/matching/` and `src/geojson/` are **pure** (no SDK, no DOM).
- All UI strings go through `i18next.t(...)` in both EN and FR.
- No `any`, named constants, early returns, "why" comments only.
- Always run `npx tsc --noEmit` before commit (`npm run build` is
  tolerant of TS errors).

## 4. Lot status board

| Lot | Status | Commits | Files | Notes |
|---|---|---|---|---|
| **0 — bootstrap** | DONE | `2bf442b`, `5f7bddf`, `4eca4eb`, *this commit* | WKT util, matching WIP, AI docs, `.mcp.json` ignored, `REFACTOR_PROGRESS.md` | Clean tree. Old `releases/*.user.js` were prettier-mangled and restored from HEAD per `HANDOFF.md` §5. |
| **1 — store + CSV foundations** | DONE | `d57f811` | `src/state/SessionStore.ts`, `src/csv/parseSchedule.ts`, `src/csv/serializeSchedule.ts`, `src/persistence/sessionStorage.ts` + 3 test files | 78 tests green, tsc clean, boundary check passes (no SDK/DOM imports in `src/state/` or `src/csv/`). FNV-1a hashing for localStorage keys. **Note for Lot 3:** `validateRow` does NOT advance `currentIndex` when called with `index !== currentIndex` — re-validation of an earlier row is allowed but pushes duplicate `ClosureRange` entries. If the UI lets the user re-validate, dedup must happen in Lot 4 or be guarded in the caller. |
| **2 — UI refactor (Waze WC)** | IN PROGRESS | — | `src/ui/MatchPanel.ts` (rewrite), `src/ui/components/wz.ts` (new), `src/layers/TrackLayer.ts`, `main.user.ts`, `src/bootstrap/loadAndAttachTrack.ts` (new), locale keys | Delegated to Sonnet agent with prompt A.2. |
| **3 — guided pipeline** | TODO | — | `src/controller/MatchingPipeline.ts`, `src/ui/tabSwitch.ts`, `src/ui/MatchPanel.ts` (guided sub-panel), `src/controller/WalkController.ts` (helpers) | Depends on Lots 1 + 2. |
| **4 — closures CSV builder** | DONE | `fe6663c` | `src/csv/buildClosuresCsv.ts`, `src/csv/__tests__/buildClosuresCsv.test.ts` (20 tests), `src/ui/promptFinalFields.ts`, locale keys under `panel.finalFields` (EN+FR) | 98 tests green, tsc clean. **Implementation note:** for merged-range rows, `RowGeo` is taken from the earliest contributing row (`mergedRange.rowIndex` = first by `startISO`). Touching boundaries (end(A) == start(B)) explicitly do NOT merge. `promptFinalFields` is implemented but not yet wired into MatchPanel — Lot 3 does that. |
| **5 — persistence + resume wiring** | TODO | — | `src/state/SessionStore.ts` (mutation hooks), `src/ui/MatchPanel.ts` (resume banner) | Depends on Lots 1 + 2 + 3. |
| **6 — polish + release** | TODO | — | `package.json` bump, `releases/release-0.10.0.user.js`, `README.md`, `HANDOFF.md` | Manual smoke E2E, version bump, regenerate release. |

Status legend: `TODO` (not started), `IN PROGRESS` (active), `BLOCKED`
(see Blockers section), `DONE`.

## 5. Next action

**Start Lot 2 (UI refactor with Waze Web Components).** Foundations
(Lots 1, 4) are merged. The PO must first draft prompt A.2 in the
annex below — this is a UI-heavy lot, the prompt needs concrete
references to (a) the existing `MatchPanel.ts` widgets to remove vs
keep, (b) the phase-based show/hide logic driven by
`SessionStore.phase`, (c) the Waze Web Component element names
(`<wz-button>`, `<wz-text-input>`, etc.) and a fallback registry
check. Skim `src/ui/MatchPanel.ts` and the existing range-slider
code before writing the prompt.

After the prompt is drafted, flip Lot 2 to `IN PROGRESS`, commit
`chore(progress): start Lot 2`, delegate to a Sonnet sub-agent.

## 6. Blockers / open questions

*(none currently)*

## 7. Execution order

```
Lot 0 (DONE)
  → Lot 1 (foundations, blocking)
    → Lot 4 (parallel with Lot 2, depends only on Lot 1 types)
    → Lot 2 (UI refactor)
       → Lot 3 (guided pipeline, needs 1+2)
         → Lot 5 (persistence wiring, needs 1+2+3)
           → Lot 6 (polish, release)
```

---

## Annex A — Agent prompts (copy-paste-ready)

Each prompt is self-contained: it briefs a fresh Sonnet agent on
context, scope, files, and acceptance criteria. Do **not** add
phrases like "based on your findings, fix the bug". The PO (the
delegating model) decides what to merge.

### A.1 — Lot 1: SessionStore + CSV foundations

```
You are working on the wme-geojson Tampermonkey userscript at
/workspaces/wme-geojson. It is a TypeScript project bundled with
Rollup, tested with vitest. Read REFACTOR_PROGRESS.md, HANDOFF.md,
and claude.md before starting — they define the architecture and
conventions you must respect (notably: no SDK or DOM imports in
src/state/, src/csv/, src/persistence/; strict TS; no any; i18next
for UI strings; named constants; "why" comments only).

Your task is Lot 1 of the refactor: deliver pure foundations.

Create the following files:

1. src/state/SessionStore.ts — small observable store, EventEmitter
   style (mirror the pattern used in src/controller/WalkController.ts
   for emitters). Export:

     export type SessionPhase =
       | "no-track" | "track-loaded" | "csv-loaded" | "matching" | "done"
     export interface CsvRow {
       distance: number          // km
       startTime: string         // "HH:MM"
       endTime: string           // "HH:MM"
       date: string              // "YYYY-MM-DD"
       segments: number[] | null // null = not yet validated
     }
     export interface ClosureRange {
       startISO: string          // "YYYY-MM-DDTHH:MM"
       endISO: string
       rowIndex: number
     }
     export interface SessionState {
       phase: SessionPhase
       geojsonUrl: string | null
       trackLengthKm: number | null
       csvRows: CsvRow[]
       currentIndex: number
       closuresBySegment: Record<number, ClosureRange[]>
     }
     export class SessionStore {
       getState(): Readonly<SessionState>
       subscribe(fn: (s: SessionState) => void): () => void  // returns unsubscribe
       setPhase(p: SessionPhase): void
       setTrack(url: string, lengthKm: number): void
       setCsvRows(rows: CsvRow[]): void
       validateRow(index: number, segments: number[], startISO: string, endISO: string): void
       reset(): void
     }

   `validateRow` must (a) write segments into csvRows[index],
   (b) advance currentIndex if index === currentIndex,
   (c) push a ClosureRange into closuresBySegment for every segment.

2. src/csv/parseSchedule.ts — `parseSchedule(text: string): CsvRow[]`.
   Header line is `distance,start_time,end_time,date,segments`.
   Tolerate leading whitespace, BOM, trailing empty lines, and
   `segments` column being missing or containing `id1;id2;id3`.
   Throw a clear Error if header is wrong or distance is non-numeric.

3. src/csv/serializeSchedule.ts — `serializeSchedule(rows: CsvRow[]): string`
   inverse of parseSchedule. `null` segments serialize as empty,
   non-null serialize as `id1;id2;...` joined by `;`. Round-trips
   parseSchedule output exactly (including column order and
   trailing newline handling).

4. src/persistence/sessionStorage.ts — wraps `window.localStorage`
   (use `globalThis.localStorage` so it tree-shakes in node tests).
   Key: `wmegj:session:${sha1Short(geojsonUrl)}:${sha1Short(csvFingerprint)}`
   where `csvFingerprint` is a simple hash of the original CSV text.
   Export `save(state: SessionState, csvText: string)`,
   `load(geojsonUrl, csvText): SessionState | null`,
   `clearForCurrent(geojsonUrl, csvText)`, `clearAll()`. Use a
   tiny non-crypto hash (FNV-1a or similar) — do NOT pull a crypto
   dep. JSON-serialize the SessionState.

Write tests in src/__tests__/:
- parseSchedule.test.ts — parses the 99-line example CSV embedded
  below; checks row count, first/last row values, segments null.
  Also tests: a row with `segments=201;202`, malformed header, empty
  body. Sample first lines:
    distance,start_time,end_time,date,segments
    0.0,13:00,13:50,2026-04-29,
    1.9,13:02,13:52,2026-04-29,
- serializeSchedule.test.ts — round-trip parse → mutate → serialize
  → re-parse equals mutation.
- sessionStorage.test.ts — uses a polyfilled localStorage
  (vitest provides `vi.stubGlobal('localStorage', ...)`); save then
  load returns equal state; different csvText → different key;
  clearForCurrent removes only the current key.

Acceptance:
- `npm test` green (existing tests must still pass).
- `npx tsc --noEmit` clean.
- No imports of `wme-sdk-typings`, `window.*`, or `document.*` in
  `src/state/`, `src/csv/` (localStorage in src/persistence/ is OK
  — it's the persistence boundary).
- No `any`. Use `unknown` + narrowing if needed.

When done, do NOT update REFACTOR_PROGRESS.md yourself — the PO
will. Reply with: list of files created, test results, any
deviations from the spec and why.
```

### A.2 — Lot 2: UI refresh (Waze Web Components)

```
You are working on the wme-geojson Tampermonkey userscript at
/workspaces/wme-geojson. TypeScript, Rollup, vitest.

Your task is **Lot 2** of the in-flight refactor: rewire the script's
sidebar tab to a clean, phase-driven UI built with Waze's native Web
Components, and switch the bootstrap so the panel mounts even when no
GeoJSON URL is present in the query string.

**Required reading before writing code:**
1. /workspaces/wme-geojson/REFACTOR_PROGRESS.md — sections 2 (frozen
   decisions), 3 (architecture), Annex A.2 (this prompt). Read 4
   (Lot status board) to understand what is already merged.
2. /workspaces/wme-geojson/HANDOFF.md — SDK quirks (especially §3
   "no Map.fitBounds, use Map.zoomToExtent", labels-per-feature,
   wme-selection-changed has no payload) and §5 release-file warning
   (NEVER commit reformatted releases/*.user.js — restore from HEAD).
3. /workspaces/wme-geojson/claude.md — conventions.
4. /workspaces/wme-geojson/main.user.ts — current bootstrap, must be
   adjusted (see scope below).
5. /workspaces/wme-geojson/src/ui/MatchPanel.ts — current panel
   (1169 lines). Identify what to keep vs strip per the deliverables
   below.
6. /workspaces/wme-geojson/src/state/SessionStore.ts — Lot 1 store.
   The new panel is DRIVEN BY THIS STORE.
7. /workspaces/wme-geojson/src/csv/parseSchedule.ts — Lot 1 parser.
   Use it for the CSV upload.
8. /workspaces/wme-geojson/src/csv/serializeSchedule.ts — Lot 1
   serializer. Use it for the "download enriched input CSV" button.
9. /workspaces/wme-geojson/src/csv/buildClosuresCsv.ts — Lot 4.
   Use it for the "download closures CSV" button (final action, not
   prompted yet — see scope: "deferred to Lot 3").
10. /workspaces/wme-geojson/src/layers/TrackLayer.ts — has
    `setVisibleDistances(keys: string[])`. Default behaviour must
    change to "no labels until CSV loaded" — see scope.

**Deliverables:**

### 2.1 — `src/ui/components/wz.ts` (new)

Typed factories for Waze Web Components, used at WME runtime. The
typings package does NOT export them; they are registered by the WME
host page itself. Export:

```ts
export interface WzButtonProps {
  text: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}
export function wzButton(props: WzButtonProps): HTMLElement;

export interface WzTextInputProps {
  label?: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "url";
  disabled?: boolean;
  onInput?: (value: string) => void;
}
export function wzTextInput(props: WzTextInputProps): HTMLElement;

// Returns the file <input> element (we keep it raw — wz-file-input
// is not consistently available across WME builds). Style it via a
// CSS class `wmegj-file-input` defined in the panel's <style> block.
export interface FileInputProps {
  accept: string;
  onFile?: (file: File) => void;
}
export function fileInput(props: FileInputProps): HTMLInputElement;
```

Implementation: each factory uses
`document.createElement("wz-button")` etc., sets attributes for
declarative props (`text`, `variant`, `disabled`), and listens to
the corresponding events. If `customElements.get("wz-button")` is
undefined at call time, fall back to a plain `<button>` styled to
look acceptable — log a `console.warn` once per missing tag with a
named guard so we don't spam the console. The fallback keeps the
script usable in development environments without WME runtime.

No tests for this module — it's pure DOM glue.

### 2.2 — Rewrite `src/ui/MatchPanel.ts`

Remove everything that the new flow does not need:
- `Center on track` button.
- The full distance-filter section (textarea + Compute views + bbox
  list of buttons) — `buildDistanceFilter`, the `bbox*` private
  fields, `runBboxProcess`, related parsers and helpers. **The
  `WalkController.matchInCurrentViewport` API is preserved**;
  Lot 3 will call it from the new pipeline.
- `Select all matched`, `Copy selected geometry` buttons,
  `onSelectAllClick`, `onExportSelectionClick`, the results list and
  `appendResultItem`. The matched-segment results list is no longer
  shown in the tab.
- Anything that depends on those (selection-changed subscription
  used solely to highlight the active result item, etc.).

Keep:
- The state badge driven by `WalkController.onStateChange`.
- `buildRangeSlider()` — the dual-handle min/max km range slider.
  This is a great visual filter and the user wants it kept.

Add (the new layout, top-to-bottom, in order):

1. **Row: GeoJSON URL input + Load button.** Field is a
   `wz-text-input type="url"` with the current URL pre-filled if
   `?geojson=...` is set. On Load: kicks off the same load path the
   current `main.user.ts` uses (call a new exported async function
   `loadAndAttachTrack(url, wmeSDK, store, layerHolder, controller)` —
   factor it out). Persist the URL in the editor URL via
   `history.replaceState` so it survives reload.
2. **Row: track length** (in km, 2 decimals). Hidden until
   `store.phase >= track-loaded`.
3. **Row: range slider** (existing `buildRangeSlider` output).
   Hidden until track loaded.
4. **Row: CSV upload** (file input, accept `.csv`). Hidden until
   track loaded. On file: read text, call `parseSchedule`, push to
   store via `store.setCsvRows(rows)` and `store.setPhase("csv-loaded")`.
   Also call `trackLayer.setVisibleDistances(distancesKeysFromCsv(rows))`.
5. **Row: Start matching** button — visible when phase >= csv-loaded.
   For Lot 2 it is a STUB that calls `store.setPhase("matching")`
   and logs a warning `"matching pipeline not wired yet — Lot 3"`.
   Lot 3 will replace the click handler.
6. **Row: download buttons** — visible when phase >= csv-loaded:
   - "Download enriched input CSV": calls `serializeSchedule` on
     the current `store.getState().csvRows` and triggers a Blob
     download named `schedule-enriched.csv`.
   - "Download closures CSV": for Lot 2 it is a STUB that just
     produces an empty-body file with the header line (call
     `buildClosuresCsv([], [], {}, dummyFields)`); Lot 3 wires the
     real prompt + final fields.
7. **Row: Resume banner** — visible only if a saved session was
   detected for the current `(geojsonUrl, csvText)` pair (Lot 5
   handles the actual detection; for Lot 2 leave a placeholder
   private method `maybeShowResumeBanner()` that no-ops, with a
   TODO comment pointing to Lot 5).

Phase-driven visibility: write a single `private renderPhase()`
method that toggles `display` on each row container based on
`this.store.getState().phase`. Subscribe to `store.subscribe(...)`
and call `renderPhase` whenever the state changes.

Locale keys to add to BOTH `locales/en/common.json` and
`locales/fr/common.json` (under existing `panel` namespace where it
fits, otherwise create sub-namespaces):
- `panel.urlInput.label`, `panel.urlInput.placeholder`,
  `panel.urlInput.load`
- `panel.trackLength` (e.g. `"Track length: {{km}} km"`)
- `panel.csvInput.label`
- `panel.startMatching`
- `panel.downloadEnriched`, `panel.downloadClosures`
- `panel.resumeDetected`, `panel.startFresh`
Provide reasonable French and English values.

The new MatchPanel constructor signature:
```ts
new MatchPanel(
  wmeSDK: WmeSDK,
  store: SessionStore,
  controller: WalkController | null,   // null until track loaded
  trackLayer: TrackLayer | null,       // null until track loaded
)
```

Both `controller` and `trackLayer` can be `null` while no track is
loaded. Provide setters so `loadAndAttachTrack` can attach them
later: `setController(c)`, `setTrackLayer(layer)`. The badge wiring
(`controller.onStateChange`) attaches lazily when `setController` is
called.

### 2.3 — `src/layers/TrackLayer.ts`

Change the default initial behaviour: until `setVisibleDistances` is
called with a non-empty array, **render no distance labels**.
Concretely: replace any existing logic that defaults to "show all
labels" with "labels hidden by default". Write a one-line "why"
comment referencing this lot.

Existing tests must still pass — if a test relies on the old default,
update it to call `setVisibleDistances` explicitly.

### 2.4 — `main.user.ts`

Change the bootstrap so the panel ALWAYS mounts after `wme-ready`,
regardless of whether `?geojson=...` is present:

```ts
const store = new SessionStore();
const panel = new MatchPanel(wmeSDK, store, null, null);
await panel.mount();

const url = getGeojsonUrlFromLocation();
if (url) {
  await loadAndAttachTrack(url, wmeSDK, store, panel);
}
```

`loadAndAttachTrack` lives in a new file
`src/bootstrap/loadAndAttachTrack.ts` and is exported so the
"Load URL" button in the panel can re-use it.

Inside loadAndAttachTrack:
1. `loadTrack(url)` (existing).
2. Build TrackLayer, draw track.
3. Build WalkController.
4. Compute total km and `store.setTrack(url, totalKm)`.
5. `store.setPhase("track-loaded")`.
6. Call `panel.setController(controller)` and
   `panel.setTrackLayer(layer)`.

If `loadTrack` throws, surface a user-visible error in the URL row
(red border + small message) without throwing further.

### 2.5 — Architecture & quality

- No `any`. Web Component elements are typed `HTMLElement`; access
  custom props via `(el as unknown as { foo: T }).foo = ...` only
  when strictly required and add a one-line "why" comment.
- All UI strings via `i18next.t(...)`. Both EN and FR populated.
- No `innerHTML` with user-provided data (per existing comment in
  current MatchPanel).
- "Why" comments only.
- Existing tests must still pass; if a TrackLayer test requires
  adjustment for the new default, update it minimally.

### 2.6 — Validation commands (must be clean before reporting done)

```
npm test
npx tsc --noEmit
npm run build
```

After build, verify `releases/release-0.9.0.user.js` is unchanged on
disk (run `git status` — if it appears modified, `git checkout HEAD
-- releases/` to restore). Do NOT commit any release file change.

**Do NOT:**
- Update REFACTOR_PROGRESS.md (PO does that).
- Commit (PO does that).
- Wire the real Start-matching pipeline (Lot 3).
- Wire promptFinalFields into the closures download (Lot 3).
- Wire localStorage resume detection (Lot 5).

**Report back with:**
- Files created / files materially modified (one line each).
- Locale keys added.
- Test summary (`Tests N passed (N)`) and tsc output (must be empty).
- Confirmation that `releases/` was untouched after build.
- Any deviation and the reason.

Keep the report under 350 words.
```

### A.3 — Lot 3: guided matching pipeline

*(to be added before launching this lot)*

### A.4 — Lot 4: closures CSV builder

```
You are working on the wme-geojson Tampermonkey userscript at
/workspaces/wme-geojson. TypeScript, Rollup, vitest.

**Required reading before writing code:**
1. /workspaces/wme-geojson/REFACTOR_PROGRESS.md — overall refactor
   context. Your task is Lot 4 (this prompt is A.4 in the annex).
   Read sections 2 (frozen decisions), 3 (architecture), and Annex
   D (overlap dedup spec) carefully. Annex C has the target CSV
   format.
2. /workspaces/wme-geojson/claude.md — coding conventions you MUST
   follow (no `any`, named constants, "why" comments only, strict
   TS, i18next for UI strings).
3. /workspaces/wme-geojson/src/state/SessionStore.ts — already
   merged in Lot 1. Re-use these exact types: `CsvRow`,
   `ClosureRange`, `SessionState`. DO NOT redefine them.
4. /workspaces/wme-geojson/src/csv/parseSchedule.ts and
   serializeSchedule.ts — for code style reference.

**Deliverables:**

1. `src/csv/buildClosuresCsv.ts` — pure module, no SDK, no DOM. Exports:

   ```ts
   export interface FinalFields {
     reason: string;          // e.g. "Tour de Romandie 2026"
     ignoreTraffic: boolean;  // serialized as "Yes" | "No"
     mteId: string;           // optional, "" if absent
     comment: string;         // optional, "" if absent
   }
   export interface RowGeo {
     // Per-CsvRow geometry context, captured during matching (Lot 3).
     // Indexed in the same order as SessionState.csvRows.
     lon: number;
     lat: number;
     zoom: number; // integer, WME zoom level used for the bbox view
   }
   export function buildClosuresCsv(
     rows: readonly CsvRow[],
     rowGeos: readonly RowGeo[],
     closuresBySegment: Readonly<Record<number, ClosureRange[]>>,
     finalFields: FinalFields,
   ): string;
   ```

   Algorithm — implement Annex D of REFACTOR_PROGRESS.md exactly:
   - For each segment in `closuresBySegment`:
     - Sort its ranges by `startISO`.
     - Compute the merged ranges (any two with overlapping
       [startISO, endISO] intervals collapse into one with
       start = min, end = max). Two adjacent intervals that touch
       at a boundary (end of A == start of B) are NOT considered
       overlapping (treat as separate).
     - If the merged set has the SAME shape as the original (no
       merges happened), the segment stays in its original
       `csvRows` rows.
     - Otherwise (at least one merge): the segment must be removed
       from every original row it appeared in, and one new row is
       emitted PER merged range, with that single segment, using
       start = merged start, end = merged end. lon/lat/zoom for
       merged-range rows: pick the rowGeo of any contributing row
       (e.g. the first by rowIndex) — document this choice in a
       brief "why" comment.
   - For each row that retains at least one segment after dedup,
     emit one CSV line.
   - Empty-segment rows (all segments stripped) are skipped.
   - Output ordering: original rows first (in their original order,
     skipping emptied ones), then merged-range rows ordered by
     (segmentId, mergedStart). Stable and deterministic.

   CSV header (exact text — do not modify, the Advanced Closures
   script parses by header):
   ```
   header,reason,start date (yyyy-mm-dd hh:mm),end date (yyyy-mm-dd hh:mm),direction (A to B|B to A|TWO WAY),ignore trafic (Yes|No),segment IDs (id1;id2;...),lon/lat (like in a permalink: lon=xxx&lat=yyy),zoom (2 to 10),MTE ID,comment (optional)
   ```

   Each data row:
   - column 0: literal `add`
   - column 1: `finalFields.reason`
   - column 2-3: `YYYY-MM-DD HH:MM` (transform from `startISO`/`endISO`
     which are stored as `YYYY-MM-DDTHH:MM`)
   - column 4: literal `TWO WAY`
   - column 5: `Yes` if `ignoreTraffic` else `No`
   - column 6: segment IDs joined by `;` (no spaces)
   - column 7: `lon=<lon>&lat=<lat>` — use 5 decimal places (e.g.
     `lon=7.05464&lat=46.17835`)
   - column 8: `rowGeo.zoom` as integer
   - column 9: `finalFields.mteId`
   - column 10: `finalFields.comment`

   IMPORTANT: do not quote any field. The Advanced Closures script
   uses naive comma split. If a `reason` or `comment` contains a
   comma, throw a descriptive Error from `buildClosuresCsv`.

2. `src/__tests__/buildClosuresCsv.test.ts` — vitest tests:
   - **Trivial case**: 2 rows with disjoint segments → 2 output rows,
     identical segment lists, no merge.
   - **No-overlap-same-segment**: same segment in 2 rows but time
     ranges disjoint → segment stays in both rows (Annex D step 2:
     "if no two ranges overlap, leave the segment unchanged").
   - **User's example**: input 2 rows sharing segment `298469941`
     with overlapping ranges 13:32–14:24 and 13:59–14:51 → 3 output
     rows: row 1 with 5 segments (no 298469941), row 2 with 2
     segments (no 298469941), row 3 dedicated to 298469941 with
     range 13:32–14:51. Verify lines char-by-char where reasonable.
   - **Three overlapping ranges of same segment** → one merged
     range covering the union.
   - **Comma in reason** → throws Error.
   - **Empty closuresBySegment** → only header line.

3. `src/ui/promptFinalFields.ts` — ASYNC function that prompts the
   user for the four FinalFields via a small modal-like overlay.
   This file MAY use DOM (it's a UI module, not in src/csv/). Use
   plain `<dialog>` element or a div overlay; don't pull a UI
   library. Wrap it as:

   ```ts
   export async function promptFinalFields(
     defaults?: Partial<FinalFields>,
   ): Promise<FinalFields | null>; // null if user cancels
   ```

   Strings via `i18next.t(...)`. Add the keys to BOTH
   `locales/en/common.json` AND `locales/fr/common.json` under a new
   namespace `panel.finalFields`:
     - title, reason, ignoreTraffic, mteId, comment, ok, cancel,
       errorCommaInField

   Do NOT add this UI to MatchPanel yet (Lot 3 wires it in).

**Hard constraints:**
- `src/csv/buildClosuresCsv.ts` MUST NOT import anything from
  `wme-sdk-typings`, `window.*`, or `document.*`. Verify with
  grep before reporting done.
- Strict TS, no `any`. No `as` casts unless you also add a
  one-line "why" comment.
- Existing tests must still pass.

**Validation commands:**
```
npm test
npx tsc --noEmit
```
Both must be clean. Spot-check `npm run build` succeeds.

**Do NOT:**
- Update REFACTOR_PROGRESS.md (PO does that).
- Commit (PO does that).
- Wire `promptFinalFields` into MatchPanel (Lot 3 does that).
- Touch the SessionStore — types are FROZEN from Lot 1.

**Report back with:**
- Files created with one-line description each.
- Test summary (tests passed / failed counts).
- Output of `npx tsc --noEmit` (must be empty).
- Any deviation from the spec and the reason.

Keep the report under 300 words.
```

### A.5 — Lot 5: persistence + resume wiring

*(to be added before launching this lot)*

---

## Annex B — Sample input CSV (truncated)

The full CSV the user will be feeding the script. Useful for tests in
Lot 1, Lot 4, and manual smoke testing in Lot 6.

```
distance,start_time,end_time,date,segments
0.0,13:00,13:50,2026-04-29,
1.9,13:02,13:52,2026-04-29,
3.8,13:04,13:55,2026-04-29,
... (99 rows total — see original conversation transcript)
86.2,14:54,15:52,2026-04-29,
```

## Annex C — Target advanced-closures CSV format

```
header,reason,start date (yyyy-mm-dd hh:mm),end date (yyyy-mm-dd hh:mm),direction (A to B|B to A|TWO WAY),ignore trafic (Yes|No),segment IDs (id1;id2;...),lon/lat (like in a permalink: lon=xxx&lat=yyy),zoom (2 to 10),MTE ID,comment (optional)
add,Tour de Romandie 2026,2026-04-29 13:25,2026-04-29 14:17,TWO WAY,Yes,201847641;212223597,lon=7.05464&lat=46.17835,14,,Autogenerated
```

Note: the example header text says "zoom (2 to 10)" but real WME zoom
levels for closures go up to ~22. Keep the header text exactly as the
Advanced Closures script expects.

## Annex D — Overlap dedup spec

For each segment, given its list of `ClosureRange`:

1. Sort by `startISO`.
2. If no two ranges overlap, leave the segment in its original CSV
   rows unchanged.
3. Otherwise: remove the segment from every row where it appears, and
   for each merged group of overlapping ranges emit one new closure
   row containing only that segment, with start = min(starts), end =
   max(ends).
4. Non-overlapping ranges of the same segment also get their own
   dedicated rows (consequence of step 3).

Concrete example (from the user's spec):

  Input:
    298469941;298469940;318772212;318772213;318772210;212078376  13:32–14:24
    298469941;335004462;335004461                                13:59–14:51
  (segment 298469941 overlaps itself across the two rows)

  Output:
    298469940;318772212;318772213;318772210;212078376  13:32–14:24
    335004462;335004461                                13:59–14:51
    298469941                                          13:32–14:51   ← merged

If algorithmically simpler, generating one closure row per segment
(rather than per group) is allowed.
