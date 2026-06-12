# FeatureCollection Phase 7c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group a slowUp `FeatureCollection`'s features into one line per `slowup_number`, fetch each slowUp's title/date from the SchweizMobil detail API, show it as the line name, and pre-fill the closure-window date from it.

**Architecture:** The loader merges all features sharing a `slowup_number` into a single `LineEntry` whose geometry concatenates every member's sub-lines. A new pure-ish `slowupClient` builds the detail-API URL and parses its response. The Lignes sub-tab fires one detail fetch per slowUp line in parallel, showing a spinner per row while it resolves and rewriting the row name to "Title — date" on success.

**Tech Stack:** TypeScript 5.6 strict, `@turf/turf`, `GM.xmlHttpRequest`, `i18next`, `vitest`.

**Scope note:** Phase 7c of the spec `docs/superpowers/specs/2026-05-18-feature-collection-design.md`. The spec's 7c covered the slowUp detail fetch; grouping features by `slowup_number` was added to 7c scope by the user during 7b validation (the real `slowups.geojson` has 140 features for 19 slowUps). Phases 7a and 7b are complete on branch `feature/feature-collection-support`.

**Baseline:** `npx tsc --noEmit` reports ONE pre-existing error in `src/__tests__/waitForMapIdle.test.ts` — the only acceptable tsc error. Tests currently: 256 passing. No top-level `await` in test files (`module: ES6`); use `beforeAll`.

---

## File structure

**Created:**

- `src/lines/slowupClient.ts` — build the detail-API URL, parse the response, fetch via `GM.xmlHttpRequest`.
- `src/__tests__/slowupClient.test.ts` — tests for the URL builder + parser.

**Modified:**

- `src/lines/featureCollectionLoader.ts` — `buildEntriesFromData` groups features by `slowup_number`; `buildEntryFromTrack` takes an explicit id.
- `src/__tests__/featureCollection.test.ts` — update `buildEntryFromTrack` calls; add grouping tests.
- `src/ui/subtabs/LinesSubTab.ts` — fire slowUp detail fetches in parallel; refresh rows on `onEntryUpdated`.
- `src/ui/views/LineRowView.ts` — render the per-row fetch state (spinner / warning).
- `src/ui/views/LinesListView.ts` — re-render rows when an entry updates.
- `src/ui/MatchPanel.ts` — spinner/warning/loading CSS in `injectShellStyles`.
- `src/ui/subtabs/MatchingSubTab.ts` — `downloadClosuresSynthetic` defaults the date from `slowupDetails`.
- `locales/en/common.json`, `locales/fr/common.json` — `panel.lines.detailsLoading` / `detailsError`.

---

## Task 1: Group FeatureCollection features by `slowup_number`

**Files:**

- Modify: `src/lines/featureCollectionLoader.ts`
- Test: `src/__tests__/featureCollection.test.ts`

**Context:** `buildEntriesFromData(raw, sourceUrl)` currently maps each FeatureCollection feature to one `LineEntry`. The real `slowups.geojson` represents one slowUp route as many separate features that share a `slowup_number`. Phase 7c groups them: all features with the same `slowup_number` become ONE `LineEntry` whose `track.geometry` is a `MultiLineString` concatenating every member feature's sub-lines. Features without a `slowup_number` stay one entry each (a generic FeatureCollection still works). The matcher already treats a `MultiLineString`'s disconnected sub-lines as one continuous track, so a grouped slowUp matches correctly.

`buildEntryFromTrack` currently takes `(track, sourceUrl, featureIndex)` and derives `id = ${sourceUrl}#${featureIndex}`. Grouped entries need a different id (`${sourceUrl}#slowup-${n}`), so `buildEntryFromTrack` is changed to take the final id directly.

- [ ] **Step 1: Update the existing `buildEntryFromTrack` tests for the new signature**

The `buildEntryFromTrack` tests live in `src/__tests__/featureCollectionLoader.test.ts` (created in Phase 7a). They call `buildEntryFromTrack(track, "https://example.com/x.json", 0)`. Change every such call to pass a precomputed id string instead of `(url, index)`:

