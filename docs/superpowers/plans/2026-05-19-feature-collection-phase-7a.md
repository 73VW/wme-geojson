# FeatureCollection Phase 7a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the matching panel into two sub-tabs and make matching + closure-CSV export work without an imported CSV, for a single GeoJSON `Feature`.

**Architecture:** A new pure `src/lines/` module introduces `LineEntry` (one loadable line) and `LineRegistry` (observable in-memory store). `MatchPanel` becomes a thin shell hosting a `[Lignes] [Matching]` toggle over two sub-tab controllers, each split into a controller class and pure DOM view classes. When no CSV is imported, a synthetic single-row schedule covering the whole track drives the existing matching pipeline; the closure time window is prompted at download via a new `promptClosureWindow` modal.

**Tech Stack:** TypeScript 5.6 strict, Rollup, `@turf/turf`, `i18next`, `vitest`, native `<dialog>` for modals.

**Scope note:** This is Phase 7a of the 3-phase spec (`docs/superpowers/specs/2026-05-18-feature-collection-design.md`). FeatureCollection parsing (7b) and slowUp details (7c) are out of scope here — but the modules are designed so 7b/7c extend rather than rewrite them.

---

## File structure

**Created:**
- `src/lines/types.ts` — `LineEntry`, `SlowupDetails`, `LineMatchPhase` type definitions.
- `src/lines/displayName.ts` — pure `computeDisplayName()` helper.
- `src/lines/LineRegistry.ts` — observable store of `LineEntry[]` + selection.
- `src/lines/featureCollectionLoader.ts` — `loadLines(url)` → `LineEntry[]` (single Feature in 7a).
- `src/csv/syntheticSchedule.ts` — `buildSyntheticRow()` for CSV-less matching.
- `src/ui/components/promptClosureWindow.ts` — modal collecting closure start/end datetimes.
- `src/ui/subtabs/MatchingSubTab.ts` — controller for the matching sub-tab (current MatchPanel body).
- `src/ui/subtabs/LinesSubTab.ts` — controller for the lines sub-tab (URL input + line list).
- `src/ui/views/LinesListView.ts` — pure DOM view: URL row, source info, list container.
- `src/ui/views/LineRowView.ts` — pure DOM view: one line row (color pill, name, Select button).
- `src/__tests__/displayName.test.ts`
- `src/__tests__/LineRegistry.test.ts`
- `src/__tests__/syntheticSchedule.test.ts`
- `src/__tests__/featureCollectionLoader.test.ts`

**Modified:**
- `src/ui/MatchPanel.ts` — reduced to a shell: tab registration, sub-tab toggle, sub-tab mounting.
- `main.user.ts` — construct `LineRegistry`, pass to `MatchPanel`.
- `src/bootstrap/loadAndAttachTrack.ts` — populate `LineRegistry` instead of (or alongside) direct panel setters.
- `locales/en/common.json`, `locales/fr/common.json` — new i18n keys.

---

## Task 1: `LineEntry` types

**Files:**
- Create: `src/lines/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// Type definitions for the multi-line FeatureCollection feature.
// Pure types — no SDK, no DOM. Safe to import anywhere.

import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";

/**
 * SlowUp event detail, fetched from the SchweizMobil refid API.
 * Only the fields the UI consumes are typed; the API returns more.
 * Populated in Phase 7c — declared here so LineEntry stays stable.
 */
export interface SlowupDetails {
  refid: number;
  title: string;
  date: string; // "YYYY-MM-DD"
}

/** Coarse matching progress for one line, mirrored from the pipeline. */
export type LineMatchPhase = "idle" | "matching" | "matched";

/** How a line's closure schedule is sourced. */
export type LineMode = "csv" | "synthetic";

/**
 * One line loaded from a GeoJSON source (a lone Feature, or — from Phase 7b —
 * one Feature out of a FeatureCollection).
 */
export interface LineEntry {
  /** Stable id, e.g. `${sourceUrl}#${featureIndex}`. */
  id: string;
  /** Validated, normalised geometry + raw properties. */
  track: NormalizedTrack;
  /** Total track length in kilometres (turf-measured at load time). */
  lengthKm: number;
  /** Display name: slowUp title | properties.name | "Tracé de X km". */
  displayName: string;
  /** Stable preview colour derived from `id` (used from Phase 7b). */
  color: string;
  /** Present when properties carry a `slowup_number` (used from Phase 7c). */
  slowupNumber?: number;
  /** Fetched slowUp detail (Phase 7c). */
  slowupDetails?: SlowupDetails;
  /** SlowUp detail fetch lifecycle (Phase 7c). */
  slowupFetchStatus: "idle" | "loading" | "ok" | "error";
  /** Whether closures come from an imported CSV or a synthetic single row. */
  mode: LineMode;
  /** Parsed CSV rows when `mode === "csv"`. */
  csvRows?: CsvRow[];
  /** Raw CSV text, kept so persistence keys can be derived. */
  csvText?: string;
  /** Coarse matching phase for UI display. */
  matchPhase: LineMatchPhase;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lines/types.ts
git commit -m "feat(lines): add LineEntry and related types"
```

---

## Task 2: `computeDisplayName` helper

**Files:**
- Create: `src/lines/displayName.ts`
- Test: `src/__tests__/displayName.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeDisplayName } from "../lines/displayName";

