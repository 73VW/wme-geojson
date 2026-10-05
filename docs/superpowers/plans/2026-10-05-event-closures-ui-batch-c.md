# WME Event Closures — UI overhaul, batch C (matching panel + step navigation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator move freely between the matched sub-lines of a line (‹ ›), reselect or re-run the matching of any validated sub-line and save a corrected selection for that sub-line only — an "editor within the editor" — inside a WME-styled floating panel that opens next to the sidebar, with a "⋯" menu for Debug / Copy debug JSON / Restart.

**Architecture:** Pure helpers compute the navigable steps (`src/domain/steps.ts`). A small, SDK-free controller (`src/controller/StepReview.ts`) owns the review of one validated sub-line (open, select matched, re-match, dirty tracking, save, cancel) through injected drivers. The run state machine (`matchingUiState.ts`) keeps its states; its destructive Back / Rerun-row / Reselect buttons are removed and a non-destructive "Relancer le matching" replaces them on the frontier. New pure-DOM views (`StepNavView`, `PanelMenuView`) are wired by `MatchingSubTab`. The panel CSS moves to `BASE_CSS` on WME tokens.

**Tech Stack:** TypeScript (strict), vitest + happy-dom, i18next, WME SDK (`Editing.getSelection/setSelection`, `Events.on("wme-selection-changed")`), WME web components.

**Spec:** `docs/superpowers/specs/2026-10-05-event-closures-ui-overhaul-design.md` (section 4).

**Deviation from the spec (decided while planning):** the review of a validated sub-line is an orthogonal `StepReview` state (`{ step, dirty, busy } | null`) next to the run state machine, instead of a new `reviewing` kind with a `returnTo` field inside `reduceMatchingUi`. Navigation is allowed whenever matching is not running (idle, waiting, paused, error, done), which also covers re-opening a finished line — the case the user reported ("no ‹ › on a matched line"). The "Debug" tab becomes a view opened from the "⋯" menu.

## Global Constraints

- No new dependencies.
- Colours only through WME tokens in `BASE_CSS` (hex-free; `src/__tests__/styles.test.ts` enforces it). `rgba(...)` shadows are allowed.
- Every user-visible string through `i18next.t("literal.key")`, keys in both `locales/fr/common.json` and `locales/en/common.json` (use `.superpowers/i18n.py <locale> <dotted.path> '<json>'`).
- Persisted data model unchanged (`Source` schemaVersion 1, `wme-geojson:source:<id>` keys). Re-validating one sub-line must only rewrite that sub-line's `segmentIds`.
- Never more than one primary button visible in the panel's action area.
- Dialogs through `confirmDialog` / `wzDialog` (batch A); no `alert()`.
- View tests: `// @vitest-environment happy-dom` + `beforeAll(initFrench)` from `src/__tests__/helpers/i18nFr.ts`.
- Commit after each task; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Navigating away from a sub-line with an unsaved selection change** (‹ ›, closing the panel): must ask "Abandonner les modifications ?" and stay if the operator says so → test in Task 2 (controller exposes `dirty`) and Task 6 (navigation asks first).
2. **Saving a reviewed sub-line**: must not touch any other sub-line, nor drop later sub-lines, nor move the resume cursor → test in Task 2.
3. **The selection WME reports is the same set in another order**: must not count as a change → test in Task 1 (`sameIds`).
4. **Navigation while a step or the automatic run is in progress**: ‹ › must be disabled → test in Task 4 (`StepNavView` disabled state) and Task 6 (`navEnabled`).
5. **A stored panel position that now sits over the sidebar or off-screen** (window resized): the panel must open next to the sidebar instead → test in Task 5.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/steps.ts` (new) | `StepRef`, `navigableSteps`, `frontierStep`, `neighbour`, `sameIds` |
| `src/controller/StepReview.ts` (new) | review of one validated sub-line; `reviewControlsFor` |
| `src/controller/LazyMatchingPipeline.ts` (modify) | drop `back`/`rerunCurrent`; add `rematchCurrent` |
| `src/state/SourceStore.ts` (modify) | drop `rerunSubLine` |
| `src/ui/matchingUiState.ts` (modify) | controls table: drop back/reselect/rerun, add rematch |
| `src/ui/views/StepNavView.ts` (new) | `‹ label ›` bar with caption |
| `src/ui/views/PanelMenuView.ts` (new) | "⋯" button + menu |
| `src/ui/panelPosition.ts` (new) | where the floating panel opens |
| `src/ui/styles.ts` (modify) | panel CSS on tokens |
| `src/ui/subtabs/MatchingSubTab.ts` (modify) | wire everything, wording per state |

---

### Task 1: Navigable steps

**Files:**
- Create: `src/domain/steps.ts`
- Test: `src/__tests__/steps.test.ts`

**Interfaces:**
- Produces:
  - `interface StepRef { lineIndex: number; subLineIndex: number }`
  - `navigableSteps(source: Source | null, includeFrontier: boolean): StepRef[]` — validated sub-lines in matching order, then the frontier (first unvalidated sub-line) when `includeFrontier`; never anything beyond the frontier.
  - `frontierStep(source: Source | null): StepRef | null`
  - `neighbour(steps: StepRef[], current: StepRef | null, direction: -1 | 1): StepRef | null` — with `current === null`, `-1` returns the last step, `1` returns `null`.
  - `sameStep(a: StepRef | null, b: StepRef | null): boolean`
  - `sameIds(a: readonly number[], b: readonly number[]): boolean` — set equality.

- [ ] **Step 1: Write the failing test**

`src/__tests__/steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { frontierStep, navigableSteps, neighbour, sameIds, sameStep } from "../domain/steps";
import type { Line, Source, SubLine } from "../domain/types";

function sub(index: number, validated: boolean): SubLine {
  return {
    index,
    kmA: index,
    kmB: index + 1,
    bbox: [0, 0, 0, 0],
    view: { lon: 0, lat: 0, zoom: 16 },
    segmentIds: validated ? [index] : [],
    validated,
  };
}

function line(index: number, subLines: SubLine[], pending = false): Line {
  return {
    index,
    bbox: [0, 0, 0, 0],
    geometry: { type: "MultiLineString", coordinates: [] },
    lengthKm: 10,
    subLines,
    pendingTail: pending ? [{ kmA: subLines.length, kmB: 10 }] : [],
  };
}

function source(lines: Line[]): Source {
  return { schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv: false, lines, cursor: null };
}

const at = (lineIndex: number, subLineIndex: number) => ({ lineIndex, subLineIndex });

describe("navigableSteps", () => {
  it("lists validated sub-lines across lines, in matching order", () => {
    const src = source([line(0, [sub(0, true), sub(1, true)]), line(1, [sub(0, true)])]);
    expect(navigableSteps(src, true)).toEqual([at(0, 0), at(0, 1), at(1, 0)]);
  });

  it("ends at the frontier, included only on request", () => {
    const src = source([line(0, [sub(0, true), sub(1, false)], true), line(1, [])]);
    expect(navigableSteps(src, false)).toEqual([at(0, 0)]);
    expect(navigableSteps(src, true)).toEqual([at(0, 0), at(0, 1)]);
    expect(frontierStep(src)).toEqual(at(0, 1));
  });

  it("stops at a line not cut yet, without a frontier", () => {
    const src = source([line(0, [sub(0, true)], true), line(1, [sub(0, true)])]);
    expect(navigableSteps(src, true)).toEqual([at(0, 0)]);
    expect(frontierStep(src)).toBeNull();
  });

  it("is empty without a source", () => {
    expect(navigableSteps(null, true)).toEqual([]);
  });
});

describe("neighbour", () => {
  const steps = [at(0, 0), at(0, 1), at(1, 0)];
  it("moves back and forth and stops at both ends", () => {
    expect(neighbour(steps, at(0, 1), -1)).toEqual(at(0, 0));
    expect(neighbour(steps, at(0, 1), 1)).toEqual(at(1, 0));
    expect(neighbour(steps, at(0, 0), -1)).toBeNull();
    expect(neighbour(steps, at(1, 0), 1)).toBeNull();
  });
  it("from nowhere, goes back to the last step only", () => {
    expect(neighbour(steps, null, -1)).toEqual(at(1, 0));
    expect(neighbour(steps, null, 1)).toBeNull();
  });
});

