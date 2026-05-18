# FeatureCollection support — design spec

**Date**: 2026-05-18
**Status**: Approved for implementation

## Context & motivation

The script today loads a single GeoJSON `Feature` (LineString or MultiLineString) from a query-param URL and walks/matches it against Waze segments. Swiss editors also work with **slowUps** — public events where roads close for pedestrians and cyclists. The SchweizMobil API (`https://schweizmobil.ch/api/4/slowups.geojson`) returns a `FeatureCollection` of all slowUps, each with a `slowup_number` property and optional detail lookup at `https://schweizmobil.ch/api/4/feature/slowup/refid/{n}?lang={iso}`.

Adding FeatureCollection support requires more than parsing: the panel must let the user pick one line out of many, the matching pipeline must work without an imported CSV (slowUps don't come with hour schedules), and naming/date defaults should leverage the slowUp detail API when available.

## Goals

1. Load and display a `FeatureCollection` URL, dropping `Point` features, keeping `LineString` and `MultiLineString`.
2. Let the user select one line at a time for matching, while preserving per-line matching state across switches.
3. Allow matching and closure-CSV export **without** importing a CSV — a single synthetic slice covering the whole track, with a date/time window prompted at download.
4. Pre-fill the closure window from slowUp details when available; otherwise default to today 09:00 → 17:30.

## Non-goals

- Bulk download of closure CSVs across multiple lines in one click.
- Editing the loaded GeoJSON or saving back to a remote.
- Concurrent walks on multiple lines.
- Showing slowUp photos/abstracts/links in the panel (just title + date).

## Architecture

### New module: `src/lines/`

Pure, no SDK dependency:

- **`LineEntry`** (type): one line loaded from the source.
  ```ts
  interface LineEntry {
    id: string;                  // stable, e.g. `${sourceUrl}#${featureIndex}`
    track: NormalizedTrack;      // from existing geojson/normalize
    displayName: string;         // computed: slowup title | properties.name | "Tracé de X km"
    color: string;               // derived from id, stable across reloads
    slowupNumber?: number;
    slowupDetails?: SlowupDetails;
    slowupFetchStatus: 'idle' | 'loading' | 'ok' | 'error';
    mode: 'csv' | 'synthetic';   // matching mode
    matchedIds?: Set<number>;
    csv?: ParsedSchedule;
    pipelineState: PipelineState;
  }
  ```
- **`LineRegistry`**: in-memory store. API:
  - `setEntries(entries: LineEntry[])`
  - `getAll(): LineEntry[]`
  - `getSelected(): LineEntry | null`
  - `setSelected(id: string | null)`
  - `updateEntry(id, patch: Partial<LineEntry>)`
  - Events: `onLinesChanged`, `onSelectedLineChanged`, `onEntryUpdated(id)`
- **`featureCollectionLoader.ts`**: `loadLines(url: string): Promise<LineEntry[]>`
  - Fetches via `GM.xmlHttpRequest` (reuses `geojson/Loader.ts` plumbing).
  - Detects `Feature` vs `FeatureCollection`.
  - Drops features whose geometry is not `LineString` or `MultiLineString`.
  - Builds initial `LineEntry` per surviving feature, with provisional `displayName` and `mode: 'synthetic'`.
- **`slowupClient.ts`**: `fetchSlowupDetails(refid: number, lang: string): Promise<SlowupDetails>`
  - Builds `https://schweizmobil.ch/api/4/feature/slowup/refid/${refid}?lang=${lang}`.
  - Parses the array response (the API returns `[{...}]`), returns the first element.
  - Throws on HTTP error or empty array.
- **`color.ts`**: `colorForLineId(id: string): string` — hash → HSL palette. Deterministic.
- **`displayName.ts`**: pure helper computing the display name from `(track, properties, slowupDetails?)`.

### Refactored UI: `src/ui/`

The 2500-line `MatchPanel.ts` is split:

- **`MatchPanel.ts`** (shell, ~200 lines): mounts the tab in WME sidebar, renders a segmented control `[Lignes] [Matching]`, mounts the active sub-tab, owns the `LineRegistry`.
- **`subtabs/LinesSubTab.ts`** (new): URL input, source-type info line, list of `LineEntry` with color pill + name + "Sélectionner". Triggers slowUp details fetches in parallel on mount/load.
- **`subtabs/MatchingSubTab.ts`** (new): everything currently in MatchPanel — CSV import, walk, match, results, download. Reads the active `LineEntry` from `LineRegistry`. Empty-state when no line is selected.
- **`components/promptClosureWindow.ts`** (new): modal prompting date/time start + end. Used by MatchingSubTab when `mode === 'synthetic'` at download time.

### Controller changes

