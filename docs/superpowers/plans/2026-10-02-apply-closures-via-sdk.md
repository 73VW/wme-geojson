# Apply Closures via SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once matching is complete, a new "Apply closures" button adds the road closures directly in WME with `wmeSDK.DataModel.RoadClosures.addClosure`, moving the map sub-line view by sub-line view (bbox by bbox) so every segment is in the data model when its closure is added.

**Architecture:** The export already knows, for every closure group, the `MapAnchor` (`sub.view`) the segments were matched in — that view is the bbox that guarantees the segments are loaded. A pure planner (`src/csv/planClosureStops.ts`) turns the existing closure data into an ordered list of *stops* (one per distinct view, each carrying its closures). A controller (`src/controller/ClosureApplier.ts`) walks the stops through a small driver interface (same pattern as `MapDriver` in `LazyMatchingPipeline`), skips closures that already exist, and collects per-segment failures instead of aborting. `MatchingSubTab` wires the SDK driver, the button gating and the progress/summary display.

**Tech Stack:** TypeScript strict, vitest, `wme-sdk-typings`, i18next.

**Spec:** this conversation's request (no separate spec doc):
- Replace "download CSV" with direct closure creation via `RoadClosures.addClosure`, moving bbox by bbox.
- The apply button is disabled until matching is done. An MTE is **not** required.

## Global Constraints

- `addClosure` throws `DataModelNotFoundError` when the segment is not in the data model → always center on the sub-line view and `waitForMapIdle` before adding that stop's closures.
- `addClosure` dates are Unix ms. Our ISO strings are `"YYYY-MM-DDTHH:MM"` without offset → `new Date(iso).getTime()` (local browser time; users are in CH, same tz as the closures).
- CSV `direction = TWO WAY` mapping: two-way segment → `isForward: true` and `false`; `isAtoB` → `true` only; `isBtoA` → `false` only.
- `fromNodeClosed: false` (Advanced Closures default for imports).
- `isPermanent = fields.ignoreTraffic`; `description = fields.reason`; `trafficEventId = fields.mteId || null`.
- Never auto-save. Closures stay as unsaved edits; the user clicks WME's Save.
- `src/csv/` stays SDK-free. SDK calls live only in `MatchingSubTab` (the driver object).
- All user-facing strings in `locales/en/common.json` and `locales/fr/common.json`.

## Review Focus

1. **Re-run after a partial failure** → must not duplicate closures already added (pinned by Task 3 "skips existing" test).
2. **Segment not loaded at its stop** (deleted since matching, or view too tight) → recorded as failed with its id, run continues (Task 3 "missing segment" test).
3. **`addClosure` throws for one segment** (locked segment, no edit rights) → recorded with the error message, other segments still processed (Task 3 "add throws" test).
4. **MTE id given but the MTE is not in the data model** → every closure of the stop would throw; fail the stop's closures with an explicit reason instead of N cryptic errors (Task 3 "missing MTE" test).
5. **Same segment in two sub-line views** (junction overlap) → closed once per window, not twice (covered by the existing-closure check, Task 3 "skips existing" test, and Task 2 "same view is merged" test).

---

## File Structure

- Create `src/domain/isMatchingComplete.ts` — pure predicate on `Source`.
- Create `src/csv/planClosureStops.ts` — pure: closure data → ordered stops; `directionsFor`; `isoToMs`.
- Create `src/controller/ClosureApplier.ts` — walks stops through a driver, returns a report.
- Modify `src/ui/subtabs/MatchingSubTab.ts` — apply button, gating, SDK driver, summary. The CSV download stays as a secondary fallback button (same transition pattern as the MTE copy/paste popup).
- Modify `locales/en/common.json`, `locales/fr/common.json`.
- Tests: `src/__tests__/isMatchingComplete.test.ts`, `src/__tests__/planClosureStops.test.ts`, `src/__tests__/ClosureApplier.test.ts`.

---

### Task 1: `isMatchingComplete`

