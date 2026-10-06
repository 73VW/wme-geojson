# WME Event Closures — UI overhaul, batch D (native look pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lignes list, the Matching sidebar and the matching panel use the same building blocks as WME's own feature panels, as observed in the editor on 2026-10-05, and remove the redundancies found while testing batch C.

**Architecture:** Views switch from hand-styled `div`s to WME web components already registered on the page: `wz-list` / `wz-list-item` (venue "Noms alternatifs" / "Points d'entrée" lists), `wz-card` (EV station "Chargeurs" cards), `wz-button color="shadowed" size="sm"` icon actions, `wz-label` section titles, `wz-subhead5` card titles, `wz-caption`. Unregistered in happy-dom, these tags behave as plain elements, so view tests keep working through classes and attributes. The panel's texts stay in pure helpers (`src/ui/matchingPanelText.ts`).

**Tech Stack:** TypeScript (strict), vitest + happy-dom, i18next, WME web components.

**Spec:** `docs/superpowers/specs/2026-10-05-event-closures-ui-overhaul-design.md` (sections 2–4) + the "Native reference (batch D)" section below, which supersedes the batch B look of the Lignes list and step cards.

## Native reference (batch D) — observed in WME

- **Lists** (venue → Général → "Noms alternatifs", "Points d'entrée"): `<wz-list>` (white, top/bottom `--separator_default` border, 0 16px padding) of `<wz-list-item>` rows (61 px, separator between rows). Row content in `slot="item-key"`, actions in `slot="actions"` as `<wz-button color="shadowed" size="sm">` holding a `w-icon` (`w-icon-recenter`, `w-icon-trash`). `wz-list-item` attributes: `subtitle`, `clickable`, `selected`, `disabled`.
- **Cards** (EV station → "Chargeurs"): `<wz-card size="sm" variant="elevated" elevation="0">` (white, radius 6, padding 16, 1px `--hairline` ring), header = grid `[icon][wz-subhead5 title][actions]`, content below (chips/captions). `elevation="1"` adds a light shadow.
- **Section titles**: "Chargeurs", "Noms alternatifs", "Points d'entrée" — small bold labels above the block (`wz-label`).
- **Secondary text actions**: "+ Ajouter un nom alternatif" — `wz-button color="text"`.
- **Panel headers**: "1 LIEU SÉLECTIONNÉ" / "ÉDITER UN ÉVÉNEMENT": icon/back arrow, an UPPERCASE 12px label with letter-spacing, a caption under it.

## Global Constraints