- `buildEntryFromTrack(track, "https://example.com/x.json", 0)` → `buildEntryFromTrack(track, "https://example.com/x.json#0")`
  The test asserting the id should still expect `entry.id === "https://example.com/x.json#0"` (now the id passed in). Apply the change to every `buildEntryFromTrack` call in that file. Do NOT touch `src/__tests__/featureCollection.test.ts` in this step — it only tests `buildEntriesFromData`, whose signature is unchanged.

- [ ] **Step 2: Write the failing grouping tests**

Append a new `describe` block to `src/__tests__/featureCollection.test.ts` (the file already imports `buildEntriesFromData` and has the `beforeAll` i18next init):

```ts
describe("buildEntriesFromData — slowUp grouping", () => {
  const url = "https://example.com/slowups.geojson";

  const slowupFeature = (slowupNumber: number, coords: number[][]) => ({
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: [coords] },
    properties: { slowup_number: slowupNumber },
  });

  it("merges features sharing a slowup_number into one entry", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
        slowupFeature(19, [
          [1, 0],
          [1.009, 0],
        ]),
        slowupFeature(7, [
          [2, 0],
          [2.009, 0],
        ]),
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries).toHaveLength(2);
    expect(entries[0].slowupNumber).toBe(19);
    expect(entries[1].slowupNumber).toBe(7);
  });

  it("a merged entry's geometry concatenates every member's sub-lines", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
        slowupFeature(19, [
          [1, 0],
          [1.009, 0],
        ]),
      ],
    };
    const [entry] = buildEntriesFromData(fc, url);
    expect(entry.track.geometry.type).toBe("MultiLineString");
    expect(entry.track.geometry.coordinates).toHaveLength(2);
  });

  it("gives merged entries a stable slowup-based id", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
      ],
    };
    expect(buildEntriesFromData(fc, url)[0].id).toBe(`${url}#slowup-19`);
  });

  it("keeps features without a slowup_number as one entry each", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0.009, 0],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 0],
              [1.009, 0],
            ],
          },
          properties: {},
        },
      ],
    };
    expect(buildEntriesFromData(fc, url)).toHaveLength(2);
  });

  it("preserves first-seen order across interleaved slowup numbers", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        slowupFeature(19, [
          [0, 0],
          [0.009, 0],
        ]),
        slowupFeature(7, [
          [1, 0],
          [1.009, 0],
        ]),
        slowupFeature(19, [
          [2, 0],
          [2.009, 0],
        ]),
      ],
    };
    const entries = buildEntriesFromData(fc, url);
    expect(entries.map((e) => e.slowupNumber)).toEqual([19, 7]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/featureCollection.test.ts src/__tests__/featureCollectionLoader.test.ts`
Expected: the new grouping tests FAIL (features sharing a number currently produce separate entries; ids are `#0` not `#slowup-19`). The updated `buildEntryFromTrack` tests in `featureCollectionLoader.test.ts` also fail until Step 4 lands the new signature.

- [ ] **Step 4: Implement**

In `src/lines/featureCollectionLoader.ts`:

Add a `MultiLineString` type import: `import type { MultiLineString } from "geojson";`. (`NormalizedTrack` is already imported.)

Change `buildEntryFromTrack`'s signature from `(track, sourceUrl, featureIndex)` to `(track, id)`:

```ts
/**
 * Build a LineEntry from a normalised track and a precomputed stable id.
 * Pure — no fetch, no SDK.
 */
export function buildEntryFromTrack(track: NormalizedTrack, id: string): LineEntry {
  const lengthKm = turfLength(
    { type: "Feature", geometry: track.geometry, properties: null },
    { units: "kilometers" },
  );
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
```

(`extractSlowupNumber` stays unchanged.)

Add a grouping helper:

```ts
interface GroupedTrack {
  id: string;
  track: NormalizedTrack;
}

/**
 * Group normalised line features into tracks. Features sharing a
 * `slowup_number` are merged into one track whose MultiLineString
 * concatenates every member's sub-lines; features without one stay separate.
 * First-seen order is preserved.
 */
function groupFeaturesIntoTracks(
  features: ReturnType<typeof validateFeatureCollection>,
  sourceUrl: string,
): GroupedTrack[] {
  interface Slot {
    id: string;
    coordinates: MultiLineString["coordinates"];
    rawProperties?: Record<string, unknown>;
  }
  const slots: Slot[] = [];
  const slotBySlowup = new Map<number, Slot>();

  features.forEach((feature, index) => {
    const track = normalizeTrack(feature);
    const slowupNumber = extractSlowupNumber(track.rawProperties);

    if (slowupNumber !== undefined) {
      const existing = slotBySlowup.get(slowupNumber);
      if (existing) {
        existing.coordinates.push(...track.geometry.coordinates);
        return;
      }
    }

    const slot: Slot = {
      id:
        slowupNumber !== undefined
          ? `${sourceUrl}#slowup-${slowupNumber}`
          : `${sourceUrl}#${index}`,
      coordinates: [...track.geometry.coordinates],
      rawProperties: track.rawProperties,
    };
    slots.push(slot);
    if (slowupNumber !== undefined) {
      slotBySlowup.set(slowupNumber, slot);
    }
  });

  return slots.map((slot) => {
    const track: NormalizedTrack = {
      trackId: null,
      geometry: { type: "MultiLineString", coordinates: slot.coordinates },
    };
    if (slot.rawProperties !== undefined) {
      track.rawProperties = slot.rawProperties;
    }
    return { id: slot.id, track };
  });
}
```

Rewrite `buildEntriesFromData`:

```ts
/**
 * Build the list of LineEntry from an already-fetched GeoJSON payload.
 * Pure — no fetch, no SDK. A FeatureCollection groups features by
 * `slowup_number` (one entry per slowUp); a lone Feature yields one entry.
 */
