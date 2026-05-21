# Lazy sub-line matching & domain unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the upfront-planned multi-leaf flow and chain-by-chain slowup orchestration with a unified `Source → Line[] → SubLine[] → MatchedSegment[]` model, lazy sub-line iteration, atomic localStorage persistence, and cross-line back/rerun semantics.

**Architecture:** Build the new domain types and a persistence adapter first (pure, no SDK). Rebuild `SessionStore` against the new model. Then rebuild `MatchingPipeline` with a `SubLineIterator` and persistence hooks. Update the slowup ingestion path to produce one Line per merged chain (the merge itself stays as today). Remove the chain-by-chain orchestrator and the CSV-upload-on-slowup UI last, once the new path is proven. Each phase ends with `npx vitest run` and `npx tsc --noEmit` clean.

**Tech Stack:** TypeScript strict, Vitest, no new runtime deps. WME SDK and `geojson` types as today.

**Spec:** `docs/superpowers/specs/2026-05-21-lazy-subline-matching-design.md`

---

## Conventions

- Every code step shows the actual content the engineer types or replaces. No "similar to Task N" handoffs.
- Tests live in `src/__tests__/<file>.test.ts` to match existing convention.
- Each task ends with a commit. Commit message format: `feat(domain): …` / `refactor(pipeline): …` / `chore(cleanup): …`.
- All localStorage keys: `wme-geojson:source:<sourceId>`. Reads/writes go through the `SourcePersistence` adapter (Task 2); no other module touches `localStorage` for this state.
- Cross-task type references: see "Shared types" below — Task 1 defines them once; later tasks import.

## Shared types (defined in Task 1, referenced throughout)

```ts
// src/domain/types.ts (new)
export interface Bbox4 { readonly bbox: [number, number, number, number]; }
export interface MapAnchor { lon: number; lat: number; zoom: number; }

export interface MatchedSegment {
  segmentId: number;
}

export interface SubLine {
  /** 0-based, stable within its parent Line. */
  index: number;
  /** Distance along the parent Line, in km. */
  kmA: number;
  kmB: number;
  bbox: [number, number, number, number];
  /** Map anchor used to drive matching for this sub-line. */
  view: MapAnchor;
  /** Validated segment ids (empty until validated === true). */
  segmentIds: number[];
  /** Whether the operator validated the matching for this sub-line. */
  validated: boolean;
}

export interface Line {
  /** 0-based, stable within its parent Source. */
  index: number;
  /** Display label, e.g. "Ligne 1/N" prefix data ("3/5"). */
  bbox: [number, number, number, number];
  /** ISO timestamps, only when the Source has CSV-derived time windows. */
  startISO?: string;
  endISO?: string;
  /** Geometry slice covered by this Line (already km-sliced for CSV mode, full for non-CSV). */
  geometry: import("geojson").MultiLineString;
  lengthKm: number;
  /** Sub-lines created so far (lazy: may grow during matching). */
  subLines: SubLine[];
  /** Pending [kmA,kmB] ranges within this Line that have not been fitted into sub-lines yet. */
  pendingTail: Array<{ kmA: number; kmB: number }>;
}

export type SourceKind = "geojson" | "slowup";

export interface Source {
  schemaVersion: 1;
  /** Stable id derived from URL+featureIndex (GeoJSON) or slowup refid (Slowup). */
  sourceId: string;
  kind: SourceKind;
  hasCsv: boolean;
  lines: Line[];
  /** Resume point. null when no line has been started yet. */
  cursor: { lineIndex: number; subLineIndex: number } | null;
}
```

---

# Phase 1 — Domain types and persistence adapter

## Task 1: Domain types module

**Files:**
- Create: `src/domain/types.ts`
- Test: `src/__tests__/domainTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/domainTypes.test.ts
import { describe, expect, it } from "vitest";
import type { Source, Line, SubLine } from "../domain/types";

describe("domain types", () => {
  it("constructs a Source with no lines", () => {
    const source: Source = {
      schemaVersion: 1,
      sourceId: "test",
      kind: "geojson",
      hasCsv: false,
      lines: [],
      cursor: null,
    };
    expect(source.schemaVersion).toBe(1);
    expect(source.cursor).toBeNull();
  });

  it("constructs a Line with one pending range and no sub-lines", () => {
    const line: Line = {
      index: 0,
      bbox: [0, 0, 1, 1],
      geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
      lengthKm: 1.4,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: 1.4 }],
    };
    expect(line.pendingTail).toHaveLength(1);
  });

  it("constructs a SubLine with empty segments and validated=false", () => {
    const sub: SubLine = {
      index: 0,
      kmA: 0,
      kmB: 1.4,
      bbox: [0, 0, 1, 1],
      view: { lon: 0.5, lat: 0.5, zoom: 16 },
      segmentIds: [],
      validated: false,
    };
    expect(sub.segmentIds).toEqual([]);
    expect(sub.validated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/domainTypes.test.ts`
Expected: FAIL — `Cannot find module '../domain/types'`.

- [ ] **Step 3: Create the module**

Write `src/domain/types.ts` with the exact content from the "Shared types" section at the top of this plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/domainTypes.test.ts` → PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/__tests__/domainTypes.test.ts
git commit -m "feat(domain): introduce Source/Line/SubLine/MatchedSegment types"
```

---

## Task 2: localStorage persistence adapter

**Files:**
- Create: `src/domain/SourcePersistence.ts`
- Test: `src/__tests__/SourcePersistence.test.ts`

The adapter is a small, debounced wrapper around `localStorage`. One key per source. JSON serialization. No migration: keys with `schemaVersion !== 1` are deleted on load.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/SourcePersistence.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcePersistence } from "../domain/SourcePersistence";
import type { Source } from "../domain/types";

function makeSource(id: string): Source {
  return {
    schemaVersion: 1,
    sourceId: id,
    kind: "geojson",
    hasCsv: false,
    lines: [],
    cursor: null,
  };
}