- No new dependencies; colours only through WME tokens in `BASE_CSS` (hex-free, `src/__tests__/styles.test.ts`).
- Keep internal identifiers (`wmegj-` classes, storage keys). Keep the existing behaviour and callbacks of every view (only their DOM changes) unless a task says otherwise.
- Every user-visible string through `i18next.t("literal.key")`, keys in both locales (`.superpowers/i18n.py`).
- One primary button per context (sidebar step list, panel action area).
- View tests: `// @vitest-environment happy-dom` + `beforeAll(initFrench)` (`src/__tests__/helpers/i18nFr.ts`).
- Commit after each task, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` as its own paragraph (`git commit -m "<subject>" -m "Co-Authored-By: …"`).

## Review Focus

1. **A line whose slowUp details are still loading** must stay non-clickable in the new `wz-list-item` (no `clickable` attribute, no select on click) → Task 1 test.
2. **Clicking the recenter action inside a list row** must not also select the line → Task 1 test.
3. **A source loaded while the loader is collapsed, then removed** (× on the card) must show the loader again → Task 2 test.
4. **A fully matched line re-opened** must not offer "Démarrer (manuel)/(automatique)" (it would jump straight to done) → Task 4 test.
5. **The step-nav caption on the frontier** must show the pending match count (the removed "n segment(s) trouvé(s)" row carried it) → Task 4 test.

## File Structure

| File                                 | Change                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| `src/ui/components/wz.ts`            | add `wzIconButton(icon, title, onClick)`                  |
| `src/ui/views/LineRowView.ts`        | row as `wz-list-item`, `lineSubtitle()`                   |
| `src/ui/views/LinesListView.ts`      | source `wz-card`, collapsible loader, `wz-list`           |
| `src/ui/views/MatchingHeaderView.ts` | native panel header                                       |
| `src/ui/views/MatchingStepsView.ts`  | steps as `wz-card`                                        |
| `src/ui/matchingPanelText.ts`        | pending count in caption, complete-line status            |
| `src/ui/subtabs/MatchingSubTab.ts`   | drop redundant rows, complete-line controls, panel header |
| `src/ui/styles.ts`                   | CSS for the above, drop obsolete rules                    |

---

### Task 1: Line rows as `wz-list-item`

**Files:** Modify `src/ui/components/wz.ts`, rewrite `src/ui/views/LineRowView.ts`, `src/ui/styles.ts`; tests `src/__tests__/LineRowView.test.ts` (rewrite), `src/__tests__/wzFields.test.ts` (add one test).

**Interfaces:**

- Produces: `wzIconButton(icon: string, title: string, onClick: () => void): HTMLElement` — `<wz-button color="shadowed" size="sm">` with `<i class="w-icon {icon}">` when registered, else `<button type="button" class="wmegj-icon-only">` with the same `<i>`; both get `title` + `aria-label`; the click handler calls `event.stopPropagation()` then `onClick()`.
- Produces: `lineSubtitle(entry: LineEntry, progress: LineProgress): string` (exported from `LineRowView.ts`): slowUp date (`formatSlowupDate`) and progress joined by `" · "`; progress text: done → `"✓ " + t("panel.lines.progressDone")`, in progress → `t("panel.summary.inProgress", { percent })`, not started → nothing. Empty string when both are absent.
- `LineRowView` keeps its props; `root` is a `wz-list-item` with class `wmegj-line-row` (+ `wmegj-line-row--loading`).

- [ ] **Step 1: Tests first**

Add to `src/__tests__/wzFields.test.ts`:

```ts
it("icon buttons carry a title and don't let the click bubble", () => {
  const onClick = vi.fn();
  const parent = vi.fn();
  const button = wzIconButton("w-icon-recenter", "Centrer", onClick);
  const row = document.createElement("div");
  row.addEventListener("click", parent);
  row.appendChild(button);
  button.click();
  expect(onClick).toHaveBeenCalled();
  expect(parent).not.toHaveBeenCalled();
  expect(button.title).toBe("Centrer");
  expect(button.querySelector("i.w-icon-recenter")).not.toBeNull();
});
```

(import `wzIconButton` with the other helpers).

Replace `src/__tests__/LineRowView.test.ts` with:

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LineRowView, lineSubtitle } from "../ui/views/LineRowView";
import type { LineEntry } from "../lines/types";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
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
const slowup = entry({
  displayName: "slowUp Valais — 25.10.2026",
  slowupDetails: { refid: 1, title: "slowUp Valais", date: "2026-10-25" },
  slowupFetchStatus: "ok",
});
const notStarted = { kind: "notStarted" } as const;
const props = (e: LineEntry, progress: Parameters<typeof lineSubtitle>[1] = notStarted) => ({
  entry: e,
  progress,
  onSelect: vi.fn(),
  onCenter: vi.fn(),
});

describe("lineSubtitle", () => {
  it("joins the slowUp date and the progress", () => {
    expect(lineSubtitle(slowup, { kind: "done" })).toBe("25.10.2026 · ✓ Terminé");
    expect(lineSubtitle(entry(), { kind: "inProgress", percent: 40 })).toBe("40 % validé");
    expect(lineSubtitle(slowup, notStarted)).toBe("25.10.2026");
    expect(lineSubtitle(entry(), notStarted)).toBe("");
  });
});

describe("LineRowView", () => {
  it("is a clickable WME list item with the title in item-key and the subtitle", () => {
    const row = new LineRowView(props(slowup, { kind: "done" }));
    expect(row.root.tagName).toBe("WZ-LIST-ITEM");
    expect(row.root.hasAttribute("clickable")).toBe(true);
    expect(row.root.getAttribute("subtitle")).toBe("25.10.2026 · ✓ Terminé");
    expect(row.root.querySelector('[slot="item-key"]')?.textContent).toContain("slowUp Valais");
    expect(row.root.querySelector<HTMLElement>(".wmegj-line-pill")?.style.backgroundColor).not.toBe(
      "",
    );
  });

  it("selects on click, but the recenter action does not select", () => {
    const p = props(entry());
    const row = new LineRowView(p);
    row.root.querySelector<HTMLElement>('[slot="actions"] .wmegj-icon-only')!.click();
    expect(p.onCenter).toHaveBeenCalledWith("l1");
    expect(p.onSelect).not.toHaveBeenCalled();
    row.root.click();
    expect(p.onSelect).toHaveBeenCalledWith("l1");
  });

  it("is not clickable while its slowUp details are loading", () => {
    const p = props(entry({ slowupFetchStatus: "loading" }));
    const row = new LineRowView(p);
    expect(row.root.hasAttribute("clickable")).toBe(false);
    row.root.click();
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(row.root.querySelector(".wmegj-spinner")).not.toBeNull();
  });
});
```