export function buildEntriesFromData(raw: unknown, sourceUrl: string): LineEntry[] {
  const isFeatureCollection =
    !!raw &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>)["type"] === "FeatureCollection";

  if (isFeatureCollection) {
    const features = validateFeatureCollection(raw);
    return groupFeaturesIntoTracks(features, sourceUrl).map((grouped) =>
      buildEntryFromTrack(grouped.track, grouped.id),
    );
  }

  const feature = validateFeature(raw);
  return [buildEntryFromTrack(normalizeTrack(feature), `${sourceUrl}#0`)];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/featureCollection.test.ts src/__tests__/featureCollectionLoader.test.ts`
Expected: PASS (all `validateFeatureCollection`, `buildEntryFromTrack`, `buildEntriesFromData`, and the new grouping tests).

- [ ] **Step 6: Full suite + tsc**

Run: `npm test` — all pass. `npx tsc --noEmit` — only the baseline `waitForMapIdle` error.

- [ ] **Step 7: Commit**

```bash
git add src/lines/featureCollectionLoader.ts src/__tests__/featureCollection.test.ts src/__tests__/featureCollectionLoader.test.ts
git commit -m "feat(lines): group FeatureCollection features by slowup_number"
```

---

## Task 2: `slowupClient` — fetch slowUp details

**Files:**

- Create: `src/lines/slowupClient.ts`
- Test: `src/__tests__/slowupClient.test.ts`

**Context:** The SchweizMobil detail API at `https://schweizmobil.ch/api/4/feature/slowup/refid/{refid}?lang={iso}` returns a JSON **array** with one object: `[{ "id": 19, "refid": 19, "title": "Ticino", "date": "2026-04-19", "photo": "...", "abstract": "...", ... }]`. `slowupClient` exposes a pure URL builder and a pure response parser (both unit-tested) plus an async fetch that wraps them with `GM.xmlHttpRequest`. The parser produces a `SlowupDetails` (`{ refid, title, date }`, already declared in `src/lines/types.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/slowupClient.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSlowupDetailUrl, parseSlowupDetails } from "../lines/slowupClient";

describe("buildSlowupDetailUrl", () => {
  it("builds the refid + lang URL", () => {
    expect(buildSlowupDetailUrl(19, "en")).toBe(
      "https://schweizmobil.ch/api/4/feature/slowup/refid/19?lang=en",
    );
  });

  it("uses the given two-letter language code", () => {
    expect(buildSlowupDetailUrl(7, "fr")).toContain("?lang=fr");
  });
});