describe("computeDisplayName", () => {
  it("uses slowUp title and date when slowUp details are present", () => {
    const name = computeDisplayName({
      lengthKm: 24.3,
      properties: { name: "ignored" },
      slowupDetails: { refid: 19, title: "Ticino", date: "2026-04-19" },
    });
    expect(name).toBe("Ticino — 2026-04-19");
  });

  it("uses properties.name when present and no slowUp details", () => {
    const name = computeDisplayName({
      lengthKm: 24.3,
      properties: { name: "Lausanne loop" },
    });
    expect(name).toBe("Lausanne loop");
  });

  it("falls back to track length when no name and no slowUp", () => {
    const name = computeDisplayName({ lengthKm: 24.34, properties: {} });
    expect(name).toBe("Tracé de 24.3 km");
  });

  it("falls back when properties is undefined", () => {
    const name = computeDisplayName({ lengthKm: 5, properties: undefined });
    expect(name).toBe("Tracé de 5.0 km");
  });

  it("ignores a non-string properties.name", () => {
    const name = computeDisplayName({ lengthKm: 8, properties: { name: 42 } });
    expect(name).toBe("Tracé de 8.0 km");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/displayName.test.ts`
Expected: FAIL — `Cannot find module '../lines/displayName'`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure helper computing the human-readable name of a line.
// Priority: slowUp "title — date" > properties.name > "Tracé de X km".
// No SDK, no DOM, no i18next — the fallback label is intentionally a
// constant here; UI-facing i18n happens at the call site if needed later.

import i18next from "i18next";
import type { SlowupDetails } from "./types";

export interface DisplayNameInput {
  lengthKm: number;
  properties: Record<string, unknown> | undefined;
  slowupDetails?: SlowupDetails;
}

export function computeDisplayName(input: DisplayNameInput): string {
  const { lengthKm, properties, slowupDetails } = input;

  if (slowupDetails) {
    return `${slowupDetails.title} — ${slowupDetails.date}`;
  }

  const name = properties?.["name"];
  if (typeof name === "string" && name.trim() !== "") {
    return name;
  }

  return i18next.t("panel.lines.fallbackName", { km: lengthKm.toFixed(1) });
}
```

> **Note for the implementer:** the test asserts the literal `"Tracé de 24.3 km"`. The i18n key `panel.lines.fallbackName` is added in Task 11 with the French value `"Tracé de {{km}} km"`. vitest runs with i18next configured by `locales/i18n.ts`; if the test environment does not initialise i18next, the test setup must call `i18next.init` with the FR resources OR the test must be reordered after Task 11. Verify how existing tests that use `i18next.t` (e.g. none currently — `buildClosuresCsv` is pure) behave; if i18next is uninitialised, `t()` returns the key. **To keep this task self-contained, initialise i18next inside the test file:**

Add at the top of `src/__tests__/displayName.test.ts`, before the `describe`:

```ts
import i18next from "i18next";

await i18next.init({
  lng: "fr",
  resources: {
    fr: { translation: { panel: { lines: { fallbackName: "Tracé de {{km}} km" } } } },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/displayName.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lines/displayName.ts src/__tests__/displayName.test.ts
git commit -m "feat(lines): add computeDisplayName helper"
```

---

## Task 3: `LineRegistry` observable store

**Files:**
- Create: `src/lines/LineRegistry.ts`
- Test: `src/__tests__/LineRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { LineRegistry } from "../lines/LineRegistry";
import type { LineEntry } from "../lines/types";

function makeEntry(id: string): LineEntry {
  return {
    id,
    track: { trackId: id, geometry: { type: "MultiLineString", coordinates: [] } },
    lengthKm: 10,
    displayName: id,
    color: "#000000",
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
}

describe("LineRegistry", () => {
  it("starts empty with no selection", () => {
    const reg = new LineRegistry();
    expect(reg.getAll()).toEqual([]);
    expect(reg.getSelected()).toBeNull();
  });

  it("setEntries replaces the list and fires onLinesChanged", () => {
    const reg = new LineRegistry();
    const cb = vi.fn();
    reg.onLinesChanged(cb);
    reg.setEntries([makeEntry("a"), makeEntry("b")]);
    expect(reg.getAll().map((e) => e.id)).toEqual(["a", "b"]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setEntries clears any prior selection", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    reg.setSelected("a");
    reg.setEntries([makeEntry("b")]);
    expect(reg.getSelected()).toBeNull();
  });

  it("setSelected fires onSelectedLineChanged with the entry", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    const cb = vi.fn();
    reg.onSelectedLineChanged(cb);
    reg.setSelected("a");
    expect(reg.getSelected()?.id).toBe("a");
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("setSelected with an unknown id throws", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    expect(() => reg.setSelected("missing")).toThrow();
  });

  it("setSelected(null) clears the selection", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    reg.setSelected("a");
    reg.setSelected(null);
    expect(reg.getSelected()).toBeNull();
  });

  it("updateEntry patches an entry and fires onEntryUpdated", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    const cb = vi.fn();
    reg.onEntryUpdated(cb);
    reg.updateEntry("a", { matchPhase: "matched" });
    expect(reg.getAll()[0].matchPhase).toBe("matched");
    expect(cb).toHaveBeenCalledWith("a");
  });

  it("updateEntry on the selected entry keeps it selected with fresh data", () => {
    const reg = new LineRegistry();
    reg.setEntries([makeEntry("a")]);
    reg.setSelected("a");
    reg.updateEntry("a", { displayName: "renamed" });
    expect(reg.getSelected()?.displayName).toBe("renamed");
  });

  it("subscribers can unsubscribe", () => {
    const reg = new LineRegistry();
    const cb = vi.fn();
    const off = reg.onLinesChanged(cb);
    off();
    reg.setEntries([makeEntry("a")]);
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/LineRegistry.test.ts`
Expected: FAIL — `Cannot find module '../lines/LineRegistry'`.

- [ ] **Step 3: Write the implementation**

```ts
// Observable in-memory store of loaded lines and the current selection.
// Pure — no SDK, no DOM. Mirrors the tiny-emitter pattern used by
// WalkController and SessionStore.

import type { LineEntry } from "./types";

type Unsubscribe = () => void;

class Emitter<A extends unknown[]> {
  private readonly listeners = new Set<(...args: A) => void>();
  on(cb: (...args: A) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(...args: A): void {
    for (const cb of this.listeners) {
      try {
        cb(...args);
      } catch {
        // A subscriber must not break the store or sibling subscribers.
      }
    }
  }
}

export class LineRegistry {
  private entries: LineEntry[] = [];
  private selectedId: string | null = null;

  private readonly linesChanged = new Emitter<[]>();
  private readonly selectedChanged = new Emitter<[LineEntry | null]>();
  private readonly entryUpdated = new Emitter<[string]>();

  getAll(): readonly LineEntry[] {
    return this.entries;
  }

  getSelected(): LineEntry | null {
    if (this.selectedId === null) return null;
    return this.entries.find((e) => e.id === this.selectedId) ?? null;
  }

  /** Replace the whole list. Always clears the current selection. */
  setEntries(entries: LineEntry[]): void {
    this.entries = [...entries];
    const hadSelection = this.selectedId !== null;
    this.selectedId = null;
    this.linesChanged.emit();
    if (hadSelection) {
      this.selectedChanged.emit(null);
    }
  }

  /** Select a line by id, or pass null to clear. Unknown id throws. */
  setSelected(id: string | null): void {
    if (id !== null && !this.entries.some((e) => e.id === id)) {
      throw new Error(`[LineRegistry] setSelected: unknown line id "${id}"`);
    }
    this.selectedId = id;
    this.selectedChanged.emit(this.getSelected());
  }

  /** Shallow-merge a patch into one entry. Unknown id throws. */
  updateEntry(id: string, patch: Partial<LineEntry>): void {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      throw new Error(`[LineRegistry] updateEntry: unknown line id "${id}"`);
    }
    this.entries = this.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
    this.entryUpdated.emit(id);
    if (id === this.selectedId) {
      this.selectedChanged.emit(this.getSelected());
    }
  }

  onLinesChanged(cb: () => void): Unsubscribe {
    return this.linesChanged.on(cb);
  }
  onSelectedLineChanged(cb: (entry: LineEntry | null) => void): Unsubscribe {
    return this.selectedChanged.on(cb);
  }
  onEntryUpdated(cb: (id: string) => void): Unsubscribe {
    return this.entryUpdated.on(cb);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/LineRegistry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lines/LineRegistry.ts src/__tests__/LineRegistry.test.ts
git commit -m "feat(lines): add observable LineRegistry store"
```

---

## Task 4: Synthetic schedule builder

**Files:**
- Create: `src/csv/syntheticSchedule.ts`
- Test: `src/__tests__/syntheticSchedule.test.ts`

**Context:** When no CSV is imported, matching still needs one `CsvRow` so the existing pipeline (`computeMatchingWorkItems` in `src/matching/trackPortions.ts`) treats the whole track as a single slice. The synthetic row carries the full track length as `distance`; its `startTime`/`endTime`/`date` stay empty until the user fills the closure window at download time. `segments` starts `null` (matching fills it in).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSyntheticRow } from "../csv/syntheticSchedule";

describe("buildSyntheticRow", () => {
  it("produces one row carrying the track length as distance", () => {
    const row = buildSyntheticRow(24.3);
    expect(row.distance).toBe(24.3);
  });

  it("leaves time and date fields empty until the closure window is set", () => {
    const row = buildSyntheticRow(10);
    expect(row.startTime).toBe("");
    expect(row.endTime).toBe("");
    expect(row.date).toBe("");
  });

  it("starts with no validated segments", () => {
    const row = buildSyntheticRow(10);
    expect(row.segments).toBeNull();
  });

  it("throws on a non-positive length", () => {
    expect(() => buildSyntheticRow(0)).toThrow();
    expect(() => buildSyntheticRow(-3)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/syntheticSchedule.test.ts`
Expected: FAIL — `Cannot find module '../csv/syntheticSchedule'`.

- [ ] **Step 3: Write the implementation**

```ts
// Builds the synthetic single-row schedule used when no CSV is imported.
// The whole track becomes one slice; the existing matching pipeline then
// sub-slices it exactly as it does for a real CSV row.
// Pure — no SDK, no DOM.

import type { CsvRow } from "../state/SessionStore";

/**
 * Build the one synthetic CsvRow covering an entire track.
 *
 * `distance` carries the full track length in km. Time/date fields are left
 * empty: in synthetic mode they are collected at download time via
 * promptClosureWindow, not from the (absent) CSV.
 */
export function buildSyntheticRow(trackLengthKm: number): CsvRow {
  if (!(trackLengthKm > 0)) {
    throw new Error(
      `[syntheticSchedule] track length must be positive, got ${trackLengthKm}`,
    );
  }
  return {
    distance: trackLengthKm,
    startTime: "",
    endTime: "",
    date: "",
    segments: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/syntheticSchedule.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/csv/syntheticSchedule.ts src/__tests__/syntheticSchedule.test.ts
git commit -m "feat(csv): add synthetic single-row schedule builder"
```

---

## Task 5: `loadLines` — single Feature loader

**Files:**
- Create: `src/lines/featureCollectionLoader.ts`
- Test: `src/__tests__/featureCollectionLoader.test.ts`

**Context:** In 7a the loader handles only a lone `Feature` (the current behaviour). It reuses `loadTrack` from `geojson/Loader.ts` and wraps the result into a single `LineEntry`. Phase 7b adds the `FeatureCollection` branch. To keep this task testable without `GM.xmlHttpRequest`, the entry-building logic is split into a pure `buildEntryFromTrack` function that the test exercises directly.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { buildEntryFromTrack } from "../lines/featureCollectionLoader";
import type { NormalizedTrack } from "../geojson/types";

beforeAll(async () => {
  await i18next.init({
    lng: "fr",
    resources: {
      fr: { translation: { panel: { lines: { fallbackName: "Tracé de {{km}} km" } } } },
    },
  });
});

const track: NormalizedTrack = {
  trackId: "t1",
  geometry: {
    type: "MultiLineString",
    // ~1 km along the equator
    coordinates: [[[0, 0], [0.009, 0]]],
  },
  rawProperties: { name: "Test line" },
};

describe("buildEntryFromTrack", () => {
  it("produces one entry with a stable id from url and index", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json", 0);
    expect(entry.id).toBe("https://example.com/x.json#0");
  });

  it("computes lengthKm from the geometry", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json", 0);
    expect(entry.lengthKm).toBeGreaterThan(0.9);
    expect(entry.lengthKm).toBeLessThan(1.1);
  });

  it("uses properties.name for the display name", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json", 0);
    expect(entry.displayName).toBe("Test line");
  });

  it("preserves rawProperties on the track", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json", 0);
    expect(entry.track.rawProperties).toEqual({ name: "Test line" });
  });

  it("defaults to synthetic mode and idle states", () => {
    const entry = buildEntryFromTrack(track, "https://example.com/x.json", 0);
    expect(entry.mode).toBe("synthetic");
    expect(entry.matchPhase).toBe("idle");
    expect(entry.slowupFetchStatus).toBe("idle");
  });

  it("falls back to a length-based name when properties has no name", () => {
    const nameless: NormalizedTrack = { ...track, rawProperties: {} };
    const entry = buildEntryFromTrack(nameless, "https://example.com/x.json", 0);
    expect(entry.displayName).toMatch(/^Tracé de /);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/featureCollectionLoader.test.ts`
Expected: FAIL — `Cannot find module '../lines/featureCollectionLoader'`.

- [ ] **Step 3: Write the implementation**

```ts
// Loads a GeoJSON source URL into one or more LineEntry objects.
// Phase 7a: handles a single Feature only (reuses geojson/Loader.loadTrack).
// Phase 7b will add the FeatureCollection branch.

import { length as turfLength } from "@turf/turf";
import type { NormalizedTrack } from "../geojson/types";
import { loadTrack } from "../geojson/Loader";
import { computeDisplayName } from "./displayName";
import { colorForLineId } from "./color";
import type { LineEntry } from "./types";

/**
 * Build a LineEntry from a normalised track. Pure — no fetch, no SDK.
 * `featureIndex` keeps ids stable and unique within a source.
 */
export function buildEntryFromTrack(
  track: NormalizedTrack,
  sourceUrl: string,
  featureIndex: number,
): LineEntry {
  const lengthKm = turfLength(
    { type: "Feature", geometry: track.geometry, properties: null },
    { units: "kilometers" },
  );
  const id = `${sourceUrl}#${featureIndex}`;
  const slowupNumber = extractSlowupNumber(track.rawProperties);

  const entry: LineEntry = {
    id,
    track,
    lengthKm,
    displayName: computeDisplayName({ lengthKm, properties: track.rawProperties }),
    color: colorForLineId(id),
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
  if (slowupNumber !== undefined) {
    entry.slowupNumber = slowupNumber;
  }
  return entry;
}

function extractSlowupNumber(props: Record<string, unknown> | undefined): number | undefined {
  const raw = props?.["slowup_number"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

/**
 * Fetch a GeoJSON URL and build the list of lines.
 * Phase 7a: the URL must resolve to a single Feature.
 */
export async function loadLines(url: string): Promise<LineEntry[]> {
  const track = await loadTrack(url);
  return [buildEntryFromTrack(track, url, 0)];
}
```

> **Dependency:** this imports `colorForLineId` from `src/lines/color.ts`, which does not exist yet. Create it now as a minimal stable stub (Phase 7b replaces the palette logic but keeps the signature):

Create `src/lines/color.ts`:

```ts
// Stable preview colour for a line, derived from its id.
// Phase 7a only needs determinism; Phase 7b tunes the palette for contrast.

export function colorForLineId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/featureCollectionLoader.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lines/featureCollectionLoader.ts src/lines/color.ts src/__tests__/featureCollectionLoader.test.ts
git commit -m "feat(lines): add loadLines for a single Feature source"
```

---

## Task 6: `promptClosureWindow` modal

**Files:**
- Create: `src/ui/components/promptClosureWindow.ts`

**Context:** Mirrors `src/ui/promptFinalFields.ts` exactly in structure (native `<dialog>`, `settle`/`cleanup` pattern, i18n keys). It collects a closure start and end datetime. Defaults are passed in by the caller.

- [ ] **Step 1: Write the implementation**

```ts
// Async modal collecting the closure time window for CSV-less (synthetic)
// matching. Structure mirrors promptFinalFields.ts: native <dialog>, a
// settle()/cleanup() pair, all strings via i18next.

import i18next from "i18next";

export interface ClosureWindow {
  /** "YYYY-MM-DDTHH:MM" — matches the ISO format used across SessionStore. */
  startISO: string;
  endISO: string;
}

export interface ClosureWindowDefaults {
  /** "YYYY-MM-DD" — the date both inputs open on. */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

/**
 * Show the closure-window modal. Resolves with the chosen window, or null if
 * the user cancels (Cancel button, Escape, or backdrop).
 */
export async function promptClosureWindow(
  defaults: ClosureWindowDefaults,
): Promise<ClosureWindow | null> {
  return new Promise<ClosureWindow | null>((resolve) => {
    let settled = false;
    function settle(result: ClosureWindow | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    const startInput = el("input");
    startInput.type = "datetime-local";
    startInput.value = `${defaults.date}T${defaults.startTime}`;

    const endInput = el("input");
    endInput.type = "datetime-local";
    endInput.value = `${defaults.date}T${defaults.endTime}`;

    const errorBanner = el("p");
    errorBanner.style.margin = "0";
    errorBanner.style.color = "#c00";
    errorBanner.style.fontSize = "12px";
    errorBanner.style.display = "none";
    function showError(msg: string): void {
      errorBanner.textContent = msg;
      errorBanner.style.display = "block";
    }

    const dialog = el("dialog");
    dialog.style.border = "none";
    dialog.style.borderRadius = "8px";
    dialog.style.padding = "28px 32px";
    dialog.style.maxWidth = "420px";
    dialog.style.width = "90vw";
    dialog.style.boxShadow = "0 6px 32px rgba(0,0,0,0.25)";

    const title = el("h3");
    title.textContent = i18next.t("panel.modal.closureWindow.title");
    title.style.margin = "0 0 16px 0";
    title.style.fontSize = "16px";
    title.style.fontWeight = "700";

    const form = el("form");
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";
    form.method = "dialog";

    function field(labelText: string, input: HTMLInputElement, id: string): HTMLDivElement {
      const wrap = el("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "4px";
      const label = el("label");
      label.htmlFor = id;
      label.textContent = labelText;
      label.style.fontSize = "13px";
      label.style.fontWeight = "600";
      label.style.color = "#333";
      input.id = id;
      input.style.padding = "6px 8px";
      input.style.fontSize = "13px";
      input.style.border = "1px solid #ccc";
      input.style.borderRadius = "4px";
      wrap.appendChild(label);
      wrap.appendChild(input);
      return wrap;
    }

    form.appendChild(field(i18next.t("panel.modal.closureWindow.start"), startInput, "pcw-start"));
    form.appendChild(field(i18next.t("panel.modal.closureWindow.end"), endInput, "pcw-end"));
    form.appendChild(errorBanner);

    const buttonRow = el("div");
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "10px";
    buttonRow.style.marginTop = "8px";

    const cancelBtn = el("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = i18next.t("panel.modal.closureWindow.cancel");
    cancelBtn.style.padding = "7px 16px";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", () => settle(null));

    const okBtn = el("button");
    okBtn.type = "submit";
    okBtn.textContent = i18next.t("panel.modal.closureWindow.download");
    okBtn.style.padding = "7px 16px";
    okBtn.style.cursor = "pointer";
    okBtn.style.fontWeight = "bold";

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const start = startInput.value;
      const end = endInput.value;
      if (start === "" || end === "") {
        showError(i18next.t("panel.modal.closureWindow.errorRequired"));
        return;
      }
      if (!(start < end)) {
        showError(i18next.t("panel.modal.closureWindow.errorOrder"));
        return;
      }
      settle({ startISO: start, endISO: end });
    });

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(null);
    });

    dialog.appendChild(title);
    dialog.appendChild(form);
    form.appendChild(buttonRow);

    document.body.appendChild(dialog);
    dialog.showModal();
    startInput.focus();

    function cleanup(): void {
      if (dialog.parentNode) {
        dialog.close();
        dialog.parentNode.removeChild(dialog);
      }
    }
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (The i18n keys are added in Task 11; `t()` compiles regardless.)

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/promptClosureWindow.ts
git commit -m "feat(ui): add promptClosureWindow modal"
```

---

## Task 7: Extract `MatchingSubTab` (pure refactor, no behaviour change)

**Files:**
- Create: `src/ui/subtabs/MatchingSubTab.ts`
- Modify: `src/ui/MatchPanel.ts`

**Context:** This is a mechanical move. The goal: relocate the entire current matching-panel body (URL row, track length, range slider, CSV upload, start-matching, guided overlay, download, resume banner, and every private method that supports them) out of `MatchPanel` into a new `MatchingSubTab` class with the **identical** logic. No behaviour changes. The regression net is: existing tests pass, `npm run build` succeeds, and a manual smoke test shows the panel works exactly as before.

> **Why a move, not a rewrite:** `MatchPanel.ts` is ~2500 lines. Reproducing it here verbatim would be error-prone. Execute this as a copy-rename-rewire operation and lean on the build + tests as verification.

- [ ] **Step 1: Create `MatchingSubTab` as a copy of the current `MatchPanel`**

```bash
cp src/ui/MatchPanel.ts src/ui/subtabs/MatchingSubTab.ts
```

- [ ] **Step 2: Rename the class and fix relative import paths**

In `src/ui/subtabs/MatchingSubTab.ts`:
- Rename the class `MatchPanel` → `MatchingSubTab`.
- The file moved one directory deeper (`src/ui/` → `src/ui/subtabs/`), so every relative import gains one `../`:
  - `"../../locales/i18n"` → `"../../../locales/i18n"`
  - `"../utils/logger"` → `"../../utils/logger"`
  - `"../layers/TrackLayer"` → `"../../layers/TrackLayer"`
  - `"../controller/WalkController"` → `"../../controller/WalkController"`
  - `"../controller/walkStates"` → `"../../controller/walkStates"`
  - `"../state/SessionStore"` → `"../../state/SessionStore"`
  - `"../csv/parseSchedule"` → `"../../csv/parseSchedule"`
  - `"../csv/serializeSchedule"` → `"../../csv/serializeSchedule"`
  - `"../csv/buildClosuresCsv"` → `"../../csv/buildClosuresCsv"`
  - `"./components/wz"` → `"../components/wz"`
  - `"../controller/MatchingPipeline"` → `"../../controller/MatchingPipeline"`
  - `"./promptFinalFields"` → `"../promptFinalFields"`
  - `"../persistence/sessionStorage"` → `"../../persistence/sessionStorage"`
  - `"./modal"` → `"../modal"`
  - `"../matching/trackPortions"` → `"../../matching/trackPortions"`

- [ ] **Step 3: Verify `MatchingSubTab` compiles in isolation**

Run: `npx tsc --noEmit`
Expected: errors only about `MatchPanel.ts` still being referenced — `MatchingSubTab.ts` itself must have zero errors. (If `tsc` reports errors inside `MatchingSubTab.ts`, fix the import paths until clean.)

- [ ] **Step 4: Reduce `MatchPanel.ts` to re-export `MatchingSubTab` temporarily**

Replace the entire contents of `src/ui/MatchPanel.ts` with:

```ts
// Temporary shim — the matching panel body now lives in MatchingSubTab.
// Task 9 replaces this file with the real two-sub-tab shell.
export { MatchingSubTab as MatchPanel } from "./subtabs/MatchingSubTab";
```

- [ ] **Step 5: Verify the build and tests still pass**

Run: `npx tsc --noEmit && npm test`
Expected: clean compile; all existing tests PASS (no test imports `MatchPanel` directly — verify with `grep -rl MatchPanel src/__tests__` returning nothing; if a test does, update its import).

Run: `npm run build`
Expected: `releases/release-*.user.js` produced with no errors.

- [ ] **Step 6: Manual smoke test**

Install the dev build, open WME with `?geojson=https%3A%2F%2Fschweizmobil.ch%2Fapi%2F6%2Ftracks%2F1764963942`. Confirm the panel behaves exactly as before this task: track loads, CSV import works, matching runs, download works.

- [ ] **Step 7: Commit**

```bash
git add src/ui/MatchPanel.ts src/ui/subtabs/MatchingSubTab.ts
git commit -m "refactor(ui): extract MatchingSubTab from MatchPanel (no behaviour change)"
```

---

## Task 8: Extract view classes from `MatchingSubTab`

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`
- Create: `src/ui/views/MatchingHeaderView.ts` (and others as the split dictates)

**Context:** The spec requires view/logic separation. `MatchingSubTab` currently mixes DOM construction (`buildUrlRow`, `buildTrackLengthRow`, `buildRangeSlider`, `buildCsvUploadRow`, `buildStartMatchingRow`, `buildGuidedMatchingRow`, `buildDownloadRow`, `buildResumeBannerRow`, `injectStyles`) with orchestration.

This task is **scoped conservatively**: extract the lowest-risk, self-contained DOM builders into view classes that take a props object and expose injectable callbacks. Do **not** attempt to extract the guided-matching overlay in this task — it is deeply coupled to pipeline events and is left in `MatchingSubTab` for now (a follow-up can split it; it is not on the 7a critical path).

- [ ] **Step 1: Extract the track-length + header DOM into `MatchingHeaderView`**

Create `src/ui/views/MatchingHeaderView.ts`. It owns: the panel title, the state badge, and the track-length row. Interface:

```ts
import { i18next } from "../../../locales/i18n";
import type { WalkState } from "../../controller/walkStates";

export interface MatchingHeaderProps {
  /** Called when the "back to Lignes" control is clicked. */
  onBack: () => void;
}

/**
 * Pure DOM view for the matching sub-tab header: back control, line name,
 * track length, and the walk-state badge. No SDK, no store access.
 */
export class MatchingHeaderView {
  readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly lengthEl: HTMLElement;
  private readonly badgeEl: HTMLElement;

  constructor(props: MatchingHeaderProps) {
    this.root = document.createElement("section");
    this.root.className = "wmegj-section";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.textContent = i18next.t("panel.matching.back");
    backBtn.addEventListener("click", props.onBack);
    this.root.appendChild(backBtn);

    this.nameEl = document.createElement("h3");
    this.nameEl.className = "wmegj-panel-title";
    this.root.appendChild(this.nameEl);

    this.lengthEl = document.createElement("p");
    this.root.appendChild(this.lengthEl);

    const badgeWrapper = document.createElement("p");
    this.badgeEl = document.createElement("strong");
    this.badgeEl.textContent = "—";
    badgeWrapper.appendChild(this.badgeEl);
    this.root.appendChild(badgeWrapper);
  }

  /** Update the displayed line name and length. */
  setLine(name: string, lengthKm: number): void {
    this.nameEl.textContent = name;
    this.lengthEl.textContent = i18next.t("panel.trackInfo.length", {
      km: lengthKm.toFixed(1),
    });
  }

  /** Update the walk-state badge. */
  setBadge(state: WalkState): void {
    this.badgeEl.textContent = i18next.t(`panel.status.${state}`);
  }
}
```

- [ ] **Step 2: Rewire `MatchingSubTab` to use `MatchingHeaderView`**

In `MatchingSubTab.ts`:
- Remove the `buildTrackLengthRow` method and the inline title/badge construction in `buildDOM`.
- In `buildDOM`, instantiate `new MatchingHeaderView({ onBack: () => {} })` and append `headerView.root`. The `onBack` callback is a temporary no-op at this task; Task 9 replaces it with `() => this.deps.onBack()` once `MatchingSubTab` gains the `deps` constructor.
- Replace `this.trackLengthValueEl` writes and `updateBadge` body with `this.headerView.setLine(...)` / `this.headerView.setBadge(state)`.

> **Implementer judgement:** the existing `updateBadge` maps `WalkState` to a label. Keep that mapping inside `MatchingHeaderView.setBadge`. The i18n keys `panel.status.*` already exist (`locales/*/common.json`).

- [ ] **Step 3: Verify build + tests + smoke**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean. Manual smoke: panel still shows title, badge, and track length identically.

- [ ] **Step 4: Commit**

```bash
git add src/ui/views/MatchingHeaderView.ts src/ui/subtabs/MatchingSubTab.ts
git commit -m "refactor(ui): extract MatchingHeaderView from MatchingSubTab"
```

> **Scope guard:** if extracting further builders (range slider, CSV upload) stays mechanical and low-risk, the implementer may extract them into additional view classes (`RangeSliderView`, `CsvUploadView`) following the same pattern, each as its own commit. If any extraction starts requiring logic changes, stop and leave it in `MatchingSubTab` — the 7a goal is the sub-tab split, not a total rewrite.

---

## Task 9: `MatchPanel` shell + `LinesSubTab` + line list views

**Files:**
- Create: `src/ui/views/LineRowView.ts`
- Create: `src/ui/views/LinesListView.ts`
- Create: `src/ui/subtabs/LinesSubTab.ts`
- Modify: `src/ui/MatchPanel.ts` (replace the shim with the real shell)
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (accept `onBack` + selected `LineEntry`)

- [ ] **Step 1: Create `LineRowView` — one line row**

Create `src/ui/views/LineRowView.ts`:

```ts
import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  onSelect: (id: string) => void;
}

/**
 * Pure DOM view for a single line in the Lignes list: colour pill, name,
 * and a "Sélectionner" button. No store access — the controller passes the
 * entry in and handles the onSelect callback.
 */
export class LineRowView {
  readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly selectBtn: HTMLButtonElement;

  constructor(props: LineRowProps) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-line-row";
    this.root.style.display = "flex";
    this.root.style.alignItems = "center";
    this.root.style.gap = "8px";
    this.root.style.padding = "6px 0";

    this.pill = document.createElement("span");
    this.pill.style.width = "12px";
    this.pill.style.height = "12px";
    this.pill.style.borderRadius = "50%";
    this.pill.style.flex = "0 0 auto";
    this.root.appendChild(this.pill);

    this.nameEl = document.createElement("span");
    this.nameEl.style.flex = "1 1 auto";
    this.root.appendChild(this.nameEl);

    this.selectBtn = document.createElement("button");
    this.selectBtn.type = "button";
    this.selectBtn.textContent = i18next.t("panel.lines.select");
    this.selectBtn.addEventListener("click", () => props.onSelect(props.entry.id));
    this.root.appendChild(this.selectBtn);

    this.update(props.entry);
  }

  /** Re-render from a (possibly updated) entry. */
  update(entry: LineEntry): void {
    this.pill.style.backgroundColor = entry.color;
    this.nameEl.textContent = entry.displayName;
  }
}
```

- [ ] **Step 2: Create `LinesListView` — URL row + source info + row container**

Create `src/ui/views/LinesListView.ts`:

```ts
import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";
import { LineRowView } from "./LineRowView";

export interface LinesListProps {
  onLoadUrl: (url: string) => void;
  onSelect: (id: string) => void;
}

/**
 * Pure DOM view for the Lignes sub-tab: URL input + Load button, an inline
 * error slot, a source-type info line, and the list of LineRowViews.
 * No store access — the controller drives it via setEntries/showError.
 */
export class LinesListView {
  readonly root: HTMLElement;
  private readonly urlInput: HTMLInputElement;
  private readonly errorEl: HTMLElement;
  private readonly sourceEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly onSelect: (id: string) => void;

  constructor(props: LinesListProps) {
    this.onSelect = props.onSelect;
    this.root = document.createElement("div");
    this.root.classList.add("sidebar-tab-pane-body");

    const urlRow = document.createElement("section");
    urlRow.className = "wmegj-section";

    const label = document.createElement("label");
    label.textContent = i18next.t("panel.lines.urlLabel");
    urlRow.appendChild(label);

    this.urlInput = document.createElement("input");
    this.urlInput.type = "url";
    this.urlInput.style.width = "100%";
    urlRow.appendChild(this.urlInput);

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = i18next.t("panel.lines.urlLoad");
    loadBtn.addEventListener("click", () => props.onLoadUrl(this.urlInput.value.trim()));
    urlRow.appendChild(loadBtn);

    this.errorEl = document.createElement("p");
    this.errorEl.style.color = "#c00";
    this.errorEl.style.fontSize = "12px";
    this.errorEl.style.display = "none";
    urlRow.appendChild(this.errorEl);

    this.root.appendChild(urlRow);

    this.sourceEl = document.createElement("p");
    this.sourceEl.style.fontWeight = "600";
    this.root.appendChild(this.sourceEl);

    this.listEl = document.createElement("div");
    this.root.appendChild(this.listEl);
  }

  /** Pre-fill the URL field (e.g. from the query param). */
  setUrl(url: string): void {
    this.urlInput.value = url;
  }

  /** Render the line list and the source-type info line. */
  setEntries(entries: readonly LineEntry[]): void {
    this.listEl.replaceChildren();
    if (entries.length === 0) {
      this.sourceEl.textContent = "";
      const empty = document.createElement("p");
      empty.textContent = i18next.t("panel.lines.empty");
      this.listEl.appendChild(empty);
      return;
    }
    // 7a always has exactly one entry (single Feature). 7b sets the
    // FeatureCollection label and count.
    this.sourceEl.textContent = i18next.t("panel.lines.sourceFeature");
    for (const entry of entries) {
      const row = new LineRowView({ entry, onSelect: this.onSelect });
      this.listEl.appendChild(row.root);
    }
  }

  showError(message: string): void {
    this.errorEl.textContent = i18next.t("panel.errors.loadUrl", { message });
    this.errorEl.style.display = "block";
  }

  clearError(): void {
    this.errorEl.textContent = "";
    this.errorEl.style.display = "none";
  }
}
```

- [ ] **Step 3: Create `LinesSubTab` controller**

Create `src/ui/subtabs/LinesSubTab.ts`:

```ts
// Controller for the "Lignes" sub-tab: owns the LinesListView, drives URL
// loading through the injected loadFn, and writes results into LineRegistry.

import { logger } from "../../utils/logger";
import type { LineRegistry } from "../../lines/LineRegistry";
import { LinesListView } from "../views/LinesListView";

export interface LinesSubTabDeps {
  registry: LineRegistry;
  /** Fetches the URL and populates the registry; rejects on failure. */
  loadFn: (url: string) => Promise<void>;
  /** Called after a line is selected, so the shell can switch sub-tabs. */
  onLineSelected: () => void;
}

export class LinesSubTab {
  readonly root: HTMLElement;
  private readonly view: LinesListView;
  private readonly deps: LinesSubTabDeps;
  private readonly unsubscribe: () => void;

  constructor(deps: LinesSubTabDeps) {
    this.deps = deps;
    this.view = new LinesListView({
      onLoadUrl: (url) => void this.handleLoad(url),
      onSelect: (id) => this.handleSelect(id),
    });
    this.root = this.view.root;

    this.view.setEntries(deps.registry.getAll());
    this.unsubscribe = deps.registry.onLinesChanged(() => {
      this.view.setEntries(deps.registry.getAll());
    });
  }

  /** Pre-fill the URL field (query-param value). */
  setUrl(url: string): void {
    this.view.setUrl(url);
  }

  /** Surface a load error in the view (called by the shell's loadFn path). */
  showError(message: string): void {
    this.view.showError(message);
  }

  private async handleLoad(url: string): Promise<void> {
    if (url === "") return;
    this.view.clearError();
    try {
      await this.deps.loadFn(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("LinesSubTab: load failed", err);
      this.view.showError(message);
    }
  }

  private handleSelect(id: string): void {
    this.deps.registry.setSelected(id);
    this.deps.onLineSelected();
  }

  dispose(): void {
    this.unsubscribe();
  }
}
```

- [ ] **Step 4: Replace `MatchPanel.ts` with the real shell**

Replace the entire contents of `src/ui/MatchPanel.ts`:

```ts
// Shell panel: registers the WME sidebar tab and hosts a [Lignes][Matching]
// segmented toggle over two sub-tab controllers. All matching logic lives in
// MatchingSubTab; all line-loading logic in LinesSubTab. This file owns only
// the tab registration, the toggle, and sub-tab mounting.

import type { WmeSDK } from "wme-sdk-typings";
import { i18next } from "../../locales/i18n";
import { logger } from "../utils/logger";
import type { SessionStore } from "../state/SessionStore";
import type { LineRegistry } from "../lines/LineRegistry";
import { LinesSubTab } from "./subtabs/LinesSubTab";
import { MatchingSubTab } from "./subtabs/MatchingSubTab";

type SubTab = "lines" | "matching";

export class MatchPanel {
  private tabPane: HTMLElement | null = null;
  private tabLabel: HTMLElement | null = null;

  private linesBtn: HTMLButtonElement | null = null;
  private matchingBtn: HTMLButtonElement | null = null;
  private linesContainer: HTMLElement | null = null;
  private matchingContainer: HTMLElement | null = null;

  private linesSubTab: LinesSubTab | null = null;
  private matchingSubTab: MatchingSubTab | null = null;

  private activeTab: SubTab = "lines";
  private loadFn: ((url: string) => Promise<void>) | null = null;

  constructor(
    private readonly wmeSDK: WmeSDK,
    private readonly store: SessionStore,
    private readonly registry: LineRegistry,
  ) {}

  /** Injected by main.user.ts to break the loadAndAttachTrack import cycle. */
  setLoadFn(fn: (url: string) => Promise<void>): void {
    this.loadFn = fn;
  }

  async mount(): Promise<void> {
    if (this.tabPane) return;

    const { tabLabel, tabPane } = await this.wmeSDK.Sidebar.registerScriptTab();
    this.tabLabel = tabLabel;
    this.tabPane = tabPane;
    tabLabel.textContent = i18next.t("panel.title");

    const toggle = document.createElement("div");
    toggle.className = "wmegj-subtab-toggle";
    this.linesBtn = this.makeToggleButton(i18next.t("panel.subtabs.lines"), "lines");
    this.matchingBtn = this.makeToggleButton(i18next.t("panel.subtabs.matching"), "matching");
    toggle.appendChild(this.linesBtn);
    toggle.appendChild(this.matchingBtn);
    tabPane.appendChild(toggle);

    this.linesContainer = document.createElement("div");
    this.matchingContainer = document.createElement("div");
    tabPane.appendChild(this.linesContainer);
    tabPane.appendChild(this.matchingContainer);

    if (!this.loadFn) {
      logger.error("MatchPanel.mount: loadFn not set before mount");
      return;
    }

    this.linesSubTab = new LinesSubTab({
      registry: this.registry,
      loadFn: this.loadFn,
      onLineSelected: () => this.setActiveTab("matching"),
    });
    this.linesContainer.appendChild(this.linesSubTab.root);

    this.matchingSubTab = new MatchingSubTab({
      wmeSDK: this.wmeSDK,
      store: this.store,
      registry: this.registry,
      onBack: () => this.setActiveTab("lines"),
    });
    this.matchingContainer.appendChild(await this.matchingSubTab.buildRoot());

    this.setActiveTab("lines");
  }

  /** Pre-fill the URL field from the query param. */
  setInitialUrl(url: string): void {
    this.linesSubTab?.setUrl(url);
  }

  /** Surface a URL load error in the Lignes sub-tab. */
  showLoadError(message: string): void {
    this.linesSubTab?.showError(message);
  }

  getTabLabel(): HTMLElement | null {
    return this.tabLabel;
  }

  private makeToggleButton(label: string, tab: SubTab): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => this.setActiveTab(tab));
    return btn;
  }

  private setActiveTab(tab: SubTab): void {
    this.activeTab = tab;
    const showLines = tab === "lines";
    if (this.linesContainer) this.linesContainer.style.display = showLines ? "" : "none";
    if (this.matchingContainer) this.matchingContainer.style.display = showLines ? "none" : "";
    this.linesBtn?.classList.toggle("wmegj-subtab-active", showLines);
    this.matchingBtn?.classList.toggle("wmegj-subtab-active", !showLines);
  }
}
```

- [ ] **Step 5: Adapt `MatchingSubTab` to the new constructor + `buildRoot`**

`MatchingSubTab` was a copy of the old `MatchPanel`, whose `mount()` called `Sidebar.registerScriptTab()` itself. The shell now owns tab registration. In `MatchingSubTab.ts`:

- Change the constructor to take a single deps object:
  ```ts
  constructor(private readonly deps: {
    wmeSDK: WmeSDK;
    store: SessionStore;
    registry: LineRegistry;
    onBack: () => void;
  }) {}
  ```
  Replace internal `this.wmeSDK` / `this.store` references with `this.deps.wmeSDK` / `this.deps.store` (or assign them to private fields in the constructor body to minimise churn).
- Replace `mount()` with `buildRoot(): Promise<HTMLElement>`: it must **not** call `Sidebar.registerScriptTab()`. Instead create a root `<div>`, run the existing `buildDOM(root)` against it, wire the store/state subscriptions exactly as `mount()` did, and return the root.
- The old `MatchPanel` read the GeoJSON URL from `SessionStore`/query param and had `setController`/`setTrackLayer` setters called by `loadAndAttachTrack`. Keep these setters — Task 10 wires them to the selected `LineEntry`.
- Wire the back control: pass `this.deps.onBack` into `MatchingHeaderView` (Task 8 added the `onBack` prop).
- When no line is selected, `buildRoot`'s result should show only the empty-state text `i18next.t("panel.matching.noSelection")`; the existing rows stay hidden until a line is attached (Task 10 handles attach).

> **Implementer note:** this step is the riskiest. Keep the diff mechanical. The existing `unmount()` logic for unsubscribing stays; rename it if convenient but keep the cleanup. Verify against the build + manual smoke.

- [ ] **Step 6: Add toggle styling**

In `MatchingSubTab`'s `injectStyles` (or a small style block in the shell), add:

```css
.wmegj-subtab-toggle { display: flex; gap: 0; margin-bottom: 8px; }
.wmegj-subtab-toggle button { flex: 1; padding: 6px; cursor: pointer; border: 1px solid #ccc; background: #f4f4f4; }
.wmegj-subtab-toggle button.wmegj-subtab-active { background: #fff; font-weight: 700; }
```

- [ ] **Step 7: Verify build + tests**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean compile, all tests pass, build artefact produced.

- [ ] **Step 8: Commit**

```bash
git add src/ui/MatchPanel.ts src/ui/subtabs/ src/ui/views/
git commit -m "feat(ui): split MatchPanel into Lignes and Matching sub-tabs"
```

---

## Task 10: Wire `LineRegistry` through bootstrap + synthetic matching

**Files:**
- Modify: `main.user.ts`
- Modify: `src/bootstrap/loadAndAttachTrack.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

- [ ] **Step 1: Construct `LineRegistry` in `main.user.ts` and use `loadLines`**

Replace `main.user.ts` body so it builds the registry, passes it to `MatchPanel`, and on a query-param URL calls the loader path:

```ts
import type { WmeSDK } from "wme-sdk-typings";
import { initI18n } from "./locales/i18n";
import { SessionStore } from "./src/state/SessionStore";
import { LineRegistry } from "./src/lines/LineRegistry";
import { MatchPanel } from "./src/ui/MatchPanel";
import { loadAndAttachLines } from "./src/bootstrap/loadAndAttachTrack";
import { getGeojsonUrlFromLocation } from "./src/utils/queryParams";
import { logger } from "./src/utils/logger";

unsafeWindow.SDK_INITIALIZED.then(initScript);

async function initScript(): Promise<void> {
  if (!unsafeWindow.getWmeSdk) {
    logger.error("getWmeSdk not available on unsafeWindow; aborting.");
    return;
  }
  const wmeSDK: WmeSDK = unsafeWindow.getWmeSdk({
    scriptId: "wme-geojson",
    scriptName: "WME GeoJSON",
  });

  await initI18n(wmeSDK);
  await wmeSDK.Events.once({ eventName: "wme-ready" });

  const store = new SessionStore();
  const registry = new LineRegistry();
  const panel = new MatchPanel(wmeSDK, store, registry);

  panel.setLoadFn((url: string) => loadAndAttachLines(url, wmeSDK, store, registry, panel));

  await panel.mount();

  const url = getGeojsonUrlFromLocation();
  if (url) {
    panel.setInitialUrl(url);
    await loadAndAttachLines(url, wmeSDK, store, registry, panel);
  }
}
```

- [ ] **Step 2: Rewrite `loadAndAttachTrack.ts` as `loadAndAttachLines`**

The bootstrap helper now loads via `loadLines`, fills the registry, and draws the (single) line. Replace the file contents:

```ts
// Bootstrap helper: load a GeoJSON source URL into the LineRegistry and draw
// the resulting line(s) on the map.

import type { WmeSDK } from "wme-sdk-typings";
import { loadLines } from "../lines/featureCollectionLoader";
import { TrackLayer } from "../layers/TrackLayer";
import { SessionStore } from "../state/SessionStore";
import { LineRegistry } from "../lines/LineRegistry";
import { logger } from "../utils/logger";
import type { MatchPanel } from "../ui/MatchPanel";

export async function loadAndAttachLines(
  url: string,
  wmeSDK: WmeSDK,
  store: SessionStore,
  registry: LineRegistry,
  panel: MatchPanel,
): Promise<void> {
  try {
    const entries = await loadLines(url);

    // Persist URL in the query string so a reload re-triggers auto-load.
    const params = new URLSearchParams(window.location.search);
    params.set("geojson", url);
    history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);

    registry.setEntries(entries);

    // 7a: a single Feature → exactly one entry. Draw it as the active line.
    try {
      wmeSDK.Map.removeLayer({ layerName: TrackLayer.LAYER_NAME });
    } catch {
      // No previous layer on first load — expected.
    }
    const layer = new TrackLayer(wmeSDK);
    layer.draw(entries[0].track);
    logger.info(`Loaded ${entries.length} line(s) from ${url}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("loadAndAttachLines: failed", err);
    panel.showLoadError(message);
  }
}
```

> **Note:** the `TrackLayer`/`WalkController` per-line wiring is intentionally minimal in 7a (one line). The `store.setTrack` call is dropped here — `MatchingSubTab` now derives its track from the selected `LineEntry` (next step). If `MatchingSubTab` still depends on `store.setTrack`/`store.setPhase` for its row visibility, keep a `store.setTrack(url, entries[0].lengthKm)` call here to avoid a regression, and let Task 10 Step 3 reconcile it. Verify against the build.

- [ ] **Step 3: Make `MatchingSubTab` attach to the selected `LineEntry`**

In `MatchingSubTab.ts`:
- Subscribe to `registry.onSelectedLineChanged` in `buildRoot`.
- On selection of entry `X`:
  - If a walk is running, call the controller's `stop()` first.
  - Construct a `WalkController` for `X.track.geometry` (mirror the old `loadAndAttachTrack`: `new WalkController(wmeSDK, X.track.geometry)`), call the existing `setController` / `setTrackLayer` setters.
  - Update the `MatchingHeaderView` with `X.displayName` and `X.lengthKm`.
  - Set `mode`: if `X.csvRows` present → CSV mode UI; else → synthetic mode. For synthetic mode, push the synthetic row into the store: `store.setCsvRows([buildSyntheticRow(X.lengthKm)], "")` so the existing matching pipeline has its one slice.
  - Show the synthetic banner (`i18next.t("panel.matching.syntheticBanner")`) above the row area when `mode === "synthetic"`; hide the CSV-row table in that case.
- On selection cleared (`null`): show the empty-state text.

> **Implementer note:** `store.setCsvRows` currently resets `closuresBySegment` and index — exactly what we want when switching lines. Importing a real CSV later (`onCsvFileSelected` → `processCsvText`) overwrites the synthetic row, flipping the line to CSV mode; also call `registry.updateEntry(X.id, { mode: "csv", csvRows, csvText })` there.

- [ ] **Step 4: Synthetic-mode download path**

In `MatchingSubTab.onDownloadClosuresClick`:
- Determine mode from the selected entry (`registry.getSelected()?.mode`).
- If `mode === "csv"`: keep the existing flow unchanged.
- If `mode === "synthetic"`:
  1. Verify matching produced segments (`hasValidatedProgress` — the synthetic row's `segments` is non-null after matching).
  2. Compute closure-window defaults: `date` = today (`new Date().toISOString().slice(0, 10)`), `startTime` = `"09:00"`, `endTime` = `"17:30"`. (Phase 7c overrides `date` from slowUp details.)
  3. `const window = await promptClosureWindow(defaults);` — bail if `null`.
  4. Re-validate the synthetic row with the chosen window so `closuresBySegment` carries the right ISO range:
     `store.rewindToRow(0)` is not enough — instead update the synthetic row's date/times then call `store.validateRow(0, matchedSegments, window.startISO, window.endISO)`. The simplest correct path: rebuild the row via `store.setCsvRows([{ ...buildSyntheticRow(lengthKm), date: window.startISO.slice(0,10), startTime: window.startISO.slice(11), endTime: window.endISO.slice(11) }], "")`, then re-run `validateRow(0, matchedSegments, window.startISO, window.endISO)`.

     > **Decision point — flag for review:** this re-validation interaction with `SessionStore` is the one genuinely fiddly piece. The cleanest implementation may be a small new `SessionStore` method `setClosureWindowForRow(index, startISO, endISO)` that rewrites a row's date/time and rebuilds its `closuresBySegment` ranges from the already-matched `segments`. If the executing engineer finds the rebuild-via-setCsvRows path loses the matched `segments`, add that method instead. Surface the chosen approach in the task commit message.
  5. Then run the existing `buildClosuresCsv(...)` + `triggerDownload(...)` path.

- [ ] **Step 5: Verify build + tests + manual smoke**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean.

Manual:
1. Open WME with `?geojson=https%3A%2F%2Fschweizmobil.ch%2Fapi%2F6%2Ftracks%2F1764963942` — Lignes sub-tab shows one row, URL field pre-filled.
2. Click "Sélectionner" — switches to Matching sub-tab, synthetic banner visible, no CSV table.
3. Run matching — segments matched.
4. Click download — `promptClosureWindow` appears, defaults today 09:00→17:30. Confirm → `closures.csv` downloads.
5. Import a CSV instead — banner disappears, CSV table appears, download skips the modal (existing flow).

- [ ] **Step 6: Commit**

```bash
git add main.user.ts src/bootstrap/loadAndAttachTrack.ts src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat: wire LineRegistry and CSV-less synthetic matching"
```

---

## Task 11: i18n keys

**Files:**
- Modify: `locales/en/common.json`
- Modify: `locales/fr/common.json`

- [ ] **Step 1: Add the new keys to both locale files**

Add under `panel` (merge into the existing structure — do not overwrite siblings):

English (`locales/en/common.json`):

```json
{
  "panel": {
    "subtabs": { "lines": "Lines", "matching": "Matching" },
    "lines": {
      "urlLabel": "GeoJSON URL",
      "urlLoad": "Load",
      "sourceFeature": "Feature (1 line)",
      "sourceCollection": "FeatureCollection ({{count}} lines)",
      "empty": "No line in this source.",
      "fallbackName": "Track {{km}} km long",
      "select": "Select"
    },
    "matching": {
      "back": "← Lines",
      "syntheticBanner": "No CSV — the whole line will be closed over a single time window (entered at download).",
      "noSelection": "Select a line in the Lines tab."
    },
    "modal": {
      "closureWindow": {
        "title": "Closure window",
        "start": "Start",
        "end": "End",
        "errorRequired": "Both start and end are required.",
        "errorOrder": "End must be after start.",
        "cancel": "Cancel",
        "download": "Download"
      }
    },
    "errors": {
      "loadUrl": "Failed to load the URL: {{message}}"
    }
  }
}
```

French (`locales/fr/common.json`):

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
      "select": "Sélectionner"
    },
    "matching": {
      "back": "← Lignes",
      "syntheticBanner": "Pas de CSV — la ligne entière sera fermée sur une seule fenêtre temporelle (saisie au téléchargement).",
      "noSelection": "Sélectionne une ligne dans l'onglet Lignes."
    },
    "modal": {
      "closureWindow": {
        "title": "Fenêtre de fermeture",
        "start": "Début",
        "end": "Fin",
        "errorRequired": "Le début et la fin sont obligatoires.",
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

> **Note:** `panel.trackInfo.length` and `panel.status.*` are referenced by `MatchingHeaderView` (Task 8) and already exist per the PRD. If `grep -n '"length"' locales/fr/common.json` finds nothing, add `"trackInfo": { "length": "Longueur : {{km}} km" }` (FR) / `"Length: {{km}} km"` (EN).

- [ ] **Step 2: Verify JSON validity and build**

Run: `node -e "JSON.parse(require('fs').readFileSync('locales/fr/common.json','utf8')); JSON.parse(require('fs').readFileSync('locales/en/common.json','utf8')); console.log('ok')"`
Expected: `ok`.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add locales/en/common.json locales/fr/common.json
git commit -m "i18n: add keys for sub-tabs, line list, and closure window"
```

---

## Task 12: Full verification + cleanup

**Files:**
- All (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests PASS, including the 4 new test files (`displayName`, `LineRegistry`, `syntheticSchedule`, `featureCollectionLoader`).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: passes (lint auto-fixes; review the diff for anything unexpected).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `releases/release-*.user.js` produced, no errors.

- [ ] **Step 4: Full manual validation checklist**

Install the dev build and verify:
- [ ] `?geojson=` query param still auto-loads; URL field pre-filled in Lignes sub-tab.
- [ ] Toggle switches between Lignes and Matching; state persists across switches.
- [ ] A single Feature shows exactly one row with name (or "Tracé de X km") + Sélectionner.
- [ ] Selecting a line switches to Matching, draws the line, shows its name + length.
- [ ] CSV-less: synthetic banner shown, matching runs, download prompts the closure window (defaults today 09:00→17:30), `closures.csv` downloads correctly.
- [ ] With a CSV imported: behaviour identical to pre-7a (no modal, CSV table shown).
- [ ] Back control returns to Lignes without losing the selection.
- [ ] An invalid URL shows a red inline error under the URL field.

- [ ] **Step 5: Update the spec's hypothesis/changelog if anything diverged**

If any SDK signature, `SessionStore` interaction, or refactor assumption turned out different from this plan, append a short note to `docs/superpowers/specs/2026-05-18-feature-collection-design.md` (or `prd.md`'s changelog) so Phase 7b planning accounts for it.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: Phase 7a verification and changelog notes"
```

---

## Self-review notes

- **Spec coverage:** Goals 1–4 of the spec are covered — single-Feature load (Tasks 5, 10), sub-tab split (Tasks 7–9), CSV-less synthetic matching (Tasks 4, 10), closure-window prompt with today/09:00/17:30 defaults (Tasks 6, 10). FeatureCollection parsing, multi-color preview, and slowUp details are explicitly Phase 7b/7c and excluded.
- **Known soft spots flagged for the executor:** (a) the `MatchingSubTab` extraction (Task 7) is a move, verified by build+tests+smoke rather than reproduced code; (b) the `MatchingSubTab` constructor/`buildRoot` adaptation (Task 9 Step 5) is the riskiest single step; (c) the synthetic-row re-validation against `SessionStore` (Task 10 Step 4) has a flagged decision point — prefer adding `SessionStore.setClosureWindowForRow` if the simpler path drops matched segments.
- **Type consistency:** `LineEntry`, `LineRegistry` method names, `ClosureWindow`, and `buildSyntheticRow`'s `CsvRow` shape are used consistently across tasks.