Run: `npx vitest run src/__tests__/LineRowView.test.ts src/__tests__/wzFields.test.ts` → FAIL (`lineSubtitle` / `wzIconButton` missing).

- [ ] **Step 2: Implement**

`wz.ts` (append):

```ts
/** Small round icon action, like WME's list-row and card actions. */
export function wzIconButton(icon: string, title: string, onClick: () => void): HTMLElement {
  const registered =
    typeof customElements !== "undefined" && customElements.get("wz-button") !== undefined;
  const button = document.createElement(registered ? "wz-button" : "button");
  if (registered) {
    button.setAttribute("color", "shadowed");
    button.setAttribute("size", "sm");
  } else {
    (button as HTMLButtonElement).type = "button";
  }
  button.classList.add("wmegj-icon-only");
  button.title = title;
  button.setAttribute("aria-label", title);
  const i = document.createElement("i");
  i.className = `w-icon ${icon}`;
  button.appendChild(i);
  button.addEventListener("click", (event) => {
    // Actions sit inside clickable rows/cards: don't trigger them too.
    event.stopPropagation();
    onClick();
  });
  return button;
}
```

`LineRowView.ts` (whole file):

```ts
import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { formatSlowupDate } from "../../lines/displayName";
import type { LineEntry } from "../../lines/types";
import { wzIconButton } from "../components/wz";

export interface LineRowProps {
  entry: LineEntry;
  progress: LineProgress;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/** "25.10.2026 · ✓ Terminé": slowUp date, then the matching progress. */
export function lineSubtitle(entry: LineEntry, progress: LineProgress): string {
  const parts: string[] = [];
  const date = entry.slowupDetails ? formatSlowupDate(entry.slowupDetails.date) : null;
  if (date) parts.push(date);
  if (progress.kind === "done") parts.push(`✓ ${i18next.t("panel.lines.progressDone")}`);
  if (progress.kind === "inProgress") {
    parts.push(i18next.t("panel.summary.inProgress", { percent: progress.percent }));
  }
  return parts.join(" · ");
}

/**
 * One line of the Lignes list as a WME list row (like a venue's "Noms
 * alternatifs"): colour dot + name, date and progress as subtitle, recenter
 * action. Not clickable while its slowUp details are loading.
 */
export class LineRowView {
  readonly root: HTMLElement;

  constructor(props: LineRowProps) {
    const { entry } = props;
    const isLoading = entry.slowupFetchStatus === "loading";

    this.root = document.createElement("wz-list-item");
    this.root.className = isLoading ? "wmegj-line-row wmegj-line-row--loading" : "wmegj-line-row";
    const subtitle = lineSubtitle(entry, props.progress);
    if (subtitle) this.root.setAttribute("subtitle", subtitle);
    if (!isLoading) {
      this.root.setAttribute("clickable", "");
      this.root.title = i18next.t("panel.lines.select");
      this.root.addEventListener("click", () => props.onSelect(entry.id));
    }

    const key = document.createElement("div");
    key.slot = "item-key";
    key.className = "wmegj-line-key";
    const dot = document.createElement("span");
    dot.className = "wmegj-line-pill";
    dot.style.backgroundColor = entry.color;
    const name = document.createElement("span");
    name.className = "wmegj-line-name";
    name.textContent = entry.slowupDetails?.title ?? entry.displayName;
    key.append(dot, name);
    if (entry.slowupFetchStatus === "error") {
      const warn = document.createElement("i");
      warn.className = "w-icon w-icon-alert-info wmegj-line-warning";
      warn.title = i18next.t("panel.lines.detailsError");
      key.appendChild(warn);
    }
    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "wmegj-spinner";
      spinner.title = i18next.t("panel.lines.detailsLoading");
      key.appendChild(spinner);
    }

    const actions = document.createElement("div");
    actions.slot = "actions";
    actions.appendChild(
      wzIconButton("w-icon-recenter", i18next.t("panel.lines.center"), () =>
        props.onCenter(entry.id),
      ),
    );

    this.root.append(key, actions);
  }
}
```