"Matching done" = every line has no `pendingTail` left, at least one sub-line, and every sub-line validated. `uiState.kind === "done"` / phase `"done"` are not usable: they reset to `csv-loaded` when the guided panel closes and are not restored from persistence.

**Files:**
- Create: `src/domain/isMatchingComplete.ts`
- Test: `src/__tests__/isMatchingComplete.test.ts`

**Interfaces:**
- Produces: `export function isMatchingComplete(source: Source | null): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isMatchingComplete } from "../domain/isMatchingComplete";
import type { Line, Source, SubLine } from "../domain/types";

function sub(validated: boolean): SubLine {
  return {
    index: 0,
    kmA: 0,
    kmB: 1,
    bbox: [0, 0, 1, 1],
    view: { lon: 0, lat: 0, zoom: 17 },
    segmentIds: validated ? [1] : [],
    validated,
  };
}

function line(subLines: SubLine[], pendingTail: Line["pendingTail"] = []): Line {
  return {
    index: 0,
    bbox: [0, 0, 1, 1],
    geometry: { type: "MultiLineString", coordinates: [] },
    lengthKm: 1,
    subLines,
    pendingTail,
  };
}

function source(lines: Line[]): Source {
  return { schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv: false, lines, cursor: null };
}

describe("isMatchingComplete", () => {
  it("is false without a source", () => {
    expect(isMatchingComplete(null)).toBe(false);
  });
  it("is false when a sub-line is not validated", () => {
    expect(isMatchingComplete(source([line([sub(true), sub(false)])]))).toBe(false);
  });
  it("is false while a pending tail remains", () => {
    expect(isMatchingComplete(source([line([sub(true)], [{ kmA: 1, kmB: 2 }])]))).toBe(false);
  });
  it("is false when a line has no sub-line yet", () => {
    expect(isMatchingComplete(source([line([sub(true)]), line([])]))).toBe(false);
  });
  it("is true when every sub-line of every line is validated", () => {
    expect(isMatchingComplete(source([line([sub(true)]), line([sub(true)])]))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/isMatchingComplete.test.ts`
Expected: FAIL — cannot resolve `../domain/isMatchingComplete`.

- [ ] **Step 3: Implement**

```ts
import type { Source } from "./types";

/**
 * True once every line of the source is fully cut into sub-lines and each
 * sub-line has been validated (or skipped) by the operator. Sub-lines are
 * created lazily, so a non-empty pendingTail means matching is not over.
 */
export function isMatchingComplete(source: Source | null): boolean {
  if (!source || source.lines.length === 0) return false;
  return source.lines.every((line) => {
    const fullyCut = line.pendingTail.length === 0 && line.subLines.length > 0;
    return fullyCut && line.subLines.every((sub) => sub.validated);
  });
}
```

Note: check while implementing how "skip" is stored on a sub-line (grep `validated = true` / `skip` in `LazyMatchingPipeline.ts`). If a skipped sub-line keeps `validated: false`, the predicate must also accept it — adjust and add a test for that case.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/isMatchingComplete.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/isMatchingComplete.ts src/__tests__/isMatchingComplete.test.ts
git commit -m "feat(closures): add isMatchingComplete predicate"
```

---

### Task 2: `planClosureStops` (pure planner)

Both export modes already resolve to "segments + window + view":
- `global-times`: `windows × closures.groups` (same expansion as `buildGlobalClosureRows`).
- `per-line-times`: `groupByWindow(closures.bySegment)` → `WindowGroup { startISO, endISO, geo, segmentIds }`.

The planner merges items sharing the same view into one stop so the map moves once per bbox, keeping first-seen (roadbook) order.

**Files:**
- Create: `src/csv/planClosureStops.ts`
- Test: `src/__tests__/planClosureStops.test.ts`

**Interfaces:**
- Consumes: `MapAnchor` from `src/domain/types.ts`.
- Produces:

```ts
export interface ClosureItem { startISO: string; endISO: string; geo: MapAnchor; segmentIds: number[] }
export interface PlannedClosure { segmentId: number; startMs: number; endMs: number }
export interface ClosureStop { geo: MapAnchor; closures: PlannedClosure[] }
export function isoToMs(iso: string): number
export function planClosureStops(items: readonly ClosureItem[]): ClosureStop[]
export function directionsFor(segment: { isAtoB: boolean; isBtoA: boolean }): boolean[]
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { directionsFor, isoToMs, planClosureStops } from "../csv/planClosureStops";