- `WalkController`: no longer owns its own matched-ids state. On line switch, the panel calls `controller.attachToLine(entry)` which rehydrates internal state from `entry.matchedIds`, `entry.csv`, `entry.pipelineState`, and writes back via `LineRegistry.updateEntry` on change. If a walk is in progress, the panel calls `controller.stop()` before switching.
- `MatchingPipeline`: unchanged externally. `mode: 'synthetic'` feeds it a single synthesised row (`startKm: 0`, `endKm: turf.length(track)`).
- `TrackLayer`: gains a multi-track mode.
  - `drawPreview(entries: LineEntry[])`: draws all lines, each with its `color`.
  - `drawActive(entry: LineEntry)`: draws only this entry in `#ff00aa` (current behaviour).
  - `destroy()` unchanged.

### Data flow

```
query-param OR URL field
  → featureCollectionLoader.loadLines(url)
    → LineRegistry.setEntries(entries)
      → LinesSubTab renders list + TrackLayer.drawPreview(all)
      → for each entry with slowup_number: fetchSlowupDetails(...) in parallel
        → LineRegistry.updateEntry(id, { slowupDetails, displayName, slowupFetchStatus })

User clicks "Sélectionner" on entry X
  → LineRegistry.setSelected(X)
    → panel switches to MatchingSubTab
    → TrackLayer.drawActive(X)
    → WalkController.attachToLine(X)

User imports CSV in MatchingSubTab
  → LineRegistry.updateEntry(X, { mode: 'csv', csv: parsed, matchedIds: undefined })

User clicks "Télécharger"
  → if entry.mode === 'csv': existing flow
  → if entry.mode === 'synthetic':
      promptClosureWindow({ defaultDate: slowupDetails?.date ?? today, defaultStart: '09:00', defaultEnd: '17:30' })
      → buildClosuresCsv({ schedule: synthesisedFromWindow, segments: entry.matchedIds })
```

### Map display rules

| Context | TrackLayer state |
| --- | --- |
| Sub-tab 1 (Lignes) open, any number of entries | `drawPreview(allEntries)` — multi-color |
| Sub-tab 2 (Matching) open, line X selected | `drawActive(X)` — magenta |
| No entries loaded | layer destroyed |

## Error handling

- URL fetch fails → red error message below the URL field in sub-tab 1. No modal.
- FeatureCollection with zero non-point features → "Aucune ligne dans cette source." in sub-tab 1.
- SlowUp details fetch fails → entry keeps provisional name + small warning icon next to it; "Sélectionner" remains enabled.
- Switch line while walking → panel stops the walk first (`controller.stop()`), then switches.

## UX details

### Sub-tab toggle

Two buttons at the top of the panel, styled as a segmented control. Persistent state — switching away and back stays on the last sub-tab. If nothing is loaded yet, sub-tab 2 shows "Charge une URL dans l'onglet Lignes."

### Sub-tab 1 — Lignes

```
URL: [_________________] [Charger]    ← pre-filled from ?geojson=, auto-fetched
Source: FeatureCollection (5 lignes)  ← or "Feature (1 ligne)"

● Ticino — 2026-04-19         [Sélectionner]
● Lausanne — 2026-06-07       [Sélectionner]
● Tracé de 24 km              [Sélectionner]
⏳ chargement détails…        [—]
⚠ Ticino (détails indispo)    [Sélectionner]
```

- Color pill (●) uses `entry.color`.
- During slowUp fetch: spinner replaces pill, "Sélectionner" disabled **on that row only**.
- Error icon: warning, no blocker.

### Sub-tab 2 — Matching

Header shows: `← Ligne: {displayName} — {km} km`. The `←` returns to sub-tab 1 without deselecting. Body is the current MatchPanel content (CSV import, walk controls, results list, download).

If `mode === 'synthetic'`: a banner above the row table reads "Pas de CSV — la ligne entière sera fermée sur une seule fenêtre temporelle (saisie au téléchargement)."

### promptClosureWindow modal

- Two `<input type="datetime-local">` fields: début, fin.
- Defaults: `slowupDetails?.date ?? today` at 09:00, same date at 17:30.
- Validation: end > start; both required.
- Buttons: Annuler, Télécharger.

## Implementation phases

Each phase is independently mergeable.

### Phase 7a — Split + CSV-less (single Feature only)

- New `LineRegistry`, `LineEntry` (single-entry capable).
- Split `MatchPanel` into shell + two sub-tabs. **Recommendation**: two internal commits — (1) pure refactor extracting MatchingSubTab with no behaviour change (existing tests must pass); (2) add LinesSubTab + toggle + URL input + synthetic mode + closure-window modal.
- URL input field in sub-tab 1, pre-filled from `?geojson=`, auto-fetched on load.
- Display 1 row for a Feature with provisional name + "Sélectionner".
- `mode: 'synthetic'` plumbing: synthesised schedule (0 → length), pipeline runs as today.
- `promptClosureWindow.ts` modal with defaults today 09:00 → 17:30.