`styles.ts`: replace the `.wmegj-line-row*`, `.wmegj-line-text`, `.wmegj-line-caption`, `.wmegj-line-progress*` rules from batch B by:

```css
.wmegj-line-row--loading {
  opacity: 0.6;
}
.wmegj-line-key {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wmegj-line-pill {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.wmegj-line-name {
  overflow-wrap: anywhere;
}
```

Keep `.wmegj-line-warning`, `.wmegj-spinner`, `@keyframes wmegj-spin`. `.wmegj-line-caption` is still used by the source card until Task 2 — keep it if `grep -rn "wmegj-line-caption" src` still finds a user.

Run the two test files → PASS; full suite; tsc; eslint; commit `feat(ui): line rows as native WME list items`.

---

### Task 2: Lignes view with a source card and a collapsible loader

**Files:** Modify `src/ui/views/LinesListView.ts`, `src/ui/styles.ts`, locales; test `src/__tests__/LinesListView.test.ts`.

**Interfaces:** `LinesListProps`, `LoadedSource`, `sourceName`, and the public methods (`setUrl`, `setSource`, `setEntries`, `showError`, `clearError`) are unchanged. Kept classes: `.wmegj-source-card`, `.wmegj-source-clear`, `.wmegj-source-center`, `.wmegj-url-load`, `.wmegj-load-error`. New: `.wmegj-loader` (the slowUps button + "Autre source" block), `.wmegj-change-source` (text button).

Layout (top to bottom): **Source** section (`wz-label` "Source" + `wz-card size="sm" variant="elevated" elevation="0"` with header grid `[w-icon][wz-subhead5 name][actions: recenter, ×]` and `wz-caption` "n lignes") — hidden without source; **"Changer de source"** text button — shown only when a source is loaded and the loader is collapsed; **loader** (`.wmegj-loader`: "Charger les slowUps" primary, "Autre source" URL row + file picker + formats) — shown when no source, collapsed when a source is set (until "Changer de source"); load error; **Lignes** section (`wz-label` "Lignes" + `wz-list.wmegj-line-list`) — hidden when no source.

Source icon: slowups/url → `w-icon-link`; file → `w-icon-script`.

- [ ] **Step 1: Tests first** — append to `src/__tests__/LinesListView.test.ts`:

```ts
it("folds the loader away once a source is loaded, and brings it back on demand", () => {
  const view = new LinesListView(props());
  const loader = () => view.root.querySelector<HTMLElement>(".wmegj-loader")!;
  const change = () => view.root.querySelector<HTMLElement>(".wmegj-change-source")!;
  expect(loader().hidden).toBe(false);
  expect(change().hidden).toBe(true);

  view.setSource({ kind: "slowups" });
  expect(loader().hidden).toBe(true);
  expect(change().hidden).toBe(false);

  change().click();
  expect(loader().hidden).toBe(false);
  expect(change().hidden).toBe(true);

  view.setSource(null);
  expect(loader().hidden).toBe(false);
});

it("shows the source as a WME card and the lines in a WME list", () => {
  const view = new LinesListView(props());
  view.setSource({ kind: "file", name: "rallye.kmz" });
  view.setEntries([entry("a")], notStarted);
  expect(view.root.querySelector(".wmegj-source-card")?.tagName).toBe("WZ-CARD");
  expect(view.root.querySelector(".wmegj-line-list")?.tagName).toBe("WZ-LIST");
  expect(view.root.querySelector(".wmegj-source-card i.w-icon-script")).not.toBeNull();
});
```

The existing tests stay; where one fails only because of a DOM detail changed by this task (not a behaviour), adapt the selector and say so in the report.

Run → FAIL.

- [ ] **Step 2: Implement** — rewrite the constructor/`setSource`/`setEntries` accordingly:
- the card: `document.createElement("wz-card")` with `size`, `variant`, `elevation` attributes, class `wmegj-source-card`, `hidden = true`; header `div.wmegj-card-header` (grid) holding `i.w-icon` (class swapped in `setSource`), `wz-subhead5.wmegj-source-name`, and `div.wmegj-card-actions` with `wzIconButton("w-icon-recenter", t("panel.lines.centerAll"), onCenterAll)` (add class `wmegj-source-center`) and `wzIconButton("w-icon-x", t("panel.lines.clearSource"), onClearSource)` (class `wmegj-source-clear`); then `wz-caption.wmegj-source-count`.
- the change button: `wzButton({ text: t("panel.lines.changeSource"), variant: "text", onClick: expand })`, class `wmegj-change-source`, `hidden = true`.
- `setSource(source)`: card hidden iff null; loader hidden iff source !== null; change button hidden iff source === null; lines section hidden iff null.
- `setEntries`: count text in `.wmegj-source-count`; rows appended to the `wz-list`.
- Section titles: `wzLabel(t("panel.lines.sourceTitle"))`, `wzLabel(t("panel.lines.linesTitle"))`.

Locales — `panel.lines`: FR `"sourceTitle": "Source"`, `"linesTitle": "Lignes"`, `"changeSource": "Changer de source"`; EN `"sourceTitle": "Source"`, `"linesTitle": "Lines"`, `"changeSource": "Change source"`.

CSS (append; replace the batch B `.wmegj-source-card` rules):

```css
.wmegj-card-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.wmegj-card-actions {
  display: flex;
  gap: 4px;
}
.wmegj-source-name {
  overflow-wrap: anywhere;
}
.wmegj-source-card {
  display: block;
}
.wmegj-change-source {
  align-self: flex-start;
}
```

Run tests → PASS; full suite; tsc; eslint; commit `feat(ui): Lignes tab with a WME source card and list, loader folded once loaded`.

---

### Task 3: Matching sidebar header and step cards

**Files:** Modify `src/ui/views/MatchingHeaderView.ts`, `src/ui/views/MatchingStepsView.ts`, `src/ui/styles.ts`, locales; tests `src/__tests__/MatchingHeaderView.test.ts`, `src/__tests__/MatchingStepsView.test.ts`.