const viewA = { lon: 6.1, lat: 46.2, zoom: 17 };
const viewB = { lon: 6.3, lat: 46.4, zoom: 16 };

describe("planClosureStops", () => {
  it("creates one stop per distinct view, in first-seen order", () => {
    const stops = planClosureStops([
      { startISO: "2026-05-31T09:00", endISO: "2026-05-31T17:00", geo: viewB, segmentIds: [1] },
      { startISO: "2026-05-31T09:00", endISO: "2026-05-31T17:00", geo: viewA, segmentIds: [2, 3] },
    ]);
    expect(stops.map((s) => s.geo)).toEqual([viewB, viewA]);
    expect(stops[1].closures.map((c) => c.segmentId)).toEqual([2, 3]);
  });

  it("merges items sharing a view and drops exact duplicates", () => {
    const stops = planClosureStops([
      { startISO: "2026-05-31T09:00", endISO: "2026-05-31T12:00", geo: viewA, segmentIds: [1, 1] },
      { startISO: "2026-05-31T14:00", endISO: "2026-05-31T17:00", geo: { ...viewA }, segmentIds: [1] },
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].closures).toEqual([
      { segmentId: 1, startMs: isoToMs("2026-05-31T09:00"), endMs: isoToMs("2026-05-31T12:00") },
      { segmentId: 1, startMs: isoToMs("2026-05-31T14:00"), endMs: isoToMs("2026-05-31T17:00") },
    ]);
  });

  it("skips empty items", () => {
    expect(
      planClosureStops([{ startISO: "2026-05-31T09:00", endISO: "2026-05-31T17:00", geo: viewA, segmentIds: [] }]),
    ).toEqual([]);
  });
});

describe("isoToMs", () => {
  it("reads the ISO string as local time", () => {
    expect(isoToMs("2026-05-31T09:00")).toBe(new Date(2026, 4, 31, 9, 0).getTime());
  });
  it("throws on garbage", () => {
    expect(() => isoToMs("nope")).toThrow();
  });
});