describe("sameIds / sameStep", () => {
  it("compares segment ids as sets", () => {
    expect(sameIds([3, 1, 2], [1, 2, 3])).toBe(true);
    expect(sameIds([1, 2], [1, 2, 3])).toBe(false);
    expect(sameIds([1, 1, 2], [2, 1])).toBe(true);
  });
  it("compares steps by position", () => {
    expect(sameStep(at(0, 1), at(0, 1))).toBe(true);
    expect(sameStep(at(0, 1), null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/steps.test.ts`
Expected: FAIL — cannot resolve `../domain/steps`.

- [ ] **Step 3: Implement**

`src/domain/steps.ts`:

```ts
// The sub-lines the operator can step through in the matching panel: the
// validated ones, in matching order, then (optionally) the frontier — the
// first sub-line still waiting for validation. Never beyond the frontier:
// later sub-lines don't exist yet (they are cut lazily).

import type { Source } from "./types";

export interface StepRef {
  lineIndex: number;
  subLineIndex: number;
}

export function frontierStep(source: Source | null): StepRef | null {
  if (!source) return null;
  for (const line of source.lines) {
    const unvalidated = line.subLines.findIndex((subLine) => !subLine.validated);
    if (unvalidated !== -1) return { lineIndex: line.index, subLineIndex: unvalidated };
    if (line.pendingTail.length > 0) return null;
  }
  return null;
}

export function navigableSteps(source: Source | null, includeFrontier: boolean): StepRef[] {
  if (!source) return [];
  const steps: StepRef[] = [];
  for (const line of source.lines) {
    for (const subLine of line.subLines) {
      if (!subLine.validated) {
        if (includeFrontier) steps.push({ lineIndex: line.index, subLineIndex: subLine.index });
        return steps;
      }
      steps.push({ lineIndex: line.index, subLineIndex: subLine.index });
    }
    if (line.pendingTail.length > 0) return steps;
  }
  return steps;
}

export function sameStep(a: StepRef | null, b: StepRef | null): boolean {
  if (!a || !b) return false;
  return a.lineIndex === b.lineIndex && a.subLineIndex === b.subLineIndex;
}

export function neighbour(
  steps: StepRef[],
  current: StepRef | null,
  direction: -1 | 1,
): StepRef | null {
  if (current === null) return direction === -1 ? (steps[steps.length - 1] ?? null) : null;
  const index = steps.findIndex((step) => sameStep(step, current));
  if (index === -1) return null;
  return steps[index + direction] ?? null;
}

export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}
```

Note: `line.index` / `subLine.index` are the positions in their arrays (documented as stable 0-based indexes in `src/domain/types.ts`).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/__tests__/steps.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/steps.ts src/__tests__/steps.test.ts
git commit -m "feat(domain): navigable matching steps up to the frontier"
```

---

### Task 2: StepReview controller

**Files:**
- Create: `src/controller/StepReview.ts`
- Test: `src/__tests__/StepReview.test.ts`

**Interfaces:**
- Consumes: `StepRef`, `sameIds` (Task 1); `SourceStore` (`getSource()`, `validateSubLine(li, si, ids)`); `ButtonView` from `src/ui/matchingUiState.ts`.
- Produces:
  - `interface ReviewState { step: StepRef; dirty: boolean; busy: boolean }`
  - `interface StepReviewDeps { store: SourceStore; map: { setMapCenter(lon: number, lat: number, zoom: number): void; waitIdle(): Promise<void>; setSelection(ids: number[]): void; getSelection(): number[] }; match: { runMatchFor(step: StepRef): Promise<number[]> }; onChange(): void }`
  - `class StepReview { get state(): ReviewState | null; open(step: StepRef): Promise<void>; close(): void; selectMatched(): void; rematch(): Promise<void>; selectionChanged(ids: number[]): void; save(): void; cancel(): void }`
  - `interface ReviewControls { selectMatched: ButtonView; rematch: ButtonView; save: ButtonView; cancel: ButtonView }`
  - `reviewControlsFor(state: ReviewState | null): ReviewControls`

- [ ] **Step 1: Write the failing test**

`src/__tests__/StepReview.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { StepReview, reviewControlsFor } from "../controller/StepReview";
import { SourceStore } from "../state/SourceStore";
import type { Source, SubLine } from "../domain/types";

function sub(index: number, ids: number[], validated = true): SubLine {
  return {
    index,
    kmA: index,
    kmB: index + 1,
    bbox: [0, 0, 0, 0],
    view: { lon: 7 + index, lat: 46, zoom: 17 },
    segmentIds: ids,
    validated,
  };
}

function setup(matchResult: number[] = [10, 11]) {
  const source: Source = {
    schemaVersion: 1,
    sourceId: "s",
    kind: "geojson",
    hasCsv: false,
    cursor: { lineIndex: 0, subLineIndex: 2 },
    lines: [
      {
        index: 0,
        bbox: [0, 0, 0, 0],
        geometry: { type: "MultiLineString", coordinates: [] },
        lengthKm: 10,
        subLines: [sub(0, [1, 2]), sub(1, [3, 4]), sub(2, [], false)],
        pendingTail: [{ kmA: 3, kmB: 10 }],
      },
    ],
  };
  const store = new SourceStore();
  store.hydrate(source);
  let selection: number[] = [];
  const map = {
    setMapCenter: vi.fn(),
    waitIdle: vi.fn(async () => {}),
    setSelection: vi.fn((ids: number[]) => {
      selection = ids;
    }),
    getSelection: () => selection,
  };
  const match = { runMatchFor: vi.fn(async () => matchResult) };
  const onChange = vi.fn();
  const review = new StepReview({ store, map, match, onChange });
  return { review, store, map, match, onChange, select: (ids: number[]) => (selection = ids) };
}

const step1 = { lineIndex: 0, subLineIndex: 1 };

describe("StepReview", () => {
  it("opens a validated sub-line on its map view, clean", async () => {
    const { review, map, onChange } = setup();
    await review.open(step1);
    expect(map.setMapCenter).toHaveBeenCalledWith(8, 46, 17);
    expect(review.state).toEqual({ step: step1, dirty: false, busy: false });
    expect(onChange).toHaveBeenCalled();
  });

  it("refuses to open a sub-line that is not validated", async () => {
    const { review } = setup();
    await review.open({ lineIndex: 0, subLineIndex: 2 });
    expect(review.state).toBeNull();
  });

  it("selects the stored segments of the reviewed sub-line", async () => {
    const { review, map } = setup();
    await review.open(step1);
    review.selectMatched();
    expect(map.setSelection).toHaveBeenLastCalledWith([3, 4]);
  });

  it("re-matches into the selection without storing, dirty only if different", async () => {
    const { review, map, match, store } = setup([4, 3]);
    await review.open(step1);
    await review.rematch();
    expect(match.runMatchFor).toHaveBeenCalledWith(step1);
    expect(map.setSelection).toHaveBeenLastCalledWith([4, 3]);
    expect(review.state?.dirty).toBe(false);
    expect(store.getSource()!.lines[0].subLines[1].segmentIds).toEqual([3, 4]);

    const other = setup([3, 4, 5]);
    await other.review.open(step1);
    await other.review.rematch();
    expect(other.review.state?.dirty).toBe(true);
  });

  it("tracks selection changes against the stored ids, ignoring order", async () => {
    const { review } = setup();
    await review.open(step1);
    review.selectionChanged([4, 3]);
    expect(review.state?.dirty).toBe(false);
    review.selectionChanged([3, 4, 9]);
    expect(review.state?.dirty).toBe(true);
  });

  it("saves the selection into that sub-line only, keeping later ones and the cursor", async () => {
    const { review, store, select } = setup();
    await review.open(step1);
    select([3, 4, 9]);
    review.selectionChanged([3, 4, 9]);
    review.save();
    const src = store.getSource()!;
    expect(src.lines[0].subLines.map((s) => s.segmentIds)).toEqual([[1, 2], [3, 4, 9], []]);
    expect(src.lines[0].subLines).toHaveLength(3);
    expect(src.cursor).toEqual({ lineIndex: 0, subLineIndex: 2 });
    expect(review.state?.dirty).toBe(false);
  });

  it("cancel puts the stored selection back", async () => {
    const { review, map } = setup();
    await review.open(step1);
    review.selectionChanged([9]);
    review.cancel();
    expect(map.setSelection).toHaveBeenLastCalledWith([3, 4]);
    expect(review.state?.dirty).toBe(false);
  });

  it("closes", async () => {
    const { review } = setup();
    await review.open(step1);
    review.close();
    expect(review.state).toBeNull();
  });
});

describe("reviewControlsFor", () => {
  const step = { lineIndex: 0, subLineIndex: 0 };
  it("hides everything outside a review", () => {
    const c = reviewControlsFor(null);
    expect([c.selectMatched, c.rematch, c.save, c.cancel].every((b) => !b.visible)).toBe(true);
  });
  it("offers select / re-match while clean, save / cancel once dirty", () => {
    const clean = reviewControlsFor({ step, dirty: false, busy: false });
    expect(clean.selectMatched.visible && clean.rematch.visible).toBe(true);
    expect(clean.save.visible || clean.cancel.visible).toBe(false);
    const dirty = reviewControlsFor({ step, dirty: true, busy: false });
    expect(dirty.save.visible && dirty.cancel.visible).toBe(true);
  });
  it("disables everything while re-matching", () => {
    const busy = reviewControlsFor({ step, dirty: false, busy: true });
    expect(busy.selectMatched.enabled || busy.rematch.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/StepReview.test.ts`
Expected: FAIL — cannot resolve `../controller/StepReview`.

- [ ] **Step 3: Implement**

`src/controller/StepReview.ts`:

```ts
// Review of one already-validated sub-line — the "editor within the
// editor": go to its map view, reselect its stored segments or re-run the
// matching on the same window, and save a corrected selection for that
// sub-line only. No SDK here: map, selection and matching come in as drivers.

import type { SourceStore } from "../state/SourceStore";
import { sameIds, type StepRef } from "../domain/steps";
import type { ButtonView } from "../ui/matchingUiState";

export interface ReviewState {
  step: StepRef;
  /** The WME selection differs from the stored segments of the step. */
  dirty: boolean;
  /** A re-match is running. */
  busy: boolean;
}

export interface StepReviewDeps {
  store: SourceStore;
  map: {
    setMapCenter(lon: number, lat: number, zoom: number): void;
    waitIdle(): Promise<void>;
    setSelection(ids: number[]): void;
    getSelection(): number[];
  };
  match: { runMatchFor(step: StepRef): Promise<number[]> };
  /** Called after every state change, to re-render. */
  onChange(): void;
}

export class StepReview {
  private current: ReviewState | null = null;

  constructor(private readonly deps: StepReviewDeps) {}

  get state(): ReviewState | null {
    return this.current;
  }

  async open(step: StepRef): Promise<void> {
    const sub = this.subLine(step);
    if (!sub?.validated) return;
    this.current = { step, dirty: false, busy: false };
    this.deps.onChange();
    this.deps.map.setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
    await this.deps.map.waitIdle();
  }

  close(): void {
    this.current = null;
    this.deps.onChange();
  }

  selectMatched(): void {
    const ids = this.storedIds();
    if (ids) this.deps.map.setSelection(ids);
  }

  /** Re-run the matching on the same window; the result only goes to the selection. */
  async rematch(): Promise<void> {
    const state = this.current;
    if (!state || state.busy) return;
    this.current = { ...state, busy: true };
    this.deps.onChange();
    try {
      const ids = await this.deps.match.runMatchFor(state.step);
      this.deps.map.setSelection(ids);
      this.selectionChanged(ids);
    } finally {
      if (this.current) this.current = { ...this.current, busy: false };
      this.deps.onChange();
    }
  }

  selectionChanged(ids: number[]): void {
    const stored = this.storedIds();
    if (!this.current || !stored) return;
    const dirty = !sameIds(ids, stored);
    if (dirty === this.current.dirty) return;
    this.current = { ...this.current, dirty };
    this.deps.onChange();
  }

  /** Store the current WME selection as this sub-line's segments (only this one). */
  save(): void {
    const state = this.current;
    if (!state) return;
    const { lineIndex, subLineIndex } = state.step;
    this.deps.store.validateSubLine(lineIndex, subLineIndex, this.deps.map.getSelection());
    this.current = { ...state, dirty: false };
    this.deps.onChange();
  }

  cancel(): void {
    const state = this.current;
    if (!state) return;
    this.selectMatched();
    this.current = { ...state, dirty: false };
    this.deps.onChange();
  }

  private subLine(step: StepRef) {
    return this.deps.store.getSource()?.lines[step.lineIndex]?.subLines[step.subLineIndex];
  }

  private storedIds(): number[] | null {
    return this.current ? (this.subLine(this.current.step)?.segmentIds ?? null) : null;
  }
}

export interface ReviewControls {
  selectMatched: ButtonView;
  rematch: ButtonView;
  save: ButtonView;
  cancel: ButtonView;
}

const HIDDEN: ButtonView = { visible: false, enabled: false };

export function reviewControlsFor(state: ReviewState | null): ReviewControls {
  if (!state) return { selectMatched: HIDDEN, rematch: HIDDEN, save: HIDDEN, cancel: HIDDEN };
  const enabled = !state.busy;
  const clean: ButtonView = { visible: !state.dirty, enabled };
  const dirty: ButtonView = { visible: state.dirty, enabled };
  return { selectMatched: clean, rematch: clean, save: dirty, cancel: dirty };
}
```

`SourceStore.validateSubLine` already overwrites only `src.lines[li].subLines[si]` (`segmentIds`, `validated`) and does not touch `cursor` — read `src/state/SourceStore.ts:34-40` to confirm before running the save test.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/__tests__/StepReview.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/controller/StepReview.ts src/__tests__/StepReview.test.ts
git commit -m "feat(controller): review a validated sub-line without touching the others"
```

---

### Task 3: Drop the destructive Back / Rerun / Reselect, add a non-destructive re-match

**Files:**
- Modify: `src/controller/LazyMatchingPipeline.ts`, `src/state/SourceStore.ts`, `src/ui/matchingUiState.ts`
- Modify tests: `src/__tests__/LazyMatchingPipeline.test.ts`, `src/__tests__/SourceStore.test.ts`, `src/__tests__/matchingUiState.test.ts`

**Interfaces:**
- Produces:
  - `LazyMatchingPipeline.rematchCurrent(): Promise<void>` — same window (map center + match) for the cursor's sub-line, result into `setSelection` and `getPendingMatched()`; nothing persisted.
  - `MatchingControlsView` loses `back`, `reselect`, `rerun`, gains `rematch: ButtonView`.
- Removes: `LazyMatchingPipeline.back()`, `LazyMatchingPipeline.rerunCurrent()`, `SourceStore.rerunSubLine()`.

- [ ] **Step 1: Update the tests first**

a) `src/__tests__/LazyMatchingPipeline.test.ts`: delete every `it(...)` that calls `pipeline.back()` or `pipeline.rerunCurrent()` (`grep -n "back()\|rerunCurrent()" src/__tests__/LazyMatchingPipeline.test.ts` — three back tests around lines 90-165 and the `rerunCurrent` test around line 240). Then add, reusing the file's existing setup helper (read the top of the file and use the same factory the `stepUntilValidation` tests use — it returns `{ pipeline, store, map, match }` or similar; adapt names to it):

```ts
  it("rematchCurrent re-runs the matching on the same sub-line without storing anything", async () => {
    // Arrange with the file's existing helper: one stepUntilValidation so the
    // cursor points at an unvalidated sub-line with a pending match.
    await pipeline.stepUntilValidation();
    const before = JSON.stringify(store.getSource());
    const runsBefore = match.runMatch.mock.calls.length;

    await pipeline.rematchCurrent();

    expect(match.runMatch.mock.calls.length).toBe(runsBefore + 1);
    expect(map.setSelection).toHaveBeenLastCalledWith(pipeline.getPendingMatched());
    expect(JSON.stringify(store.getSource())).toBe(before);
  });
```

b) `src/__tests__/SourceStore.test.ts`: delete the `rerunSubLine …` test (around line 85).

c) `src/__tests__/matchingUiState.test.ts` lines ~124 and ~132: replace `["validate", "skip", "back", "reselect", "rerun"]` by `["validate", "skip", "rematch"]` in both loops. Add:

```ts
  it("has no destructive back / reselect / rerun controls any more", () => {
    const keys = Object.keys(controlsFor({ kind: "waiting" }, true));
    expect(keys).not.toContain("back");
    expect(keys).not.toContain("reselect");
    expect(keys).not.toContain("rerun");
    expect(keys).toContain("rematch");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/LazyMatchingPipeline.test.ts src/__tests__/matchingUiState.test.ts`
Expected: FAIL — `rematchCurrent` is not a function; `rematch` key missing.

- [ ] **Step 3: Implement**

a) `src/controller/LazyMatchingPipeline.ts`: delete `back()` and `rerunCurrent()`; add after `validate`:

```ts
  /**
   * Re-run the matching of the cursor's sub-line on the same window. The
   * result goes to the selection and the pending match; nothing is stored,
   * so the operator still validates (or corrects) it.
   */
  async rematchCurrent(): Promise<void> {
    const src = this.opts.store.getSource();
    const cursor = src?.cursor;
    const sub = cursor ? src?.lines[cursor.lineIndex]?.subLines[cursor.subLineIndex] : undefined;
    if (!sub) return;
    this.opts.map.setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
    await this.opts.map.waitIdle();
    const matched = await this.opts.match.runMatch();
    this.opts.map.setSelection(matched);
    this.pendingMatched = matched;
  }
```

b) `src/state/SourceStore.ts`: delete `rerunSubLine` (whole method).

c) `src/ui/matchingUiState.ts`:
- `MatchingControlsView`: remove `back`, `reselect`, `rerun`; add `rematch: ButtonView;` after `skip`.
- `ALL_HIDDEN`: same edit (`rematch: HIDDEN`).
- `controlsFor`: `stepping` → `validate`, `skip`, `rematch`, `restart` all `SHOWN_DISABLED`; `waiting` → `validate`, `skip`, `rematch`, `restart` all `SHOWN`.

d) `src/ui/subtabs/MatchingSubTab.ts` (only what stops compiling here; the panel is rebuilt in Task 6):
- delete `onBackMatchingClick`, `onReselectMatchedClick`; rename `onRerunCurrentRowClick` to `onRematchClick` with body:

```ts
  private async onRematchClick(): Promise<void> {
    if (this.uiState.kind !== "waiting") return;
    const pipeline = this.lazyPipeline;
    if (!pipeline) return;
    this.setGuidedLoading(true, i18next.t("panel.matching.matchingInProgress"));
    try {
      await pipeline.rematchCurrent();
    } finally {
      this.setGuidedLoading(false);
    }
    this.renderSourceState();
  }
```

- delete the `guidedBackBtn` and `guidedReselectBtn` buttons/fields; the `guidedRerunBtn` becomes `guidedRematchBtn` (label `panel.matching.rematch`, click → `onRematchClick`); in `updateGuidedControls` drop the `back`/`reselect` lines and map `c.rematch` to `guidedRematchBtn`.
- Locales: add `panel.matching.rematch` = FR `"Relancer le matching"` / EN `"Re-run matching"`; delete `panel.matching.back`… **careful**: `panel.matching.back` is now the header's "Lignes" link (batch B) — keep it. Delete `panel.matching.reselectMatched` and `panel.matching.rerunCurrentRow` once `grep -rn "reselectMatched\|rerunCurrentRow" src` is empty.

- [ ] **Step 4: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass; only the pre-existing `waitForMapIdle.test.ts` type error.

- [ ] **Step 5: Commit**

```bash
git add src locales
git commit -m "refactor(matching): non-destructive re-match replaces Back / Rerun / Reselect"
```

---

### Task 4: Step navigation bar and "⋯" menu views

**Files:**
- Create: `src/ui/views/StepNavView.ts`, `src/ui/views/PanelMenuView.ts`
- Modify: `src/ui/styles.ts`, both locales
- Test: `src/__tests__/StepNavView.test.ts`, `src/__tests__/PanelMenuView.test.ts`

**Interfaces:**
- Produces:
  - `interface StepNavState { label: string; caption: string; validated: boolean; canPrev: boolean; canNext: boolean }`
  - `class StepNavView { root; constructor(props: { onPrev(): void; onNext(): void }); setState(state: StepNavState): void }`
  - `interface PanelMenuItem { label: string; onSelect(): void; danger?: boolean; disabled?: boolean }`
  - `class PanelMenuView { root; constructor(props: { label: string }); setItems(items: PanelMenuItem[]): void; close(): void; isOpen(): boolean }`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/StepNavView.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { StepNavView } from "../ui/views/StepNavView";

const state = {
  label: "Ligne 1/1 · sous-ligne 3/8",
  caption: "9.10 → 14.30 km",
  validated: true,
  canPrev: true,
  canNext: false,
};

describe("StepNavView", () => {
  it("shows the step and its window, ticked when validated", () => {
    const view = new StepNavView({ onPrev: vi.fn(), onNext: vi.fn() });
    view.setState(state);
    expect(view.root.textContent).toContain("Ligne 1/1 · sous-ligne 3/8");
    expect(view.root.textContent).toContain("9.10 → 14.30 km");
    expect(view.root.classList.contains("is-validated")).toBe(true);
  });

  it("moves with ‹ › and disables them at the ends or while busy", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const view = new StepNavView({ onPrev, onNext });
    view.setState(state);
    const [prev, next] = [...view.root.querySelectorAll<HTMLButtonElement>("button")];
    prev.click();
    expect(onPrev).toHaveBeenCalled();
    expect(next.disabled).toBe(true);
    view.setState({ ...state, canPrev: false });
    expect(prev.disabled).toBe(true);
  });
});
```

`src/__tests__/PanelMenuView.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PanelMenuView } from "../ui/views/PanelMenuView";

describe("PanelMenuView", () => {
  it("opens from its ⋯ button and runs the chosen item, then closes", () => {
    const debug = vi.fn();
    const menu = new PanelMenuView({ label: "Plus d'actions" });
    document.body.appendChild(menu.root);
    menu.setItems([{ label: "Debug", onSelect: debug }]);
    const toggle = menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-toggle")!;
    expect(toggle.title).toBe("Plus d'actions");
    expect(menu.isOpen()).toBe(false);
    toggle.click();
    expect(menu.isOpen()).toBe(true);
    menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-item")!.click();
    expect(debug).toHaveBeenCalled();
    expect(menu.isOpen()).toBe(false);
  });

  it("marks dangerous items and skips disabled ones", () => {
    const restart = vi.fn();
    const menu = new PanelMenuView({ label: "…" });
    menu.setItems([{ label: "Recommencer", onSelect: restart, danger: true, disabled: true }]);
    menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-toggle")!.click();
    const item = menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-item")!;
    expect(item.classList.contains("is-danger")).toBe(true);
    expect(item.disabled).toBe(true);
    item.click();
    expect(restart).not.toHaveBeenCalled();
  });

  it("closes on a click outside", () => {
    const menu = new PanelMenuView({ label: "…" });
    document.body.appendChild(menu.root);
    menu.setItems([{ label: "Debug", onSelect: vi.fn() }]);
    menu.root.querySelector<HTMLButtonElement>(".wmegj-menu-toggle")!.click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/StepNavView.test.ts src/__tests__/PanelMenuView.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`src/ui/views/StepNavView.ts`:

```ts
// "‹  Ligne 1/1 · sous-ligne 3/8  ›" with the km window underneath: steps
// through the validated sub-lines (and the one being validated).

export interface StepNavState {
  label: string;
  caption: string;
  validated: boolean;
  canPrev: boolean;
  canNext: boolean;
}

function arrow(icon: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wmegj-icon-only";
  const i = document.createElement("i");
  i.className = `w-icon ${icon}`;
  button.appendChild(i);
  return button;
}

export class StepNavView {
  readonly root: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly captionEl: HTMLElement;

  constructor(props: { onPrev: () => void; onNext: () => void }) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-step-nav";
    this.prev = arrow("w-icon-chevron-left");
    this.next = arrow("w-icon-chevron-right");
    this.prev.addEventListener("click", () => props.onPrev());
    this.next.addEventListener("click", () => props.onNext());

    const text = document.createElement("div");
    text.className = "wmegj-step-nav-text";
    this.labelEl = document.createElement("span");
    this.labelEl.className = "wmegj-step-nav-label";
    this.captionEl = document.createElement("span");
    this.captionEl.className = "wmegj-caption";
    text.append(this.labelEl, this.captionEl);

    this.root.append(this.prev, text, this.next);
  }

  setState(state: StepNavState): void {
    this.labelEl.textContent = state.label;
    this.captionEl.textContent = state.caption;
    this.root.classList.toggle("is-validated", state.validated);
    this.prev.disabled = !state.canPrev;
    this.next.disabled = !state.canNext;
  }
}
```

`src/ui/views/PanelMenuView.ts`:

```ts
// "⋯" button opening a small menu of secondary actions (Debug, copy debug
// JSON, restart). Closes after a choice or a click outside.

export interface PanelMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export class PanelMenuView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;

  constructor(props: { label: string }) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-menu";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wmegj-icon-only wmegj-menu-toggle";
    toggle.title = props.label;
    toggle.setAttribute("aria-label", props.label);
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.textContent = "⋯";
    toggle.addEventListener("click", () => (this.isOpen() ? this.close() : this.open()));

    this.list = document.createElement("div");
    this.list.className = "wmegj-menu-list";
    this.list.setAttribute("role", "menu");
    this.list.hidden = true;

    this.root.append(toggle, this.list);
  }

  setItems(items: PanelMenuItem[]): void {
    this.list.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = item.danger ? "wmegj-menu-item is-danger" : "wmegj-menu-item";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        button.disabled = item.disabled ?? false;
        button.addEventListener("click", () => {
          if (button.disabled) return;
          this.close();
          item.onSelect();
        });
        return button;
      }),
    );
  }

  isOpen(): boolean {
    return !this.list.hidden;
  }

  close(): void {
    this.list.hidden = true;
    document.removeEventListener("pointerdown", this.onOutside, true);
  }

  private open(): void {
    this.list.hidden = false;
    document.addEventListener("pointerdown", this.onOutside, true);
  }

  private readonly onOutside = (event: Event): void => {
    if (!this.root.contains(event.target as Node)) this.close();
  };
}
```

CSS (append to `BASE_CSS`):

```css
  .wmegj-step-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    background: var(--surface_default);
  }
  .wmegj-step-nav-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .wmegj-step-nav-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--content_default);
  }
  .wmegj-step-nav.is-validated .wmegj-step-nav-label::after {
    content: " ✓";
    color: var(--safe_variant);
  }
  .wmegj-menu {
    position: relative;
  }
  .wmegj-menu-toggle {
    font-size: 18px;
    line-height: 1;
  }
  .wmegj-menu-list {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 2;
    min-width: 200px;
    padding: 4px 0;
    border-radius: 8px;
    background: var(--background_default);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
  }
  .wmegj-menu-list[hidden] {
    display: none;
  }
  .wmegj-menu-item {
    padding: 8px 16px;
    border: none;
    background: none;
    color: var(--content_p1);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .wmegj-menu-item:hover:not(:disabled) {
    background: var(--background_variant);
  }
  .wmegj-menu-item.is-danger {
    color: var(--alarming_variant);
  }
  .wmegj-menu-item:disabled {
    color: var(--hairline_strong);
    cursor: default;
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/StepNavView.test.ts src/__tests__/PanelMenuView.test.ts src/__tests__/styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(ui): step navigation bar and ⋯ menu views"
```

---

### Task 5: Panel position and WME card styling

**Files:**
- Create: `src/ui/panelPosition.ts`
- Modify: `src/ui/styles.ts`, `src/ui/subtabs/MatchingSubTab.ts` (`injectStyles` guided rules, `restoreGuidedPanelLayout`, `openMatchingPanel`)
- Test: `src/__tests__/panelPosition.test.ts`, `src/__tests__/styles.test.ts`

**Interfaces:**
- Produces: `initialPanelPosition(input: { stored: { left: number; top: number } | null; sidebarRight: number; viewport: { width: number; height: number }; panel: { width: number; height: number } }): { left: number; top: number }`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/panelPosition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialPanelPosition } from "../ui/panelPosition";

const base = {
  sidebarRight: 330,
  viewport: { width: 1600, height: 900 },
  panel: { width: 360, height: 400 },
};

describe("initialPanelPosition", () => {
  it("opens next to the sidebar by default", () => {
    expect(initialPanelPosition({ ...base, stored: null })).toEqual({ left: 346, top: 72 });
  });

  it("keeps a stored position over the map", () => {
    expect(initialPanelPosition({ ...base, stored: { left: 900, top: 200 } })).toEqual({
      left: 900,
      top: 200,
    });
  });

  it("ignores a stored position over the sidebar or off-screen", () => {
    expect(initialPanelPosition({ ...base, stored: { left: 36, top: 386 } })).toEqual({
      left: 346,
      top: 72,
    });
    expect(initialPanelPosition({ ...base, stored: { left: 1500, top: 200 } })).toEqual({
      left: 346,
      top: 72,
    });
    expect(initialPanelPosition({ ...base, stored: { left: 900, top: 800 } })).toEqual({
      left: 346,
      top: 72,
    });
  });
});
```

Append to `src/__tests__/styles.test.ts` inside the `describe`:

```ts
  it("styles the matching panel as a WME card", () => {
    expect(BASE_CSS).toMatch(/\.wmegj-guided-overlay \{[^}]*background: var\(--background_default\);/);
    expect(BASE_CSS).toMatch(/\.wmegj-guided-overlay \{[^}]*box-shadow:/);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/panelPosition.test.ts src/__tests__/styles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/ui/panelPosition.ts`:

```ts
// Where the floating matching panel opens: where the operator last dropped
// it, unless that spot now covers the sidebar or leaves the window — then
// right next to the sidebar, over the map.

const GAP = 16;
const TOP = 72;

export function initialPanelPosition(input: {
  stored: { left: number; top: number } | null;
  sidebarRight: number;
  viewport: { width: number; height: number };
  panel: { width: number; height: number };
}): { left: number; top: number } {
  const fallback = { left: input.sidebarRight + GAP, top: TOP };
  const { stored, viewport, panel } = input;
  if (!stored) return fallback;
  const coversSidebar = stored.left < input.sidebarRight;
  const offScreen =
    stored.left + panel.width > viewport.width || stored.top + panel.height > viewport.height;
  return coversSidebar || offScreen ? fallback : stored;
}
```

In `MatchingSubTab`:
- `restoreGuidedPanelLayout(panel)`: keep only the collapsed-flag restore (`this.guidedCollapsed = …`); drop the position part.
- `openMatchingPanel()`: after `this.matchingPanelOpen = true;` and before `renderPhase`, position the panel:

```ts
    const panel = this.guidedMatchingRow;
    if (panel) {
      let stored: { left: number; top: number } | null = null;
      try {
        const raw = localStorage.getItem(MatchingSubTab.PANEL_POSITION_KEY);
        const parsed = raw ? (JSON.parse(raw) as { left?: unknown; top?: unknown }) : null;
        if (parsed && typeof parsed.left === "number" && typeof parsed.top === "number") {
          stored = { left: parsed.left, top: parsed.top };
        }
      } catch {
        // Ignore malformed or unavailable persisted layout.
      }
      const position = initialPanelPosition({
        stored,
        sidebarRight: this.tabPane?.getBoundingClientRect().right ?? 0,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        panel: { width: panel.offsetWidth || 360, height: panel.offsetHeight || 400 },
      });
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
```

  Import `initialPanelPosition` from `../panelPosition`. Every path that shows the panel goes through `openMatchingPanel()` (sidebar step 1 button); `onStartMatchingClick` / `onStartBurstClick` set `matchingPanelOpen = true` directly — replace those two lines by `this.openMatchingPanel();`.

- Move the guided-panel CSS out of `MatchingSubTab.injectStyles` into `BASE_CSS`, rewritten on tokens (delete `injectStyles` and its call in `buildRoot` once empty; `BASE_CSS` is injected by `MatchPanel.mount`). Replace **all** `.wmegj-guided-*` rules by:

```css
  .wmegj-guided-overlay {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    width: min(360px, calc(100vw - 24px));
    max-height: calc(100vh - 88px);
    border-radius: 8px;
    background: var(--background_default);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 0 1px rgba(0, 0, 0, 0.2);
    color: var(--content_p1);
    font-size: 14px;
    overflow: hidden;
  }
  .wmegj-guided-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 8px 8px 16px;
    cursor: move;
    user-select: none;
  }
  .wmegj-guided-title-wrap {
    flex: 1 1 auto;
    min-width: 0;
  }
  .wmegj-guided-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--content_default);
  }
  .wmegj-guided-status {
    font-size: 12px;
    color: var(--content_p3);
  }
  .wmegj-guided-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .wmegj-guided-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--content_p2);
    cursor: pointer;
  }
  .wmegj-guided-icon-button:hover {
    background: var(--surface_default);
  }
  .wmegj-guided-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 16px 16px;
    overflow-y: auto;
  }
  .wmegj-guided-tabpane {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wmegj-guided-row {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--content_default);
  }
  .wmegj-guided-count,
  .wmegj-guided-instruction,
  .wmegj-guided-meta,
  .wmegj-guided-feedback {
    margin: 0;
    font-size: 13px;
    color: var(--content_p2);
  }
  .wmegj-guided-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .wmegj-guided-actions > * {
    flex: 1 1 auto;
  }
  .wmegj-guided-loader {
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--content_p2);
  }
  .wmegj-guided-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--hairline);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: wmegj-spin 0.7s linear infinite;
  }
  .wmegj-guided-debug-title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
  }
  .wmegj-guided-debug-body {
    font-size: 12px;
    color: var(--content_p2);
    overflow-wrap: anywhere;
  }
  .wmegj-guided-steps {
    margin: 4px 0 0;
    padding-left: 16px;
  }
```

  (`@keyframes wmegj-spin` already exists in `BASE_CSS` from batch B. The `@media (max-width: 640px)` block and `wmegj-guided-button--*` / `wmegj-guided-tab*` / `wmegj-guided-secondary-actions` / `wmegj-guided-reset-actions` rules are dropped: buttons use the shared `.wmegj-button` styles, tabs and the reset row disappear in Task 6.)

- [ ] **Step 4: Run tests, type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass; only the pre-existing type error.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(ui): matching panel opens next to the sidebar, styled as a WME card"
```

---

### Task 6: Wire navigation, review and menu into the panel

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`, both locales
- Test: `src/__tests__/matchingPanelText.test.ts` (new, pure helpers exported from a new `src/ui/matchingPanelText.ts`)
- Create: `src/ui/matchingPanelText.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (pure, in `src/ui/matchingPanelText.ts`):
  - `instructionKey(input: { run: MatchingUiState["kind"]; review: ReviewState | null; hasValidated: boolean }): string` — the i18n key of the panel instruction.
  - `navEnabled(run: MatchingUiState["kind"], review: ReviewState | null): boolean`
  - `stepNavState(source: Source, current: StepRef | null, steps: StepRef[], enabled: boolean): StepNavState`

- [ ] **Step 1: Write the failing test**

`src/__tests__/matchingPanelText.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { instructionKey, navEnabled, stepNavState } from "../ui/matchingPanelText";
import type { Source, SubLine } from "../domain/types";
import { initFrench } from "./helpers/i18nFr";

beforeAll(initFrench);

const step = { lineIndex: 0, subLineIndex: 1 };

describe("instructionKey", () => {
  it("guides each situation with one sentence", () => {
    expect(instructionKey({ run: "idle", review: null, hasValidated: false })).toBe(
      "panel.matching.instructions.idle",
    );
    expect(instructionKey({ run: "idle", review: null, hasValidated: true })).toBe(
      "panel.matching.instructions.idleBrowse",
    );
    expect(instructionKey({ run: "waiting", review: null, hasValidated: true })).toBe(
      "panel.matching.validateOrCorrect",
    );
    expect(instructionKey({ run: "done", review: null, hasValidated: true })).toBe(
      "panel.matching.instructions.done",
    );
    expect(
      instructionKey({ run: "done", review: { step, dirty: false, busy: false }, hasValidated: true }),
    ).toBe("panel.matching.instructions.review");
    expect(
      instructionKey({ run: "waiting", review: { step, dirty: true, busy: false }, hasValidated: true }),
    ).toBe("panel.matching.instructions.reviewDirty");
  });
});

describe("navEnabled", () => {
  it("only while matching is not running", () => {
    for (const run of ["idle", "waiting", "paused", "error", "done"] as const) {
      expect(navEnabled(run, null)).toBe(true);
    }
    for (const run of ["stepping", "bursting", "pausePending"] as const) {
      expect(navEnabled(run, null)).toBe(false);
    }
    expect(navEnabled("done", { step, dirty: false, busy: true })).toBe(false);
  });
});

describe("stepNavState", () => {
  function sub(index: number, validated: boolean): SubLine {
    return {
      index,
      kmA: index * 2,
      kmB: index * 2 + 2,
      bbox: [0, 0, 0, 0],
      view: { lon: 0, lat: 0, zoom: 16 },
      segmentIds: validated ? [1, 2, 3] : [],
      validated,
    };
  }
  const source: Source = {
    schemaVersion: 1,
    sourceId: "s",
    kind: "geojson",
    hasCsv: false,
    cursor: null,
    lines: [
      {
        index: 0,
        bbox: [0, 0, 0, 0],
        geometry: { type: "MultiLineString", coordinates: [] },
        lengthKm: 6,
        subLines: [sub(0, true), sub(1, true), sub(2, true)],
        pendingTail: [],
      },
    ],
  };
  const steps = [0, 1, 2].map((subLineIndex) => ({ lineIndex: 0, subLineIndex }));

  it("labels the current step, its window and its segments", () => {
    const nav = stepNavState(source, step, steps, true);
    expect(nav.label).toBe("Ligne 1/1 · sous-ligne 2/3");
    expect(nav.caption).toBe("2.00 → 4.00 km · 3 segment(s)");
    expect(nav).toMatchObject({ validated: true, canPrev: true, canNext: true });
  });

  it("from outside the steps, only goes back to the last one", () => {
    const nav = stepNavState(source, null, steps, true);
    expect(nav).toMatchObject({ canPrev: true, canNext: false });
    expect(nav.label).toBe("3 sous-ligne(s) validée(s)");
  });

  it("is frozen while disabled", () => {
    expect(stepNavState(source, step, steps, false)).toMatchObject({ canPrev: false, canNext: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/matchingPanelText.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure helpers**

`src/ui/matchingPanelText.ts`:

```ts
// Pure texts and flags of the matching panel, from the run state, the review
// state and the Source. Kept out of MatchingSubTab so they are testable.

import { i18next } from "../../locales/i18n";
import type { ReviewState } from "../controller/StepReview";
import { neighbour, type StepRef } from "../domain/steps";
import type { Source } from "../domain/types";
import type { MatchingUiState } from "./matchingUiState";
import type { StepNavState } from "./views/StepNavView";

type RunKind = MatchingUiState["kind"];

export function instructionKey(input: {
  run: RunKind;
  review: ReviewState | null;
  hasValidated: boolean;
}): string {
  if (input.review) {
    return input.review.dirty
      ? "panel.matching.instructions.reviewDirty"
      : "panel.matching.instructions.review";
  }
  switch (input.run) {
    case "idle":
      return input.hasValidated
        ? "panel.matching.instructions.idleBrowse"
        : "panel.matching.instructions.idle";
    case "waiting":
      return "panel.matching.validateOrCorrect";
    case "done":
      return "panel.matching.instructions.done";
    case "bursting":
    case "pausePending":
      return "panel.matching.burstRunning";
    case "paused":
      return "panel.matching.instructions.paused";
    case "stepping":
      return "panel.matching.matchingInProgress";
    case "error":
      return "panel.matching.instructions.error";
  }
}

export function navEnabled(run: RunKind, review: ReviewState | null): boolean {
  const running = run === "stepping" || run === "bursting" || run === "pausePending";
  return !running && !review?.busy;
}

export function stepNavState(
  source: Source,
  current: StepRef | null,
  steps: StepRef[],
  enabled: boolean,
): StepNavState {
  const canPrev = enabled && neighbour(steps, current, -1) !== null;
  const canNext = enabled && neighbour(steps, current, 1) !== null;
  const line = current ? source.lines[current.lineIndex] : undefined;
  const sub = current ? line?.subLines[current.subLineIndex] : undefined;
  if (!current || !line || !sub) {
    const validated = steps.filter(
      (s) => source.lines[s.lineIndex]?.subLines[s.subLineIndex]?.validated,
    ).length;
    return {
      label: i18next.t("panel.matching.nav.summary", { count: validated }),
      caption: "",
      validated: false,
      canPrev,
      canNext,
    };
  }
  // The sub-line total is only known once the line is fully cut.
  const subTotal = line.pendingTail.length === 0 ? line.subLines.length : null;
  const label = i18next.t(
    subTotal === null ? "panel.matching.nav.label" : "panel.matching.nav.labelOf",
    {
      line: current.lineIndex + 1,
      lines: source.lines.length,
      sub: current.subLineIndex + 1,
      subs: subTotal ?? 0,
    },
  );
  const window = `${sub.kmA.toFixed(2)} → ${sub.kmB.toFixed(2)} km`;
  const caption = sub.validated
    ? `${window} · ${i18next.t("panel.matching.nav.segments", { count: sub.segmentIds.length })}`
    : `${window} · ${i18next.t("panel.matching.nav.toValidate")}`;
  return { label, caption, validated: sub.validated, canPrev, canNext };
}
```

Locales (both files):
- FR `panel.matching.nav`: `{ "prev": "Sous-ligne précédente", "next": "Sous-ligne suivante", "label": "Ligne {{line}}/{{lines}} · sous-ligne {{sub}}", "labelOf": "Ligne {{line}}/{{lines}} · sous-ligne {{sub}}/{{subs}}", "segments": "{{count}} segment(s)", "toValidate": "à valider", "summary": "{{count}} sous-ligne(s) validée(s)" }`
- EN `panel.matching.nav`: `{ "prev": "Previous sub-line", "next": "Next sub-line", "label": "Line {{line}}/{{lines}} · sub-line {{sub}}", "labelOf": "Line {{line}}/{{lines}} · sub-line {{sub}}/{{subs}}", "segments": "{{count}} segment(s)", "toValidate": "to validate", "summary": "{{count}} validated sub-line(s)" }`
- FR `panel.matching.instructions`: `{ "idle": "Démarrez la correspondance : manuelle pour valider chaque sous-ligne, automatique pour tout enchaîner.", "idleBrowse": "Reprenez la correspondance, ou parcourez les sous-lignes déjà validées avec ‹ ›.", "review": "Sous-ligne validée. Resélectionnez ses segments ou relancez le matching, corrigez la sélection dans WME puis enregistrez.", "reviewDirty": "La sélection a changé. Enregistrez-la pour cette sous-ligne, ou annulez.", "done": "Toutes les sous-lignes sont validées. Appliquez les fermetures depuis la barre latérale, ou parcourez-les avec ‹ ›.", "paused": "En pause. Reprenez, ou parcourez les sous-lignes validées avec ‹ ›.", "error": "Le matching a échoué. Réessayez." }`
- EN `panel.matching.instructions`: `{ "idle": "Start matching: manual to validate each sub-line, automatic to run through all of them.", "idleBrowse": "Resume matching, or browse the validated sub-lines with ‹ ›.", "review": "Validated sub-line. Reselect its segments or re-run the matching, correct the selection in WME, then save.", "reviewDirty": "The selection changed. Save it for this sub-line, or cancel.", "done": "Every sub-line is validated. Apply the closures from the sidebar, or browse them with ‹ ›.", "paused": "Paused. Resume, or browse the validated sub-lines with ‹ ›.", "error": "Matching failed. Try again." }`
- FR `panel.matching.review`: `{ "selectMatched": "Sélectionner les segments matchés", "save": "Enregistrer", "cancel": "Annuler", "discardTitle": "Abandonner les modifications ?", "discardMessage": "La sélection modifiée de cette sous-ligne n'est pas enregistrée.", "discard": "Abandonner", "stay": "Rester" }`
- EN `panel.matching.review`: `{ "selectMatched": "Select matched segments", "save": "Save", "cancel": "Cancel", "discardTitle": "Discard changes?", "discardMessage": "The changed selection of this sub-line is not saved.", "discard": "Discard", "stay": "Stay" }`
- FR `panel.matching.menu`: `{ "more": "Plus d'actions", "debug": "Debug", "backToMatching": "Retour à la correspondance" }`; EN `{ "more": "More actions", "debug": "Debug", "backToMatching": "Back to matching" }`.
- Keep `panel.matching.validateOrCorrect` but reword FR to `"Vérifiez la sélection dans WME, corrigez-la si besoin, puis validez."` and EN to `"Check the selection in WME, correct it if needed, then validate."`.
- Delete `panel.matching.tabs` (both) once unused.

Run: `npx vitest run src/__tests__/matchingPanelText.test.ts` → PASS.

- [ ] **Step 4: Wire it into `MatchingSubTab`**

Read `src/ui/subtabs/MatchingSubTab.ts` from `buildGuidedMatchingRow` to `updateGuidedControls` first. Then:

a) **Fields and construction.** Add imports (`StepReview`, `reviewControlsFor`, `type ReviewState` from `../../controller/StepReview`; `navigableSteps`, `frontierStep`, `neighbour`, `sameStep`, `type StepRef` from `../../domain/steps`; `StepNavView`; `PanelMenuView`; `instructionKey`, `navEnabled`, `stepNavState` from `../matchingPanelText`). Add fields:

```ts
  private review: StepReview | null = null;
  private stepNav: StepNavView | null = null;
  private panelMenu: PanelMenuView | null = null;
  private guidedSelectMatchedBtn: HTMLElement | null = null;
  private guidedReviewRematchBtn: HTMLElement | null = null;
  private guidedSaveBtn: HTMLElement | null = null;
  private guidedCancelBtn: HTMLElement | null = null;
  private unsubscribeSelectionChanged: (() => void) | null = null;
```

  `review` is created in `buildRoot()` (after `this.buildDOM(root)`):

```ts
    this.review = new StepReview({
      store: this.sourceStore,
      map: {
        setMapCenter: (lon, lat, zoom) => this.buildMapDriver().setMapCenter(lon, lat, zoom),
        waitIdle: () => waitForMapIdle(this.wmeSDK, { settleDelayMs: 650 }),
        setSelection: (ids) => this.buildMapDriver().setSelection(ids),
        getSelection: () => this.readSelectionSegmentIds(),
      },
      match: { runMatchFor: (step) => this.runMatchFor(step) },
      onChange: () => {
        this.renderSourceState();
        this.updateGuidedControls();
      },
    });
    try {
      this.unsubscribeSelectionChanged = this.wmeSDK.Events.on({
        eventName: "wme-selection-changed",
        eventHandler: () => this.review?.selectionChanged(this.readSelectionSegmentIds()),
      });
    } catch (err) {
      logger.warn("MatchingSubTab.buildRoot: failed to subscribe to wme-selection-changed", err);
    }
```

  and `unmount()` calls `this.unsubscribeSelectionChanged?.()` and nulls `review`, `stepNav`, `panelMenu`, the four new buttons.

b) **Match driver for any step.** Split `buildMatchDriver().runMatch` into a method `runMatchFor(step: StepRef): Promise<number[]>` holding today's body with `lineIndex/subLineIndex` taken from `step` (not from `src.cursor`), and keep `runMatch: async () => { const cursor = this.sourceStore.getSource()?.cursor; return cursor ? this.runMatchFor(cursor) : []; }`. `runMatchFor` must first center on the sub-line view (`this.buildMapDriver().setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom)` + `await waitForMapIdle(...)`) only when called from the review — the pipeline already centers before `runMatch`. To keep one code path, `StepReview.open()` centers the map (Task 2), so `runMatchFor` does **not** center; the review re-match happens on the view `open()` set.

c) **Header: menu instead of tabs and reset row.** In `buildGuidedMatchingRow`:
- insert the menu before the collapse button:

```ts
    this.panelMenu = new PanelMenuView({ label: i18next.t("panel.matching.menu.more") });
    headerActions.appendChild(this.panelMenu.root);
```

- delete the tab row (`tabRow`, `guidedTabMatchEl`, `guidedTabDebugEl`, `buildGuidedTab`); the debug pane gets, as its first child, a text button `wzButton({ text: "← " + i18next.t("panel.matching.menu.backToMatching"), variant: "text", onClick: () => this.setGuidedActiveTab("match") })`;
- delete the `restartActions` row and `guidedRestartBtn` (restart moves to the menu); delete the `manualToolsActions` row — `guidedRematchBtn` (Task 3) moves into `matchActions`;
- insert the nav bar at the top of `matchPane`, before `headerEl`:

```ts
    this.stepNav = new StepNavView({
      onPrev: () => void this.navigate(-1),
      onNext: () => void this.navigate(1),
    });
    matchPane.appendChild(this.stepNav.root);
```

- add the review buttons to `matchActions` (after `guidedRematchBtn`):

```ts
    this.guidedSelectMatchedBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.review.selectMatched"),
      variant: "primary",
      onClick: () => this.review?.selectMatched(),
    });
    this.guidedReviewRematchBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.rematch"),
      variant: "secondary",
      onClick: () => void this.review?.rematch(),
    });
    this.guidedSaveBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.review.save"),
      variant: "primary",
      onClick: () => this.review?.save(),
    });
    this.guidedCancelBtn = this.appendGuidedButton(matchActions, {
      text: i18next.t("panel.matching.review.cancel"),
      variant: "secondary",
      onClick: () => this.review?.cancel(),
    });
```

- the start-burst button becomes `variant: "secondary"` (one primary per state: manual start is the primary).

d) **Navigation.**

```ts
  /** The sub-line shown in the panel: the reviewed one, else the one being validated. */
  private currentStep(): StepRef | null {
    const reviewed = this.review?.state?.step;
    if (reviewed) return reviewed;
    return this.uiState.kind === "waiting" ? frontierStep(this.sourceStore.getSource()) : null;
  }

  private navSteps(): StepRef[] {
    return navigableSteps(this.sourceStore.getSource(), this.uiState.kind === "waiting");
  }

  private async navigate(direction: -1 | 1): Promise<void> {
    if (!navEnabled(this.uiState.kind, this.review?.state ?? null)) return;
    const target = neighbour(this.navSteps(), this.currentStep(), direction);
    if (!target || !(await this.confirmDiscardReview())) return;
    const frontier = this.uiState.kind === "waiting" ? frontierStep(this.sourceStore.getSource()) : null;
    if (sameStep(target, frontier)) {
      // Back on the sub-line being validated: show its pending match again.
      this.review?.close();
      const pipeline = this.lazyPipeline;
      const src = this.sourceStore.getSource();
      const sub = src?.lines[target.lineIndex]?.subLines[target.subLineIndex];
      if (sub) this.buildMapDriver().setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
      this.buildMapDriver().setSelection(pipeline?.getPendingMatched() ?? []);
      return;
    }
    await this.review?.open(target);
  }

  /** true when there is nothing unsaved, or the operator chose to discard it. */
  private async confirmDiscardReview(): Promise<boolean> {
    if (!this.review?.state?.dirty) return true;
    const discard = await confirmDialog({
      title: i18next.t("panel.matching.review.discardTitle"),
      message: i18next.t("panel.matching.review.discardMessage"),
      confirmLabel: i18next.t("panel.matching.review.discard"),
      cancelLabel: i18next.t("panel.matching.review.stay"),
    });
    if (discard) this.review.cancel();
    return discard;
  }
```

- `closeMatchingPanel()` becomes async-guarded: start with `if (!(await this.confirmDiscardReview())) return;` then `this.review?.close();` and keep the existing body. Its callers use `void this.closeMatchingPanel()`.
- Every **run** action closes the review first: at the top of `onStartMatchingClick`, `onStartBurstClick`, `onResumeBurstClick`, `onValidateClick`, `onSkipMatchingClick`, `onRematchClick`, `onRetryClick` add `this.review?.close();` (they only run when no review is shown, because `updateGuidedControls` hides run buttons during a review, but closing keeps the state honest).
- `onSelectedLineChangedAsync` and `rebuildSourceWithCsv` and the restart path: call `this.review?.close();` (a line change discards an unsaved review without asking — it is triggered from the sidebar list, outside the panel).

e) **Rendering.**
- `renderSourceState()`: replace `const cursor = src.cursor;` by `const cursor = this.currentStep() ?? src.cursor;` so header, segment count and highlighted slice follow the reviewed sub-line. For a validated sub-line the count already uses `sub.segmentIds.length`.
- `updateGuidedControls()`:

```ts
  private updateGuidedControls(): void {
    const hasSource = this.sourceStore.getSource() !== null;
    const reviewState = this.review?.state ?? null;
    const run = controlsFor(this.uiState, hasSource);
    const hidden: ButtonView = { visible: false, enabled: false };
    // While a validated sub-line is reviewed, its own controls replace the run controls.
    const c = reviewState
      ? { ...run, start: hidden, startBurst: hidden, validate: hidden, skip: hidden, rematch: hidden, resume: hidden, retry: hidden, doneClose: hidden }
      : run;
    this.applyButtonView(this.guidedStartBtn, c.start);
    this.applyButtonView(this.guidedStartBurstBtn, c.startBurst);
    this.applyButtonView(this.guidedValidateBtn, c.validate);
    this.applyButtonView(this.guidedSkipBtn, c.skip);
    this.applyButtonView(this.guidedRematchBtn, c.rematch);
    this.applyButtonView(this.guidedPauseBtn, c.pause);
    this.applyButtonView(this.guidedResumeBtn, c.resume);
    this.applyButtonView(this.guidedRetryBtn, c.retry);
    this.applyButtonView(this.guidedDoneCloseBtn, c.doneClose);

    const r = reviewControlsFor(reviewState);
    this.applyButtonView(this.guidedSelectMatchedBtn, r.selectMatched);
    this.applyButtonView(this.guidedReviewRematchBtn, r.rematch);
    this.applyButtonView(this.guidedSaveBtn, r.save);
    this.applyButtonView(this.guidedCancelBtn, r.cancel);

    const src = this.sourceStore.getSource();
    const steps = this.navSteps();
    if (this.stepNav && src) {
      this.stepNav.root.hidden = steps.length === 0;
      this.stepNav.setState(
        stepNavState(src, this.currentStep(), steps, navEnabled(this.uiState.kind, reviewState)),
      );
    }

    if (this.guidedInstructionEl) {
      const hasValidated = navigableSteps(src, false).length > 0;
      this.guidedInstructionEl.textContent = i18next.t(
        instructionKey({ run: this.uiState.kind, review: reviewState, hasValidated }),
      );
    }

    this.panelMenu?.setItems([
      { label: i18next.t("panel.matching.menu.debug"), onSelect: () => this.setGuidedActiveTab("debug") },
      { label: i18next.t("panel.matching.copyDebugJson"), onSelect: () => void this.onCopyDebugJsonClick() },
      {
        label: i18next.t("panel.matching.restartFromScratch"),
        onSelect: () => this.onRestartFromScratchClick(),
        danger: true,
        disabled: !(c.restart.visible && c.restart.enabled),
      },
    ]);

    if (this.guidedStatusEl) {
      this.guidedStatusEl.textContent = i18next.t(
        `panel.matching.panelStatus.${statusKeyFor(this.uiState)}`,
      );
    }
  }
```

  (`ButtonView` is already imported from `../matchingUiState`.) The old instruction writes (`guidedInstructionEl.textContent = …` in `onStartMatchingClick`, `onStartBurstClick`, `resetGuidedSessionState`, `applyTransitionEffects` error branch, `runStep`/burst stall paths) can stay or be removed — `updateGuidedControls()` runs after every `dispatch` and overwrites them; remove the ones that set `validateOrCorrect` / `burstRunning` to avoid two sources of truth, keep the error message one (`stepError` with the message) but move it: in `updateGuidedControls`, when `this.uiState.kind === "error"`, use `i18next.t("panel.matching.stepError", { message: this.uiState.message })` instead of the `instructions.error` key.
- `renderSourceState()` is called on every source change; also call `this.updateGuidedControls()` at its end so the nav bar follows validations.

f) Delete the now-unused `panel.matching.tabs` keys and `setGuidedActiveTab`'s tab-button styling code (keep the method: it still toggles `guidedMatchPaneEl` / `guidedDebugPaneEl`).

- [ ] **Step 5: Run tests, type-check, lint, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npx eslint src/ui/subtabs/MatchingSubTab.ts src/ui/matchingPanelText.ts && npm run compile`
Expected: all pass; only the pre-existing type error; lint clean; bundle written.

- [ ] **Step 6: Commit**

```bash
git add src locales
git commit -m "feat(ui): browse, reselect, re-match and save validated sub-lines from the panel"
```

---

### Task 7: Browser verification of batch C

Done by the controller (needs the user's logged-in WME tab).

- [ ] Reload WME; open the rally line "SS7+11 Les Cols" (already fully matched) → "Revoir la correspondance": the panel opens next to the sidebar (not over it), status "Prêt", instruction "Reprenez… ou parcourez…", nav bar "8 sous-ligne(s) validée(s)" with ‹ enabled.
- [ ] ‹ → "Ligne 1/1 · sous-ligne 8/8 ✓", map centred on it, buttons "Sélectionner les segments matchés" (primary) + "Relancer le matching". Click "Sélectionner…" → its segments selected in WME.
- [ ] Deselect one segment in WME (ctrl-click) → "Enregistrer" / "Annuler" appear; "Annuler" restores the selection. Change again, ‹ → the discard dialog appears; "Rester" keeps the sub-line.
- [ ] **Do not click "Enregistrer"** on the user's data unless the selection is identical to the stored one (or restore it afterwards) — the review must not alter the user's matching.
- [ ] "⋯" menu: Debug opens the debug view with "← Retour à la correspondance"; "Recommencer à zéro" is red — click it and **cancel** the dialog.
- [ ] Drag the panel, close, reopen: it reopens where dropped; drag it over the sidebar, reopen: it reopens next to the sidebar.
- [ ] Each fix found gets a regression test first, then `fix(ui): …`.
