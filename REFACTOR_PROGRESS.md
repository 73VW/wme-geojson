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
| **2 — UI refactor (Waze WC)** | TODO | — | `src/ui/MatchPanel.ts`, `src/ui/components/wz.ts`, `src/layers/TrackLayer.ts`, locale keys | Strip old controls, render by phase. |
| **3 — guided pipeline** | TODO | — | `src/controller/MatchingPipeline.ts`, `src/ui/tabSwitch.ts`, `src/ui/MatchPanel.ts` (guided sub-panel), `src/controller/WalkController.ts` (helpers) | Depends on Lots 1 + 2. |
| **4 — closures CSV builder** | IN PROGRESS | — | `src/csv/buildClosuresCsv.ts`, `src/ui/promptFinalFields.ts` + tests | Delegated to Sonnet agent with prompt A.4. |
| **5 — persistence + resume wiring** | TODO | — | `src/state/SessionStore.ts` (mutation hooks), `src/ui/MatchPanel.ts` (resume banner) | Depends on Lots 1 + 2 + 3. |
| **6 — polish + release** | TODO | — | `package.json` bump, `releases/release-0.10.0.user.js`, `README.md`, `HANDOFF.md` | Manual smoke E2E, version bump, regenerate release. |

Status legend: `TODO` (not started), `IN PROGRESS` (active), `BLOCKED`
(see Blockers section), `DONE`.

## 5. Next action

**Start Lot 4 (closures CSV builder)** — pure module, can run in
parallel with Lot 2 (UI). Lot 1 types are now in
`src/state/SessionStore.ts` (`ClosureRange`, `CsvRow`,
`closuresBySegment`). Draft prompt A.4 below before delegating.
Then flip Lot 4 to `IN PROGRESS`, commit
`chore(progress): start Lot 4`, delegate to a Sonnet sub-agent.

Lot 2 (UI refactor) can start whenever a developer is available —
it does not depend on Lot 4. Drafting prompt A.2 is the next PO
task before launching it.

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

*(to be added before launching this lot — the layout depends on what
Lot 1 exposes; PO will write A.2 at that point)*

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