Out of scope for 7a: FeatureCollection parsing, multi-color preview, slowUp details.

Tests (vitest, pure modules):
- `featureCollectionLoader.test.ts`: single Feature → 1 entry; rawProperties preserved; `mode === 'synthetic'`.
- `syntheticSchedule.test.ts`: length correct (turf-based); 1 row; start/end empty until window picked.
- `LineRegistry.test.ts`: setEntries/setSelected/updateEntry events; clear semantics.
- `displayName.test.ts`: `properties.name` used when present; "Tracé de X km" fallback.

DoD: lint + tests pass; manual checks — `?geojson=...` still auto-loads; can switch sub-tabs; can DL a closures CSV without an imported CSV (window prompted); CSV-imported behaviour unchanged.

### Phase 7b — FeatureCollection (no slowUp)

- `featureCollectionLoader` handles FeatureCollection, drops Point features, builds N entries.
- `LineRegistry` handles N entries; per-line matching state preserved across switches.
- Sub-tab 1: N rows with stable color pills.
- `TrackLayer.drawPreview` (multi-color) and `drawActive` (magenta).
- Switch handling: stop walk if running, then switch.

Out of scope for 7b: slowUp details, slowUp-driven date defaults.

Tests:
- `featureCollectionLoader.test.ts` extended: drops points; keeps LineString and MultiLineString; mixed input.
- `color.test.ts`: deterministic for a given id; reasonable distribution across N ids.
- `displayName.test.ts` extended: "Tracé de X km" fallback for entries without `name`.

DoD: `https://schweizmobil.ch/api/4/slowups.geojson` loads N lines; can select, match, return, select another, prior state intact.

### Phase 7c — SlowUp details

- `slowupClient.fetchSlowupDetails(refid, lang)`.
- Language via `wmeSDK.Settings.getLocale()` (already wired in `locales/i18n.ts`); fallback `en`.
- LinesSubTab fires parallel fetches on mount/load for entries with `slowup_number`. Row shows spinner + disabled "Sélectionner" during fetch.
- On success: `displayName` becomes `"{title} — {date}"`.
- On error: warning icon, row stays selectable, name unchanged.
- `promptClosureWindow` reads `slowupDetails?.date` for default.

Tests:
- `slowupClient.test.ts`: URL construction includes `?lang=`; parses `[{...}]` shape; HTTP error rejects.
- `displayName.test.ts` extended: slowUp title + date wins over `properties.name`.

DoD: on `slowups.geojson`, names populate progressively as details arrive; date pre-filled in download modal.

## Risks

- **MatchPanel split (7a)**: the file is ~2500 lines mixing DOM and orchestration. The two-commit approach (pure refactor first, then additions) is mandatory to keep the diff reviewable and the regressions tractable.
- **WalkController rehydration**: switching lines mid-walk must call `stop()` first. Manual test required since this layer has no automated coverage by repo convention.
- **i18n keys**: many new strings (sub-tab labels, banners, modal, error states). Add to `locales/{en,fr}/common.json` as phases land; do not anticipate.

## Out of scope (forever, unless reopened)

- Combined CSV across multiple lines in one download.
- Live polling of the slowUps API for changes.
- Showing slowUp photos, abstracts, or links inside the panel (deferred or out).
- Auto-selection of a single Feature — UX stays uniform (user always clicks "Sélectionner").

## i18n key plan (indicative)

```json
{
  "panel": {
    "subtabs": { "lines": "Lignes", "matching": "Matching" },
    "lines": {
      "urlLabel": "URL GeoJSON",
      "urlLoad": "Charger",
      "sourceFeature": "Feature (1 ligne)",
      "sourceCollection": "FeatureCollection ({{count}} lignes)",
      "empty": "Aucune ligne dans cette source.",
      "fallbackName": "Tracé de {{km}} km",
      "select": "Sélectionner",
      "detailsLoading": "Chargement des détails…",
      "detailsError": "Détails indisponibles"
    },
    "matching": {
      "header": "Ligne : {{name}} — {{km}} km",
      "back": "←",
      "syntheticBanner": "Pas de CSV — fenêtre temporelle saisie au téléchargement.",
      "noSelection": "Sélectionne une ligne dans l'onglet Lignes."
    },
    "modal": {
      "closureWindow": {
        "title": "Fenêtre de fermeture",
        "start": "Début",
        "end": "Fin",
        "errorOrder": "La fin doit être après le début.",
        "cancel": "Annuler",
        "download": "Télécharger"
      }
    },
    "errors": {
      "loadUrl": "Échec du chargement de l'URL : {{message}}"
    }
  }
}
```