**Interfaces:** unchanged public APIs (`MatchingHeaderView({ onBack })`, `setTitle`, `setSummary`; `MatchingStepsView`, `nextStep`, `StepsState`). Kept classes: `.wmegj-back`, `.wmegj-header-summary`, `.wmegj-step`, `.is-next`, `.is-done`.

Design:

- **Header** like WME's "ÉDITER UN ÉVÉNEMENT": a row `[back icon button][column]`; the back button is `wzIconButton("w-icon-arrow-left", t("panel.matching.back"), onBack)` with class `wmegj-back`; the column holds an UPPERCASE kicker `p.wmegj-header-kicker` = `t("panel.matching.kicker")` ("LIGNE"), the title (`h3.wmegj-header-title`) and the summary caption.
- **Steps**: each step root is `<wz-card size="sm" variant="elevated" elevation="0">` with class `wmegj-step` (and `is-next` / `is-done`); the next step gets `elevation="1"`. The header is a `div.wmegj-card-header` (same grid as Task 2) `[badge][wz-subhead5 title]`.

- [ ] **Step 1: Tests first** — in `MatchingHeaderView.test.ts` add:

```ts
it("looks like a WME panel header: back icon, kicker, title", () => {
  const header = new MatchingHeaderView({ onBack: vi.fn() });
  header.setTitle("SS7+11 Les Cols");
  expect(header.root.querySelector(".wmegj-back i.w-icon-arrow-left")).not.toBeNull();
  expect(header.root.querySelector(".wmegj-header-kicker")?.textContent).toBe("Ligne");
});
```

(the kicker text is "Ligne"; CSS uppercases it). In `MatchingStepsView.test.ts` add:

```ts
it("renders the steps as WME cards, the next one raised", () => {
  const { steps } = setup({});
  expect(steps.every((step) => step.tagName === "WZ-CARD")).toBe(true);
  expect(steps[0].getAttribute("elevation")).toBe("1");
  expect(steps[1].getAttribute("elevation")).toBe("0");
});
```

Run → FAIL.

- [ ] **Step 2: Implement** as described; in `setState`, set `elevation` to `"1"` for the next step and `"0"` for the others. Locales: `panel.matching.kicker` FR `"Ligne"` / EN `"Line"`. CSS: `.wmegj-header { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 8px; align-items: start; }`, `.wmegj-header-kicker { margin: 0; font-size: 12px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--content_p2); }`; drop the batch B `.wmegj-step { background…; box-shadow… }` and `.wmegj-step.is-next { box-shadow… }` rules (the card draws them) but keep `display: flex; flex-direction: column; gap: 6px` on `.wmegj-step` (light DOM content of the card) — move them to a `.wmegj-step > *` free layout if `wz-card` ignores host display. Keep badge rules.

Run tests → PASS; full suite; tsc; eslint; commit `feat(ui): Matching sidebar header and steps in WME card style`.

---

### Task 4: Matching panel — no redundant rows, finished lines, header label

**Files:** Modify `src/ui/matchingPanelText.ts`, `src/ui/subtabs/MatchingSubTab.ts`, `src/ui/styles.ts`, locales; test `src/__tests__/matchingPanelText.test.ts`.

**Interfaces:**

- `stepNavState(...)` gains a trailing optional parameter `pendingCount: number | null = null`; for an unvalidated current step the caption becomes `"{window} · " + t("panel.matching.nav.found", { count: pendingCount })` when `pendingCount !== null`, else the existing `"{window} · à valider"`.
- New `isLineComplete(source: Source | null): boolean` re-export from `isMatchingComplete` is not needed — use `isMatchingComplete` from `src/domain/isMatchingComplete.ts` directly.
- New pure helper `panelStatusKey(run: MatchingUiState["kind"], complete: boolean): PanelStatusKey` in `matchingPanelText.ts`: `"done"` when `complete && (run === "idle" || run === "done")`, else `statusKeyFor({ kind: run } as MatchingUiState)` (import `statusKeyFor` and `PanelStatusKey` from `./matchingUiState`).
- `instructionKey` input gains `complete: boolean`; `run === "idle" && complete && !review` → `"panel.matching.instructions.done"`.