describe("SourcePersistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes and reads back a source", async () => {
    const p = new SourcePersistence();
    const src = makeSource("s1");
    p.save(src);
    vi.advanceTimersByTime(250);
    const loaded = p.load("s1");
    expect(loaded?.sourceId).toBe("s1");
  });

  it("returns null when the key does not exist", () => {
    const p = new SourcePersistence();
    expect(p.load("missing")).toBeNull();
  });

  it("discards prior-schema payloads silently", () => {
    localStorage.setItem(
      "wme-geojson:source:legacy",
      JSON.stringify({ schemaVersion: 0, sourceId: "legacy" }),
    );
    const p = new SourcePersistence();
    expect(p.load("legacy")).toBeNull();
    expect(localStorage.getItem("wme-geojson:source:legacy")).toBeNull();
  });

  it("debounces multiple save() calls within the window", () => {
    const p = new SourcePersistence({ debounceMs: 200 });
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    p.save(makeSource("s2"));
    p.save(makeSource("s2"));
    p.save(makeSource("s2"));
    vi.advanceTimersByTime(199);
    expect(setSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it("flush() forces an immediate write", () => {
    const p = new SourcePersistence({ debounceMs: 200 });
    p.save(makeSource("s3"));
    p.flush();
    expect(localStorage.getItem("wme-geojson:source:s3")).toContain("\"sourceId\":\"s3\"");
  });

  it("clear() removes the key", () => {
    const p = new SourcePersistence();
    p.save(makeSource("s4"));
    p.flush();
    expect(p.load("s4")).not.toBeNull();
    p.clear("s4");
    expect(p.load("s4")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/SourcePersistence.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the adapter**

```ts
// src/domain/SourcePersistence.ts
import type { Source } from "./types";

const KEY_PREFIX = "wme-geojson:source:";
const DEFAULT_DEBOUNCE_MS = 200;

export interface SourcePersistenceOptions {
  debounceMs?: number;
}

export class SourcePersistence {
  private readonly debounceMs: number;
  private pending: Map<string, Source> = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SourcePersistenceOptions = {}) {
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  load(sourceId: string): Source | null {
    const raw = localStorage.getItem(KEY_PREFIX + sourceId);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Source>;
      if (parsed.schemaVersion !== 1) {
        localStorage.removeItem(KEY_PREFIX + sourceId);
        return null;
      }
      return parsed as Source;
    } catch {
      localStorage.removeItem(KEY_PREFIX + sourceId);
      return null;
    }
  }

  save(source: Source): void {
    this.pending.set(source.sourceId, source);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [id, src] of this.pending) {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(src));
    }
    this.pending.clear();
  }

  clear(sourceId: string): void {
    this.pending.delete(sourceId);
    localStorage.removeItem(KEY_PREFIX + sourceId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/SourcePersistence.test.ts` → all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/SourcePersistence.ts src/__tests__/SourcePersistence.test.ts
git commit -m "feat(domain): add SourcePersistence adapter for localStorage"
```

---

# Phase 2 — Sub-line iterator (pure)

## Task 3: Extract `fitNextSubLine` from existing `fitPendingSlice`

Goal: pull the inner zoom-fitting logic out of `MatchingPipeline` into a pure, testable function. Today's `fitPendingSlice` (`MatchingPipeline.ts:746`) mixes `wmeSDK.Map.zoomToExtent` calls with looping. We want a pure function that takes `(geometry, kmA, evaluateZoomForBbox)` and returns the fitted slice without owning the loop state.

**Files:**
- Create: `src/matching/fitNextSubLine.ts`
- Test: `src/__tests__/fitNextSubLine.test.ts`

- [ ] **Step 1: Write the failing test (covers the 3 outcomes: fits, min-span accepted, split required)**

```ts
// src/__tests__/fitNextSubLine.test.ts
import { describe, expect, it } from "vitest";
import type { MultiLineString } from "geojson";
import { fitNextSubLine } from "../matching/fitNextSubLine";

const TARGET_ZOOM = 16;

function lineFromKmRange(kmA: number, kmB: number): MultiLineString {
  // Use a 1-km/deg-longitude approximation at the equator (≈ 111 km/deg).
  const lonA = kmA / 111;
  const lonB = kmB / 111;
  return { type: "MultiLineString", coordinates: [[[lonA, 0], [lonB, 0]]] };
}

describe("fitNextSubLine", () => {
  it("accepts the whole pending range when it fits at the target zoom", () => {
    const result = fitNextSubLine({
      pending: { kmA: 0, kmB: 1 },
      geometry: lineFromKmRange(0, 1),
      targetZoom: TARGET_ZOOM,
      evaluateZoom: () => TARGET_ZOOM,
      sliceByKm: (_, a, b) => lineFromKmRange(a, b),
    });
    expect(result.accepted.kmA).toBe(0);
    expect(result.accepted.kmB).toBe(1);
    expect(result.remainder).toBeNull();
  });

  it("splits and returns a remainder when the candidate is below target zoom", () => {
    const result = fitNextSubLine({
      pending: { kmA: 0, kmB: 8 },
      geometry: lineFromKmRange(0, 8),
      targetZoom: TARGET_ZOOM,
      // Pretend the whole range needs z13 but a head trimmed to 75% reaches z16.
      evaluateZoom: (geom) => {
        const span = geom.coordinates[0][1][0] - geom.coordinates[0][0][0];
        return span > 0.05 ? 13 : 16;
      },
      sliceByKm: (_, a, b) => lineFromKmRange(a, b),
    });
    expect(result.accepted.kmA).toBe(0);
    expect(result.accepted.kmB).toBeLessThan(8);
    expect(result.accepted.kmB).toBeGreaterThan(0);
    expect(result.remainder).not.toBeNull();
    expect(result.remainder!.kmA).toBe(result.accepted.kmB);
    expect(result.remainder!.kmB).toBe(8);
  });

  it("accepts undersized slices when span <= MIN", () => {
    const result = fitNextSubLine({
      pending: { kmA: 0, kmB: 0.005 },
      geometry: lineFromKmRange(0, 0.005),
      targetZoom: TARGET_ZOOM,
      evaluateZoom: () => 14, // below target
      sliceByKm: (_, a, b) => lineFromKmRange(a, b),
      minSpanKm: 0.01,
    });
    expect(result.accepted.kmB).toBe(0.005);
    expect(result.remainder).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/fitNextSubLine.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure function**

```ts
// src/matching/fitNextSubLine.ts
import type { MultiLineString } from "geojson";
import { bboxOfMultiLineString, multiLineLengthKm } from "./trackPortions";

const VIEW_SLICE_EPSILON_KM = 0.005;
const DEFAULT_MIN_SPAN_KM = 0.01;
const VIEW_SLICE_HEAD_RATIO = 0.75;

export interface PendingRange { kmA: number; kmB: number; }

export interface FittedSubLine {
  kmA: number;
  kmB: number;
  bbox: [number, number, number, number];
  view: { lon: number; lat: number; zoom: number };
}

export interface FitInput {
  pending: PendingRange;
  geometry: MultiLineString;          // geometry covering [pending.kmA, pending.kmB]
  targetZoom: number;
  evaluateZoom(geom: MultiLineString): number;   // pure delegate (Pipeline wraps zoomToExtent)
  sliceByKm(geom: MultiLineString, kmA: number, kmB: number): MultiLineString;
  minSpanKm?: number;
}

export interface FitResult {
  accepted: FittedSubLine;
  remainder: PendingRange | null;
}

export function fitNextSubLine(input: FitInput): FitResult {
  const minSpan = input.minSpanKm ?? DEFAULT_MIN_SPAN_KM;
  let headKmA = input.pending.kmA;
  let headGeom = input.geometry;

  while (headGeom.coordinates.length > 0) {
    const zoom = input.evaluateZoom(headGeom);
    const headKmB = headKmA + multiLineLengthKm(headGeom);
    const box = bboxOfMultiLineString(headGeom);
    if (!box) {
      throw new Error("fitNextSubLine: empty bbox");
    }
    const span = headKmB - headKmA;
    const accept = (): FitResult => {
      const remainder =
        input.pending.kmB - headKmB > VIEW_SLICE_EPSILON_KM
          ? { kmA: headKmB, kmB: input.pending.kmB }
          : null;
      return {
        accepted: {
          kmA: headKmA,
          kmB: headKmB,
          bbox: box,
          view: { lon: (box[0] + box[2]) / 2, lat: (box[1] + box[3]) / 2, zoom },
        },
        remainder,
      };
    };
    if (zoom >= input.targetZoom) return accept();
    if (span <= minSpan) return accept();

    const newKmB = headKmA + span * VIEW_SLICE_HEAD_RATIO;
    if (newKmB - headKmA <= VIEW_SLICE_EPSILON_KM) return accept();

    const next = input.sliceByKm(input.geometry, headKmA, newKmB);
    if (next.coordinates.length === 0) return accept();
    headGeom = next;
  }

  throw new Error("fitNextSubLine: exited loop without accepting a slice");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/fitNextSubLine.test.ts` → 3 PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/matching/fitNextSubLine.ts src/__tests__/fitNextSubLine.test.ts
git commit -m "feat(matching): pure fitNextSubLine helper for lazy sub-line iteration"
```

---

# Phase 3 — Slowup ingestion: build Lines list at selection time

## Task 4: Source builder for slowup sources

This produces the `Line[]` for a slowup `LineEntry` using the existing `listTrackChains` + `mergeTrackChainsByEndpoints(_, 0.05)`. Each merged chain becomes one Line.

**Files:**
- Create: `src/domain/buildSlowupSource.ts`
- Test: `src/__tests__/buildSlowupSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/buildSlowupSource.test.ts
import { describe, expect, it } from "vitest";
import { buildSlowupSource } from "../domain/buildSlowupSource";
import type { NormalizedTrack } from "../geojson/types";

function track(coords: number[][][]): NormalizedTrack {
  return {
    trackId: null,
    geometry: { type: "MultiLineString", coordinates: coords },
    rawProperties: {},
  };
}

describe("buildSlowupSource", () => {
  it("creates one Line per merged chain", () => {
    // Two well-separated pieces (gap >> 50m) → 2 lines.
    const t = track([
      [[6.0, 46.0], [6.01, 46.0]],
      [[7.0, 47.0], [7.01, 47.0]],
    ]);
    const src = buildSlowupSource({ sourceId: "slowup-1", track: t });
    expect(src.kind).toBe("slowup");
    expect(src.hasCsv).toBe(false);
    expect(src.lines).toHaveLength(2);
    expect(src.lines[0].index).toBe(0);
    expect(src.lines[1].index).toBe(1);
    expect(src.lines[0].pendingTail).toEqual([
      { kmA: 0, kmB: src.lines[0].lengthKm },
    ]);
    expect(src.lines[0].subLines).toEqual([]);
    expect(src.cursor).toBeNull();
  });

  it("collapses small endpoint gaps into a single Line", () => {
    // Two pieces whose endpoints are within 50 m.
    const t = track([
      [[6.0, 46.0], [6.001, 46.0]],
      [[6.0010003, 46.0], [6.002, 46.0]],
    ]);
    const src = buildSlowupSource({ sourceId: "slowup-2", track: t });
    expect(src.lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/buildSlowupSource.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the builder**

```ts
// src/domain/buildSlowupSource.ts
import type { NormalizedTrack } from "../geojson/types";
import { listTrackChains, mergeTrackChainsByEndpoints } from "../matching/chainTracks";
import { bboxOfMultiLineString, multiLineLengthKm } from "../matching/trackPortions";
import type { Line, Source } from "./types";

const SLOWUP_MERGE_MAX_GAP_KM = 0.05;

export interface BuildSlowupSourceInput {
  sourceId: string;
  track: NormalizedTrack;
}

export function buildSlowupSource(input: BuildSlowupSourceInput): Source {
  const rawChains = listTrackChains(input.track);
  const mergedChains = mergeTrackChainsByEndpoints(rawChains, SLOWUP_MERGE_MAX_GAP_KM);

  const lines: Line[] = mergedChains.map((chain, idx) => {
    const lengthKm = chain.lengthKm;
    const bbox = bboxOfMultiLineString(chain.geometry);
    if (!bbox) {
      throw new Error(`buildSlowupSource: chain ${idx} has empty bbox`);
    }
    return {
      index: idx,
      bbox,
      geometry: chain.geometry,
      lengthKm,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: lengthKm }],
    };
  });

  return {
    schemaVersion: 1,
    sourceId: input.sourceId,
    kind: "slowup",
    hasCsv: false,
    lines,
    cursor: null,
  };
}

export { multiLineLengthKm }; // re-export for callers that need it later
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/buildSlowupSource.test.ts` → 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/buildSlowupSource.ts src/__tests__/buildSlowupSource.test.ts
git commit -m "feat(domain): build Source from a slowup track via existing chain merge"
```

---

## Task 5: Source builder for GeoJSON non-slowup sources

GeoJSON without CSV → 1 Line covering the full track. GeoJSON with CSV → N Lines, one per CSV row, with kmA/kmB derived from existing `computeMatchingWorkItems`.

**Files:**
- Create: `src/domain/buildGeojsonSource.ts`
- Test: `src/__tests__/buildGeojsonSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/buildGeojsonSource.test.ts
import { describe, expect, it } from "vitest";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";

function track(): NormalizedTrack {
  return {
    trackId: null,
    geometry: { type: "MultiLineString", coordinates: [[[6.0, 46.0], [6.1, 46.0]]] },
    rawProperties: {},
  };
}

describe("buildGeojsonSource", () => {
  it("creates a single Line when no CSV is provided", () => {
    const src = buildGeojsonSource({ sourceId: "geo-1", track: track() });
    expect(src.kind).toBe("geojson");
    expect(src.hasCsv).toBe(false);
    expect(src.lines).toHaveLength(1);
    expect(src.lines[0].startISO).toBeUndefined();
    expect(src.lines[0].pendingTail[0].kmA).toBe(0);
    expect(src.lines[0].pendingTail[0].kmB).toBeGreaterThan(0);
  });

  it("creates one Line per CSV row with time windows", () => {
    const rows: CsvRow[] = [
      { date: "2026-05-21", startTime: "08:00", endTime: "12:00", distance: "0.0 - 3.0" },
      { date: "2026-05-21", startTime: "12:00", endTime: "18:00", distance: "3.0 - 6.0" },
    ] as unknown as CsvRow[];
    const src = buildGeojsonSource({ sourceId: "geo-2", track: track(), csvRows: rows });
    expect(src.hasCsv).toBe(true);
    expect(src.lines).toHaveLength(2);
    expect(src.lines[0].startISO).toBe("2026-05-21T08:00");
    expect(src.lines[0].endISO).toBe("2026-05-21T12:00");
    expect(src.lines[1].startISO).toBe("2026-05-21T12:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/buildGeojsonSource.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the builder**

```ts
// src/domain/buildGeojsonSource.ts
import type { NormalizedTrack } from "../geojson/types";
import type { CsvRow } from "../state/SessionStore";
import {
  bboxOfMultiLineString,
  computeMatchingWorkItems,
  multiLineLengthKm,
  sliceMultiLineByDistance,
} from "../matching/trackPortions";
import type { Line, Source } from "./types";

export interface BuildGeojsonSourceInput {
  sourceId: string;
  track: NormalizedTrack;
  csvRows?: CsvRow[];
}

export function buildGeojsonSource(input: BuildGeojsonSourceInput): Source {
  const fullLengthKm = multiLineLengthKm(input.track.geometry);
  const lines: Line[] = [];

  if (!input.csvRows || input.csvRows.length === 0) {
    const bbox = bboxOfMultiLineString(input.track.geometry);
    if (!bbox) throw new Error("buildGeojsonSource: empty bbox");
    lines.push({
      index: 0,
      bbox,
      geometry: input.track.geometry,
      lengthKm: fullLengthKm,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: fullLengthKm }],
    });
    return {
      schemaVersion: 1,
      sourceId: input.sourceId,
      kind: "geojson",
      hasCsv: false,
      lines,
      cursor: null,
    };
  }

  const workItems = computeMatchingWorkItems(input.csvRows, fullLengthKm);
  workItems.forEach((item, idx) => {
    const geom = sliceMultiLineByDistance(input.track.geometry, item.kmA, item.kmB);
    const bbox = bboxOfMultiLineString(geom);
    if (!bbox) return;
    const row = input.csvRows![item.rowIndex];
    lines.push({
      index: idx,
      bbox,
      geometry: geom,
      lengthKm: item.kmB - item.kmA,
      startISO: `${row.date}T${row.startTime}`,
      endISO: `${row.date}T${row.endTime}`,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: item.kmB - item.kmA }],
    });
  });

  return {
    schemaVersion: 1,
    sourceId: input.sourceId,
    kind: "geojson",
    hasCsv: true,
    lines,
    cursor: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/buildGeojsonSource.test.ts` → 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/buildGeojsonSource.ts src/__tests__/buildGeojsonSource.test.ts
git commit -m "feat(domain): build Source from GeoJSON track with optional CSV split"
```

---

# Phase 4 — SourceStore: replacing SessionStore

The existing `SessionStore` is row-centric (CSV rows + match groups). It is used in many places. Rather than rewrite it in place, we introduce a parallel `SourceStore` against the new model and migrate callers one at a time. At the end of Phase 7 the legacy `SessionStore` is removed.

## Task 6: SourceStore — minimum API

**Files:**
- Create: `src/state/SourceStore.ts`
- Test: `src/__tests__/SourceStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/SourceStore.test.ts
import { describe, expect, it } from "vitest";
import { SourceStore } from "../state/SourceStore";
import type { Source, SubLine } from "../domain/types";

function srcWithOneLine(): Source {
  return {
    schemaVersion: 1,
    sourceId: "s1",
    kind: "geojson",
    hasCsv: false,
    lines: [{
      index: 0,
      bbox: [0, 0, 1, 1],
      geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
      lengthKm: 2,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: 2 }],
    }],
    cursor: null,
  };
}

function makeSub(index: number, kmA: number, kmB: number): SubLine {
  return {
    index,
    kmA,
    kmB,
    bbox: [0, 0, 1, 1],
    view: { lon: 0.5, lat: 0.5, zoom: 16 },
    segmentIds: [],
    validated: false,
  };
}

describe("SourceStore", () => {
  it("hydrates with the provided source and exposes it via getSource()", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    expect(store.getSource()?.sourceId).toBe("s1");
  });

  it("addSubLine appends to the line, trims pendingTail, sets cursor", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), { kmA: 1, kmB: 2 });
    const src = store.getSource()!;
    expect(src.lines[0].subLines).toHaveLength(1);
    expect(src.lines[0].pendingTail).toEqual([{ kmA: 1, kmB: 2 }]);
    expect(src.cursor).toEqual({ lineIndex: 0, subLineIndex: 0 });
  });

  it("validateSubLine stores segment ids and marks validated", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), null);
    store.validateSubLine(0, 0, [101, 102]);
    const sub = store.getSource()!.lines[0].subLines[0];
    expect(sub.validated).toBe(true);
    expect(sub.segmentIds).toEqual([101, 102]);
  });

  it("rewindCursor(line, sub) drops nothing but moves the cursor backwards", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), { kmA: 1, kmB: 2 });
    store.validateSubLine(0, 0, [1]);
    store.addSubLine(0, makeSub(1, 1, 2), null);
    store.rewindCursor(0, 0);
    expect(store.getSource()!.cursor).toEqual({ lineIndex: 0, subLineIndex: 0 });
    expect(store.getSource()!.lines[0].subLines).toHaveLength(2);
  });

  it("rerunSubLine drops the current sub-line and merges its range back onto pendingTail head", () => {
    const store = new SourceStore();
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), { kmA: 1, kmB: 2 });
    store.validateSubLine(0, 0, [42]);
    store.addSubLine(0, makeSub(1, 1, 1.5), { kmA: 1.5, kmB: 2 });
    store.rerunSubLine(0, 1);
    const line = store.getSource()!.lines[0];
    expect(line.subLines).toHaveLength(1);
    expect(line.pendingTail).toEqual([{ kmA: 1, kmB: 2 }]);
  });

  it("emits onChange after each mutation", () => {
    const store = new SourceStore();
    const seen: number[] = [];
    store.onChange(() => seen.push(seen.length));
    store.hydrate(srcWithOneLine());
    store.addSubLine(0, makeSub(0, 0, 1), null);
    store.validateSubLine(0, 0, [1]);
    expect(seen.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/SourceStore.test.ts` → FAIL (missing module).

- [ ] **Step 3: Implement the store**

```ts
// src/state/SourceStore.ts
import type { Source, SubLine } from "../domain/types";

type Listener = () => void;

export class SourceStore {
  private source: Source | null = null;
  private listeners: Set<Listener> = new Set();

  getSource(): Source | null {
    return this.source;
  }

  hydrate(source: Source): void {
    this.source = source;
    this.emit();
  }

  /** Append a SubLine; replace the line's pendingTail head with the remainder (or remove it if null). */
  addSubLine(lineIndex: number, sub: SubLine, remainder: { kmA: number; kmB: number } | null): void {
    this.mutate((src) => {
      const line = src.lines[lineIndex];
      line.subLines.push(sub);
      line.pendingTail.shift();
      if (remainder !== null) line.pendingTail.unshift(remainder);
      src.cursor = { lineIndex, subLineIndex: sub.index };
    });
  }

  validateSubLine(lineIndex: number, subLineIndex: number, segmentIds: number[]): void {
    this.mutate((src) => {
      const sub = src.lines[lineIndex].subLines[subLineIndex];
      sub.segmentIds = segmentIds.slice();
      sub.validated = true;
    });
  }

  rewindCursor(lineIndex: number, subLineIndex: number): void {
    this.mutate((src) => {
      src.cursor = { lineIndex, subLineIndex };
    });
  }

  /** Drop the sub-line at (lineIndex, subLineIndex) and any later ones in that line; merge its range back into pendingTail head. */
  rerunSubLine(lineIndex: number, subLineIndex: number): void {
    this.mutate((src) => {
      const line = src.lines[lineIndex];
      const dropped = line.subLines.slice(subLineIndex);
      line.subLines = line.subLines.slice(0, subLineIndex);
      if (dropped.length > 0) {
        const merged = {
          kmA: dropped[0].kmA,
          kmB: dropped[dropped.length - 1].kmB,
        };
        // If pendingTail still had a head, extend it; else create one.
        if (line.pendingTail.length > 0 && Math.abs(line.pendingTail[0].kmA - merged.kmB) < 1e-9) {
          line.pendingTail[0] = { kmA: merged.kmA, kmB: line.pendingTail[0].kmB };
        } else {
          line.pendingTail.unshift(merged);
        }
      }
      src.cursor = subLineIndex > 0
        ? { lineIndex, subLineIndex: subLineIndex - 1 }
        : lineIndex > 0
          ? { lineIndex: lineIndex - 1, subLineIndex: src.lines[lineIndex - 1].subLines.length - 1 }
          : null;
    });
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* don't crash siblings */ }
    }
  }

  private mutate(fn: (src: Source) => void): void {
    if (!this.source) throw new Error("SourceStore: not hydrated");
    // Shallow clone to give consumers structural-change signal; deep mutation inside is fine for now.
    const next: Source = {
      ...this.source,
      lines: this.source.lines.map((l) => ({
        ...l,
        subLines: l.subLines.map((s) => ({ ...s, segmentIds: s.segmentIds.slice() })),
        pendingTail: l.pendingTail.slice(),
      })),
      cursor: this.source.cursor ? { ...this.source.cursor } : null,
    };
    fn(next);
    this.source = next;
    this.emit();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/SourceStore.test.ts` → 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/SourceStore.ts src/__tests__/SourceStore.test.ts
git commit -m "feat(state): SourceStore with addSubLine/validateSubLine/rewind/rerun"
```

---

## Task 7: Wire SourcePersistence to SourceStore

Bind `SourceStore.onChange` → `SourcePersistence.save(source)`. Add a helper `attachPersistence(store, persistence)` that returns an unsubscribe.

**Files:**
- Modify: `src/state/SourceStore.ts` (add `attachPersistence` exported helper)
- Test: extend `src/__tests__/SourceStore.test.ts`

- [ ] **Step 1: Extend the test file**

Append to `src/__tests__/SourceStore.test.ts`:

```ts
import { SourcePersistence } from "../domain/SourcePersistence";
import { attachPersistence } from "../state/SourceStore";

describe("attachPersistence", () => {
  it("saves to persistence after each mutation", () => {
    localStorage.clear();
    const persistence = new SourcePersistence({ debounceMs: 0 });
    const store = new SourceStore();
    const unsub = attachPersistence(store, persistence);
    store.hydrate(srcWithOneLine());
    persistence.flush();
    expect(persistence.load("s1")?.sourceId).toBe("s1");
    unsub();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/SourceStore.test.ts` → the new test FAILS (`attachPersistence` not exported).

- [ ] **Step 3: Add the helper**

In `src/state/SourceStore.ts`, add at the bottom:

```ts
import type { SourcePersistence } from "../domain/SourcePersistence";

export function attachPersistence(store: SourceStore, persistence: SourcePersistence): () => void {
  return store.onChange(() => {
    const src = store.getSource();
    if (src) persistence.save(src);
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/SourceStore.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/SourceStore.ts src/__tests__/SourceStore.test.ts
git commit -m "feat(state): persist SourceStore changes via SourcePersistence"
```

---

# Phase 5 — MatchingPipeline rewrite

Phase 4 produced the data model. Phase 5 plugs the pipeline into it.

## Task 8: `LazyMatchingPipeline` — skeleton driving a single Line

We keep the existing `MatchingPipeline.ts` untouched during this phase so the app keeps building. The new pipeline ships under a new name; the swap is in Phase 6.

**Files:**
- Create: `src/controller/LazyMatchingPipeline.ts`
- Test: `src/__tests__/LazyMatchingPipeline.test.ts`

The pipeline depends on:
- `SourceStore` (to read state and call `addSubLine` / `validateSubLine`)
- A delegate `MapDriver` that wraps the WME SDK calls (zoomToExtent + setMapCenter + getZoomLevel + setSelection). The delegate keeps tests free of SDK.
- The existing `WalkController` for `matchInCurrentViewport`.

- [ ] **Step 1: Write the failing test (covers the happy path of one Line with two sub-lines)**

```ts
// src/__tests__/LazyMatchingPipeline.test.ts
import { describe, expect, it, vi } from "vitest";
import { LazyMatchingPipeline, type MapDriver, type MatchDriver } from "../controller/LazyMatchingPipeline";
import { SourceStore } from "../state/SourceStore";
import { buildGeojsonSource } from "../domain/buildGeojsonSource";
import type { NormalizedTrack } from "../geojson/types";

function track(): NormalizedTrack {
  return {
    trackId: null,
    geometry: { type: "MultiLineString", coordinates: [[[6.0, 46.0], [6.4, 46.0]]] }, // ~ 31km
    rawProperties: {},
  };
}

function makeDrivers(zoomSchedule: number[]): { map: MapDriver; match: MatchDriver; segmentsByCall: number[][] } {
  let call = 0;
  const segmentsByCall: number[][] = [[111], [222]];
  return {
    map: {
      zoomToExtent: vi.fn(),
      setMapCenter: vi.fn(),
      getZoomLevel: () => zoomSchedule[Math.min(call, zoomSchedule.length - 1)] as number,
      setSelection: vi.fn(),
      waitIdle: vi.fn().mockResolvedValue(undefined),
    },
    match: {
      runMatch: async () => {
        const ids = segmentsByCall[call] ?? [];
        call += 1;
        return ids;
      },
    },
    segmentsByCall,
  };
}

describe("LazyMatchingPipeline", () => {
  it("creates sub-lines lazily and validates each one", async () => {
    const store = new SourceStore();
    store.hydrate(buildGeojsonSource({ sourceId: "s", track: track() }));
    const { map, match } = makeDrivers([13, 16, 16]);
    const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

    // Drive it: each cycle is await stepUntilValidation() then validate()
    await pipeline.stepUntilValidation();
    pipeline.validate();
    await pipeline.stepUntilValidation();
    pipeline.validate();

    const src = store.getSource()!;
    expect(src.lines[0].subLines.length).toBeGreaterThanOrEqual(1);
    expect(src.lines[0].subLines.every((s) => s.validated)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/LazyMatchingPipeline.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the pipeline**

```ts
// src/controller/LazyMatchingPipeline.ts
import type { MultiLineString } from "geojson";
import type { SourceStore } from "../state/SourceStore";
import type { Line, SubLine } from "../domain/types";
import { fitNextSubLine } from "../matching/fitNextSubLine";
import { sliceMultiLineByDistance } from "../matching/trackPortions";

export interface MapDriver {
  zoomToExtent(bbox: [number, number, number, number]): void;
  setMapCenter(lon: number, lat: number, zoom: number): void;
  getZoomLevel(): number;
  setSelection(segmentIds: number[]): void;
  waitIdle(): Promise<void>;
}

export interface MatchDriver {
  runMatch(): Promise<number[]>;
}

export interface LazyMatchingPipelineOptions {
  store: SourceStore;
  map: MapDriver;
  match: MatchDriver;
  targetZoom: number;
}

export class LazyMatchingPipeline {
  constructor(private readonly opts: LazyMatchingPipelineOptions) {}

  /**
   * Advance to the next sub-line that needs operator validation. If the cursor
   * already points at an unvalidated sub-line, do nothing. Otherwise fit and
   * persist the next sub-line, run matching, set selection, and return.
   */
  async stepUntilValidation(): Promise<void> {
    const src = this.opts.store.getSource();
    if (!src) throw new Error("LazyMatchingPipeline: store not hydrated");

    const cursor = this.findOrCreateNextSubLineCursor();
    if (cursor === null) return; // nothing more to do
    const { lineIndex, subLineIndex } = cursor;
    const sub = this.opts.store.getSource()!.lines[lineIndex].subLines[subLineIndex];

    this.opts.map.setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
    await this.opts.map.waitIdle();
    const matched = await this.opts.match.runMatch();
    this.opts.map.setSelection(matched);
    // Stash matched on the sub-line as a pre-validation candidate by storing on cursor; we re-read inside validate().
    this.pendingMatched = matched;
  }

  validate(segmentIdsOverride?: number[]): void {
    const src = this.opts.store.getSource();
    if (!src || !src.cursor) throw new Error("LazyMatchingPipeline.validate: no cursor");
    const ids = segmentIdsOverride ?? this.pendingMatched ?? [];
    this.opts.store.validateSubLine(src.cursor.lineIndex, src.cursor.subLineIndex, ids);
    this.pendingMatched = null;
  }

  back(): void {
    const src = this.opts.store.getSource();
    if (!src || !src.cursor) return;
    const { lineIndex, subLineIndex } = src.cursor;
    if (subLineIndex > 0) {
      this.opts.store.rewindCursor(lineIndex, subLineIndex - 1);
      return;
    }
    if (lineIndex > 0) {
      const prevLine = src.lines[lineIndex - 1];
      const lastIdx = prevLine.subLines.length - 1;
      if (lastIdx >= 0) this.opts.store.rewindCursor(lineIndex - 1, lastIdx);
    }
  }

  rerunCurrent(): void {
    const src = this.opts.store.getSource();
    if (!src || !src.cursor) return;
    this.opts.store.rerunSubLine(src.cursor.lineIndex, src.cursor.subLineIndex);
  }

  private pendingMatched: number[] | null = null;

  private findOrCreateNextSubLineCursor(): { lineIndex: number; subLineIndex: number } | null {
    const src = this.opts.store.getSource()!;
    // First, find the first line+subline that's not validated, or the first line with a pending range.
    for (let li = 0; li < src.lines.length; li++) {
      const line = src.lines[li];
      // An identified-but-unvalidated sub-line at the cursor counts.
      const firstUnvalidated = line.subLines.findIndex((s) => !s.validated);
      if (firstUnvalidated !== -1) {
        return { lineIndex: li, subLineIndex: firstUnvalidated };
      }
      if (line.pendingTail.length > 0) {
        const newSub = this.createNextSubLineFor(line);
        const remainder = line.pendingTail[0].kmB > newSub.kmB
          ? { kmA: newSub.kmB, kmB: line.pendingTail[0].kmB }
          : null;
        this.opts.store.addSubLine(li, newSub, remainder);
        return { lineIndex: li, subLineIndex: newSub.index };
      }
    }
    return null;
  }

  private createNextSubLineFor(line: Line): SubLine {
    const pending = line.pendingTail[0];
    const slice = sliceMultiLineByDistance(line.geometry, pending.kmA, pending.kmB);
    const fit = fitNextSubLine({
      pending,
      geometry: slice,
      targetZoom: this.opts.targetZoom,
      evaluateZoom: (geom) => this.evaluateZoomViaSdk(geom),
      sliceByKm: (_geom, a, b) => sliceMultiLineByDistance(line.geometry, a, b),
    });
    return {
      index: line.subLines.length,
      kmA: fit.accepted.kmA,
      kmB: fit.accepted.kmB,
      bbox: fit.accepted.bbox,
      view: fit.accepted.view,
      segmentIds: [],
      validated: false,
    };
  }

  private evaluateZoomViaSdk(geom: MultiLineString): number {
    // The MapDriver computes the zoom that would fit `geom` by calling zoomToExtent then getZoomLevel.
    const xs = geom.coordinates.flatMap((line) => line.map((p) => p[0]));
    const ys = geom.coordinates.flatMap((line) => line.map((p) => p[1]));
    const bbox: [number, number, number, number] = [
      Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys),
    ];
    this.opts.map.zoomToExtent(bbox);
    return this.opts.map.getZoomLevel();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/LazyMatchingPipeline.test.ts` → PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/controller/LazyMatchingPipeline.ts src/__tests__/LazyMatchingPipeline.test.ts
git commit -m "feat(controller): LazyMatchingPipeline driving SourceStore via map/match drivers"
```

---

## Task 9: Cross-line back, end-to-end test

Add a focused test that exercises a 2-line scenario and verifies back from sub-line 1 of line 2 lands on the last sub-line of line 1, and that re-validating walks back into line 2 sub-line 1 without recomputing it.

**Files:**
- Modify: `src/__tests__/LazyMatchingPipeline.test.ts`

- [ ] **Step 1: Append the test**

```ts
it("back from sub-line 1 of line 2 lands on the last sub-line of line 1", async () => {
  const store = new SourceStore();
  // Build a source with two short lines (each fits at z16 in one shot).
  const csvRows = [
    { date: "2026-05-21", startTime: "08:00", endTime: "12:00", distance: "0.0 - 15.0" },
    { date: "2026-05-21", startTime: "12:00", endTime: "18:00", distance: "15.0 - 30.0" },
  ];
  store.hydrate(
    buildGeojsonSource({ sourceId: "s2", track: track(), csvRows: csvRows as never }),
  );
  const { map, match } = makeDrivers([16, 16, 16, 16]);
  const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

  await pipeline.stepUntilValidation();
  pipeline.validate(); // line 0 done

  await pipeline.stepUntilValidation();
  // We are now on line 1 sub-line 0. Press back.
  pipeline.back();
  const cursor1 = store.getSource()!.cursor!;
  expect(cursor1.lineIndex).toBe(0);
  expect(cursor1.subLineIndex).toBe(store.getSource()!.lines[0].subLines.length - 1);

  // Validate without changes → should advance into line 1 sub-line 0 again.
  pipeline.validate();
  await pipeline.stepUntilValidation();
  const cursor2 = store.getSource()!.cursor!;
  expect(cursor2.lineIndex).toBe(1);
});
```

- [ ] **Step 2: Run to verify the test fails or passes**

Run: `npx vitest run src/__tests__/LazyMatchingPipeline.test.ts -t "back from sub-line"`

If FAIL: revisit `findOrCreateNextSubLineCursor` — the validate-and-step sequence should re-enter line 1 because all of line 0's sub-lines are validated. The fix is to consult `cursor` in `validate()` and let `stepUntilValidation` pick the next unvalidated-or-pending sub-line, which is what the current implementation does. Adjust if any assertion fails.

- [ ] **Step 3: Make it pass**

Iterate until the test PASSES.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/LazyMatchingPipeline.test.ts
git commit -m "test(controller): cover cross-line back semantics"
```

---

## Task 10: Rerun semantics test

**Files:**
- Modify: `src/__tests__/LazyMatchingPipeline.test.ts`

- [ ] **Step 1: Append the test**

```ts
it("rerunCurrent drops the current sub-line and recomputes from the merged range", async () => {
  const store = new SourceStore();
  store.hydrate(buildGeojsonSource({ sourceId: "s3", track: track() }));
  let zoomSeq = [13, 16, 13, 16];
  const map: MapDriver = {
    zoomToExtent: vi.fn(),
    setMapCenter: vi.fn(),
    getZoomLevel: () => zoomSeq.shift() ?? 16,
    setSelection: vi.fn(),
    waitIdle: vi.fn().mockResolvedValue(undefined),
  };
  const match: MatchDriver = { runMatch: async () => [] };
  const pipeline = new LazyMatchingPipeline({ store, map, match, targetZoom: 16 });

  await pipeline.stepUntilValidation();
  const before = store.getSource()!.lines[0].subLines.length;
  pipeline.rerunCurrent();
  // The current sub-line should be gone; pendingTail head should cover what it covered.
  expect(store.getSource()!.lines[0].subLines.length).toBe(before - 1);
  await pipeline.stepUntilValidation();
  expect(store.getSource()!.lines[0].subLines.length).toBe(before);
});
```

- [ ] **Step 2: Run + commit**

Run: `npx vitest run src/__tests__/LazyMatchingPipeline.test.ts -t "rerunCurrent"` → PASS.
```bash
git add src/__tests__/LazyMatchingPipeline.test.ts
git commit -m "test(controller): cover rerun semantics on the current sub-line"
```

---

# Phase 6 — Integration in MatchingSubTab

Phase 5 produced an SDK-free pipeline. Phase 6 wires it in. The work is one-shot: swap, then delete old code paths.

## Task 11: Build a Source on line selection

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

Locate the line selection handler (today calls `mergeChainsForSelectedLine` and friends). Replace its body with:

- If `entry.kind === "slowup"` → call `buildSlowupSource({ sourceId: entry.id, track: entry.track })`
- Else if `entry.csvRows` is set → `buildGeojsonSource({ sourceId: entry.id, track: entry.track, csvRows: entry.csvRows })`
- Else → `buildGeojsonSource({ sourceId: entry.id, track: entry.track })`

Then `sourceStore.hydrate(source)` and `attachPersistence(sourceStore, persistence)`.

- [ ] **Step 1: Add `SourceStore` and `SourcePersistence` instances as private fields on `MatchingSubTab`**

```ts
// Near the top of the class:
private readonly sourceStore = new SourceStore();
private readonly persistence = new SourcePersistence();
private detachPersistence: (() => void) | null = null;
```

- [ ] **Step 2: Find the existing selection handler**

Run: `grep -n "shouldUseChainByChain\|mergeChainsForSelectedLine\|ensureMergeInitializedForSelectedSlowup" src/ui/subtabs/MatchingSubTab.ts`

The handler reading the selected entry is around line 370. Replace its body following the dispatch above. Keep existing UI calls (preview, header) intact; only the data source changes.

- [ ] **Step 3: On hydrate, attempt to load from persistence first**

```ts
const existing = this.persistence.load(entry.id);
const source = existing ?? buildSourceForEntry(entry);
this.sourceStore.hydrate(source);
this.detachPersistence?.();
this.detachPersistence = attachPersistence(this.sourceStore, this.persistence);
```

Where `buildSourceForEntry` is a small private method that does the dispatch.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit` — fix any type errors that arise from removed imports.

- [ ] **Step 5: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat(ui): hydrate SourceStore on line selection (with resume from localStorage)"
```

---

## Task 12: Swap MatchingPipeline → LazyMatchingPipeline at start

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

Replace the construction of `MatchingPipeline` in the start-matching handler with `LazyMatchingPipeline`, wired through a thin `MapDriver` and `MatchDriver` built around the existing `wmeSDK` and `WalkController`.

- [ ] **Step 1: Add the driver factory in the file**

At the bottom of `MatchingSubTab.ts`, add:

```ts
function makeMapDriver(wmeSDK: WmeSDK): MapDriver {
  return {
    zoomToExtent: (bbox) => wmeSDK.Map.zoomToExtent({ bbox }),
    setMapCenter: (lon, lat, zoom) =>
      wmeSDK.Map.setMapCenter({ lonLat: { lon, lat }, zoomLevel: zoom as ZoomLevel }),
    getZoomLevel: () => wmeSDK.Map.getZoomLevel(),
    setSelection: (ids) =>
      wmeSDK.Editing.setSelection({ selection: { ids, objectType: "segment" } }),
    waitIdle: () => waitForMapIdle(wmeSDK, { settleDelayMs: 650 }),
  };
}

function makeMatchDriver(controller: WalkController, line: Line, sub: SubLine): MatchDriver {
  return {
    runMatch: async () => {
      const ids = new Set<number>();
      const unsub = controller.onMatchFound((id) => ids.add(id));
      try {
        await controller.matchInCurrentViewport(sub.kmA, sub.kmB);
      } finally {
        unsub();
      }
      return Array.from(ids);
    },
  };
}
```

- [ ] **Step 2: Replace pipeline construction**

Find where `new MatchingPipeline(...)` is constructed in `MatchingSubTab.ts`. Replace with:

```ts
const pipeline = new LazyMatchingPipeline({
  store: this.sourceStore,
  map: makeMapDriver(this.wmeSDK),
  match: { runMatch: async () => {
    const src = this.sourceStore.getSource()!;
    const { lineIndex, subLineIndex } = src.cursor!;
    const line = src.lines[lineIndex];
    const sub = line.subLines[subLineIndex];
    return makeMatchDriver(this.controller, line, sub).runMatch();
  } },
  targetZoom: 16,
});
this.activePipeline = pipeline;
await pipeline.stepUntilValidation();
```

Hook the Validate/Back/Rerun buttons to `pipeline.validate()`, `pipeline.back() + pipeline.stepUntilValidation()`, `pipeline.rerunCurrent() + pipeline.stepUntilValidation()`.

- [ ] **Step 3: Build and smoke test in dev**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all existing tests still pass (some chain-by-chain tests will fail in Task 14; that's expected).

- [ ] **Step 4: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat(ui): wire LazyMatchingPipeline to drive matching from SourceStore"
```

---

## Task 13: Sub-line overlay color

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`
- Modify: `src/__tests__/TrackLayer.test.ts` (if applicable)

`TrackLayer.setHighlightedSlice` already exists. The current call site uses the full row geometry. Change to use the current sub-line's geometry.

- [ ] **Step 1: Subscribe to `sourceStore.onChange` and refresh the highlight**

```ts
this.sourceStore.onChange(() => {
  const src = this.sourceStore.getSource();
  if (!src || !src.cursor) {
    this.trackLayer.setHighlightedSlice(null);
    return;
  }
  const line = src.lines[src.cursor.lineIndex];
  const sub = line.subLines[src.cursor.subLineIndex];
  if (!sub) {
    this.trackLayer.setHighlightedSlice(null);
    return;
  }
  this.trackLayer.setHighlightedSlice(sliceMultiLineByDistance(line.geometry, sub.kmA, sub.kmB));
});
```

- [ ] **Step 2: Visually confirm in dev**

Run the script in WME against a long line. Confirm the highlight color follows the active sub-line.

- [ ] **Step 3: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat(ui): highlight only the active sub-line on the track overlay"
```

---

# Phase 7 — Header text, i18n, dead-code removal

## Task 14: New header text + remove chain suffix

**Files:**
- Modify: `src/ui/views/MatchingHeaderView.ts`
- Modify: `locales/en/common.json`, `locales/fr/common.json`

- [ ] **Step 1: Update i18n strings**

Edit both `locales/en/common.json` and `locales/fr/common.json`. Remove keys: `chainSuffix`, `chainStart`, `chainSwitching`, `subLinesEmpty`, `mergeEligible`, `mergeChainItem`. Adjust:

For fr/common.json:
```json
"rowHeader": "Ligne {{index}} / {{total}} — {{km}} km, {{startTime}} → {{endTime}}",
"rowHeaderWithSubLine": "Ligne {{index}} / {{total}} — {{km}} km, {{startTime}} → {{endTime}} | sous-ligne {{subIndex}}/{{subTotal}}",
"rowHeaderWithSubLineNoTime": "Ligne {{index}} / {{total}} — {{km}} km | sous-ligne {{subIndex}}/{{subTotal}}",
"rowHeaderNoTime": "Ligne {{index}} / {{total}} — {{km}} km"
```

For en/common.json: mirror with English wording, replacing "Ligne" with "Line" and "sous-ligne" with "sub-line".

- [ ] **Step 2: Update `MatchingHeaderView.ts`**

Wherever `chainSuffix` was applied, remove. The view now reads `lineIndex`, `lineTotal`, `subLineIndex`, `subLineTotal`, and optional `startISO`/`endISO`. When `subLineTotal === 1` and the only sub-line equals the whole line, use `rowHeader` / `rowHeaderNoTime`; otherwise use the `WithSubLine` variants.

- [ ] **Step 3: Adjust tests that reference removed strings**

Run: `grep -rn "chainSuffix\|chainStart\|chainSwitching\|subLinesEmpty\|mergeEligible\|mergeChainItem" src --include="*.ts"`

For each match, update the test/usage. Mostly in `MatchingSubTab.test.ts` and the header view tests.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run` → all PASS.
```bash
git add src/ui/views/MatchingHeaderView.ts locales/en/common.json locales/fr/common.json src/ui/subtabs/MatchingSubTab.ts src/__tests__/
git commit -m "feat(ui): unified line/sub-line header text; drop chain suffix"
```

---

## Task 15: Remove chain-by-chain orchestrator from MatchingSubTab

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

Remove:
- Fields: `activeChains`, `activeChainIndex`, `chainSnapshots`, `chainByChainEnabled`.
- Methods: `shouldUseChainByChain`, `ensureMergeInitializedForSelectedSlowup`, the chain-progress branches in `start` / `validate` / `pause` / `goBack`.
- Constant `SLOWUP_CHAIN_MERGE_MAX_GAP_KM` (already centralized in `buildSlowupSource`).
- All references to `chainMergeState` on LineEntry from this file.

- [ ] **Step 1: Make the deletions**

Run: `grep -n "chainByChain\|activeChain\|chainSnapshots\|chainMergeState\|SLOWUP_CHAIN_MERGE" src/ui/subtabs/MatchingSubTab.ts`

Delete each reference. The IDE / TypeScript will flag callers; fix them by deleting their bodies (the orchestrator is no longer needed since `LazyMatchingPipeline` handles all lines uniformly through the SourceStore).

- [ ] **Step 2: Typecheck and tests**

Run: `npx tsc --noEmit` → fix any remaining references.
Run: `npx vitest run` → some chain-related tests will fail; mark them for deletion in Task 16.

- [ ] **Step 3: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts
git commit -m "refactor(ui): remove chain-by-chain orchestrator from MatchingSubTab"
```

---

## Task 16: Delete chainMerge.ts, chainMergeState types, and obsolete tests

**Files:**
- Delete: `src/matching/chainMerge.ts`
- Delete: `src/__tests__/chainMerge.test.ts`
- Modify: `src/lines/types.ts` (remove `ChainMergeState`, `ChainMergeSnapshot`)
- Delete or rewrite: `src/__tests__/slowupsMerge.test.ts` (keep its second test — strict 50m — under the new module if it still calls `mergeTrackChainsByEndpoints` directly; the first test asserting "single chain at 20km tolerance" is meaningful for confirming the 50m default still produces 1 chain on most slowups: keep both but adapt imports if files moved).

- [ ] **Step 1: Delete files**

```bash
git rm src/matching/chainMerge.ts src/__tests__/chainMerge.test.ts
```

- [ ] **Step 2: Strip types**

Open `src/lines/types.ts`. Delete `SlowupDetails`-adjacent `ChainMergeSnapshot` and `ChainMergeState` interfaces, and any reference on `LineEntry` (e.g. `chainMergeState?: ChainMergeState`).

- [ ] **Step 3: Update tests still referencing chainMerge**

Run: `grep -rn "chainMerge\|ChainMergeState\|ChainMergeSnapshot" src --include="*.ts"`. If matches remain, delete them (orphan tests).

- [ ] **Step 4: Run full suite + typecheck**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(cleanup): drop chainMerge module and ChainMergeState types"
```

---

## Task 17: Remove `MatchingPipeline.ts` and `planLeafSlices`

The old pipeline is now unused.

- [ ] **Step 1: Confirm no callers**

Run: `grep -rn "from \".*MatchingPipeline\"" src --include="*.ts"` — should return nothing (or only test files).
Run: `grep -rn "planLeafSlices\|fitPendingSlice" src --include="*.ts"`.

- [ ] **Step 2: Delete the files**

```bash
git rm src/controller/MatchingPipeline.ts src/__tests__/MatchingPipeline.test.ts
```

- [ ] **Step 3: Run + commit**

Run: `npx tsc --noEmit && npx vitest run` → clean.

```bash
git add -A
git commit -m "chore(cleanup): remove legacy MatchingPipeline and planLeafSlices"
```

---

## Task 18: Remove CSV-upload UI for slowup sources

**Files:**
- Modify: `src/ui/subtabs/LinesSubTab.ts` (or wherever slowup rows expose the CSV upload control)
- Modify: `src/ui/views/LineRowView.ts` (if relevant)
- Modify: i18n if a string mentions CSV-upload-on-slowup.

- [ ] **Step 1: Locate the CSV upload UI**

Run: `grep -rn "csvUpload\|importCsv\|csvText" src/ui --include="*.ts"`.

- [ ] **Step 2: Guard the control**

If the entry has `slowupNumber !== undefined`, do not render the CSV upload UI for that row. Add a unit test that renders a slowup `LineEntry` and asserts no upload control is present.

- [ ] **Step 3: Run + commit**

Run: `npx vitest run && npx tsc --noEmit` → clean.

```bash
git add -A
git commit -m "feat(ui): remove CSV-upload affordance from slowup line rows"
```

---

# Phase 8 — Export

## Task 19: Adapt export to consume SourceStore

The existing `buildClosuresCsv` consumes `ClosureRowGroup[]` keyed by `rowIndex`. We feed it equivalent data computed from the Source:
- For each `MatchedSegment` (= each `segmentId` in a `SubLine.segmentIds` of a validated sub-line), produce a tuple `{ segmentId, lineIndex, startISO?, endISO?, mapAnchor }`.
- Group by `segmentId`, dedupe `(segmentId, startISO, endISO)` for CSV mode.

**Files:**
- Create: `src/csv/closuresFromSource.ts`
- Test: `src/__tests__/closuresFromSource.test.ts`
- Modify: caller(s) of `buildClosuresCsv` in `MatchingSubTab.ts` to use `closuresFromSource(source)` as the input shape.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/closuresFromSource.test.ts
import { describe, expect, it } from "vitest";
import { closuresFromSource } from "../csv/closuresFromSource";
import type { Source } from "../domain/types";

function srcWithMatches(hasCsv: boolean): Source {
  return {
    schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv,
    cursor: null,
    lines: [
      {
        index: 0, bbox: [0,0,1,1], lengthKm: 5,
        geometry: { type: "MultiLineString", coordinates: [[[0,0],[1,1]]] },
        startISO: hasCsv ? "2026-05-21T08:00" : undefined,
        endISO: hasCsv ? "2026-05-21T12:00" : undefined,
        pendingTail: [],
        subLines: [
          {
            index: 0, kmA: 0, kmB: 5, bbox: [0,0,1,1],
            view: { lon: 0.5, lat: 0.5, zoom: 16 },
            segmentIds: [100, 101], validated: true,
          },
        ],
      },
      {
        index: 1, bbox: [0,0,1,1], lengthKm: 3,
        geometry: { type: "MultiLineString", coordinates: [[[0,0],[1,1]]] },
        startISO: hasCsv ? "2026-05-21T10:00" : undefined,
        endISO: hasCsv ? "2026-05-21T14:00" : undefined,
        pendingTail: [],
        subLines: [
          {
            index: 0, kmA: 0, kmB: 3, bbox: [0,0,1,1],
            view: { lon: 0.5, lat: 0.5, zoom: 16 },
            segmentIds: [101, 102], validated: true,
          },
        ],
      },
    ],
  };
}

describe("closuresFromSource", () => {
  it("non-CSV: unique segments, no times", () => {
    const out = closuresFromSource(srcWithMatches(false));
    expect(out.mode).toBe("global-times");
    expect(out.segmentIds.sort()).toEqual([100, 101, 102]);
  });

  it("CSV: groups by segment with merged overlapping windows", () => {
    const out = closuresFromSource(srcWithMatches(true));
    expect(out.mode).toBe("per-line-times");
    const seg101 = out.bySegment.find((s) => s.segmentId === 101)!;
    // 08:00-12:00 overlaps 10:00-14:00 → merged 08:00-14:00
    expect(seg101.windows).toEqual([
      { startISO: "2026-05-21T08:00", endISO: "2026-05-21T14:00" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure → implement → re-run to pass**

```ts
// src/csv/closuresFromSource.ts
import type { Source } from "../domain/types";

export interface ClosureWindow { startISO: string; endISO: string; }
export interface ClosuresBySegment { segmentId: number; windows: ClosureWindow[]; }
export type ClosuresFromSource =
  | { mode: "global-times"; segmentIds: number[] }
  | { mode: "per-line-times"; bySegment: ClosuresBySegment[] };

function mergeWindows(input: ClosureWindow[]): ClosureWindow[] {
  if (input.length === 0) return [];
  const sorted = input.slice().sort((a, b) => a.startISO.localeCompare(b.startISO));
  const out: ClosureWindow[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].startISO <= last.endISO) {
      if (sorted[i].endISO > last.endISO) last.endISO = sorted[i].endISO;
    } else {
      out.push(sorted[i]);
    }
  }
  return out;
}

export function closuresFromSource(source: Source): ClosuresFromSource {
  if (!source.hasCsv) {
    const ids = new Set<number>();
    for (const line of source.lines) {
      for (const sub of line.subLines) {
        if (!sub.validated) continue;
        sub.segmentIds.forEach((id) => ids.add(id));
      }
    }
    return { mode: "global-times", segmentIds: Array.from(ids) };
  }

  const windowsBySegment = new Map<number, ClosureWindow[]>();
  for (const line of source.lines) {
    if (!line.startISO || !line.endISO) continue;
    for (const sub of line.subLines) {
      if (!sub.validated) continue;
      for (const segId of sub.segmentIds) {
        const arr = windowsBySegment.get(segId) ?? [];
        arr.push({ startISO: line.startISO, endISO: line.endISO });
        windowsBySegment.set(segId, arr);
      }
    }
  }
  const bySegment: ClosuresBySegment[] = Array.from(windowsBySegment.entries())
    .map(([segmentId, windows]) => ({ segmentId, windows: mergeWindows(windows) }))
    .sort((a, b) => a.segmentId - b.segmentId);
  return { mode: "per-line-times", bySegment };
}
```

- [ ] **Step 3: Hook into the existing export caller**

In `MatchingSubTab.ts`, locate the download button handler. Replace its data-collection step with `closuresFromSource(this.sourceStore.getSource()!)` and adapt the call into `buildClosuresCsv` to take this shape, OR feed `buildClosuresCsv` with synthesized `ClosureRowGroup[]` derived from `closuresFromSource` (whichever requires the smallest patch). Keep the existing global-times popup and reason popup wiring.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run && npx tsc --noEmit` → clean.

```bash
git add -A
git commit -m "feat(export): build closures from SourceStore with per-segment window merge"
```

---

# Phase 9 — Sweep

## Task 20: Remove legacy `SessionStore` if no callers remain

- [ ] **Step 1: Grep**

```bash
grep -rn "from \".*SessionStore\"" src --include="*.ts"
```

If no callers remain, `git rm src/state/SessionStore.ts src/__tests__/SessionStore.test.ts`. Otherwise, list remaining callers and convert them one by one (likely small leftovers in `MatchingSubTab.ts`).

- [ ] **Step 2: Run + commit**

Run: `npx tsc --noEmit && npx vitest run`.
```bash
git add -A
git commit -m "chore(cleanup): remove legacy SessionStore"
```

---

## Task 21: Final full-suite verification

- [ ] **Step 1: Run full suite**

```bash
npx tsc --noEmit
npx vitest run
```

Both clean.

- [ ] **Step 2: Smoke test in WME**

Load the script, select a slowup with multiple chains, run guided matching end-to-end. Confirm:
- Header reads `Ligne X/N — km | sous-ligne A/B` with no "chaîne".
- Each sub-line is highlighted in the contrasting color while active.
- Validate / Back / Rerun behave per spec (cross-line back lands on previous line's last sub-line).
- Refreshing the page mid-matching reloads at the same cursor.
- Download flow prompts for global times (no CSV) or skips straight to the reason popup (CSV).

- [ ] **Step 3: Commit any final fixes; tag the work**

```bash
git tag lazy-subline-matching-done
```

---

## Notes for the implementer

- Some tasks reference `MatchingSubTab.ts` edits that span many lines. Use `grep` to locate the exact insertion/deletion points rather than memorizing line numbers — the file is large and shifts as you edit.
- When deleting chain-related code, prefer removing whole methods at once and letting `tsc --noEmit` light up callers. Do **not** silently rename or refactor more than the spec asks.
- The `LazyMatchingPipeline` test file uses fake drivers; do not add SDK-level integration tests there. SDK integration lives only in the smoke test in Task 21.
- Persistence writes are debounced (200ms). Always `persistence.flush()` in unit tests that read back the written state.