describe("parseSlowupDetails", () => {
  it("extracts refid, title and date from the API array response", () => {
    const raw = [
      { id: 19, refid: 19, title: "Ticino", date: "2026-04-19", abstract: "…", photo: "…" },
    ];
    expect(parseSlowupDetails(raw)).toEqual({ refid: 19, title: "Ticino", date: "2026-04-19" });
  });

  it("throws on an empty array", () => {
    expect(() => parseSlowupDetails([])).toThrow();
  });

  it("throws when the response is not an array", () => {
    expect(() => parseSlowupDetails({ refid: 19 })).toThrow();
  });

  it("throws when title or date is missing", () => {
    expect(() => parseSlowupDetails([{ refid: 19, title: "Ticino" }])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/slowupClient.test.ts`
Expected: FAIL — `Cannot find module '../lines/slowupClient'`.

- [ ] **Step 3: Implement**

Create `src/lines/slowupClient.ts`:

```ts
// Client for the SchweizMobil slowUp detail API. The URL builder and the
// response parser are pure (unit-tested); fetchSlowupDetails wraps them with
// GM.xmlHttpRequest (CORS bypass, userscript context).

import type { SlowupDetails } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

/** Build the slowUp detail API URL for a refid and a 2-letter language code. */
export function buildSlowupDetailUrl(refid: number, lang: string): string {
  return `https://schweizmobil.ch/api/4/feature/slowup/refid/${refid}?lang=${lang}`;
}

/**
 * Parse the detail API response. The API returns a one-element array; this
 * extracts the fields the UI needs. Throws on an empty/non-array response or
 * a missing title/date.
 */
export function parseSlowupDetails(raw: unknown): SlowupDetails {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("[slowupClient] slowUp detail response is not a non-empty array");
  }
  const first = raw[0] as Record<string, unknown>;
  const title = first["title"];
  const date = first["date"];
  const refid = first["refid"];
  if (typeof title !== "string" || typeof date !== "string") {
    throw new Error("[slowupClient] slowUp detail is missing title or date");
  }
  return {
    refid: typeof refid === "number" ? refid : Number(refid),
    title,
    date,
  };
}

/**
 * Fetch slowUp details for a refid. Resolves with parsed SlowupDetails or
 * rejects with an Error on HTTP failure, timeout, or a malformed response.
 */
export function fetchSlowupDetails(refid: number, lang: string): Promise<SlowupDetails> {
  const url = buildSlowupDetailUrl(refid, lang);
  return new Promise<SlowupDetails>((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "GET",
      url,
      responseType: "json",
      timeout: FETCH_TIMEOUT_MS,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          reject(new Error(`[slowupClient] HTTP ${response.status} for slowUp ${refid}`));
          return;
        }
        try {
          resolve(parseSlowupDetails(response.response));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      onerror() {
        reject(new Error(`[slowupClient] network error fetching slowUp ${refid}`));
      },
      ontimeout() {
        reject(new Error(`[slowupClient] timeout fetching slowUp ${refid}`));
      },
    });
  });
}
```

The caller (`LinesSubTab`, Task 4) logs fetch failures — `slowupClient` itself does not log; it only builds, parses, and rejects with descriptive `Error`s.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/slowupClient.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + tsc**

Run: `npm test` — all pass. `npx tsc --noEmit` — only the baseline error.

- [ ] **Step 6: Commit**

```bash
git add src/lines/slowupClient.ts src/__tests__/slowupClient.test.ts
git commit -m "feat(lines): add slowupClient for the SchweizMobil detail API"
```

---

## Task 3: i18n keys for the fetch states

**Files:**

- Modify: `locales/en/common.json`, `locales/fr/common.json`

- [ ] **Step 1: Add the keys**

Add `detailsLoading` and `detailsError` to the existing `panel.lines` object in BOTH locale files (merge — do not disturb siblings). Use a Node one-liner so formatting is preserved:

```
node -e 'const fs=require("fs"); const data={"locales/en/common.json":{detailsLoading:"Loading details…",detailsError:"Details unavailable"},"locales/fr/common.json":{detailsLoading:"Chargement des détails…",detailsError:"Détails indisponibles"}}; for(const [f,kv] of Object.entries(data)){const j=JSON.parse(fs.readFileSync(f,"utf8")); Object.assign(j.panel.lines,kv); fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
```

If either key already exists in `panel.lines`, STOP and report DONE_WITH_CONCERNS (not expected).

- [ ] **Step 2: Verify**

Run: `node -e 'JSON.parse(require("fs").readFileSync("locales/fr/common.json","utf8")); JSON.parse(require("fs").readFileSync("locales/en/common.json","utf8")); console.log("ok")'` → `ok`.
Run: `npm run build` — succeeds.

- [ ] **Step 3: Commit**

```bash
git add locales/en/common.json locales/fr/common.json
git commit -m "i18n: add slowUp detail loading/error strings"
```

---

## Task 4: Fetch slowUp details and show them per row

**Files:**

- Modify: `src/ui/views/LineRowView.ts`
- Modify: `src/ui/views/LinesListView.ts`
- Modify: `src/ui/subtabs/LinesSubTab.ts`
- Modify: `src/ui/MatchPanel.ts`

**Context:** After lines load, every entry that has a `slowupNumber` needs its detail fetched. `LinesSubTab` fires one `fetchSlowupDetails` per such entry, in parallel. While a fetch is in flight the entry's `slowupFetchStatus` is `"loading"` and that row shows a spinner with its card click disabled. On success the entry gets `slowupDetails`, a recomputed `displayName` (`"Title — date"`), and status `"ok"`. On failure the status becomes `"error"` (a small warning marker; the row stays selectable). Entry updates flow through `LineRegistry.updateEntry` → `onEntryUpdated`, so `LinesListView` must re-render its rows on that event.

The slowUp API language is the 2-letter code i18next resolved at startup — `i18next.language` (from `locales/i18n.ts`).

### 4a. `LineRowView` — render the fetch state

Replace `src/ui/views/LineRowView.ts` with:

```ts
import { i18next } from "../../../locales/i18n";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/**
 * Pure DOM view for a single line in the Lignes list: colour pill, name, a
 * round "recenter" icon button, and a trailing affordance. The whole card is
 * clickable to select the line — except while its slowUp details are still
 * loading. No store access; styling comes from the shell-injected
 * `.wmegj-line-*` rules.
 */
export class LineRowView {
  readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly nameEl: HTMLElement;

  constructor(props: LineRowProps) {
    const isLoading = props.entry.slowupFetchStatus === "loading";

    this.root = document.createElement("div");
    this.root.className = isLoading ? "wmegj-line-row wmegj-line-row--loading" : "wmegj-line-row";
    if (!isLoading) {
      this.root.title = i18next.t("panel.lines.select");
      this.root.addEventListener("click", () => props.onSelect(props.entry.id));
    }

    this.pill = document.createElement("span");
    this.pill.className = "wmegj-line-pill";
    this.root.appendChild(this.pill);

    this.nameEl = document.createElement("span");
    this.nameEl.className = "wmegj-line-name";
    this.root.appendChild(this.nameEl);

    if (props.entry.slowupFetchStatus === "error") {
      const warn = document.createElement("i");
      warn.className = "w-icon w-icon-alert-fill wmegj-line-warning";
      warn.title = i18next.t("panel.lines.detailsError");
      this.root.appendChild(warn);
    }

    const centerBtn = document.createElement("button");
    centerBtn.type = "button";
    centerBtn.className = "wmegj-icon-btn";
    centerBtn.title = i18next.t("panel.lines.center");
    const centerIcon = document.createElement("i");
    centerIcon.className = "w-icon w-icon-recenter w-icon-2x";
    centerBtn.appendChild(centerIcon);
    centerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      props.onCenter(props.entry.id);
    });
    this.root.appendChild(centerBtn);

    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "wmegj-spinner";
      spinner.title = i18next.t("panel.lines.detailsLoading");
      spinner.setAttribute("aria-label", i18next.t("panel.lines.detailsLoading"));
      this.root.appendChild(spinner);
    } else {
      const arrow = document.createElement("i");
      arrow.className = "w-icon w-icon-arrow-right wmegj-line-arrow";
      arrow.setAttribute("aria-hidden", "true");
      this.root.appendChild(arrow);
    }

    this.update(props.entry);
  }

  update(entry: LineEntry): void {
    this.pill.style.backgroundColor = entry.color;
    this.nameEl.textContent = entry.displayName;
  }
}
```

### 4b. `MatchPanel` — spinner / warning / loading CSS

In `src/ui/MatchPanel.ts`, inside `injectShellStyles`'s template string, after the `.wmegj-line-arrow` rule, add:

```css
.wmegj-line-row--loading {
  opacity: 0.6;
  cursor: default;
}
.wmegj-line-row--loading:hover {
  background: transparent;
}
.wmegj-line-warning {
  flex: 0 0 auto;
  color: #e0a800;
}
.wmegj-spinner {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 2px solid #c7ced6;
  border-top-color: #2c6fbb;
  border-radius: 50%;
  animation: wmegj-spin 0.7s linear infinite;
}
@keyframes wmegj-spin {
  to {
    transform: rotate(360deg);
  }
}
```

### 4c. `LinesListView` — re-render rows on entry updates

`LinesListView.setEntries` already rebuilds every row. No structural change is needed there — `LinesSubTab` (4d) will call `setEntries` again whenever an entry updates. Confirm `setEntries` can be safely called repeatedly (it does `this.listEl.replaceChildren()` first — it can).

### 4d. `LinesSubTab` — fire the fetches

In `src/ui/subtabs/LinesSubTab.ts`:

- Add imports:

```ts
import { i18next } from "../../../locales/i18n";
import { fetchSlowupDetails } from "../../lines/slowupClient";
import { computeDisplayName } from "../../lines/displayName";
```

- Subscribe to `onEntryUpdated` (in the constructor, alongside the existing `onLinesChanged` subscription) so a resolved fetch re-renders the list. Store the extra unsubscribe handle and call it in `dispose()`:

```ts
this.unsubscribeEntry = deps.registry.onEntryUpdated(() => {
  this.view.setEntries(deps.registry.getAll());
});
```

(Add a private field `private readonly unsubscribeEntry: () => void;` and `this.unsubscribeEntry();` in `dispose()`.)

- After the existing `onLinesChanged` subscription, also kick off detail fetches whenever the line list changes:

```ts
deps.registry.onLinesChanged(() => this.fetchSlowupDetailsForLines());
```

- Add the fetch driver method:

```ts
  /**
   * For every loaded line that carries a slowUp number and has not been
   * fetched yet, fetch its detail in parallel. Each line's row reflects the
   * fetch lifecycle via its slowupFetchStatus.
   */
  private fetchSlowupDetailsForLines(): void {
    const lang = i18next.language.split("-")[0] || "fr";
    for (const entry of this.deps.registry.getAll()) {
      if (entry.slowupNumber === undefined) continue;
      if (entry.slowupFetchStatus !== "idle") continue;

      this.deps.registry.updateEntry(entry.id, { slowupFetchStatus: "loading" });
      fetchSlowupDetails(entry.slowupNumber, lang)
        .then((details) => {
          this.deps.registry.updateEntry(entry.id, {
            slowupDetails: details,
            slowupFetchStatus: "ok",
            displayName: computeDisplayName({
              lengthKm: entry.lengthKm,
              properties: entry.track.rawProperties,
              slowupDetails: details,
            }),
          });
        })
        .catch((err: unknown) => {
          logger.warn(`LinesSubTab: slowUp ${entry.slowupNumber ?? "?"} detail fetch failed`, err);
          this.deps.registry.updateEntry(entry.id, { slowupFetchStatus: "error" });
        });
    }
  }