describe("directionsFor", () => {
  it("closes both directions on a two-way segment", () => {
    expect(directionsFor({ isAtoB: false, isBtoA: false })).toEqual([true, false]);
  });
  it("closes only A→B on an A→B one-way", () => {
    expect(directionsFor({ isAtoB: true, isBtoA: false })).toEqual([true]);
  });
  it("closes only B→A on a B→A one-way", () => {
    expect(directionsFor({ isAtoB: false, isBtoA: true })).toEqual([false]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/planClosureStops.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Turns closure data into an ordered list of map stops for direct closure
// creation. One stop per sub-line view: that view is the bbox the segments
// were matched in, so centering on it guarantees they are in the data model.
// Pure — no SDK, no DOM.

import type { MapAnchor } from "../domain/types";

export interface ClosureItem {
  startISO: string;
  endISO: string;
  geo: MapAnchor;
  segmentIds: number[];
}

export interface PlannedClosure {
  segmentId: number;
  startMs: number;
  endMs: number;
}

export interface ClosureStop {
  geo: MapAnchor;
  closures: PlannedClosure[];
}

/** "YYYY-MM-DDTHH:MM" (no offset) → Unix ms, interpreted as local time. */
export function isoToMs(iso: string): number {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) throw new Error(`[planClosureStops] Invalid date: "${iso}"`);
  return ms;
}

export function planClosureStops(items: readonly ClosureItem[]): ClosureStop[] {
  const stopsByView = new Map<string, ClosureStop>();
  const seen = new Set<string>();

  for (const item of items) {
    const viewKey = `${item.geo.lon}|${item.geo.lat}|${item.geo.zoom}`;
    const startMs = isoToMs(item.startISO);
    const endMs = isoToMs(item.endISO);

    for (const segmentId of item.segmentIds) {
      const closureKey = `${viewKey}|${segmentId}|${startMs}|${endMs}`;
      if (seen.has(closureKey)) continue;
      seen.add(closureKey);

      let stop = stopsByView.get(viewKey);
      if (!stop) {
        stop = { geo: item.geo, closures: [] };
        stopsByView.set(viewKey, stop);
      }
      stop.closures.push({ segmentId, startMs, endMs });
    }
  }
  return Array.from(stopsByView.values());
}

/** isForward values matching the CSV export's "TWO WAY" direction. */
export function directionsFor(segment: { isAtoB: boolean; isBtoA: boolean }): boolean[] {
  if (segment.isAtoB) return [true];
  if (segment.isBtoA) return [false];
  return [true, false];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/planClosureStops.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/csv/planClosureStops.ts src/__tests__/planClosureStops.test.ts
git commit -m "feat(closures): plan closure stops by sub-line view"
```

---

### Task 3: `ClosureApplier` (controller)

Walks the stops: center → wait idle → (check MTE) → per closure, per direction: skip if it already exists, else add. Failures are collected, never thrown, so one bad segment does not lose the rest of the run. Re-running is safe thanks to `hasClosure`.

**Files:**
- Create: `src/controller/ClosureApplier.ts`
- Test: `src/__tests__/ClosureApplier.test.ts`

**Interfaces:**
- Consumes: `ClosureStop`, `directionsFor` from Task 2.
- Produces:

```ts
export interface ClosureDriver {
  setMapCenter(lon: number, lat: number, zoom: number): void;
  waitIdle(): Promise<void>;
  /** null when the segment is not in the data model. */
  getSegment(segmentId: number): { isAtoB: boolean; isBtoA: boolean } | null;
  hasTrafficEvent(id: string): boolean;
  hasClosure(c: { segmentId: number; isForward: boolean; startMs: number; endMs: number }): boolean;
  addClosure(c: {
    segmentId: number; isForward: boolean; startMs: number; endMs: number;
    description: string; isPermanent: boolean; trafficEventId: string | null;
  }): void;
}
export interface ApplyOptions { description: string; isPermanent: boolean; trafficEventId: string | null }
export interface ClosureFailure { segmentId: number; reason: string }
export interface ApplyReport { added: number; skipped: number; failures: ClosureFailure[] }
export async function applyClosures(
  stops: readonly ClosureStop[], options: ApplyOptions, driver: ClosureDriver,
  onProgress?: (stopIndex: number, stopCount: number) => void,
): Promise<ApplyReport>
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { applyClosures, type ClosureDriver } from "../controller/ClosureApplier";
import type { ClosureStop } from "../csv/planClosureStops";

const options = { description: "slowUp", isPermanent: true, trafficEventId: null };
const stop = (segmentIds: number[]): ClosureStop => ({
  geo: { lon: 6, lat: 46, zoom: 17 },
  closures: segmentIds.map((segmentId) => ({ segmentId, startMs: 1, endMs: 2 })),
});

function fakeDriver(overrides: Partial<ClosureDriver> = {}): ClosureDriver {
  return {
    setMapCenter: vi.fn(),
    waitIdle: vi.fn(async () => {}),
    getSegment: vi.fn(() => ({ isAtoB: false, isBtoA: false })),
    hasTrafficEvent: vi.fn(() => true),
    hasClosure: vi.fn(() => false),
    addClosure: vi.fn(),
    ...overrides,
  };
}

describe("applyClosures", () => {
  it("centers on each stop before adding, both directions for two-way", async () => {
    const order: string[] = [];
    const driver = fakeDriver({
      setMapCenter: vi.fn(() => order.push("center")),
      waitIdle: vi.fn(async () => { order.push("idle"); }),
      addClosure: vi.fn(() => order.push("add")),
    });
    const report = await applyClosures([stop([1])], options, driver);
    expect(order).toEqual(["center", "idle", "add", "add"]);
    expect(report).toEqual({ added: 2, skipped: 0, failures: [] });
    expect(driver.addClosure).toHaveBeenCalledWith({
      segmentId: 1, isForward: true, startMs: 1, endMs: 2,
      description: "slowUp", isPermanent: true, trafficEventId: null,
    });
  });

  it("skips closures that already exist (safe re-run)", async () => {
    const driver = fakeDriver({ hasClosure: vi.fn((c) => c.isForward) });
    const report = await applyClosures([stop([1])], options, driver);
    expect(report).toEqual({ added: 1, skipped: 1, failures: [] });
  });

  it("records a segment missing from the data model and continues", async () => {
    const driver = fakeDriver({ getSegment: vi.fn((id) => (id === 1 ? null : { isAtoB: true, isBtoA: false })) });
    const report = await applyClosures([stop([1, 2])], options, driver);
    expect(report.added).toBe(1);
    expect(report.failures).toEqual([{ segmentId: 1, reason: "segment not loaded" }]);
  });

  it("records addClosure errors and continues", async () => {
    const driver = fakeDriver({
      addClosure: vi.fn((c) => { if (c.segmentId === 1) throw new Error("locked"); }),
    });
    const report = await applyClosures([stop([1, 2])], options, driver);
    expect(report.added).toBe(2);
    expect(report.failures).toEqual([
      { segmentId: 1, reason: "locked" },
      { segmentId: 1, reason: "locked" },
    ]);
  });

  it("fails the whole stop when the MTE is not loaded", async () => {
    const driver = fakeDriver({ hasTrafficEvent: vi.fn(() => false) });
    const report = await applyClosures([stop([1, 2])], { ...options, trafficEventId: "123" }, driver);
    expect(driver.addClosure).not.toHaveBeenCalled();
    expect(report.failures).toEqual([
      { segmentId: 1, reason: "MTE 123 not loaded" },
      { segmentId: 2, reason: "MTE 123 not loaded" },
    ]);
  });

  it("reports progress per stop", async () => {
    const onProgress = vi.fn();
    await applyClosures([stop([1]), stop([2])], options, fakeDriver(), onProgress);
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/ClosureApplier.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Adds road closures directly in the WME data model, stop by stop.
// addClosure only works on segments present in the data model, so each stop
// first centers the map on the sub-line view the segments were matched in.
// Failures are collected, not thrown: one locked segment must not lose the
// rest of a long run, and hasClosure makes a re-run safe.

import { directionsFor, type ClosureStop } from "../csv/planClosureStops";

export interface ClosureDriver {
  setMapCenter(lon: number, lat: number, zoom: number): void;
  waitIdle(): Promise<void>;
  /** null when the segment is not in the data model. */
  getSegment(segmentId: number): { isAtoB: boolean; isBtoA: boolean } | null;
  hasTrafficEvent(id: string): boolean;
  hasClosure(c: { segmentId: number; isForward: boolean; startMs: number; endMs: number }): boolean;
  addClosure(c: {
    segmentId: number;
    isForward: boolean;
    startMs: number;
    endMs: number;
    description: string;
    isPermanent: boolean;
    trafficEventId: string | null;
  }): void;
}

export interface ApplyOptions {
  description: string;
  isPermanent: boolean;
  trafficEventId: string | null;
}

export interface ClosureFailure {
  segmentId: number;
  reason: string;
}

export interface ApplyReport {
  added: number;
  skipped: number;
  failures: ClosureFailure[];
}

export async function applyClosures(
  stops: readonly ClosureStop[],
  options: ApplyOptions,
  driver: ClosureDriver,
  onProgress?: (stopIndex: number, stopCount: number) => void,
): Promise<ApplyReport> {
  const report: ApplyReport = { added: 0, skipped: 0, failures: [] };

  for (const [index, stop] of stops.entries()) {
    driver.setMapCenter(stop.geo.lon, stop.geo.lat, stop.geo.zoom);
    await driver.waitIdle();

    const { trafficEventId } = options;
    const mteMissing = trafficEventId !== null && !driver.hasTrafficEvent(trafficEventId);
    if (mteMissing) {
      for (const { segmentId } of stop.closures) {
        report.failures.push({ segmentId, reason: `MTE ${trafficEventId} not loaded` });
      }
      onProgress?.(index + 1, stops.length);
      continue;
    }

    for (const closure of stop.closures) {
      const segment = driver.getSegment(closure.segmentId);
      if (!segment) {
        report.failures.push({ segmentId: closure.segmentId, reason: "segment not loaded" });
        continue;
      }
      for (const isForward of directionsFor(segment)) {
        const directed = { ...closure, isForward };
        if (driver.hasClosure(directed)) {
          report.skipped++;
          continue;
        }
        try {
          driver.addClosure({ ...directed, ...options });
          report.added++;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          report.failures.push({ segmentId: closure.segmentId, reason });
        }
      }
    }
    onProgress?.(index + 1, stops.length);
  }
  return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/ClosureApplier.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller/ClosureApplier.ts src/__tests__/ClosureApplier.test.ts
git commit -m "feat(closures): apply closures stop by stop through a driver"
```

---

### Task 4: Wire the "Apply closures" button in `MatchingSubTab`

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (download row builder ~L1820-1848, `renderSourceState` subscription ~L230, export section ~L2066-2160)
- Modify: `locales/en/common.json`, `locales/fr/common.json`

**Interfaces:**
- Consumes: `isMatchingComplete` (Task 1), `planClosureStops`, `ClosureItem` (Task 2), `applyClosures`, `ClosureDriver`, `ApplyReport` (Task 3), existing `closuresFromSource`, `groupByWindow`, `promptClosureWindow`, `promptFinalFields`, `mteKeyOf`, `waitForMapIdle`.

- [ ] **Step 0: Verify the `RoadClosure.startDate` format (needed by `hasClosure`)**

In WME with one existing closure loaded, run in the console:
`getWmeSdk({scriptId:"x",scriptName:"x"}).DataModel.RoadClosures.getAll()[0]` and note `startDate` (expected `"YYYY-MM-DD HH:MM"` in the closure's local tz). If the format differs, adapt `closureDateToMs` below.

- [ ] **Step 1: Add the i18n keys**

`locales/en/common.json`, under `panel`:
```json
"applyClosures": "Apply closures in WME",
"applyClosuresDisabled": "Finish matching every sub-line first",
"applyClosuresProgress": "Adding closures… view {{index}}/{{count}}",
"applyClosuresDone": "{{added}} closure(s) added, {{skipped}} already present. Click Save in WME.",
"applyClosuresFailures": "{{count}} closure(s) failed — segments: {{ids}}. Run again after fixing to retry only these.",
"applyClosuresNoEditing": "Editing is not allowed right now (permissions or read-only mode)."
```
`locales/fr/common.json`, under `panel`:
```json
"applyClosures": "Appliquer les fermetures dans WME",
"applyClosuresDisabled": "Terminez d'abord le matching de toutes les sous-lignes",
"applyClosuresProgress": "Ajout des fermetures… vue {{index}}/{{count}}",
"applyClosuresDone": "{{added}} fermeture(s) ajoutée(s), {{skipped}} déjà présente(s). Cliquez sur Sauvegarder dans WME.",
"applyClosuresFailures": "{{count}} fermeture(s) en échec — segments : {{ids}}. Relancez après correction pour ne réessayer que celles-ci.",
"applyClosuresNoEditing": "L'édition n'est pas autorisée actuellement (droits ou mode lecture seule)."
```
Rename the existing `panel.downloadClosures` value to `"Download closures CSV (fallback)"` / `"Télécharger le CSV de fermetures (secours)"`.

- [ ] **Step 2: Button + status element in the download row**

In the row builder (where `closuresBtn` is created, after `prepareMteBtn`), replace the primary CSV button with:

```ts
const applyBtn = wzButton({
  text: i18next.t("panel.applyClosures"),
  variant: "primary",
  onClick: () => {
    void this.onApplyClosuresClick();
  },
});
section.appendChild(applyBtn);
this.applyClosuresBtn = applyBtn;

const applyStatus = document.createElement("div");
applyStatus.className = "wmegj-guided-status";
applyStatus.style.whiteSpace = "pre-line";
section.appendChild(applyStatus);
this.applyClosuresStatusEl = applyStatus;

const closuresBtn = wzButton({
  text: i18next.t("panel.downloadClosures"),
  variant: "secondary",
  onClick: () => {
    this.onDownloadClosuresClick();
  },
});
section.appendChild(closuresBtn);
this.downloadClosuresBtn = closuresBtn;

this.updateClosureButtons();
```

Fields (next to `prepareMteBtn`), and reset them to `undefined` / `null` where `prepareMteBtn` is reset (~L416):

```ts
private applyClosuresBtn?: HTMLButtonElement;
private downloadClosuresBtn?: HTMLButtonElement;
private applyClosuresStatusEl: HTMLElement | null = null;
private applyingClosures = false;
```

(If `wzButton` returns `HTMLElement`, type the fields like `prepareMteBtn` is typed and reuse `setButtonDisabled`.)

- [ ] **Step 3: Gating**

```ts
private updateClosureButtons(): void {
  const complete = isMatchingComplete(this.sourceStore.getSource());
  const disabled = !complete || this.applyingClosures;
  const title = complete ? "" : i18next.t("panel.applyClosuresDisabled");
  for (const btn of [this.applyClosuresBtn, this.downloadClosuresBtn]) {
    if (!btn) continue;
    this.setButtonDisabled(btn, disabled);
    btn.title = title;
  }
}
```

Call it from the `sourceStore.onChange` callback (~L230, next to `this.renderSourceState()`) and from `onSelectedLineChanged`.

- [ ] **Step 4: Collect closure items (shared by CSV and apply)**

Extract from `downloadClosuresGlobalTimes` / `downloadClosuresPerLine` the part that asks for windows, so both flows reuse it:

```ts
/** Closure items for the current source, or null if the user cancelled. */
private async collectClosureItems(): Promise<ClosureItem[] | null> {
  const src = this.sourceStore.getSource();
  if (!src) return null;
  const closures = closuresFromSource(src);

  if (closures.mode === "per-line-times") {
    return groupByWindow(closures.bySegment);
  }

  const today = new Date().toISOString().slice(0, 10);
  const slowupDate = this.registry.getSelected()?.slowupDetails?.date;
  const windows = await promptClosureWindow({
    date: slowupDate ?? today,
    startTime: "09:00",
    endTime: "17:30",
  });
  if (!windows) return null;
  return windows.flatMap((w) =>
    closures.groups.map((g) => ({ startISO: w.startISO, endISO: w.endISO, geo: g.geo, segmentIds: g.segmentIds })),
  );
}
```

Leave the CSV functions as they are (don't refactor them onto this helper — not needed for this feature).

- [ ] **Step 5: Apply handler + SDK driver**

```ts
private async onApplyClosuresClick(): Promise<void> {
  if (this.applyingClosures) return;
  if (!this.wmeSDK.Editing.isEditingAllowed()) {
    alert(i18next.t("panel.applyClosuresNoEditing"));
    return;
  }
  const items = await this.collectClosureItems();
  if (!items) return;
  const fields = await promptFinalFields({ mteKey: mteKeyOf(this.registry.getSelected()) });
  if (!fields) return;

  const stops = planClosureStops(items);
  this.applyingClosures = true;
  this.updateClosureButtons();
  try {
    const report = await applyClosures(
      stops,
      { description: fields.reason, isPermanent: fields.ignoreTraffic, trafficEventId: fields.mteId || null },
      this.buildClosureDriver(),
      (index, count) => this.setApplyStatus(i18next.t("panel.applyClosuresProgress", { index, count })),
    );
    this.setApplyStatus(this.formatApplyReport(report));
  } catch (err) {
    logger.error("MatchingSubTab.onApplyClosuresClick failed", err);
    this.setApplyStatus(err instanceof Error ? err.message : String(err));
  } finally {
    this.applyingClosures = false;
    this.updateClosureButtons();
  }
}

private buildClosureDriver(): ClosureDriver {
  const dm = this.wmeSDK.DataModel;
  return {
    setMapCenter: (lon, lat, zoom) =>
      this.wmeSDK.Map.setMapCenter({ lonLat: { lon, lat }, zoomLevel: zoom as ZoomLevel }),
    // Same settle delay as the matching walk: segments must be in the model.
    waitIdle: () => waitForMapIdle(this.wmeSDK, { settleDelayMs: 650 }),
    getSegment: (segmentId) => dm.Segments.getById({ segmentId }),
    hasTrafficEvent: (id) => dm.MajorTrafficEvents.getById({ majorTrafficEventId: id }) !== null,
    hasClosure: ({ segmentId, isForward, startMs, endMs }) =>
      dm.RoadClosures.getAll().some(
        (c) =>
          c.segmentId === segmentId &&
          c.isForward === isForward &&
          closureDateToMs(c.startDate) === startMs &&
          closureDateToMs(c.endDate) === endMs,
      ),
    addClosure: (c) =>
      dm.RoadClosures.addClosure({
        segmentId: c.segmentId,
        isForward: c.isForward,
        startDate: c.startMs,
        endDate: c.endMs,
        description: c.description,
        isPermanent: c.isPermanent,
        trafficEventId: c.trafficEventId,
        fromNodeClosed: false,
      }),
  };
}

private setApplyStatus(text: string): void {
  if (this.applyClosuresStatusEl) this.applyClosuresStatusEl.textContent = text;
}

private formatApplyReport(report: ApplyReport): string {
  const lines = [i18next.t("panel.applyClosuresDone", { added: report.added, skipped: report.skipped })];
  if (report.failures.length > 0) {
    const ids = [...new Set(report.failures.map((f) => f.segmentId))].join(", ");
    lines.push(i18next.t("panel.applyClosuresFailures", { count: report.failures.length, ids }));
    logger.warn("MatchingSubTab: closure failures", report.failures);
  }
  return lines.join("\n");
}
```

Module-level helper (bottom of the file, next to `slugifyFilename`), adjusted to the format found in Step 0:

```ts
/** RoadClosure dates are "YYYY-MM-DD HH:MM" strings (verified in WME); null never matches. */
function closureDateToMs(value: string | null): number {
  return value === null ? NaN : new Date(value.replace(" ", "T")).getTime();
}
```

Imports to add:

```ts
import { isMatchingComplete } from "../../domain/isMatchingComplete";
import { planClosureStops, type ClosureItem } from "../../csv/planClosureStops";
import { applyClosures, type ApplyReport, type ClosureDriver } from "../../controller/ClosureApplier";
```

- [ ] **Step 6: Typecheck, lint, tests, build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run compile`
Expected: all green.

- [ ] **Step 7: Manual check in WME (dev header)**

1. Load a short GeoJSON line, match every sub-line → "Apply closures" enabled; before the last validation → disabled with tooltip.
2. Click it without MTE id → map jumps view by view, status shows progress, summary shows N added. WME "Save" counter shows the edits; save.
3. Click again → `0 added, N already present`.
4. With an MTE id from "Prepare MTE" → closures are linked to the MTE in the closure panel.
5. CSV-mode line (roadbook imported) → closures carry the per-row windows.

- [ ] **Step 8: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts locales/en/common.json locales/fr/common.json
git commit -m "feat(closures): apply closures directly in WME, view by view"
```

---

## Deliberately skipped

- **Cancel button during the run**: a run is ~1 s per view; add an `AbortSignal` to `applyClosures` if long slowUps make it painful.
- **Auto-save / save every N edits**: WME may cap pending edits on very large runs — check with a full slowUp in Step 7; if it bites, call `wmeSDK.Editing.save()` every N stops.
- **Retry with a wider view for "segment not loaded"**: the re-run is idempotent, so the user can just click again.
- **Removing the CSV export**: kept as a disabled-until-done secondary button; delete it once the SDK path has proven itself.
