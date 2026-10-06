# WME Event Closures — UI overhaul, batch B (Lignes tab + Matching sidebar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the "Lignes" sub-tab and the "Matching" sidebar sub-tab so they look and read like native WME: a one-click slowUps button, one loaded-source card, per-line progress, a real two-handle distance slider, and three numbered steps (Correspondance → MTE → Fermetures) with a single primary action.

**Deviation from the spec (decided while planning):** the "recenter on all lines" icon sits in the loaded-source card (next to ×) instead of a separate list header, which would only have repeated the card's "n lignes". Progress reads "NN %" (validated share of the track length) rather than "3/8": sub-lines are created lazily, so their total is unknown until the end.

**Architecture:** Each visual block becomes a small pure-DOM view in `src/ui/views/` (no SDK, no store), unit-tested in happy-dom through the plain-HTML fallbacks of the `wz-*` helpers. Controllers (`LinesSubTab`, `MatchingSubTab`, `MatchPanel`) keep the logic and feed the views. All new CSS goes into the shared `BASE_CSS` (`src/ui/styles.ts`, WME tokens only); the legacy sidebar CSS injected by `MatchPanel` and `MatchingSubTab` is deleted. Per-line progress is a pure function over the persisted `Source`.

**Tech Stack:** TypeScript (strict), vitest + happy-dom, i18next, WME web components.

