# Lazy sub-line matching & domain unification

Status: draft for review
Date: 2026-05-21

## Goal

Unify the matching domain around three concepts — **source**, **line**, **sub-line** — and replace the current upfront sub-line planning with a lazy iterator that splits, matches, and persists one sub-line at a time. Remove the chain-by-chain orchestration and `chainMerge` code entirely; slowups produce ordinary lines, identical to CSV-driven lines.

## Motivation

Today, when a CSV row's track slice is too long to fit at zoom 16, `MatchingPipeline.planLeafSlices()` pre-computes the full list of sub-slices by panning/zooming the map repeatedly before any matching happens. The operator sees the map jitter through every future sub-slice, then matching starts. Two consequences:

1. Wasted work if the operator aborts after the first sub-slice.
2. Lost responsiveness — the operator wants to validate sub-slice 1 before the planner even thinks about sub-slice 2.

Symmetrically, slowups today are matched via a separate "chain-by-chain" orchestrator that runs one `MatchingPipeline` per slowup chain and exposes a `chaîne X/Y` suffix in the header. The downstream `chainMerge` step then dedupes results across chains. Each step duplicates logic that, once the domain is unified, becomes a no-op.

## Domain model

```
Source         ─ a loaded GeoJSON file OR a selected slowup
   │
   └── Line[]  ─ one closure unit. Has its own bbox and (optional) time window.
            │       Sources :
            │         - GeoJSON, no CSV    →  1 line covering the full track
            │         - GeoJSON + CSV      →  N lines, one per CSV row
            │         - Slowup (selection) →  K lines, one per contiguous merged piece
            │
            └── SubLine[]  ─ a zoom-fitting tile, created lazily during matching.
                       │     Persisted on creation so the operator can resume.
                       │     A line that fits at z16 has exactly 1 sub-line == the whole line.
                       │
                       └── MatchedSegment[]  ─ segmentId persisted under its sub-line.
```

**Vocabulary mapping vs current code:** `LineEntry` (today) = `Source` (new). The current CSV `rowIndex` becomes the `Line.index` within its source. The current `leafSlice` becomes a `SubLine`. `Chain*` types disappear.

## Behavioural change

### Lazy sub-line iteration

For each line, the pipeline holds a small state machine:

```
pendingTail : PendingSlice[]              // starts as [{ kmA, kmB } of the whole line ]
completedSubLines : SubLine[]             // grows as we go
```

Inner loop:

1. If the current sub-line is not yet known (fresh entry or post-rerun): pop a pending range from `pendingTail`, run `fitNextSubLine()` (zoom-driven head trimming, extracted from the current `fitPendingSlice`). Push the remainder back onto `pendingTail` **immediately** (before matching). Persist the sub-line shape and the updated `pendingTail` to localStorage.
2. Center the map on the sub-line, run matching, hit the validate gate.
3. On validate: persist `MatchedSegment[]` under the sub-line, mark it validated, advance the cursor (next sub-line is either already identified — back-then-forward case — or freshly computed by step 1 next round).
4. On back/rerun/skip: see "Back semantics" and "Rerun semantics" below.

Because step 1 commits the sub-line shape and the remainder *before* matching, a Back followed by Validate never triggers a recompute: the next sub-line is already in the persisted state.

`planLeafSlices()` is deleted. The map only jitters once per sub-line, immediately before the operator inspects it.

### Back semantics

Back rewinds the cursor by one step; Validate from the new position returns to where you came from. Sub-lines that were already identified stay identified (their shape is persisted); only their `validated` flag and `segmentIds` are touched.

| From | Back lands on | Subsequent Validate goes to |
|---|---|---|
| Sub-line k > 1 of line m | Sub-line k−1 of line m, with its persisted `segmentIds` re-applied as WME selection. | Sub-line k of line m (unchanged shape, possibly already matched but not validated). |
| Sub-line 1 of line m > 1 | Last sub-line of line m−1, with its segments re-applied as WME selection. | Sub-line 1 of line m. |
| Sub-line 1 of line 1 | No-op (UI disabled). | — |

No prior sub-line is destroyed by Back. The operator can chain Backs all the way to the first sub-line and walk forward again without recomputing any sub-line shape.

### Rerun semantics

Distinct from Back. A "Recommencer cette étape" button on the current sub-line:

1. Merges the current sub-line range back into `pendingTail` (becomes the new head: `{ kmA: current.kmA, kmB: current.kmB }`).
2. Drops the current sub-line and any sub-lines that came after it within the same line, including their `segmentIds`.
3. Re-enters the inner loop at step 1 (fresh `fitNextSubLine` from the merged range — typically yields a different shape because the map state, zoom heuristics, or operator intent has changed).

Rerun affects only the current line. Prior lines are untouched.

### Sub-line overlay colour

`TrackLayer.setHighlightedSlice()` is currently called per row with the whole row's geometry. We move the call so it highlights only the **current sub-line**'s geometry. The remainder of the line is shown in the default colour. The operator immediately sees which tile is active.

### Header text

Pipeline emits `(lineIndex+1, lineCount, subLineIndex+1, subLineCount?)`. `subLineCount` is unknown ahead of time (because of lazy iteration). Display:

- When the line fits at z16: `Ligne X/N — km, t1 → t2` (no sub-line suffix).
- Otherwise: `Ligne X/N — km, t1 → t2 | sous-ligne A/?` while `pendingTail` is non-empty, then `A/A` when known to be the last.

The `chaîne X/Y` suffix is removed. The `chainStart` / `chainSwitching` / `chainSuffix` / `subLinesEmpty` / `mergeEligible` / `mergeChainItem` i18n strings are deleted.

## Source ingestion changes