```

> **Re-entrancy note:** `updateEntry` fires `onEntryUpdated`, which the constructor subscribes to with `view.setEntries(...)`. That only re-renders DOM — it does not call `fetchSlowupDetailsForLines` — so there is no fetch loop. `fetchSlowupDetailsForLines` is driven only by `onLinesChanged`. The `slowupFetchStatus !== "idle"` guard additionally ensures each line is fetched at most once even if `onLinesChanged` fires again.

> **Verify while implementing:** confirm `LineRegistry` exposes `onEntryUpdated(cb: (id: string) => void)` (it does — added in Phase 7a). Confirm `logger` is already imported in `LinesSubTab.ts` (it is).

- [ ] **Step 1: Apply 4a, 4b, 4c, 4d.**

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — only the baseline error. `npm test` — all pass. `npm run build` — succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/views/LineRowView.ts src/ui/views/LinesListView.ts src/ui/subtabs/LinesSubTab.ts src/ui/MatchPanel.ts
git commit -m "feat(ui): fetch and show slowUp details per line"
```

---

## Task 5: Default the closure-window date from slowUp details

**Files:**

- Modify: `src/ui/subtabs/MatchingSubTab.ts`

**Context:** `downloadClosuresSynthetic` opens `promptClosureWindow` with `date` defaulting to today. When the selected line is a slowUp with fetched details, default the date to the slowUp's date instead (times stay 09:00 / 17:30).