**Spec:** `docs/superpowers/specs/2026-10-05-event-closures-ui-overhaul-design.md` (sections 2 and 3; section 0's "no horizontal scroll" for these two tabs).

## Global Constraints

- No new dependencies.
- Colours only through WME tokens (`var(--primary)`, `var(--content_p2)`, `var(--hairline)`, …); `BASE_CSS` must stay hex-free (`src/__tests__/styles.test.ts` enforces it).
- Keep internal identifiers: `wmegj-` CSS prefix, storage keys (`wme-geojson:source:<id>`), the `geojson` query parameter, `scriptId`.
- Every user-visible string goes through `i18next.t("literal.key")` with a literal key, added to both `locales/fr/common.json` and `locales/en/common.json` (use `.superpowers/i18n.py <locale> <dotted.path> '<json>'` — it inserts without reordering). Plurals use i18next v4 suffixes `_one` / `_other`.
- Reuse the batch A helpers: `wzButton` (variants `primary | secondary | danger | text`), `wzTextInput`, `wzLabel`, `fileInput` (WME's native `wz-file-input`), `injectStyles`.
- The slowUps source URL is exactly `https://schweizmobil.ch/api/4/slowups.geojson`.
- No `alert()` / `confirm()`.
- Commit after each task; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- View tests run in happy-dom with the real French strings: first line `// @vitest-environment happy-dom`, and `beforeAll(initFrench)` from `src/__tests__/helpers/i18nFr.ts` (Task 1).

## Review Focus

1. **A line never opened, or whose saved session is unreadable** (no persisted Source / old schema): its row must show no progress at all, never "0 %" or an error → test in Task 1 (`lineProgress(null)`).
2. **A URL source whose text isn't a valid URL** (pasted path, typo): the source card must still show something readable (the raw text), not throw → test in Task 3.
3. **Dragging the left slider handle past the right one**: the window must clamp (start ≤ end), never invert → test in Task 7.
4. **An MTE linked to the line but not loaded in WME** (Events tab never opened): the sidebar must not show its raw UUID → test in Task 8.
5. **Matching complete but no MTE linked**: "Appliquer" must stay usable (closures can be applied without MTE) while "Préparer le MTE" is the highlighted next step → test in Task 8.

## File Structure

| File                                           | Responsibility                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `src/domain/lineProgress.ts` (new)             | `lineProgress(source)` → not started / % validated / done         |
| `src/__tests__/helpers/i18nFr.ts` (new)        | init i18next with the real FR bundle for view tests               |
| `src/lines/displayName.ts` (modify)            | export `formatSlowupDate`                                         |
| `src/lines/slowupClient.ts` (modify)           | export `SLOWUPS_GEOJSON_URL`                                      |
| `src/ui/views/LineRowView.ts` (rewrite)        | one line row: colour dot, name, date, progress, recenter          |
| `src/ui/views/LinesListView.ts` (rewrite)      | slowUps button, other source (URL + file), source card, list      |
| `src/ui/subtabs/LinesSubTab.ts` (modify)       | source state, progress lookup, refresh                            |
| `src/ui/MatchPanel.ts` (modify)                | wiring: progress, refresh on show, back to Lignes, drop shell CSS |
| `src/bootstrap/loadAndAttachTrack.ts` (modify) | `notifyUrlLoaded(url)`                                            |
| `src/ui/views/MatchingHeaderView.ts` (rewrite) | "← Lignes", line name, "km · status"                              |
| `src/ui/views/PlanningCsvView.ts` (new)        | planning CSV file input / loaded chip / error                     |
| `src/ui/views/RangeSliderView.ts` (new)        | two-handle distance slider on one track                           |
| `src/ui/views/MatchingStepsView.ts` (new)      | three numbered steps, one primary action                          |
| `src/ui/subtabs/MatchingSubTab.ts` (modify)    | use the four views, drop old rows/badge/CSS                       |
| `src/ui/styles.ts` (modify)                    | CSS for all of the above                                          |

---

### Task 1: Line progress + test helper

**Files:**

- Create: `src/domain/lineProgress.ts`, `src/__tests__/helpers/i18nFr.ts`
- Test: `src/__tests__/lineProgress.test.ts`

**Interfaces:**

- Produces:
  - `type LineProgress = { kind: "notStarted" } | { kind: "inProgress"; percent: number } | { kind: "done" }`
  - `lineProgress(source: Source | null): LineProgress`
  - `initFrench(): Promise<void>` (test helper)

- [ ] **Step 1: Write the test helper**

`src/__tests__/helpers/i18nFr.ts`:

```ts
import { i18next } from "../../../locales/i18n";
import fr from "../../../locales/fr/common.json";

/** Real French strings, same namespace as the userscript (locales/i18n.ts). */
export async function initFrench(): Promise<void> {
  await i18next.init({
    lng: "fr",
    defaultNS: "common",
    resources: { fr: { common: fr } },
    interpolation: { escapeValue: false },
  });
}
```

`vitest.config.ts` includes `src/__tests__/**/*.test.ts` only, so the helper is not collected as a test file.

- [ ] **Step 2: Write the failing test**

`src/__tests__/lineProgress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lineProgress } from "../domain/lineProgress";
import type { Line, Source, SubLine } from "../domain/types";

function sub(kmA: number, kmB: number, validated: boolean): SubLine {
  return {
    index: 0,
    kmA,
    kmB,
    bbox: [0, 0, 0, 0],
    view: { lon: 0, lat: 0, zoom: 16 },
    segmentIds: validated ? [1] : [],
    validated,
  };
}

function line(lengthKm: number, subLines: SubLine[], pendingTail: Line["pendingTail"]): Line {
  return {
    index: 0,
    bbox: [0, 0, 0, 0],
    geometry: { type: "MultiLineString", coordinates: [] },
    lengthKm,
    subLines,
    pendingTail,
  };
}

function source(lines: Line[]): Source {
  return { schemaVersion: 1, sourceId: "s", kind: "geojson", hasCsv: false, lines, cursor: null };
}

describe("lineProgress", () => {
  it("is not started without a persisted source", () => {
    expect(lineProgress(null)).toEqual({ kind: "notStarted" });
  });

  it("is not started while nothing is validated", () => {
    const src = source([line(10, [sub(0, 4, false)], [{ kmA: 4, kmB: 10 }])]);
    expect(lineProgress(src)).toEqual({ kind: "notStarted" });
  });

  it("reports the validated share of the track, across lines", () => {
    const src = source([
      line(10, [sub(0, 4, true)], [{ kmA: 4, kmB: 10 }]),
      line(10, [sub(0, 2, true), sub(2, 5, false)], [{ kmA: 5, kmB: 10 }]),
    ]);
    expect(lineProgress(src)).toEqual({ kind: "inProgress", percent: 30 });
  });

  it("never rounds to 0 % or 100 % before the matching is complete", () => {
    const tiny = source([line(100, [sub(0, 0.1, true)], [{ kmA: 0.1, kmB: 100 }])]);
    expect(lineProgress(tiny)).toEqual({ kind: "inProgress", percent: 1 });
    const almost = source([line(100, [sub(0, 99.9, true)], [{ kmA: 99.9, kmB: 100 }])]);
    expect(lineProgress(almost)).toEqual({ kind: "inProgress", percent: 99 });
  });

  it("is done once every sub-line is cut and validated", () => {
    const src = source([line(10, [sub(0, 10, true)], [])]);
    expect(lineProgress(src)).toEqual({ kind: "done" });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/lineProgress.test.ts`
Expected: FAIL — cannot resolve `../domain/lineProgress`.

- [ ] **Step 4: Implement**

`src/domain/lineProgress.ts`:

```ts
// Coarse matching progress of one line, read from its persisted Source.
// Sub-lines are created lazily, so their total count is unknown until the
// end: progress is the validated share of the track length instead.

import { isMatchingComplete } from "./isMatchingComplete";
import type { Source } from "./types";

export type LineProgress =
  | { kind: "notStarted" }
  | { kind: "inProgress"; percent: number }
  | { kind: "done" };

export function lineProgress(source: Source | null): LineProgress {
  if (!source) return { kind: "notStarted" };
  if (isMatchingComplete(source)) return { kind: "done" };

  const totalKm = source.lines.reduce((sum, line) => sum + line.lengthKm, 0);
  const validatedKm = source.lines.reduce(
    (sum, line) =>
      sum +
      line.subLines
        .filter((subLine) => subLine.validated)
        .reduce((lineSum, subLine) => lineSum + (subLine.kmB - subLine.kmA), 0),
    0,
  );
  if (validatedKm <= 0 || totalKm <= 0) return { kind: "notStarted" };

  // 0 % would read as "not started" and 100 % as "done": keep 1..99.
  const percent = Math.min(99, Math.max(1, Math.round((validatedKm / totalKm) * 100)));
  return { kind: "inProgress", percent };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/__tests__/lineProgress.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/lineProgress.ts src/__tests__/lineProgress.test.ts src/__tests__/helpers/i18nFr.ts
git commit -m "feat(domain): line matching progress from the persisted source"
```

---

### Task 2: Line row

**Files:**

- Rewrite: `src/ui/views/LineRowView.ts`
- Modify: `src/lines/displayName.ts` (export `formatSlowupDate`), `src/ui/styles.ts`, both locales
- Test: `src/__tests__/LineRowView.test.ts`

**Interfaces:**

- Consumes: `LineProgress` (Task 1), `initFrench` (Task 1).
- Produces: `new LineRowView({ entry: LineEntry; progress: LineProgress; onSelect(id: string): void; onCenter(id: string): void })` with `root: HTMLElement`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/LineRowView.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LineRowView } from "../ui/views/LineRowView";
import type { LineEntry } from "../lines/types";
import { initFrench } from "./helpers/i18nFr";

beforeAll(initFrench);

function entry(overrides: Partial<LineEntry> = {}): LineEntry {
  return {
    id: "l1",
    track: {
      trackId: "l1",
      geometry: { type: "MultiLineString", coordinates: [] },
      rawProperties: {},
    },
    lengthKm: 30.85,
    displayName: "SS7+11 Les Cols",
    color: "#ff00aa",
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
    ...overrides,
  };
}

const notStarted = { kind: "notStarted" } as const;

describe("LineRowView", () => {
  it("shows the slowUp title with its date on a second line", () => {
    const row = new LineRowView({
      entry: entry({
        displayName: "slowUp Valais — 25.10.2026",
        slowupDetails: { refid: 1, title: "slowUp Valais", date: "2026-10-25" },
        slowupFetchStatus: "ok",
      }),
      progress: notStarted,
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    expect(row.root.querySelector(".wmegj-line-name")?.textContent).toBe("slowUp Valais");
    expect(row.root.querySelector(".wmegj-line-caption")?.textContent).toBe("25.10.2026");
  });

  it("shows progress only once the line has been started", () => {
    const none = new LineRowView({
      entry: entry(),
      progress: notStarted,
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    expect(none.root.querySelector(".wmegj-line-progress")).toBeNull();

    const half = new LineRowView({
      entry: entry(),
      progress: { kind: "inProgress", percent: 45 },
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    expect(half.root.querySelector(".wmegj-line-progress")?.textContent).toBe("45 %");

    const done = new LineRowView({
      entry: entry(),
      progress: { kind: "done" },
      onSelect: vi.fn(),
      onCenter: vi.fn(),
    });
    const doneEl = done.root.querySelector(".wmegj-line-progress");
    expect(doneEl?.textContent).toContain("Terminé");
    expect(doneEl?.classList.contains("is-done")).toBe(true);
  });

  it("selects on click, but recentering does not select", () => {
    const onSelect = vi.fn();
    const onCenter = vi.fn();
    const row = new LineRowView({ entry: entry(), progress: notStarted, onSelect, onCenter });
    row.root.querySelector<HTMLButtonElement>(".wmegj-icon-only")!.click();
    expect(onCenter).toHaveBeenCalledWith("l1");
    expect(onSelect).not.toHaveBeenCalled();
    row.root.click();
    expect(onSelect).toHaveBeenCalledWith("l1");
  });

  it("cannot be selected while its slowUp details are loading", () => {
    const onSelect = vi.fn();
    const row = new LineRowView({
      entry: entry({ slowupFetchStatus: "loading" }),
      progress: notStarted,
      onSelect,
      onCenter: vi.fn(),
    });
    row.root.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(row.root.querySelector(".wmegj-spinner")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/LineRowView.test.ts`
Expected: FAIL — no `.wmegj-line-caption` / `.wmegj-line-progress`, and `progress` is not a prop yet.

- [ ] **Step 3: Implement**

a) `src/lines/displayName.ts`: change `function formatSlowupDate(` to `export function formatSlowupDate(`.

b) `src/ui/views/LineRowView.ts` (whole file):

```ts
import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { formatSlowupDate } from "../../lines/displayName";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  progress: LineProgress;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/**
 * One line of the Lignes list, in WME's list style: colour dot, name (slowUp
 * date underneath), progress, recenter icon. The whole row selects the line,
 * except while its slowUp details are still loading.
 */
export class LineRowView {
  readonly root: HTMLElement;

  constructor(props: LineRowProps) {
    const { entry } = props;
    const isLoading = entry.slowupFetchStatus === "loading";

    this.root = document.createElement("div");
    this.root.className = isLoading ? "wmegj-line-row wmegj-line-row--loading" : "wmegj-line-row";
    if (!isLoading) {
      this.root.title = i18next.t("panel.lines.select");
      this.root.addEventListener("click", () => props.onSelect(entry.id));
    }

    const dot = document.createElement("span");
    dot.className = "wmegj-line-pill";
    dot.style.backgroundColor = entry.color;

    const text = document.createElement("div");
    text.className = "wmegj-line-text";
    const name = document.createElement("span");
    name.className = "wmegj-line-name";
    name.textContent = entry.slowupDetails?.title ?? entry.displayName;
    text.appendChild(name);
    const date = entry.slowupDetails ? formatSlowupDate(entry.slowupDetails.date) : null;
    if (date) {
      const caption = document.createElement("span");
      caption.className = "wmegj-line-caption";
      caption.textContent = date;
      text.appendChild(caption);
    }

    this.root.append(dot, text);

    if (entry.slowupFetchStatus === "error") {
      const warn = document.createElement("i");
      warn.className = "w-icon w-icon-alert-info wmegj-line-warning";
      warn.title = i18next.t("panel.lines.detailsError");
      this.root.appendChild(warn);
    }

    const progressEl = renderProgress(props.progress);
    if (progressEl) this.root.appendChild(progressEl);

    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "wmegj-spinner";
      spinner.title = i18next.t("panel.lines.detailsLoading");
      this.root.appendChild(spinner);
      return;
    }

    const centerBtn = document.createElement("button");
    centerBtn.type = "button";
    centerBtn.className = "wmegj-icon-only";
    centerBtn.title = i18next.t("panel.lines.center");
    const centerIcon = document.createElement("i");
    centerIcon.className = "w-icon w-icon-recenter";
    centerBtn.appendChild(centerIcon);
    centerBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      props.onCenter(entry.id);
    });
    this.root.appendChild(centerBtn);
  }
}

function renderProgress(progress: LineProgress): HTMLElement | null {
  if (progress.kind === "notStarted") return null;
  const el = document.createElement("span");
  el.className = "wmegj-line-progress";
  if (progress.kind === "done") {
    el.classList.add("is-done");
    el.textContent = `✓ ${i18next.t("panel.lines.progressDone")}`;
  } else {
    el.textContent = i18next.t("panel.lines.progressPercent", { percent: progress.percent });
  }
  return el;
}
```

(`w-icon-alert-fill` from the old row does not exist in WME; `w-icon-alert-info` does — verified in batch A.)

c) Locales — `panel.lines`: FR `"progressDone": "Terminé"`, `"progressPercent": "{{percent}} %"`; EN `"progressDone": "Done"`, `"progressPercent": "{{percent}}%"`.

d) Append to `BASE_CSS` in `src/ui/styles.ts`:

```css
.wmegj-line-list {
  display: flex;
  flex-direction: column;
}
.wmegj-line-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 4px 4px 4px 8px;
  border-bottom: 1px solid var(--separator_default);
  cursor: pointer;
}
.wmegj-line-row:hover {
  background: var(--background_variant);
}
.wmegj-line-row--loading {
  opacity: 0.6;
  cursor: default;
}
.wmegj-line-row--loading:hover {
  background: transparent;
}
.wmegj-line-pill {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.wmegj-line-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wmegj-line-name {
  font-size: 14px;
  color: var(--content_default);
  overflow-wrap: anywhere;
}
.wmegj-line-caption {
  font-size: 12px;
  color: var(--content_p3);
}
.wmegj-line-progress {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--content_p2);
}
.wmegj-line-progress.is-done {
  color: var(--safe_variant);
}
.wmegj-line-warning {
  flex: 0 0 auto;
  color: var(--cautious_variant);
}
.wmegj-spinner {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 2px solid var(--hairline);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: wmegj-spin 0.7s linear infinite;
}
@keyframes wmegj-spin {
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/LineRowView.test.ts src/__tests__/displayName.test.ts src/__tests__/styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src locales
git commit -m "feat(ui): WME-style line rows with slowUp date and progress"
```

---

### Task 3: Lignes list view

**Files:**

- Rewrite: `src/ui/views/LinesListView.ts`
- Modify: `src/lines/slowupClient.ts`, `src/ui/styles.ts`, both locales
- Test: `src/__tests__/LinesListView.test.ts`

**Interfaces:**

- Consumes: `LineRowView`, `LineProgress`, `wzButton`, `wzTextInput`, `wzLabel`, `fileInput`, `readValue`, `initFrench`.
- Produces:
  - `export const SLOWUPS_GEOJSON_URL = "https://schweizmobil.ch/api/4/slowups.geojson"` (in `slowupClient.ts`)
  - `type LoadedSource = { kind: "slowups" } | { kind: "url"; url: string } | { kind: "file"; name: string }`
  - `interface LinesListProps { onLoadUrl(url: string): void; onLoadFile(file: File): void; onClearSource(): void; onSelect(id: string): void; onCenterAll(): void; onCenterLine(id: string): void }`
  - `class LinesListView { root; setUrl(url: string): void; setSource(source: LoadedSource | null): void; setEntries(entries: readonly LineEntry[], progressOf: (id: string) => LineProgress): void; showError(message: string): void; clearError(): void }`
  - `sourceName(source: LoadedSource): string` (exported for the controller tests)

- [ ] **Step 1: Write the failing test**

`src/__tests__/LinesListView.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LinesListView, sourceName, type LinesListProps } from "../ui/views/LinesListView";
import { SLOWUPS_GEOJSON_URL } from "../lines/slowupClient";
import type { LineEntry } from "../lines/types";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

function props(): LinesListProps {
  return {
    onLoadUrl: vi.fn(),
    onLoadFile: vi.fn(),
    onClearSource: vi.fn(),
    onSelect: vi.fn(),
    onCenterAll: vi.fn(),
    onCenterLine: vi.fn(),
  };
}

function entry(id: string): LineEntry {
  return {
    id,
    track: {
      trackId: id,
      geometry: { type: "MultiLineString", coordinates: [] },
      rawProperties: {},
    },
    lengthKm: 1,
    displayName: id,
    color: "#000000",
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
}

const notStarted = () => ({ kind: "notStarted" }) as const;

describe("LinesListView", () => {
  it("loads the slowUps with one click", () => {
    const p = props();
    const view = new LinesListView(p);
    view.root.querySelector<HTMLButtonElement>(".wmegj-button--primary")!.click();
    expect(p.onLoadUrl).toHaveBeenCalledWith(SLOWUPS_GEOJSON_URL);
  });

  it("loads another URL from its field, by button or Enter, ignoring blanks", () => {
    const p = props();
    const view = new LinesListView(p);
    const input = view.root.querySelector<HTMLInputElement>("input[type=url]")!;
    const loadBtn = view.root.querySelector<HTMLButtonElement>(".wmegj-url-load")!;

    loadBtn.click();
    expect(p.onLoadUrl).not.toHaveBeenCalled();

    input.value = "  https://example.org/a.geojson ";
    input.dispatchEvent(new Event("input"));
    loadBtn.click();
    expect(p.onLoadUrl).toHaveBeenLastCalledWith("https://example.org/a.geojson");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(p.onLoadUrl).toHaveBeenCalledTimes(2);
  });

  it("offers WME's file input for GeoJSON, GPX, KML and KMZ", () => {
    const view = new LinesListView(props());
    const file = view.root.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(file.accept).toBe(".geojson,.gpx,.kml,.kmz");
  });

  it("shows one card for the loaded source, with its line count and a remove button", () => {
    const p = props();
    const view = new LinesListView(p);
    const card = () => view.root.querySelector<HTMLElement>(".wmegj-source-card")!;
    expect(card().hidden).toBe(true);

    view.setSource({ kind: "url", url: "https://example.org/tracks/a.geojson" });
    view.setEntries([entry("a"), entry("b")], notStarted);
    expect(card().hidden).toBe(false);
    expect(card().textContent).toContain("example.org");
    expect(card().textContent).toContain("2 lignes");
    expect(view.root.textContent).not.toContain("FeatureCollection");

    card().querySelector<HTMLButtonElement>(".wmegj-source-clear")!.click();
    expect(p.onClearSource).toHaveBeenCalled();
    card().querySelector<HTMLButtonElement>(".wmegj-source-center")!.click();
    expect(p.onCenterAll).toHaveBeenCalled();

    view.setSource(null);
    expect(card().hidden).toBe(true);
  });

  it("names each kind of source", () => {
    expect(sourceName({ kind: "slowups" })).toBe("slowUps");
    expect(sourceName({ kind: "file", name: "rallye.kmz" })).toBe("rallye.kmz");
    expect(sourceName({ kind: "url", url: "https://example.org/x" })).toBe("example.org");
    expect(sourceName({ kind: "url", url: "not a url" })).toBe("not a url");
  });

  it("renders one row per line with its progress", () => {
    const view = new LinesListView(props());
    view.setSource({ kind: "slowups" });
    view.setEntries([entry("a"), entry("b")], (id) =>
      id === "a" ? { kind: "done" } : { kind: "notStarted" },
    );
    expect(view.root.querySelectorAll(".wmegj-line-row")).toHaveLength(2);
    expect(view.root.querySelectorAll(".wmegj-line-progress")).toHaveLength(1);
  });

  it("shows load errors and clears them", () => {
    const view = new LinesListView(props());
    view.showError("HTTP 404");
    const error = view.root.querySelector<HTMLElement>(".wmegj-load-error")!;
    expect(error.textContent).toContain("HTTP 404");
    view.clearError();
    expect(error.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/LinesListView.test.ts`
Expected: FAIL — `SLOWUPS_GEOJSON_URL` / `sourceName` not exported.

- [ ] **Step 3: Implement**

a) `src/lines/slowupClient.ts`, after the imports:

```ts
/** SchweizMobil's list of every slowUp, as a GeoJSON FeatureCollection. */
export const SLOWUPS_GEOJSON_URL = "https://schweizmobil.ch/api/4/slowups.geojson";
```

b) `src/ui/views/LinesListView.ts` (whole file):

```ts
import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { SLOWUPS_GEOJSON_URL } from "../../lines/slowupClient";
import type { LineEntry } from "../../lines/types";
import { fileInput, readValue, wzButton, wzLabel, wzTextInput } from "../components/wz";
import { LineRowView } from "./LineRowView";

export type LoadedSource =
  | { kind: "slowups" }
  | { kind: "url"; url: string }
  | { kind: "file"; name: string };

export interface LinesListProps {
  onLoadUrl: (url: string) => void;
  onLoadFile: (file: File) => void;
  onClearSource: () => void;
  onSelect: (id: string) => void;
  onCenterAll: () => void;
  onCenterLine: (id: string) => void;
}

/** Short name of a loaded source: file name, "slowUps", or the URL's host. */
export function sourceName(source: LoadedSource): string {
  if (source.kind === "slowups") return i18next.t("panel.lines.slowupsSource");
  if (source.kind === "file") return source.name;
  try {
    return new URL(source.url).host || source.url;
  } catch {
    return source.url;
  }
}

function iconButton(icon: string, title: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `wmegj-icon-only ${className}`;
  button.title = title;
  const i = document.createElement("i");
  i.className = `w-icon ${icon}`;
  button.appendChild(i);
  return button;
}

/**
 * Lignes sub-tab: one-click slowUps, another source (URL or file), the
 * loaded-source card, then the lines. Pure DOM; the controller feeds it.
 */
export class LinesListView {
  readonly root: HTMLElement;
  private readonly urlInputHost: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly cardNameEl: HTMLElement;
  private readonly cardCountEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly props: LinesListProps;

  constructor(props: LinesListProps) {
    this.props = props;
    this.root = document.createElement("div");
    this.root.className = "wmegj-lines";

    const slowupsBtn = wzButton({
      text: i18next.t("panel.lines.loadSlowups"),
      variant: "primary",
      onClick: () => props.onLoadUrl(SLOWUPS_GEOJSON_URL),
    });
    slowupsBtn.classList.add("wmegj-block-button");

    // --- Other source: URL + file -------------------------------------------
    const other = document.createElement("section");
    other.className = "wmegj-section";
    other.appendChild(wzLabel(i18next.t("panel.lines.otherSource")));

    const loadTypedUrl = (): void => {
      const url = readValue(this.urlInputHost).trim();
      if (url !== "") props.onLoadUrl(url);
    };
    this.urlInputHost = wzTextInput({ type: "url", placeholder: "https://…" });
    this.urlInputHost.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadTypedUrl();
    });
    const loadBtn = iconButton(
      "w-icon-arrow-right",
      i18next.t("panel.lines.urlLoad"),
      "wmegj-url-load",
    );
    loadBtn.addEventListener("click", loadTypedUrl);
    const urlRow = document.createElement("div");
    urlRow.className = "wmegj-row";
    loadBtn.classList.add("wmegj-row-fixed");
    urlRow.append(this.urlInputHost, loadBtn);

    const file = fileInput({
      accept: ".geojson,.gpx,.kml,.kmz",
      buttonLabel: i18next.t("panel.lines.chooseFile"),
      onFile: (picked) => props.onLoadFile(picked),
    });
    const formats = document.createElement("p");
    formats.className = "wmegj-caption";
    formats.textContent = i18next.t("panel.lines.fileFormats");

    other.append(urlRow, file, formats);

    this.errorEl = document.createElement("p");
    this.errorEl.className = "wmegj-load-error";

    // --- Loaded source card -------------------------------------------------
    this.cardEl = document.createElement("div");
    this.cardEl.className = "wmegj-source-card";
    this.cardEl.hidden = true;
    const cardText = document.createElement("div");
    cardText.className = "wmegj-line-text";
    this.cardNameEl = document.createElement("span");
    this.cardNameEl.className = "wmegj-source-name";
    this.cardCountEl = document.createElement("span");
    this.cardCountEl.className = "wmegj-line-caption";
    cardText.append(this.cardNameEl, this.cardCountEl);
    const centerAll = iconButton(
      "w-icon-recenter",
      i18next.t("panel.lines.centerAll"),
      "wmegj-source-center",
    );
    centerAll.addEventListener("click", () => props.onCenterAll());
    const clear = iconButton(
      "w-icon-x",
      i18next.t("panel.lines.clearSource"),
      "wmegj-source-clear",
    );
    clear.addEventListener("click", () => props.onClearSource());
    this.cardEl.append(cardText, centerAll, clear);

    this.listEl = document.createElement("div");
    this.listEl.className = "wmegj-line-list";

    this.root.append(slowupsBtn, other, this.errorEl, this.cardEl, this.listEl);
  }

  /** Pre-fill the URL field (e.g. from the query param). */
  setUrl(url: string): void {
    // The wz host exposes `.value`; the plain-input fallback nests an <input>.
    (this.urlInputHost as unknown as { value?: string }).value = url;
    this.urlInputHost.setAttribute("value", url);
    const nested = this.urlInputHost.querySelector("input");
    if (nested) nested.value = url;
  }

  setSource(source: LoadedSource | null): void {
    this.cardEl.hidden = source === null;
    if (source) this.cardNameEl.textContent = sourceName(source);
  }

  setEntries(entries: readonly LineEntry[], progressOf: (id: string) => LineProgress): void {
    this.cardCountEl.textContent = i18next.t("panel.lines.lineCount", { count: entries.length });
    this.listEl.replaceChildren();
    if (entries.length === 0) {
      if (!this.cardEl.hidden) {
        const empty = document.createElement("p");
        empty.className = "wmegj-caption";
        empty.textContent = i18next.t("panel.lines.empty");
        this.listEl.appendChild(empty);
      }
      return;
    }
    for (const entry of entries) {
      const row = new LineRowView({
        entry,
        progress: progressOf(entry.id),
        onSelect: this.props.onSelect,
        onCenter: this.props.onCenterLine,
      });
      this.listEl.appendChild(row.root);
    }
  }

  showError(message: string): void {
    this.errorEl.textContent = i18next.t("panel.errors.loadUrl", { message });
  }

  clearError(): void {
    this.errorEl.textContent = "";
  }
}
```

Note: in the plain-HTML fallback `wzTextInput` returns a wrapper `<div>` holding the `<input>`; `keydown` from the input bubbles to the wrapper, and `readValue` reads the nested input — that is what the test exercises. The test's `input` event is irrelevant to `readValue` (it reads the live value) but documents user typing.

c) Locales — `panel.lines`:

- FR: `"loadSlowups": "Charger les slowUps"`, `"otherSource": "Autre source"`, `"chooseFile": "Choisir un fichier"`, `"fileFormats": "GeoJSON, GPX, KML ou KMZ"`, `"slowupsSource": "slowUps"`, `"lineCount_one": "{{count}} ligne"`, `"lineCount_other": "{{count}} lignes"`, `"clearSource": "Retirer cette source"`, `"centerAll": "Centrer sur toutes les lignes"`.
- EN: `"loadSlowups": "Load the slowUps"`, `"otherSource": "Other source"`, `"chooseFile": "Choose a file"`, `"fileFormats": "GeoJSON, GPX, KML or KMZ"`, `"slowupsSource": "slowUps"`, `"lineCount_one": "{{count}} line"`, `"lineCount_other": "{{count}} lines"`, `"clearSource": "Remove this source"`, `"centerAll": "Center on all lines"`.
- Delete from both: `panel.lines.urlLabel`, `panel.lines.urlClear`, `panel.lines.sourceFeature`, `panel.lines.sourceCollection` (no longer referenced; check with `grep -rn "lines.urlLabel\|lines.urlClear\|lines.source" src`).

d) Append to `BASE_CSS`:

```css
.wmegj-lines {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.wmegj-block-button {
  align-self: stretch;
}
.wmegj-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.wmegj-caption {
  margin: 0;
  font-size: 12px;
  color: var(--content_p3);
}
.wmegj-load-error {
  margin: 0;
  font-size: 12px;
  color: var(--alarming_variant);
}
.wmegj-load-error:empty {
  display: none;
}
.wmegj-source-card {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 4px 8px 12px;
  border-radius: 8px;
  background: var(--surface_default);
}
.wmegj-source-card[hidden] {
  display: none;
}
.wmegj-source-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--content_default);
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/LinesListView.test.ts src/__tests__/LineRowView.test.ts src/__tests__/styles.test.ts`
Expected: PASS. (`LinesSubTab.test.ts` mocks the view and may now fail type-wise only after Task 4; it still runs green here because the mock replaces the module.)

- [ ] **Step 5: Commit**

```bash
git add src locales
git commit -m "feat(ui): Lignes view with one-click slowUps and a single source card"
```

---

### Task 4: Wire the Lignes sub-tab

**Files:**

- Modify: `src/ui/subtabs/LinesSubTab.ts`, `src/ui/MatchPanel.ts`, `src/bootstrap/loadAndAttachTrack.ts:94`
- Test: `src/__tests__/LinesSubTab.test.ts`

**Interfaces:**

- Consumes: `LinesListView`/`LoadedSource` (Task 3), `lineProgress` (Task 1), `SLOWUPS_GEOJSON_URL`, `SourcePersistence` (existing, `load(id): Source | null`).
- Produces:
  - `LinesSubTabDeps.loadProgress: (id: string) => LineProgress` (new required dep)
  - `LinesSubTab.setUrlLoaded(url: string): void` (now takes the URL), `LinesSubTab.refresh(): void`
  - `MatchPanel.notifyUrlLoaded(url: string): void`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/LinesSubTab.test.ts`:

a) extend the mocked view instance type and factory with `setSource: vi.fn()`:

```ts
  linesListInstances: [] as Array<{
    root: HTMLElement;
    setEntries: ReturnType<typeof vi.fn>;
    setUrl: ReturnType<typeof vi.fn>;
    setSource: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    clearError: ReturnType<typeof vi.fn>;
  }>,
```

and in the `vi.mock("../ui/views/LinesListView", …)` factory add `setSource: vi.fn(),` to `instance`. Also make the mock keep the props: change `vi.fn().mockImplementation(() => {` to `vi.fn().mockImplementation((props: unknown) => {` and add `props,` to `instance` (and `props: unknown;` to the type).

b) every place that builds `new LinesSubTab({...})` must pass `loadProgress: () => ({ kind: "notStarted" })`. Find them with `grep -n "new LinesSubTab" src/__tests__/LinesSubTab.test.ts` and add the property.

c) append this block inside `describe("LinesSubTab", …)`:

```ts
it("names the source after a load and clears the matching kind of source", () => {
  const registry = new LineRegistry();
  const loadProgress = vi.fn(() => ({ kind: "inProgress", percent: 40 }) as const);
  const subTab = new LinesSubTab({
    registry,
    loadFn: vi.fn(),
    loadFileFn: vi.fn(),
    onLineSelected: vi.fn(),
    onCenterAll: vi.fn(),
    onCenterLine: vi.fn(),
    loadProgress,
  });
  const view = latestView();

  subTab.setUrlLoaded("https://schweizmobil.ch/api/4/slowups.geojson");
  expect(view.setSource).toHaveBeenLastCalledWith({ kind: "slowups" });
  subTab.setUrlLoaded("https://example.org/a.geojson");
  expect(view.setSource).toHaveBeenLastCalledWith({
    kind: "url",
    url: "https://example.org/a.geojson",
  });
  subTab.setLoadedFile("rallye.kmz");
  expect(view.setSource).toHaveBeenLastCalledWith({ kind: "file", name: "rallye.kmz" });

  registry.setEntries([makeEntry("line-1")]);
  const progressOf = view.setEntries.mock.calls.at(-1)?.[1] as (id: string) => unknown;
  expect(progressOf("line-1")).toEqual({ kind: "inProgress", percent: 40 });
  expect(loadProgress).toHaveBeenCalledWith("line-1");

  (view as unknown as { props: { onClearSource: () => void } }).props.onClearSource();
  expect(registry.getAll()).toEqual([]);
  expect(view.setSource).toHaveBeenLastCalledWith(null);
});

it("re-reads progress on refresh", () => {
  const registry = new LineRegistry();
  registry.setEntries([makeEntry("line-1")]);
  const subTab = new LinesSubTab({
    registry,
    loadFn: vi.fn(),
    loadFileFn: vi.fn(),
    onLineSelected: vi.fn(),
    onCenterAll: vi.fn(),
    onCenterLine: vi.fn(),
    loadProgress: () => ({ kind: "notStarted" }),
  });
  const view = latestView();
  const calls = view.setEntries.mock.calls.length;
  subTab.refresh();
  expect(view.setEntries.mock.calls.length).toBe(calls + 1);
});
```

This test file runs in the default node environment; `clearUploadedFile` touches `localStorage`. Add `// @vitest-environment happy-dom` as the file's first line if the "clears" assertion fails with `localStorage is not defined`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/LinesSubTab.test.ts`
Expected: FAIL — `setSource` never called, `refresh` is not a function.

- [ ] **Step 3: Implement `LinesSubTab`**

- Add to imports: `import type { LineProgress } from "../../domain/lineProgress";`, `import { SLOWUPS_GEOJSON_URL } from "../../lines/slowupClient";`, `import type { LoadedSource } from "../views/LinesListView";`.
- `LinesSubTabDeps` gains:

```ts
/** Matching progress of a line, read from its persisted session. */
loadProgress: (id: string) => LineProgress;
```

- Add a field `private source: LoadedSource | null = null;` and a render helper, and route every `this.view.setEntries(sortSlowupEntries(...))` call through it:

```ts
  private renderEntries(): void {
    this.view.setEntries(sortSlowupEntries(this.deps.registry.getAll()), this.deps.loadProgress);
  }

  /** Re-read progress (e.g. when the Lignes tab is shown again). */
  refresh(): void {
    this.renderEntries();
  }
```

In the constructor: replace the three `this.view.setEntries(sortSlowupEntries(…))` calls with `this.renderEntries();` (the `onLinesChanged` handler keeps its `void this.fetchSlowupDetailsForLines(entries)`).

- View props in the constructor become:

```ts
this.view = new LinesListView({
  onLoadUrl: (url) => void this.handleLoad(url),
  onLoadFile: (file) => void this.deps.loadFileFn(file),
  onClearSource: () => this.handleClearSource(),
  onSelect: (id) => this.handleSelect(id),
  onCenterAll: deps.onCenterAll,
  onCenterLine: deps.onCenterLine,
});
```

- Replace `setLoadedFile`, `setUrlLoaded`, `handleClearFile`, `handleClearUrl` with:

```ts
  /** Called by MatchPanel when a file is successfully loaded or restored. */
  setLoadedFile(name: string): void {
    this.setSource({ kind: "file", name });
  }

  /** Called by MatchPanel when a URL is successfully loaded (manual or auto). */
  setUrlLoaded(url: string): void {
    this.setSource(url === SLOWUPS_GEOJSON_URL ? { kind: "slowups" } : { kind: "url", url });
  }

  private setSource(source: LoadedSource | null): void {
    this.source = source;
    this.view.setSource(source);
  }

  private handleClearSource(): void {
    this.view.clearError();
    if (this.source?.kind === "file") {
      clearUploadedFile();
      this.deps.registry.setEntries([]);
    } else {
      this.view.setUrl("");
      clearLoadedUrl(this.deps.registry);
    }
    this.setSource(null);
  }
```

- [ ] **Step 4: Implement the wiring**

- `src/bootstrap/loadAndAttachTrack.ts:94`: `panel.notifyUrlLoaded();` → `panel.notifyUrlLoaded(url);`
- `src/ui/MatchPanel.ts`:
  - imports: `import { lineProgress } from "../domain/lineProgress";`, `import { SourcePersistence } from "../domain/SourcePersistence";`
  - `notifyUrlLoaded(): void { this.linesSubTab?.setUrlLoaded(); }` → `notifyUrlLoaded(url: string): void { this.linesSubTab?.setUrlLoaded(url); }`
  - in `mount()`, add to the `LinesSubTab` deps (a read-only instance: `load` only reads localStorage):

```ts
      loadProgress: (id) => lineProgress(progressReader.load(id)),
```

with `const progressReader = new SourcePersistence();` declared just before `this.linesSubTab = new LinesSubTab({`.

- in the `IntersectionObserver` callback, refresh the rows when the Lignes tab comes into view:

```ts
const observer = new IntersectionObserver((records) => {
  const becameVisible = !this.linesTabVisible && records.some((r) => r.isIntersecting);
  this.linesTabVisible = records.some((record) => record.isIntersecting);
  if (becameVisible) this.linesSubTab?.refresh();
  this.refreshPreview();
});
```

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all tests pass; only the pre-existing `waitForMapIdle.test.ts` type error.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(ui): Lignes tab tracks its source and shows per-line progress"
```

---

### Task 5: Matching header

**Files:**

- Rewrite: `src/ui/views/MatchingHeaderView.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (constructor, `buildDOM`, store subscription, `setController`, `updateBadge`, track length row), `src/ui/MatchPanel.ts`, `src/ui/styles.ts`, both locales
- Test: `src/__tests__/MatchingHeaderView.test.ts`

**Interfaces:**

- Consumes: `LineProgress`, `lineProgress` (Task 1).
- Produces:
  - `new MatchingHeaderView({ onBack(): void })` with `root`, `setTitle(name: string)`, `setSummary(km: number | null, progress: LineProgress)`
  - `MatchingSubTab` constructor gains a 4th parameter `onBackToLines: () => void`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/MatchingHeaderView.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MatchingHeaderView } from "../ui/views/MatchingHeaderView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

describe("MatchingHeaderView", () => {
  it("goes back to the Lignes tab", () => {
    const onBack = vi.fn();
    const header = new MatchingHeaderView({ onBack });
    header.root.querySelector<HTMLButtonElement>(".wmegj-back")!.click();
    expect(onBack).toHaveBeenCalled();
  });

  it("summarises length and progress on one line", () => {
    const header = new MatchingHeaderView({ onBack: vi.fn() });
    header.setTitle("SS7+11 Les Cols");
    const summary = () => header.root.querySelector(".wmegj-header-summary")?.textContent;

    header.setSummary(30.85, { kind: "notStarted" });
    expect(header.root.textContent).toContain("SS7+11 Les Cols");
    expect(summary()).toBe("30.85 km · Pas commencé");

    header.setSummary(30.85, { kind: "inProgress", percent: 40 });
    expect(summary()).toBe("30.85 km · 40 % validé");

    header.setSummary(null, { kind: "done" });
    expect(summary()).toBe("Correspondance terminée");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/MatchingHeaderView.test.ts`
Expected: FAIL — the current header has no `.wmegj-back` and no `setSummary`.

- [ ] **Step 3: Implement the view**

`src/ui/views/MatchingHeaderView.ts` (whole file):

```ts
// Header of the Matching sub-tab: back to the Lignes list, the line name,
// and "length · progress". The progress comes from the same persisted Source
// as the Lignes rows, so both always agree.

import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";

export class MatchingHeaderView {
  readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly summaryEl: HTMLElement;

  constructor(props: { onBack: () => void }) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-header";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "wmegj-back";
    const arrow = document.createElement("i");
    arrow.className = "w-icon w-icon-arrow-left";
    back.append(arrow, i18next.t("panel.matching.back"));
    back.addEventListener("click", () => props.onBack());

    this.titleEl = document.createElement("h3");
    this.titleEl.className = "wmegj-header-title";

    this.summaryEl = document.createElement("p");
    this.summaryEl.className = "wmegj-caption wmegj-header-summary";

    this.root.append(back, this.titleEl, this.summaryEl);
  }

  setTitle(name: string): void {
    this.titleEl.textContent = name;
  }

  setSummary(km: number | null, progress: LineProgress): void {
    const status =
      progress.kind === "done"
        ? i18next.t("panel.summary.done")
        : progress.kind === "inProgress"
          ? i18next.t("panel.summary.inProgress", { percent: progress.percent })
          : i18next.t("panel.summary.notStarted");
    // Once matching is done, the length is noise.
    const showLength = km !== null && progress.kind !== "done";
    this.summaryEl.textContent = showLength ? `${km.toFixed(2)} km · ${status}` : status;
  }
}
```

Locales:

- FR: `panel.matching.back` = `"Lignes"`; `panel.summary` = `{ "notStarted": "Pas commencé", "inProgress": "{{percent}} % validé", "done": "Correspondance terminée" }`.
- EN: `panel.matching.back` = `"Lines"`; `panel.summary` = `{ "notStarted": "Not started", "inProgress": "{{percent}}% validated", "done": "Matching done" }`.

CSS (append to `BASE_CSS`):

```css
.wmegj-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin-bottom: 12px;
}
.wmegj-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border: none;
  background: none;
  color: var(--primary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.wmegj-header-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--content_default);
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: Wire it into `MatchingSubTab` and `MatchPanel`**

In `src/ui/subtabs/MatchingSubTab.ts`:

- Constructor: add a 4th parameter `private readonly onBackToLines: () => void = () => {}`.
- Add `import { lineProgress } from "../../domain/lineProgress";`.
- `buildDOM`: `this.headerView = new MatchingHeaderView();` → `this.headerView = new MatchingHeaderView({ onBack: () => this.onBackToLines() });`. Delete the two lines that build/append `this.trackLengthRow`, and delete `buildTrackLengthRow()`, the `trackLengthRow` / `trackLengthValueEl` fields, their reset lines in `unmount()`, and `this.setRowVisible(this.trackLengthRow, atLeastTrackLoaded);` in `renderPhase`.
- Add a method and call it from the store subscription (replacing the `trackLengthValueEl` block) and from the `sourceStore.onChange` handler:

```ts
  /** Header line "30.85 km · 40 % validé", from the same Source as the Lignes rows. */
  private renderHeaderSummary(): void {
    this.headerView?.setSummary(
      this.store.getState().trackLengthKm,
      lineProgress(this.sourceStore.getSource()),
    );
  }
```

Store subscription becomes:

```ts
this.unsubscribeStore = this.store.subscribe((state) => {
  this.renderPhase(state.phase);
  this.renderHeaderSummary();
});
```

`sourceStore.onChange` handler gains `this.renderHeaderSummary();`.

- `setController`: delete the `unsubscribeState` subscription and the `this.updateBadge(c.state)` call (the walk state "En attente" disagreed with the matching state — spec §3). Delete `updateBadge()` and, if now unused, the `unsubscribeState` field and its `unmount` lines, and the `WalkState` import. Run `npx tsc --noEmit -p .` to find leftovers.

In `src/ui/MatchPanel.ts`, the construction becomes:

```ts
this.matchingSubTab = new MatchingSubTab(this.wmeSDK, this.store, this.registry, () =>
  this.tabs?.setActiveTab(0),
);
```

Delete the now-unused `panel.status.*` and `panel.trackLength` keys from both locales after checking `grep -rn "panel.status\.\|panel.trackLength" src` returns nothing.

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass; only the pre-existing type error.

- [ ] **Step 6: Commit**

```bash
git add src locales
git commit -m "feat(ui): Matching header with back link and one progress summary"
```

---

### Task 6: Planning CSV block

**Files:**

- Create: `src/ui/views/PlanningCsvView.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (`buildCsvUploadRow` and the `*Csv*` helpers), `src/ui/styles.ts`, both locales
- Test: `src/__tests__/PlanningCsvView.test.ts`

**Interfaces:**

- Consumes: `fileInput`, `wzLabel`.
- Produces: `new PlanningCsvView({ onFile(file: File): void; onRemove(): void })` with `root`, `setLoaded(loaded: boolean)`, `setLoading(loading: boolean)`, `showError(message: string)`, `clearError()`, `errorText(): string`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/PlanningCsvView.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PlanningCsvView } from "../ui/views/PlanningCsvView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

describe("PlanningCsvView", () => {
  it("offers one CSV file input, without a duplicate label", () => {
    const view = new PlanningCsvView({ onFile: vi.fn(), onRemove: vi.fn() });
    expect(view.root.querySelectorAll("input[type=file]")).toHaveLength(1);
    expect(view.root.querySelector<HTMLInputElement>("input[type=file]")!.accept).toBe(".csv");
    expect(view.root.textContent).not.toContain("Importer le CSV de planning");
  });

  it("swaps the input for a removable chip once loaded", () => {
    const onRemove = vi.fn();
    const view = new PlanningCsvView({ onFile: vi.fn(), onRemove });
    const chip = () => view.root.querySelector<HTMLElement>(".wmegj-chip")!;
    const input = () => view.root.querySelector<HTMLElement>(".wmegj-planning-input")!;

    expect(chip().hidden).toBe(true);
    view.setLoaded(true);
    expect(chip().hidden).toBe(false);
    expect(input().hidden).toBe(true);
    expect(chip().textContent).toContain("Planning chargé");

    chip().querySelector<HTMLButtonElement>("button")!.click();
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows loading and errors", () => {
    const view = new PlanningCsvView({ onFile: vi.fn(), onRemove: vi.fn() });
    view.setLoading(true);
    expect(view.root.querySelector<HTMLElement>(".wmegj-planning-loading")!.hidden).toBe(false);
    view.showError("Ligne 3 invalide");
    expect(view.errorText()).toBe("Ligne 3 invalide");
    view.clearError();
    expect(view.errorText()).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/PlanningCsvView.test.ts`
Expected: FAIL — cannot resolve `../ui/views/PlanningCsvView`.

- [ ] **Step 3: Implement the view**

`src/ui/views/PlanningCsvView.ts`:

```ts
// Planning CSV (roadbook schedule) for non-slowUp lines: WME's file input
// until a CSV is loaded, then a removable chip. Pure DOM.

import { i18next } from "../../../locales/i18n";
import { fileInput, wzLabel } from "../components/wz";

export class PlanningCsvView {
  readonly root: HTMLElement;
  private readonly inputWrap: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly loadingEl: HTMLElement;
  private readonly errorEl: HTMLElement;

  constructor(props: { onFile: (file: File) => void; onRemove: () => void }) {
    this.root = document.createElement("section");
    this.root.className = "wmegj-section";
    this.root.appendChild(wzLabel(i18next.t("panel.csvInput.title")));

    this.inputWrap = document.createElement("div");
    this.inputWrap.className = "wmegj-planning-input";
    this.inputWrap.appendChild(
      fileInput({
        accept: ".csv",
        buttonLabel: i18next.t("panel.csvInput.label"),
        onFile: props.onFile,
      }),
    );

    this.chip = document.createElement("div");
    this.chip.className = "wmegj-chip";
    this.chip.hidden = true;
    const chipText = document.createElement("span");
    chipText.textContent = i18next.t("panel.csvInput.loaded");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "wmegj-chip-remove";
    remove.title = i18next.t("panel.csvInput.remove");
    const x = document.createElement("i");
    x.className = "w-icon w-icon-x";
    remove.appendChild(x);
    remove.addEventListener("click", () => props.onRemove());
    this.chip.append(chipText, remove);

    this.loadingEl = document.createElement("p");
    this.loadingEl.className = "wmegj-caption wmegj-planning-loading";
    this.loadingEl.textContent = i18next.t("panel.csvInput.loading");
    this.loadingEl.hidden = true;

    this.errorEl = document.createElement("p");
    this.errorEl.className = "wmegj-load-error";
    this.errorEl.style.whiteSpace = "pre-line";

    this.root.append(this.inputWrap, this.chip, this.loadingEl, this.errorEl);
  }

  setLoaded(loaded: boolean): void {
    this.chip.hidden = !loaded;
    this.inputWrap.hidden = loaded;
  }

  setLoading(loading: boolean): void {
    this.loadingEl.hidden = !loading;
  }

  showError(message: string): void {
    this.errorEl.textContent = message;
  }

  clearError(): void {
    this.errorEl.textContent = "";
  }

  errorText(): string {
    return this.errorEl.textContent ?? "";
  }
}
```

Locales — `panel.csvInput`: FR `"title": "Planning (optionnel)"`, `"loaded": "Planning chargé"`; EN `"title": "Schedule (optional)"`, `"loaded": "Schedule loaded"`. Keep `label`, `remove`, `loading`, `error`.

CSS (append to `BASE_CSS`):

```css
.wmegj-panel-root [hidden],
.wmegj-dialog-body [hidden] {
  display: none !important;
}
.wmegj-chip {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 12px;
  border-radius: 100px;
  background: var(--surface_default);
  color: var(--content_p1);
  font-size: 13px;
}
.wmegj-chip-remove {
  display: inline-flex;
  border: none;
  background: none;
  color: var(--content_p2);
  cursor: pointer;
  padding: 2px;
}
```

- [ ] **Step 4: Wire it into `MatchingSubTab`**

- Add field `private planningCsv: PlanningCsvView | null = null;` and import the view.
- Replace the body of `buildCsvUploadRow()` with:

```ts
  private buildCsvUploadRow(): HTMLElement {
    this.planningCsv = new PlanningCsvView({
      onFile: (file) => this.onCsvFileSelected(file),
      onRemove: () => this.removeCsv(),
    });
    return this.planningCsv.root;
  }
```

- Replace the helper bodies:

```ts
  private setRemoveCsvVisible(visible: boolean): void {
    this.planningCsv?.setLoaded(visible);
  }

  private showCsvError(message: string): void {
    this.planningCsv?.showError(message);
  }

  private clearCsvError(): void {
    this.planningCsv?.clearError();
  }

  private showCsvLoading(): void {
    this.planningCsv?.setLoading(true);
  }

  private hideCsvLoading(): void {
    this.planningCsv?.setLoading(false);
  }
```

- In `reportCsvWarning`: `const existing = this.csvErrorEl?.textContent;` → `const existing = this.planningCsv?.errorText();`.
- Delete the fields `csvErrorEl`, `csvLoadingEl`, `csvRemoveBtn` and their `unmount` lines; set `this.planningCsv = null;` in `unmount`.

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass; only the pre-existing type error.

- [ ] **Step 6: Commit**

```bash
git add src locales
git commit -m "feat(ui): planning CSV as WME file input, then a removable chip"
```

---

### Task 7: Two-handle distance slider

**Files:**

- Create: `src/ui/views/RangeSliderView.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (`buildRangeSlider`), `src/ui/styles.ts`
- Test: `src/__tests__/RangeSliderView.test.ts`

**Interfaces:**

- Produces: `createRangeSlider(props: { totalKm: number; originKm: number; onChange(lo: number, hi: number): void }): HTMLElement` — `lo`/`hi` in display-geometry km (without `originKm`), `lo ≤ hi` always.

- [ ] **Step 1: Write the failing test**

`src/__tests__/RangeSliderView.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRangeSlider } from "../ui/views/RangeSliderView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

function setup(originKm = 0) {
  const onChange = vi.fn();
  const root = createRangeSlider({ totalKm: 30, originKm, onChange });
  const [min, max] = [...root.querySelectorAll<HTMLInputElement>("input[type=range]")];
  const move = (input: HTMLInputElement, value: number) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input"));
  };
  return { root, min, max, move, onChange };
}

describe("createRangeSlider", () => {
  it("puts both handles on one track", () => {
    const { root } = setup();
    expect(root.querySelectorAll(".wmegj-range input[type=range]")).toHaveLength(2);
  });

  it("reports the window and shows it with the roadbook origin", () => {
    const { root, min, move, onChange } = setup(12);
    move(min, 5);
    expect(onChange).toHaveBeenLastCalledWith(5, 30);
    expect(root.textContent).toContain("17.00 km – 42.00 km");
  });

  it("never lets the start pass the end", () => {
    const { min, max, move, onChange } = setup();
    move(max, 10);
    move(min, 20);
    expect(onChange).toHaveBeenLastCalledWith(10, 10);
    expect(min.value).toBe("10");
  });

  it("colours the selected part of the track", () => {
    const { root, min, max, move } = setup();
    move(min, 3);
    move(max, 15);
    const fill = root.querySelector<HTMLElement>(".wmegj-range-fill")!;
    expect(fill.style.left).toBe("10%");
    expect(fill.style.width).toBe("40%");
  });
});
```

Check the existing `panel.range.window` text before running: `grep -n '"window"' locales/fr/common.json`. The test assumes `"{{min}} km – {{max}} km"`; if the key reads differently, adjust the expected string in the test to the real format (do not change the key).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/RangeSliderView.test.ts`
Expected: FAIL — cannot resolve `../ui/views/RangeSliderView`.

- [ ] **Step 3: Implement**

`src/ui/views/RangeSliderView.ts`:

```ts
// Visible-distance window: two range inputs stacked on one track, so the
// operator drags a start and an end handle on the same bar.

import { i18next } from "../../../locales/i18n";
import { wzLabel } from "../components/wz";

export function createRangeSlider(props: {
  totalKm: number;
  /** Roadbook km at the start of the display geometry (labels only). */
  originKm: number;
  onChange: (lo: number, hi: number) => void;
}): HTMLElement {
  const { totalKm, originKm } = props;
  const section = document.createElement("section");
  section.className = "wmegj-section";

  const valueLabel = document.createElement("p");
  valueLabel.className = "wmegj-caption";

  const range = document.createElement("div");
  range.className = "wmegj-range";
  const track = document.createElement("div");
  track.className = "wmegj-range-track";
  const fill = document.createElement("div");
  fill.className = "wmegj-range-fill";

  const makeInput = (value: number): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(totalKm);
    input.step = "0.01";
    input.value = String(value);
    return input;
  };
  const minInput = makeInput(0);
  const maxInput = makeInput(totalKm);
  range.append(track, fill, minInput, maxInput);

  const render = (lo: number, hi: number): void => {
    valueLabel.textContent = i18next.t("panel.range.window", {
      min: (lo + originKm).toFixed(2),
      max: (hi + originKm).toFixed(2),
    });
    fill.style.left = `${(lo / totalKm) * 100}%`;
    fill.style.width = `${((hi - lo) / totalKm) * 100}%`;
  };

  const onInput = (moved: HTMLInputElement) => (): void => {
    let lo = Number(minInput.value);
    let hi = Number(maxInput.value);
    // Clamp the handle being dragged against the other one.
    if (lo > hi) {
      if (moved === minInput) {
        lo = hi;
        minInput.value = String(lo);
      } else {
        hi = lo;
        maxInput.value = String(hi);
      }
    }
    render(lo, hi);
    props.onChange(lo, hi);
  };
  minInput.addEventListener("input", onInput(minInput));
  maxInput.addEventListener("input", onInput(maxInput));

  render(0, totalKm);
  section.append(wzLabel(i18next.t("panel.range.title")), valueLabel, range);
  return section;
}
```

CSS (append to `BASE_CSS`):

```css
.wmegj-range {
  position: relative;
  height: 24px;
}
.wmegj-range-track,
.wmegj-range-fill {
  position: absolute;
  top: 50%;
  height: 4px;
  margin-top: -2px;
  border-radius: 2px;
}
.wmegj-range-track {
  left: 0;
  right: 0;
  background: var(--hairline);
}
.wmegj-range-fill {
  background: var(--primary);
}
.wmegj-range input[type="range"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 24px;
  margin: 0;
  background: none;
  pointer-events: none;
  -webkit-appearance: none;
  appearance: none;
}
.wmegj-range input[type="range"]::-webkit-slider-runnable-track {
  background: none;
}
.wmegj-range input[type="range"]::-webkit-slider-thumb {
  pointer-events: auto;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border: 2px solid var(--background_default);
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}
.wmegj-range input[type="range"]::-moz-range-thumb {
  pointer-events: auto;
  width: 12px;
  height: 12px;
  border: 2px solid var(--background_default);
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
}
```

- [ ] **Step 4: Use it in `MatchingSubTab.buildRangeSlider`**

Replace everything after the `originKm` computation (heading, label, both inputs, `apply`, listeners, appends) with:

```ts
let pendingFrame = 0;
let pendingLo = 0;
let pendingHi = totalKm;
const layer = this.trackLayer;
return createRangeSlider({
  totalKm,
  originKm,
  onChange: (lo, hi) => {
    pendingLo = lo;
    pendingHi = hi;
    // Redraw at most once per frame while dragging.
    if (pendingFrame !== 0) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      layer.setVisibleRange(pendingLo, pendingHi);
    });
  },
});
```

The early-return branches (`!this.trackLayer`, `totalKm <= 0`) keep returning the empty `section`; give that section `className = "wmegj-section"` and drop its `style.marginTop`. Import `createRangeSlider`.

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass; only the pre-existing type error.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(ui): two-handle distance slider on a single track"
```

---

### Task 8: Three numbered steps

**Files:**

- Create: `src/ui/views/MatchingStepsView.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (start row, resume banner, download row, linked MTE, closure buttons, `renderPhase`, `unmount`), `src/ui/styles.ts`, both locales
- Test: `src/__tests__/MatchingStepsView.test.ts`

**Interfaces:**

- Consumes: `LineProgress`, `lineProgress`, `wzButton`.
- Produces:
  - `type LinkedMte = { name: string | null } | null` — `null`: no MTE linked; `{ name: null }`: linked but not loaded in WME.
  - `interface StepsState { matching: LineProgress; resumeAt: { line: number; subLine: number } | null; linkedMte: LinkedMte; canPrepareMte: boolean; applying: boolean }`
  - `nextStep(state: StepsState): 1 | 2 | 3`
  - `class MatchingStepsView { root; applyStatusEl: HTMLElement; constructor(props: { onOpenMatching(): void; onPrepareMte(): void; onApply(): void; onDownloadCsv(): void }); setState(state: StepsState): void }`

- [ ] **Step 1: Write the failing test**

`src/__tests__/MatchingStepsView.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MatchingStepsView, nextStep, type StepsState } from "../ui/views/MatchingStepsView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

const base: StepsState = {
  matching: { kind: "notStarted" },
  resumeAt: null,
  linkedMte: null,
  canPrepareMte: true,
  applying: false,
};

function setup(state: Partial<StepsState>) {
  const props = {
    onOpenMatching: vi.fn(),
    onPrepareMte: vi.fn(),
    onApply: vi.fn(),
    onDownloadCsv: vi.fn(),
  };
  const view = new MatchingStepsView(props);
  view.setState({ ...base, ...state });
  const steps = [...view.root.querySelectorAll<HTMLElement>(".wmegj-step")];
  const primary = view.root.querySelectorAll(".wmegj-button--primary");
  return { view, props, steps, primary };
}

describe("nextStep", () => {
  it("is matching until it is done, then the MTE, then the closures", () => {
    expect(nextStep(base)).toBe(1);
    expect(nextStep({ ...base, matching: { kind: "inProgress", percent: 50 } })).toBe(1);
    expect(nextStep({ ...base, matching: { kind: "done" } })).toBe(2);
    expect(nextStep({ ...base, matching: { kind: "done" }, linkedMte: { name: null } })).toBe(3);
  });
});

describe("MatchingStepsView", () => {
  it("has exactly one primary action: the next step's", () => {
    const { steps, primary } = setup({});
    expect(steps).toHaveLength(3);
    expect(primary).toHaveLength(1);
    expect(steps[0].contains(primary[0])).toBe(true);
    expect(steps[0].classList.contains("is-next")).toBe(true);
  });

  it("resumes where the session stopped", () => {
    const { steps, props } = setup({
      matching: { kind: "inProgress", percent: 40 },
      resumeAt: { line: 1, subLine: 8 },
    });
    const button = steps[0].querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Reprendre (ligne 1 / sous-ligne 8)");
    button.click();
    expect(props.onOpenMatching).toHaveBeenCalled();
  });

  it("keeps closures available without an MTE once matching is done", () => {
    const { steps, primary, props } = setup({ matching: { kind: "done" } });
    expect(steps[0].classList.contains("is-done")).toBe(true);
    expect(steps[1].contains(primary[0])).toBe(true);
    const apply = steps[2].querySelector<HTMLButtonElement>(".wmegj-button--secondary")!;
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(props.onApply).toHaveBeenCalled();
  });

  it("blocks closures until matching is done, and while applying", () => {
    const notDone = setup({ matching: { kind: "inProgress", percent: 10 } });
    for (const button of notDone.steps[2].querySelectorAll<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
    }
    const applying = setup({
      matching: { kind: "done" },
      linkedMte: { name: "x" },
      applying: true,
    });
    for (const button of applying.steps[2].querySelectorAll<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
    }
  });

  it("names the linked MTE, and never shows its id", () => {
    const named = setup({ matching: { kind: "done" }, linkedMte: { name: "RIV 2026 SS7+11" } });
    expect(named.steps[1].textContent).toContain("RIV 2026 SS7+11");
    expect(named.steps[1].classList.contains("is-done")).toBe(true);

    const unloaded = setup({ linkedMte: { name: null } });
    expect(unloaded.steps[1].textContent).toContain("MTE associé");
    expect(unloaded.steps[1].textContent).not.toMatch(/\d\.\d\.[0-9a-f]{8}/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/MatchingStepsView.test.ts`
Expected: FAIL — cannot resolve `../ui/views/MatchingStepsView`.

- [ ] **Step 3: Implement the view**

`src/ui/views/MatchingStepsView.ts`:

```ts
// The Matching sidebar's three steps — 1. Correspondance, 2. MTE,
// 3. Fermetures — each ticked when done, with a single primary button: the
// next step's. Pure DOM; MatchingSubTab computes the state.

import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { wzButton } from "../components/wz";

/** null: no MTE linked. `name: null`: linked, but not loaded in WME. */
export type LinkedMte = { name: string | null } | null;

export interface StepsState {
  matching: LineProgress;
  resumeAt: { line: number; subLine: number } | null;
  linkedMte: LinkedMte;
  canPrepareMte: boolean;
  applying: boolean;
}

export function nextStep(state: StepsState): 1 | 2 | 3 {
  if (state.matching.kind !== "done") return 1;
  if (state.linkedMte === null) return 2;
  return 3;
}

type Variant = "primary" | "secondary";

/** Switch a wz-button (or its fallback <button>) between primary and secondary. */
function setVariant(button: HTMLElement, variant: Variant): void {
  button.setAttribute("color", variant);
  (button as unknown as { color?: string }).color = variant;
  button.classList.toggle("wmegj-button--primary", variant === "primary");
  button.classList.toggle("wmegj-button--secondary", variant === "secondary");
}

function setDisabled(button: HTMLElement, disabled: boolean): void {
  button.toggleAttribute("disabled", disabled);
  (button as unknown as { disabled?: boolean }).disabled = disabled;
}

function setText(button: HTMLElement, text: string): void {
  button.textContent = text;
  (button as unknown as { text?: string }).text = text;
}

interface StepParts {
  root: HTMLElement;
  badge: HTMLElement;
  note: HTMLElement;
}

function buildStep(number: number, title: string, ...content: HTMLElement[]): StepParts {
  const root = document.createElement("div");
  root.className = "wmegj-step";
  const header = document.createElement("div");
  header.className = "wmegj-step-header";
  const badge = document.createElement("span");
  badge.className = "wmegj-step-badge";
  badge.textContent = String(number);
  const titleEl = document.createElement("span");
  titleEl.className = "wmegj-step-title";
  titleEl.textContent = title;
  header.append(badge, titleEl);
  const note = document.createElement("p");
  note.className = "wmegj-caption";
  root.append(header, note, ...content);
  return { root, badge, note };
}

export class MatchingStepsView {
  readonly root: HTMLElement;
  /** Progress / report of "Appliquer" — written by MatchingSubTab. */
  readonly applyStatusEl: HTMLElement;
  private readonly steps: StepParts[];
  private readonly matchingBtn: HTMLElement;
  private readonly mteBtn: HTMLElement;
  private readonly applyBtn: HTMLElement;
  private readonly csvBtn: HTMLElement;

  constructor(props: {
    onOpenMatching: () => void;
    onPrepareMte: () => void;
    onApply: () => void;
    onDownloadCsv: () => void;
  }) {
    this.matchingBtn = wzButton({ text: "", variant: "primary", onClick: props.onOpenMatching });
    this.mteBtn = wzButton({
      text: i18next.t("panel.steps.prepareMte"),
      variant: "secondary",
      onClick: props.onPrepareMte,
    });
    this.applyBtn = wzButton({
      text: i18next.t("panel.applyClosures"),
      variant: "secondary",
      onClick: props.onApply,
    });
    this.csvBtn = wzButton({
      text: i18next.t("panel.steps.csvFallback"),
      variant: "text",
      onClick: props.onDownloadCsv,
    });
    this.applyStatusEl = document.createElement("div");
    this.applyStatusEl.className = "wmegj-caption wmegj-apply-status";

    this.steps = [
      buildStep(1, i18next.t("panel.steps.matching"), this.matchingBtn),
      buildStep(2, i18next.t("panel.steps.mte"), this.mteBtn),
      buildStep(
        3,
        i18next.t("panel.steps.closures"),
        this.applyBtn,
        this.csvBtn,
        this.applyStatusEl,
      ),
    ];

    this.root = document.createElement("div");
    this.root.className = "wmegj-steps";
    this.root.append(...this.steps.map((step) => step.root));
  }

  setState(state: StepsState): void {
    const next = nextStep(state);
    const matchingDone = state.matching.kind === "done";
    const done = [matchingDone, state.linkedMte !== null, false];
    this.steps.forEach((step, index) => {
      step.root.classList.toggle("is-next", index + 1 === next);
      step.root.classList.toggle("is-done", done[index]);
      step.badge.textContent = done[index] ? "✓" : String(index + 1);
    });

    // 1. Matching
    setText(this.matchingBtn, this.matchingLabel(state));
    setVariant(this.matchingBtn, next === 1 ? "primary" : "secondary");

    // 2. MTE
    this.steps[1].note.textContent = this.mteNote(state.linkedMte);
    setVariant(this.mteBtn, next === 2 ? "primary" : "secondary");
    setDisabled(this.mteBtn, !state.canPrepareMte);
    this.mteBtn.title = state.canPrepareMte ? "" : i18next.t("panel.matching.prepareMteDisabled");

    // 3. Closures — usable without an MTE once matching is complete.
    const closuresBlocked = !matchingDone || state.applying;
    setVariant(this.applyBtn, next === 3 ? "primary" : "secondary");
    setDisabled(this.applyBtn, closuresBlocked);
    setDisabled(this.csvBtn, closuresBlocked);
    const blockedTitle = matchingDone ? "" : i18next.t("panel.applyClosuresDisabled");
    this.applyBtn.title = blockedTitle;
    this.csvBtn.title = blockedTitle;
  }

  private matchingLabel(state: StepsState): string {
    if (state.resumeAt) return i18next.t("panel.steps.resume", state.resumeAt);
    if (state.matching.kind === "done") return i18next.t("panel.steps.review");
    return i18next.t("panel.steps.open");
  }

  private mteNote(linked: LinkedMte): string {
    if (linked === null) return "";
    if (linked.name) return i18next.t("panel.steps.mteLinked", { name: linked.name });
    return i18next.t("panel.steps.mteLinkedUnloaded");
  }
}
```

Locales — add `panel.steps`:

- FR: `{ "matching": "Correspondance", "mte": "MTE", "closures": "Fermetures", "open": "Ouvrir la correspondance", "resume": "Reprendre (ligne {{line}} / sous-ligne {{subLine}})", "review": "Revoir la correspondance", "prepareMte": "Préparer le MTE", "mteLinked": "Associé : {{name}}", "mteLinkedUnloaded": "MTE associé (ouvrez l'onglet Événements pour voir son nom)", "csvFallback": "CSV de secours" }`
- EN: `{ "matching": "Matching", "mte": "MTE", "closures": "Closures", "open": "Open matching", "resume": "Resume (line {{line}} / sub-line {{subLine}})", "review": "Review matching", "prepareMte": "Prepare the MTE", "mteLinked": "Linked: {{name}}", "mteLinkedUnloaded": "MTE linked (open the Events tab to see its name)", "csvFallback": "Fallback CSV" }`

CSS (append to `BASE_CSS`):

```css
.wmegj-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wmegj-step {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: var(--background_variant);
}
.wmegj-step.is-next {
  background: var(--background_default);
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.wmegj-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wmegj-step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface_variant);
  color: var(--content_p1);
  font-size: 12px;
  font-weight: 500;
}
.wmegj-step.is-next .wmegj-step-badge {
  background: var(--primary);
  color: var(--always_white);
}
.wmegj-step.is-done .wmegj-step-badge {
  background: var(--safe);
  color: var(--always_white);
}
.wmegj-step-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--content_default);
}
.wmegj-step .wmegj-caption:empty {
  display: none;
}
.wmegj-steps wz-button,
.wmegj-steps .wmegj-button {
  max-width: 100%;
}
.wmegj-apply-status {
  white-space: pre-line;
}
.wmegj-apply-status:empty {
  display: none;
}
```

- [ ] **Step 4: Wire it into `MatchingSubTab`**

- Import `MatchingStepsView`, `type LinkedMte` and `lineProgress`; add field `private stepsView: MatchingStepsView | null = null;`.
- `buildDOM`: delete the `resumeBannerRow`, `startMatchingRow` and `downloadRow` build/append lines; after the range slider append:

```ts
this.stepsView = new MatchingStepsView({
  onOpenMatching: () => this.openMatchingPanel(),
  onPrepareMte: () => void this.openMtePopup(),
  onApply: () => void this.onApplyClosuresClick(),
  onDownloadCsv: () => this.onDownloadClosuresClick(),
});
this.applyClosuresStatusEl = this.stepsView.applyStatusEl;
body.appendChild(this.stepsView.root);
```

- Add:

```ts
  /** Linked MTE for the steps view: name when WME has it loaded, never the raw id. */
  private linkedMteOf(entry: LineEntry | null): LinkedMte {
    const mteId = entry ? mteStore.get(mteKeyOf(entry)) : undefined;
    if (!mteId) return null;
    const mte = this.wmeSDK.DataModel.MajorTrafficEvents.getById({ majorTrafficEventId: mteId });
    const name = mte ? pickName(mte.names) : "";
    return { name: name || null };
  }

  private renderSteps(): void {
    const entry = this.registry.getSelected();
    const source = this.sourceStore.getSource();
    const matching = lineProgress(source);
    const cursor = source?.cursor ?? null;
    const resumeAt =
      matching.kind === "inProgress" && cursor !== null
        ? { line: cursor.lineIndex + 1, subLine: cursor.subLineIndex + 1 }
        : null;
    this.stepsView?.setState({
      matching,
      resumeAt,
      linkedMte: this.linkedMteOf(entry),
      canPrepareMte: entry !== null,
      applying: this.applyingClosures,
    });
  }
```

- Replace the bodies so everything goes through `renderSteps()`:
  - `updateClosureButtons()` → `{ this.renderSteps(); }`
  - `updateLinkedMte(entry)` → `{ this.renderSteps(); }` (keep the signature; callers stay unchanged)
  - `updatePrepareMteBtn(entry)` → `{ this.renderSteps(); }`
- `sourceStore.onChange` handler already calls `updateClosureButtons()` → steps re-render on every source change.
- Delete `buildStartMatchingRow`, `buildResumeBannerRow`, `renderResumeBanner`, `hideResumeBanner`, `buildDownloadRow` and every call to them (`onSelectedLineChangedAsync` resume-banner branch, `rebuildSourceWithCsv`'s `this.hideResumeBanner();`). The resume point now appears on the step 1 button.
- Delete the fields `startMatchingRow`, `downloadRow`, `resumeBannerRow`, `prepareMteBtn`, `applyClosuresBtn`, `downloadClosuresBtn`, `linkedMteEl` and their `unmount` lines; add `this.stepsView = null;` to `unmount`. Keep `applyClosuresStatusEl` (now the view's element) and `applyingClosures`.
- `renderPhase`: replace the two `setRowVisible(this.startMatchingRow…)` / `setRowVisible(this.downloadRow…)` lines with `this.setRowVisible(this.stepsView?.root ?? null, atLeastCsvLoaded);`.
- Run `npx tsc --noEmit -p .` and remove what it reports as unused (e.g. `panel.openMatchingPanel` / `panel.downloadClosures` / `panel.matching.resumeBanner` / `panel.matching.linkedMte` keys from both locales once `grep` confirms no reference).

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass; only the pre-existing type error.

- [ ] **Step 6: Commit**

```bash
git add src locales
git commit -m "feat(ui): Matching sidebar as three numbered steps with one primary action"
```

---

### Task 9: Drop the legacy sidebar CSS

**Files:**

- Modify: `src/ui/MatchPanel.ts` (`injectShellStyles`), `src/ui/subtabs/MatchingSubTab.ts` (`injectStyles`), `src/ui/styles.ts`
- Test: `src/__tests__/styles.test.ts`

**Interfaces:**

- Consumes: `injectStyles`, `BASE_CSS`.

- [ ] **Step 1: Write the failing test**

Append inside `describe("injectStyles", …)` in `src/__tests__/styles.test.ts`:

```ts
it("styles the sidebar panel root without horizontal overflow", () => {
  expect(BASE_CSS).toMatch(/\.wmegj-panel-root \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/styles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

a) Prepend to `BASE_CSS`:

```css
.wmegj-panel-root {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
  color: var(--content_p1);
}
.wmegj-panel-root *,
.wmegj-panel-root *::before,
.wmegj-panel-root *::after {
  box-sizing: border-box;
}
.wmegj-panel-root wz-button {
  max-width: 100%;
}
```

b) `MatchPanel.ts`: delete `injectShellStyles` and its call; call `injectStyles(document)` in `mount()` instead (import from `./styles`). Keep only the fallback-tabs rule `.wmegj-subtab-toggle …` by moving it into `BASE_CSS` with token colours:

```css
.wmegj-subtab-toggle {
  display: flex;
  margin: 10px 0 12px;
  border-bottom: 1px solid var(--separator_default);
}
.wmegj-subtab-toggle button {
  flex: 1;
  padding: 8px 6px;
  border: none;
  background: none;
  color: var(--content_p2);
  cursor: pointer;
}
.wmegj-subtab-toggle button.wmegj-subtab-active {
  color: var(--primary);
  box-shadow: inset 0 -2px 0 var(--primary);
}
```

c) `MatchingSubTab.injectStyles`: delete the sidebar rules (`.wmegj-panel-root`, `.wmegj-panel-root *`, `.wmegj-panel-title`, `.wmegj-section`, `.wmegj-section p`, `.wmegj-input-group`, `.wmegj-input-label`, `.wmegj-text-input*`, `.wmegj-button*`, `.wmegj-button-stack`) and keep every `.wmegj-guided-*` rule (the floating panel is batch C). Keep the plain-HTML fallback button look by adding to `BASE_CSS`:

```css
.wmegj-button {
  min-height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 100px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.wmegj-button--primary {
  background: var(--primary);
  color: var(--always_white);
}
.wmegj-button--secondary,
.wmegj-button--danger {
  background: var(--surface_default);
  color: var(--primary);
}
.wmegj-button--danger {
  color: var(--alarming_variant);
}
.wmegj-button--text {
  padding: 0;
  background: none;
  color: var(--primary);
}
.wmegj-button:disabled {
  opacity: 0.5;
  cursor: default;
}
```

d) Check: `grep -n "#[0-9a-fA-F]\{3,6\}" src/ui/MatchPanel.ts src/ui/views/*.ts` returns nothing (inline hex left in views/shell).

- [ ] **Step 4: Run tests, type-check, build**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run compile`
Expected: all pass; bundle written.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(ui): sidebar styles from the shared WME-token stylesheet"
```

---

### Task 10: Browser verification of batch B

**Files:** none new (fixes only, each with a regression test first).

- [ ] **Step 1: Static checks**

Run: `npx eslint $(git diff --name-only --diff-filter=d master...HEAD | grep -E "\.ts$") && npx tsc --noEmit -p . && npx vitest run && npm run compile`
Expected: changed files lint clean, only the pre-existing type error, all tests pass, bundle written.

- [ ] **Step 2: Reload WME and check the Lignes tab**

Reload the WME tab (dev userscript `@require`s `.out/main.user.js`), open Scripts → Event Closures. Take a screenshot first in each check (the tab only renders while visible). Check:

- "Charger les slowUps" loads the slowUps: rows with title + date, sorted by date; the card reads "slowUps · n lignes".
- A pasted URL + Enter loads it; the card shows its host.
- "Choisir un fichier" is WME's file input; loading a KMZ from the repo works and the card shows the file name.
- × on the card empties the list; recenter icon zooms to all lines.
- A line with a saved session shows "NN %" or "✓ Terminé".
- **No horizontal scroll:** `document.querySelector('#user-tabs .tab-pane.active, .wmegj-panel-root').scrollWidth <= clientWidth` for the script's tab pane (run in the page via JS), and no scrollbar visible in the screenshot.

Restore the user's original source afterwards (the Rallye KMZ was loaded when batch B started) if the checks replaced it.

- [ ] **Step 3: Check the Matching tab**

Select a line and check: "← Lignes" goes back; header "km · status" agrees with the row's progress; planning CSV shows WME's file input (non-slowUp line) and the chip after loading a CSV (then remove it — **removing the CSV rebuilds the session**: only do it on a line without useful progress, or skip); the slider has two handles on one bar and both move; the three steps show one primary button; the linked MTE shows a name or "MTE associé (…)" — never a UUID; no horizontal scroll.

Do **not** click "Appliquer" through to the end, nor "Recommencer à zéro".

- [ ] **Step 4: Fix and commit each issue found** (`fix(ui): …`, with a regression test first).