**GeoJSON file load** (existing): unchanged. Produces a Source with a single Line covering the full track, or with N Lines once a CSV is uploaded.

**Slowup selection** (mostly unchanged): the merge already happens today at selection time via `mergeTrackChainsByEndpoints(chains, 0.05)` (constant `SLOWUP_CHAIN_MERGE_MAX_GAP_KM` in `MatchingSubTab`, validated by `slowupsMerge.test.ts` — slowup #4 collapses 7 raw pieces into 2 merged chains). Keep this call as-is. The change is downstream: the K merged chains feed directly into the new `Source → Line[]` model (1 chain = 1 Line). The chain-by-chain orchestration that wraps these merged chains today (chainSnapshots, activeChainIndex, the secondary `listTrackChains`/`mergeTrackChainsByEndpoints` calls in `ensureMergeInitializedForSelectedSlowup`, etc.) is what gets deleted. The CSV upload UI on a slowup source is removed.

**Lines from CSV** (existing): unchanged — one Line per CSV row, with `startISO`/`endISO`.

## Persistence

One localStorage key per Source: `wme-geojson:source:<sourceId>`. Atomic JSON, written after every state change (sub-line creation, sub-line validation, segment update). Format:

```ts
interface PersistedSource {
  schemaVersion: 1;
  sourceId: string;            // stable id of the GeoJSON file or slowup
  kind: "geojson" | "slowup";
  hasCsv: boolean;
  lines: PersistedLine[];
  cursor: { lineIndex: number; subLineIndex: number } | null;  // resume point
}
interface PersistedLine {
  index: number;
  bbox: [number, number, number, number];
  startISO?: string;
  endISO?: string;
  subLines: PersistedSubLine[];
}
interface PersistedSubLine {
  index: number;
  bbox: [number, number, number, number];
  view: { lon: number; lat: number; zoom: number };  // map anchor used for matching
  segmentIds: number[];
  validated: boolean;
}
```

Persisted on every sub-line creation and every validate. Loaded on Source selection: if a key exists, the operator resumes at `cursor`.

## Export

The current `ClosureRowGroup[]` model and `buildClosuresCsv` are reframed in terms of the unified domain:

1. Collect all `MatchedSegment` entries for the active Source (joined via lines/sub-lines).
2. If the Source has CSV-derived time windows: produce one closure per `(segmentId, startISO, endISO)`. Detect overlaps across lines that share a segment and merge overlapping ranges. (This is the existing `ClosureRange` dedup logic, simplified — no more cross-chain ownership.)
3. If the Source has no time windows: produce one closure per unique `segmentId`. The existing global-times popup collects `startISO`/`endISO` before the reason popup. Already works; add regression tests but do not change the flow.

## Code deletions

- `src/matching/chainMerge.ts` and its tests.
- `src/matching/chainTracks.ts` is kept (the slowup selection still calls `listTrackChains` + `mergeTrackChainsByEndpoints`). Optionally moved under `src/lines/slowupMerge.ts` for clarity, but the API stays the same.
- `ChainMergeState`, `ChainMergeSnapshot` from `src/lines/types.ts`.
- `activeChains`, `activeChainIndex`, `chainSnapshots`, and the chain-by-chain orchestrator block in `src/ui/subtabs/MatchingSubTab.ts`.
- i18n strings: `chainSuffix`, `chainStart`, `chainSwitching`, `subLinesEmpty`, `mergeEligible`, `mergeChainItem`.
- CSV upload UI path for slowup sources.
- `MatchingPipeline.planLeafSlices()` and `fitPendingSlice()` upfront caller; the inner `fitPendingSlice` helper itself stays (renamed `fitNextSubLine`).

## Component changes

| File | Change |
|---|---|
| `src/lines/types.ts` | Replace `LineEntry` surface to expose `lines: Line[]`. Drop `ChainMergeState`. |
| `src/lines/slowupMerge.ts` (new) | `mergeSlowupPieces(pieces) → MultiLineString[]`, distilled from `chainTracks.ts`. Runs at slowup selection. |
| `src/state/SessionStore.ts` | Replace CSV-row-oriented state with line/sub-line/segment state. `validateRow` → `validateSubLine`. `rewindToRow` → `rewindToSubLine`. |
| `src/state/persistence.ts` (new) | Read/write `PersistedSource` to localStorage. Debounced write (e.g. 200ms). |
| `src/controller/MatchingPipeline.ts` | Replace per-row leaf planning with lazy `SubLineIterator`. Add cross-line back logic that consults persisted prior lines. Persist after each step. |
| `src/ui/views/MatchingHeaderView.ts` | New header format. Drop chain suffix. |
| `src/ui/subtabs/MatchingSubTab.ts` | Drop chain orchestrator. Drop CSV upload UI for slowup sources. Wire persistence resume on source open. |
| `src/layers/TrackLayer.ts` | `setHighlightedSlice` is now driven by current sub-line geometry. |
| `locales/{en,fr}/common.json` | Remove chain strings. Adjust header strings. |
| `src/__tests__/*` | Add `lazySubLineIterator.test.ts`, `crossLineBack.test.ts`, `persistence.test.ts`. Remove `chainMerge.test.ts`, `chainTracks.test.ts`, `slowupsMerge.test.ts` (or rewrite under new names). |

## Out of scope

- Multi-Source concurrent matching (only the selected Source is active).
- Re-running matching on already-validated sub-lines from the persisted state (operator must explicitly use back/rerun).
- Migration of existing localStorage data; the new schemaVersion=1 ignores and overwrites prior keys (explicitly confirmed: existing in-progress sessions are discarded on upgrade).

## Open questions

None — answers captured above.