- [ ] **Step 1: Tests first** — append to `src/__tests__/matchingPanelText.test.ts`:

```ts
describe("finished lines", () => {
  it("say done instead of offering to start", () => {
    expect(panelStatusKey("idle", true)).toBe("done");
    expect(panelStatusKey("idle", false)).toBe("ready");
    expect(panelStatusKey("waiting", true)).toBe("waiting");
    expect(instructionKey({ run: "idle", review: null, hasValidated: true, complete: true })).toBe(
      "panel.matching.instructions.done",
    );
  });
});

describe("frontier caption", () => {
  it("carries the pending match count", () => {
    const pendingSource: Source = {
      ...source,
      lines: [
        {
          ...source.lines[0],
          subLines: [sub(0, true), sub(1, false)],
          pendingTail: [{ kmA: 4, kmB: 6 }],
        },
      ],
    };
    const frontier = { lineIndex: 0, subLineIndex: 1 };
    const nav = stepNavState(
      pendingSource,
      frontier,
      [{ lineIndex: 0, subLineIndex: 0 }, frontier],
      true,
      false,
      7,
    );
    expect(nav.caption).toBe("2.00 → 4.00 km · 7 segment(s) trouvé(s)");
  });
});
```

(Move the `sub` helper and `source` fixture of the existing `stepNavState` describe to module level if needed so both describes share them; add `complete: false` to the existing `instructionKey` test inputs.) Run → FAIL.

- [ ] **Step 2: Implement the helpers** + locales `panel.matching.nav.found` FR `"{{count}} segment(s) trouvé(s)"` / EN `"{{count}} segment(s) found"`.

- [ ] **Step 3: Wire `MatchingSubTab`**
  - Remove the `guidedRowHeaderEl` and `guidedSegmentCountEl` elements, fields, writes and `formatHeader` (the nav bar carries line/sub-line/window/count). In `renderSourceState` keep the highlighted-slice logic only. Pass `this.uiState.kind === "waiting" ? this.lazyPipeline?.getPendingMatched().length ?? null : null` as `pendingCount` to `stepNavState`. Delete now-unused locale keys `panel.matching.rowHeader*`, `panel.matching.segmentsMatched`, `panel.matching.steps.completedSummary` once grep finds no reference.
  - Complete line: compute `complete = isMatchingComplete(src)`; in `updateGuidedControls`, when `complete && this.uiState.kind === "idle"`, hide `start` and `startBurst`; pass `complete` to `instructionKey`; use `panelStatusKey(this.uiState.kind, complete)` for the status text.
  - Panel header label: the title element shows `t("panel.matching.panelTitle")` styled as an UPPERCASE kicker (class `wmegj-guided-title` gets the kicker CSS), and the status line becomes `"{line name} · {status}"` with the selected entry's `displayName` (`this.registry.getSelected()?.displayName`).
  - CSS: `.wmegj-guided-title { font-size: 12px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--content_p1); }`, `.wmegj-guided-status { font-size: 13px; color: var(--content_default); }`.
  - Carried deferred minor from batch C: replace the debug back button's `"← " + t(…)` by `t("panel.matching.menu.backToMatching")` with an `w-icon-arrow-left` icon button or put the arrow inside the locale string.

Run all tests, tsc, eslint, `npm run compile`; commit `feat(ui): matching panel without redundant rows, finished lines say done`.

---

### Task 5: Browser verification and design review

Controller task. Screenshots of each view (Lignes empty / slowUps / file; Matching sidebar; panel idle-complete, review, frontier) saved with `save_to_disk`, side by side with the native references (venue alternative names list, EV chargers cards), handed to a reviewer subagent for a design critique; fixes for confirmed findings, each with a test where testable.