- [ ] **Step 1: Implement**

In `src/ui/subtabs/MatchingSubTab.ts`, `downloadClosuresSynthetic`. It currently starts:

```ts
const today = new Date().toISOString().slice(0, 10);
const window = await promptClosureWindow({
  date: today,
  startTime: "09:00",
  endTime: "17:30",
});
```

Replace those lines with:

```ts
const today = new Date().toISOString().slice(0, 10);
// A slowUp line carries its event date — default the closure date to it.
const slowupDate = this.registry.getSelected()?.slowupDetails?.date;
const window = await promptClosureWindow({
  date: slowupDate ?? today,
  startTime: "09:00",
  endTime: "17:30",
});
```

Leave the rest of the method unchanged.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — only the baseline error. `npm test` — all pass. `npm run build` — succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat(ui): default the closure-window date from slowUp details"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Test suite** — `npm test`, all pass including `slowupClient.test.ts` and the new grouping tests in `featureCollection.test.ts`.
- [ ] **Step 2: Lint** — `npm run lint`. Pre-existing issues in `WalkController.ts` / `SegmentMatcher.ts` are baseline noise; confirm no NEW issues in Phase 7c files.
- [ ] **Step 3: Build** — `npm run build`, `releases/release-*.user.js` produced.
- [ ] **Step 4: Manual validation checklist** (user performs in a live WME session):
  - [ ] Loading `https://schweizmobil.ch/api/4/slowups.geojson` lists ~19 lines (one per slowUp), not 140.
  - [ ] Each slowUp row shows a spinner briefly, then its name becomes "Title — date".
  - [ ] A slowUp whose detail fetch fails keeps a fallback name + a warning marker and stays selectable.
  - [ ] Selecting a slowUp draws its full route (all member traces) and matching runs over it.
  - [ ] For a CSV-less slowUp, the closure-window modal opens defaulted to the slowUp's date.
  - [ ] A non-slowUp FeatureCollection / lone Feature still works (no detail fetch, one entry per feature).
- [ ] **Step 5: Commit** any changelog note if the implementation diverged from this plan.

---

## Self-review notes

- **Spec coverage:** 7c spec items — slowUp detail fetch (`slowupClient`, Task 2), language via the SDK-detected locale (`i18next.language`, Task 4), parallel per-row fetch with spinner + disabled selection (Task 4), display name "Title — date" (`computeDisplayName` already supports `slowupDetails`; Task 4 recomputes it), closure-date default from details (Task 5). Plus the user-added grouping by `slowup_number` (Task 1).
- **Type consistency:** `buildEntryFromTrack(track, id)`, `buildSlowupDetailUrl`, `parseSlowupDetails`, `fetchSlowupDetails`, `SlowupDetails`, and `LineEntry.slowup*` fields are used consistently across tasks.
- **Risk:** Task 1 changes `buildEntryFromTrack`'s signature — Step 1 updates its existing tests first so the suite stays green. Task 4's `onEntryUpdated` re-render must not retrigger fetching — the `slowupFetchStatus !== "idle"` guard and the `onLinesChanged`-only fetch trigger prevent a loop.
