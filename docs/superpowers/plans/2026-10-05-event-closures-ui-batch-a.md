# WME Event Closures — UI overhaul, batch A (foundation, dialogs, name) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the script a shared WME-token stylesheet, rebuild every dialog on WME's native `wz-dialog`, add event category + lock level to MTE preparation, restyle the MTE helper window, and rename the script to "WME Event Closures".

**Architecture:** A `styles.ts` module owns all shared CSS (WME tokens only) and injects it once per document. A `wzDialog()` helper builds WME's exact dialog structure (`#wz-dialog-container > wz-dialog > wz-dialog-content + wz-dialog-controls`) and returns a promise; every prompt (`confirmDialog`, `alertDialog`, `promptMteInfo`, `promptFinalFields`, `promptClosureWindow`) is a thin builder of `wz-*` fields on top of it. Each `wz-*` helper falls back to plain HTML when the custom element is not registered, which is what the happy-dom unit tests exercise.

**Tech Stack:** TypeScript (strict), Rollup, vitest (+ happy-dom per-file), i18next (+ i18next-parser), WME web components.

**Spec:** `docs/superpowers/specs/2026-10-05-event-closures-ui-overhaul-design.md` (sections 0, 1, 5, 6).

## Global Constraints

- No new dependencies.
- Colours only through WME tokens (`var(--primary)`, `var(--content_p2)`, …). Hex values are allowed only in `TOKEN_FALLBACKS_CSS` (the detached MTE window has no WME tokens).
- Keep internal identifiers: `wmegj-` CSS prefix, storage keys, `scriptId: "wme-geojson"`, `@namespace wme-sdk-scripts`.
- Every user-visible string goes through `i18next.t("literal.key")` with a **literal** key (i18next-parser has `keepRemoved: false`; dynamic keys get deleted by `npm run makemessages`). Add each key to both `locales/en/common.json` and `locales/fr/common.json`.
- No `alert()`, `confirm()` or `prompt()` anywhere in `src/` (they freeze the page and the browser automation).
- Dialog look = WME's save dialog: `wz-h4` title, `wz-body2` text, `wz-caption` notes, primary `wz-button` on the right, cancel = `wz-button color="secondary" alarming` on the left, `dismissible="false"` (no ×).
- Code style per `claude.md`: named booleans for complex conditions, early returns, comments only for non-obvious "why".
- Commit after each task; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Enter while the Cancel button has focus** must cancel, not submit → test in Task 3.
2. **Two dialogs open at once** (e.g. the "MTE already linked" confirm, then the info dialog, or a double click): Esc/Enter must only act on the topmost dialog → test in Task 3.
3. **Lock level above the editor's rank** must not be selectable (WME rejects it on save) → test in Task 5.
4. **Default MTE title longer than 25 chars** (WME limit) must be truncated in the dialog, not rejected on save → test in Task 5.
5. **Closure window with end ≤ start** must keep the dialog open with an error, not apply closures → test in Task 7.

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/styles.ts` (new) | Shared CSS strings + `injectStyles(doc)` |
| `src/ui/components/wz.ts` (modify) | Add field helpers: `wzTextarea`, `wzSelect`, `wzCheckbox`, `wzChipSelect`, `wzLabel`, `dateTimeInput`, `readValue`, `isChecked`; `maxLength` on `wzTextInput`; `"text"` button variant |
| `src/ui/components/wzDialog.ts` (new) | `wzDialog`, `confirmDialog`, `alertDialog` |
| `src/ui/modal.ts` (delete) | replaced by `confirmDialog` |
| `src/ui/promptMteInfo.ts` (rewrite) | MTE info dialog incl. category + lock level |
| `src/mte/mteFormFiller.ts` (modify) | `MteEventOptions`, `lockLevel`, `categoryOptions`, `lockLevelOptions` |
| `src/ui/promptFinalFields.ts` (rewrite) | final fields on `wzDialog` |
| `src/ui/components/promptClosureWindow.ts` (rewrite UI part) | closure windows on `wzDialog` |
| `src/ui/MtePreparePopup.ts` (modify) | WME-like styling of the detached window |
| `src/ui/subtabs/MatchingSubTab.ts` (modify) | use new dialogs, no `alert()`, MTE options flow |
| `src/ui/MatchPanel.ts`, `main.user.ts`, `header.js`, `header-dev.template.js`, `README.md`, `locales/*/common.json` | rename |

---

### Task 1: Shared stylesheet

**Files:**
- Create: `src/ui/styles.ts`
- Test: `src/__tests__/styles.test.ts`

**Interfaces:**
- Produces: `STYLE_ELEMENT_ID: string`, `BASE_CSS: string`, `TOKEN_FALLBACKS_CSS: string`, `injectStyles(doc: Document): void` (idempotent).

- [ ] **Step 1: Write the failing test**

`src/__tests__/styles.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BASE_CSS, STYLE_ELEMENT_ID, TOKEN_FALLBACKS_CSS, injectStyles } from "../ui/styles";

describe("injectStyles", () => {
  it("injects the base stylesheet once per document", () => {
    injectStyles(document);
    injectStyles(document);
    const styles = document.querySelectorAll(`#${STYLE_ELEMENT_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(BASE_CSS);
  });

  it("uses WME tokens only, hex colours live in the fallback block", () => {
    expect(BASE_CSS).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(TOKEN_FALLBACKS_CSS).toContain("--primary: #0099ff");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/styles.test.ts`
Expected: FAIL — cannot resolve `../ui/styles`.

- [ ] **Step 3: Implement**

`src/ui/styles.ts`:

```ts
// Shared stylesheet. WME exposes its design tokens as CSS variables on
// <body>; everything here reads them so the script follows the editor's theme.

export const STYLE_ELEMENT_ID = "wmegj-styles";

/** Token values copied from WME, for documents that don't have them (MTE window). */
export const TOKEN_FALLBACKS_CSS = `
  :root {
    --primary: #0099ff;
    --primary_variant: #0075e3;
    --content_default: #202124;
    --content_p1: #3c4043;
    --content_p2: #55595e;
    --content_p3: #72767d;
    --background_default: #ffffff;
    --background_variant: #f2f4f7;
    --surface_default: #f2f4f7;
    --surface_variant: #e8eaed;
    --separator_default: #e8eaed;
    --hairline: #d5d7db;
    --hairline_strong: #90959c;
    --alarming: #ff5252;
    --alarming_variant: #e42828;
    --cautious: #ffc400;
    --cautious_variant: #e37400;
    --safe: #1bab50;
    --safe_variant: #118742;
    --leading_icon: #90959c;
    --always_white: #ffffff;
  }
`;

export const BASE_CSS = `
  .wmegj-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .wmegj-dialog-body > wz-text-input,
  .wmegj-dialog-body > wz-textarea,
  .wmegj-dialog-body > wz-select {
    width: 100%;
  }
  .wmegj-dialog-error {
    color: var(--alarming_variant);
  }
  .wmegj-dialog-error:empty {
    display: none;
  }
  .wmegj-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .wmegj-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--content_p1);
  }
  .wmegj-row {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }
  .wmegj-row > * {
    flex: 1 1 0;
    min-width: 0;
  }
  .wmegj-row > .wmegj-row-fixed {
    flex: 0 0 auto;
  }
  .wmegj-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  /* Native datetime input dressed as a wz-text-input. */
  .wmegj-datetime {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--surface_default);
    color: var(--content_default);
    font: inherit;
    font-size: 14px;
  }
  .wmegj-datetime:hover {
    background: var(--surface_variant);
  }
  .wmegj-datetime:focus {
    outline: none;
    border-color: var(--primary);
    background: var(--background_default);
  }
  .wmegj-icon-only {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--content_p2);
    cursor: pointer;
  }
  .wmegj-icon-only:hover:not(:disabled) {
    background: var(--surface_default);
  }
  .wmegj-icon-only:disabled {
    color: var(--hairline);
    cursor: default;
  }
  /* Fallback when wz-dialog is not registered (tests, future WME changes). */
  dialog.wmegj-dialog-fallback {
    border: none;
    border-radius: 8px;
    padding: 24px;
    width: min(400px, 90vw);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
    font-family: inherit;
  }
  .wmegj-dialog-controls:not(wz-dialog-controls) {
    display: flex;
    flex-direction: row-reverse;
    gap: 8px;
    margin-top: 20px;
  }
`;

/** Inject BASE_CSS into `doc` once; later calls are no-ops. */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = BASE_CSS;
  doc.head.appendChild(style);
}
```

Note: `box-shadow` in the fallback uses `rgba(...)`, not hex — the test only bans hex.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/styles.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/styles.ts src/__tests__/styles.test.ts
git commit -m "feat(ui): shared stylesheet on WME design tokens"
```

---

### Task 2: `wz-*` field helpers

**Files:**
- Modify: `src/ui/components/wz.ts`
- Test: `src/__tests__/wzFields.test.ts`

**Interfaces:**
- Consumes: existing `wzButton`, `wzTextInput`, `warnMissingTag` in `wz.ts`.
- Produces (all exported from `src/ui/components/wz.ts`):
  - `WzButtonProps.variant` gains `"text"` (maps to `color="text"`).
  - `WzTextInputProps` gains `maxLength?: number`.
  - `wzLabel(text: string): HTMLElement`
  - `wzTextarea(props: { label: string; value?: string; placeholder?: string }): HTMLElement`
  - `wzSelect(props: { label: string; value: string; options: { value: string; label: string }[] }): HTMLElement`
  - `wzCheckbox(props: { label: string; checked: boolean }): HTMLElement`
  - `wzChipSelect(props: { label: string; value: string; options: { value: string; label: string; disabled?: boolean }[] }): { root: HTMLElement; getValue(): string }`
  - `dateTimeInput(props: { label?: string; value?: string }): { root: HTMLElement; input: HTMLInputElement }`
  - `readValue(el: HTMLElement): string`
  - `isChecked(el: HTMLElement): boolean`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/wzFields.test.ts` (happy-dom has no WME custom elements, so the fallback branch is what runs):

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  dateTimeInput,
  isChecked,
  readValue,
  wzCheckbox,
  wzChipSelect,
  wzSelect,
  wzTextInput,
  wzTextarea,
} from "../ui/components/wz";

vi.spyOn(console, "warn").mockImplementation(() => {});

describe("wz field helpers (fallback DOM)", () => {
  it("reads text input and textarea values", () => {
    const input = wzTextInput({ label: "Titre", value: "abc", maxLength: 2 });
    expect(readValue(input)).toBe("abc");
    expect(input.querySelector("input")?.maxLength).toBe(2);

    const area = wzTextarea({ label: "Description", value: "long text" });
    expect(readValue(area)).toBe("long text");
  });

  it("selects the initial option and reads changes", () => {
    const select = wzSelect({
      label: "Catégorie",
      value: "B",
      options: [
        { value: "A", label: "a" },
        { value: "B", label: "b" },
      ],
    });
    expect(readValue(select)).toBe("B");
    select.querySelector("select")!.value = "A";
    expect(readValue(select)).toBe("A");
  });

  it("reports checkbox state", () => {
    const box = wzCheckbox({ label: "Ignorer le trafic", checked: true });
    expect(isChecked(box)).toBe(true);
    box.querySelector("input")!.click();
    expect(isChecked(box)).toBe(false);
  });

  it("chip select keeps exactly one chip checked and ignores disabled chips", () => {
    const chips = wzChipSelect({
      label: "Niveau",
      value: "1",
      options: [
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3", disabled: true },
      ],
    });
    const buttons = chips.root.querySelectorAll<HTMLButtonElement>("button");
    buttons[1].click();
    expect(chips.getValue()).toBe("2");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    buttons[2].click();
    expect(chips.getValue()).toBe("2");
  });

  it("datetime input keeps the datetime-local value format", () => {
    const { root, input } = dateTimeInput({ label: "Début", value: "2026-10-05T09:00" });
    expect(input.type).toBe("datetime-local");
    expect(input.value).toBe("2026-10-05T09:00");
    expect(root.textContent).toContain("Début");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/wzFields.test.ts`
Expected: FAIL — `readValue` / `wzTextarea` … are not exported.

- [ ] **Step 3: Implement**

In `src/ui/components/wz.ts`:

a) `WzButtonProps.variant`: change to `"primary" | "secondary" | "danger" | "text"`. The existing `const color = variant === "danger" ? "secondary" : variant;` already passes `"text"` through as the `color` attribute — no other change.

b) `WzTextInputProps`: add `maxLength?: number;`. In the fallback branch after `input.disabled = …` add:

```ts
    if (props.maxLength !== undefined) input.maxLength = props.maxLength;
```

In the registered branch after `if (props.disabled) el.setAttribute("disabled", "");` add:

```ts
  if (props.maxLength !== undefined) el.setAttribute("maxlength", String(props.maxLength));
```

c) Append the new helpers at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Form field helpers. Each one renders the WME component when registered and
// a plain-HTML equivalent otherwise (unit tests, or a WME rename).
// ---------------------------------------------------------------------------

function isTagRegistered(tagName: string): boolean {
  const registered =
    typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;
  if (!registered) warnMissingTag(tagName);
  return registered;
}

/** Small field title (WME `wz-label`). */
export function wzLabel(text: string): HTMLElement {
  const el = document.createElement(isTagRegistered("wz-label") ? "wz-label" : "span");
  el.className = "wmegj-field-label";
  el.textContent = text;
  return el;
}

function fallbackField(label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "wmegj-field";
  wrapper.append(wzLabel(label), control);
  return wrapper;
}

export function wzTextarea(props: {
  label: string;
  value?: string;
  placeholder?: string;
}): HTMLElement {
  if (!isTagRegistered("wz-textarea")) {
    const area = document.createElement("textarea");
    area.rows = 4;
    area.value = props.value ?? "";
    area.placeholder = props.placeholder ?? "";
    return fallbackField(props.label, area);
  }
  const el = document.createElement("wz-textarea");
  el.setAttribute("label", props.label);
  if (props.placeholder) el.setAttribute("placeholder", props.placeholder);
  if (props.value) el.setAttribute("value", props.value);
  (el as unknown as { value: string }).value = props.value ?? "";
  return el;
}

export function wzSelect(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
}): HTMLElement {
  if (!isTagRegistered("wz-select")) {
    const select = document.createElement("select");
    for (const option of props.options) {
      select.append(new Option(option.label, option.value));
    }
    select.value = props.value;
    return fallbackField(props.label, select);
  }
  const el = document.createElement("wz-select");
  el.setAttribute("label", props.label);
  for (const option of props.options) {
    const optionEl = document.createElement("wz-option");
    optionEl.setAttribute("value", option.value);
    optionEl.textContent = option.label;
    el.appendChild(optionEl);
  }
  el.setAttribute("value", props.value);
  (el as unknown as { value: string }).value = props.value;
  return el;
}

export function wzCheckbox(props: { label: string; checked: boolean }): HTMLElement {
  if (!isTagRegistered("wz-checkbox")) {
    const wrapper = document.createElement("label");
    wrapper.className = "wmegj-row";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = props.checked;
    box.className = "wmegj-row-fixed";
    const text = document.createElement("span");
    text.textContent = props.label;
    wrapper.append(box, text);
    return wrapper;
  }
  const el = document.createElement("wz-checkbox");
  el.textContent = props.label;
  if (props.checked) el.setAttribute("checked", "");
  (el as unknown as { checked: boolean }).checked = props.checked;
  return el;
}

/** One-of-n chips, like WME's lock level selector. */
export function wzChipSelect(props: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
}): { root: HTMLElement; getValue(): string } {
  const useChips = isTagRegistered("wz-checkable-chip");
  let current = props.value;
  const chips: { value: string; el: HTMLElement }[] = [];

  const render = (): void => {
    for (const chip of chips) {
      const checked = chip.value === current;
      chip.el.toggleAttribute("checked", checked);
      (chip.el as unknown as { checked: boolean }).checked = checked;
      chip.el.setAttribute("aria-pressed", String(checked));
    }
  };

  const row = document.createElement("div");
  row.className = "wmegj-chips";
  for (const option of props.options) {
    const el = document.createElement(useChips ? "wz-checkable-chip" : "button");
    el.textContent = option.label;
    el.setAttribute("value", option.value);
    if (useChips) el.setAttribute("size", "md");
    if (option.disabled) {
      el.setAttribute("disabled", "");
      (el as unknown as { disabled: boolean }).disabled = true;
    }
    el.addEventListener("click", () => {
      if (option.disabled) return;
      current = option.value;
      render();
    });
    chips.push({ value: option.value, el });
    row.appendChild(el);
  }
  render();

  const root = document.createElement("div");
  root.className = "wmegj-field";
  root.append(wzLabel(props.label), row);
  return { root, getValue: () => current };
}

/**
 * WME's own date/time pickers have no documented API, so dates use a native
 * datetime-local input dressed like a wz-text-input ("YYYY-MM-DDTHH:mm").
 */
export function dateTimeInput(props: { label?: string; value?: string }): {
  root: HTMLElement;
  input: HTMLInputElement;
} {
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.className = "wmegj-datetime";
  input.value = props.value ?? "";
  if (!props.label) return { root: input, input };
  input.setAttribute("aria-label", props.label);
  const root = document.createElement("div");
  root.className = "wmegj-field";
  root.append(wzLabel(props.label), input);
  return { root, input };
}

/** Value of a wz field or of its plain-HTML fallback. */
export function readValue(el: HTMLElement): string {
  const own = (el as unknown as { value?: unknown }).value;
  if (typeof own === "string") return own;
  const nested = el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  return nested?.value ?? "";
}

export function isChecked(el: HTMLElement): boolean {
  const own = (el as unknown as { checked?: unknown }).checked;
  if (typeof own === "boolean") return own;
  return el.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked ?? false;
}
```

`warnMissingTag` is already defined at the top of `wz.ts`; `isTagRegistered` reuses it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/wzFields.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/wz.ts src/__tests__/wzFields.test.ts
git commit -m "feat(ui): wz field helpers with plain-HTML fallbacks"
```

---

### Task 3: Native dialog helper

**Files:**
- Create: `src/ui/components/wzDialog.ts`
- Test: `src/__tests__/wzDialog.test.ts`

**Interfaces:**
- Consumes: `wzButton` (Task 2 variant set), `injectStyles` (Task 1).
- Produces:
  - `interface WzDialogOptions { title: string; body?: (Node | string)[]; primaryLabel: string; cancelLabel?: string; onPrimary?: () => string | null; focus?: HTMLElement }`
  - `wzDialog(opts: WzDialogOptions): Promise<boolean>` — true on primary, false on cancel/Esc.
  - `confirmDialog(opts: { title: string; message: string; confirmLabel: string; cancelLabel: string }): Promise<boolean>`
  - `alertDialog(message: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/wzDialog.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wzDialog } from "../ui/components/wzDialog";

vi.spyOn(console, "warn").mockImplementation(() => {});

const primary = () => document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!;
const cancel = () => document.querySelector<HTMLButtonElement>(".wmegj-button--secondary")!;
const key = (target: EventTarget, k: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, composed: true }));

afterEach(() => {
  document.body.replaceChildren();
});

describe("wzDialog", () => {
  it("resolves true on primary and removes itself", async () => {
    const result = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    primary().click();
    await expect(result).resolves.toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("resolves false on cancel and on Escape", async () => {
    const byButton = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    cancel().click();
    await expect(byButton).resolves.toBe(false);

    const byEscape = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(document.body, "Escape");
    await expect(byEscape).resolves.toBe(false);
  });

  it("submits on Enter in a text field but not in a textarea", async () => {
    const area = document.createElement("textarea");
    const input = document.createElement("input");
    const result = wzDialog({ title: "T", body: [area, input], primaryLabel: "OK" });
    key(area, "Enter");
    expect(document.querySelector("dialog")).not.toBeNull();
    key(input, "Enter");
    await expect(result).resolves.toBe(true);
  });

  it("Enter on the cancel button cancels instead of submitting", async () => {
    const result = wzDialog({ title: "T", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(cancel(), "Enter");
    expect(document.querySelector("dialog")).not.toBeNull();
    cancel().click();
    await expect(result).resolves.toBe(false);
  });

  it("stays open and shows the error returned by onPrimary", async () => {
    let attempts = 0;
    const result = wzDialog({
      title: "T",
      primaryLabel: "OK",
      onPrimary: () => (++attempts === 1 ? "Champ obligatoire" : null),
    });
    primary().click();
    expect(document.querySelector(".wmegj-dialog-error")?.textContent).toBe("Champ obligatoire");
    primary().click();
    await expect(result).resolves.toBe(true);
  });

  it("only the topmost dialog reacts to keys", async () => {
    const bottom = wzDialog({ title: "Bottom", primaryLabel: "OK", cancelLabel: "Annuler" });
    const top = wzDialog({ title: "Top", primaryLabel: "OK", cancelLabel: "Annuler" });
    key(document.body, "Escape");
    await expect(top).resolves.toBe(false);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    key(document.body, "Escape");
    await expect(bottom).resolves.toBe(false);
  });

  it("renders a single button when there is no cancel label", () => {
    void wzDialog({ title: "T", primaryLabel: "OK" });
    expect(document.querySelectorAll("dialog button")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/wzDialog.test.ts`
Expected: FAIL — cannot resolve `../ui/components/wzDialog`.

- [ ] **Step 3: Implement**

`src/ui/components/wzDialog.ts`:

```ts
// Dialogs built exactly like WME's own (e.g. the "save edits" dialog):
//   #wz-dialog-container > wz-dialog > wz-dialog-content + wz-dialog-controls
// wz-dialog is opened with showDialog() once upgraded. dismissible="false"
// removes the × and the backdrop close, so every exit goes through settle().

import i18next from "i18next";
import { injectStyles } from "../styles";
import { wzButton } from "./wz";

export interface WzDialogOptions {
  title: string;
  /** Nodes under the title. Strings become wz-body2 paragraphs. */
  body?: (Node | string)[];
  primaryLabel: string;
  /** Omit for a single-button information dialog. */
  cancelLabel?: string;
  /** Runs on primary click / Enter. Return an error message to stay open. */
  onPrimary?: () => string | null;
  focus?: HTMLElement;
}

interface WzDialogElement extends HTMLElement {
  componentOnReady?: () => Promise<unknown>;
  showDialog?: () => void;
  hideDialog?: () => void;
}

// Topmost last: only the top dialog handles Enter / Escape.
const openDialogs: HTMLElement[] = [];

function isTagRegistered(tagName: string): boolean {
  return typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;
}

function textElement(tagName: string, text: string, className = ""): HTMLElement {
  const el = document.createElement(isTagRegistered(tagName) ? tagName : "p");
  el.className = className;
  el.textContent = text;
  return el;
}

export function wzDialog(opts: WzDialogOptions): Promise<boolean> {
  injectStyles(document);
  const useNative = isTagRegistered("wz-dialog");

  const body = document.createElement("div");
  body.className = "wmegj-dialog-body";
  body.appendChild(textElement("wz-h4", opts.title));
  for (const part of opts.body ?? []) {
    body.appendChild(typeof part === "string" ? textElement("wz-body2", part) : part);
  }
  const errorEl = textElement("wz-caption", "", "wmegj-dialog-error");
  body.appendChild(errorEl);

  const primaryBtn = wzButton({ text: opts.primaryLabel, variant: "primary" });
  const cancelBtn = opts.cancelLabel
    ? wzButton({ text: opts.cancelLabel, variant: "secondary" })
    : null;
  cancelBtn?.setAttribute("alarming", "");

  const controls = document.createElement(useNative ? "wz-dialog-controls" : "div");
  controls.className = "wmegj-dialog-controls";
  controls.setAttribute("layout", "horizontal-reverse");
  controls.appendChild(primaryBtn);
  if (cancelBtn) controls.appendChild(cancelBtn);

  let host: WzDialogElement;
  if (useNative) {
    host = document.createElement("wz-dialog");
    host.setAttribute("size", "sm");
    host.setAttribute("dismissible", "false");
    const content = document.createElement("wz-dialog-content");
    content.appendChild(body);
    host.append(content, controls);
  } else {
    host = document.createElement("dialog");
    host.className = "wmegj-dialog-fallback";
    host.append(body, controls);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    function settle(result: boolean): void {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown, true);
      openDialogs.splice(openDialogs.indexOf(host), 1);
      host.hideDialog?.();
      host.remove();
      resolve(result);
    }

    function submit(): void {
      const error = opts.onPrimary?.() ?? null;
      if (error) {
        errorEl.textContent = error;
        return;
      }
      settle(true);
    }

    function onKeyDown(event: KeyboardEvent): void {
      const isTopmost = openDialogs[openDialogs.length - 1] === host;
      if (!isTopmost) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        settle(false);
        return;
      }
      if (event.key !== "Enter") return;

      // Enter keeps its normal meaning in a textarea (new line) and on a
      // button (activates that button — e.g. Cancel must not submit).
      const path = event.composedPath();
      const inTextarea = path.some(
        (node) => node instanceof HTMLElement && /^(TEXTAREA|WZ-TEXTAREA)$/.test(node.tagName),
      );
      const onButton = path.some(
        (node) => node instanceof HTMLElement && /^(BUTTON|WZ-BUTTON)$/.test(node.tagName),
      );
      if (inTextarea || onButton) return;

      event.preventDefault();
      event.stopPropagation();
      submit();
    }

    primaryBtn.addEventListener("click", submit);
    cancelBtn?.addEventListener("click", () => settle(false));
    host.addEventListener("cancel", (event) => {
      // Fallback <dialog>: its native Esc handling would close without us.
      event.preventDefault();
      settle(false);
    });
    document.addEventListener("keydown", onKeyDown, true);

    const container = document.getElementById("wz-dialog-container") ?? document.body;
    container.appendChild(host);
    openDialogs.push(host);

    if (useNative) {
      void (host.componentOnReady?.() ?? Promise.resolve()).then(() => {
        host.showDialog?.();
        opts.focus?.focus();
      });
    } else {
      const fallback = host as unknown as HTMLDialogElement;
      if (typeof fallback.showModal === "function") fallback.showModal();
      else fallback.setAttribute("open", "");
      opts.focus?.focus();
    }
  });
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  return wzDialog({
    title: opts.title,
    body: [opts.message],
    primaryLabel: opts.confirmLabel,
    cancelLabel: opts.cancelLabel,
  });
}

/** Replacement for window.alert(): one OK button, never blocks the page. */
export async function alertDialog(message: string): Promise<void> {
  await wzDialog({
    title: i18next.t("panel.dialogs.errorTitle"),
    body: [message],
    primaryLabel: i18next.t("panel.dialogs.ok"),
  });
}
```

Add to `locales/fr/common.json` under `panel`:

```json
"dialogs": {
  "errorTitle": "Action impossible",
  "ok": "OK",
  "restartTitle": "Recommencer à zéro ?",
  "mteLinkedTitle": "MTE déjà associé",
  "mteNotLoadedTitle": "MTE non chargé"
}
```

and to `locales/en/common.json` under `panel`:

```json
"dialogs": {
  "errorTitle": "Action not possible",
  "ok": "OK",
  "restartTitle": "Restart from scratch?",
  "mteLinkedTitle": "MTE already linked",
  "mteNotLoadedTitle": "MTE not loaded"
}
```

(Keys sorted alphabetically inside the object, matching the parser's `sort: true`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/wzDialog.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/wzDialog.ts src/__tests__/wzDialog.test.ts locales
git commit -m "feat(ui): native wz-dialog helper with confirm and alert variants"
```

---

### Task 4: Replace `confirmModal` and every `alert()`

**Files:**
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (imports; `confirmModal` at ~1532, ~1946, ~2330; `alert` at ~2135, ~2147, ~2224, ~2281)
- Modify: `src/ui/MtePreparePopup.ts:69`
- Delete: `src/ui/modal.ts`

**Interfaces:**
- Consumes: `confirmDialog`, `alertDialog` (Task 3).

- [ ] **Step 1: Swap imports**

In `MatchingSubTab.ts` replace `import { confirmModal } from "../modal";` with:

```ts
import { alertDialog, confirmDialog } from "../components/wzDialog";
```

- [ ] **Step 2: Replace the three `confirmModal` calls**

Restart (~1532):

```ts
    confirmDialog({
      title: i18next.t("panel.dialogs.restartTitle"),
      message: i18next.t("panel.matching.restartConfirm"),
      confirmLabel: i18next.t("panel.matching.restartFromScratch"),
      cancelLabel: i18next.t("panel.finalFields.cancel"),
    })
```

MTE already linked (~1946): same shape with `title: i18next.t("panel.dialogs.mteLinkedTitle")`, keeping its existing `message` / labels.

MTE not loaded (~2330): same shape with `title: i18next.t("panel.dialogs.mteNotLoadedTitle")`, keeping its existing `message` / labels.

- [ ] **Step 3: Replace the `alert()` calls**

Each `alert(x);` in `MatchingSubTab.ts` becomes `void alertDialog(x);` (4 sites). In `MtePreparePopup.ts` add `import { alertDialog } from "./components/wzDialog";` and replace `alert(i18next.t("panel.mtePopup.blocked"));` with `void alertDialog(i18next.t("panel.mtePopup.blocked"));`.

- [ ] **Step 4: Delete `src/ui/modal.ts` and check nothing references it or `alert(`**

Run: `git rm src/ui/modal.ts && grep -rnE "confirmModal|\balert\(|\bconfirm\(|from \"\.\./modal\"" src --include=*.ts | grep -v __tests__`
Expected: no output.

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A src/ui
git commit -m "refactor(ui): native dialogs instead of confirmModal and alert()"
```

---

### Task 5: MTE info dialog with category and lock level

**Files:**
- Modify: `src/mte/mteFormFiller.ts`
- Rewrite: `src/ui/promptMteInfo.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts` (`openMtePopup`, ~1923-1985)
- Modify: `locales/en/common.json`, `locales/fr/common.json`
- Test: `src/__tests__/mteFormFiller.test.ts`, `src/__tests__/promptMteInfo.test.ts`

**Interfaces:**
- Consumes: `wzDialog` (Task 3); `wzTextInput`, `wzTextarea`, `wzSelect`, `wzChipSelect`, `dateTimeInput`, `readValue` (Task 2).
- Produces:
  - `type LockLevel = 1 | 2 | 3 | 4`
  - `interface MteEventOptions { category: MajorTrafficEventCategory; lockLevel: LockLevel }`
  - `MteFormData.category: MajorTrafficEventCategory` (no longer nullable), `MteFormData.lockLevel: LockLevel`
  - `slowupFormData(d, polygon, options: MteEventOptions): MteFormData`
  - `manualFormData(info, polygon, options: MteEventOptions): MteFormData`
  - `categoryOptions(): { value: MajorTrafficEventCategory; label: string }[]`
  - `lockLevelOptions(userRank: number): { value: LockLevel; disabled: boolean }[]`
  - `interface MteInfoResult { options: MteEventOptions; manual: ManualMteInfo | null }`
  - `promptMteInfo(defaults: { title: string; userRank: number; askDetails: boolean }): Promise<MteInfoResult | null>`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/mteFormFiller.test.ts` (and update the existing slowUp test call to pass options):

```ts
import { categoryOptions, lockLevelOptions, manualFormData } from "../mte/mteFormFiller";

const options = { category: "PARADE", lockLevel: 2 } as const;

describe("MTE event options", () => {
  it("carries category and lock level into the form data", () => {
    const data = manualFormData(
      {
        title: "Course",
        startDate: "2026-10-05T09:00",
        endDate: "2026-10-05T17:00",
        description: "",
        urlLink: "",
      },
      null,
      options,
    );
    expect(data.category).toBe("PARADE");
    expect(data.lockLevel).toBe(2);
  });

  it("offers the categories of the native form, sporting event included", () => {
    const values = categoryOptions().map((option) => option.value);
    expect(values).toContain("SPORTING_EVENT");
    expect(values).not.toContain("PARTNER_USER_COMMS");
    expect(values).toHaveLength(11);
  });

  it("disables lock levels above the editor's rank (rank 0 = level 1)", () => {
    expect(lockLevelOptions(1)).toEqual([
      { value: 1, disabled: false },
      { value: 2, disabled: false },
      { value: 3, disabled: true },
      { value: 4, disabled: true },
    ]);
    expect(lockLevelOptions(5).every((option) => !option.disabled)).toBe(true);
  });
});
```

The existing slowUp test becomes `slowupFormData({...}, null, { category: "SPORTING_EVENT", lockLevel: 1 })` with the same expectations.

Append to `src/__tests__/promptMteInfo.test.ts` (add `// @vitest-environment happy-dom` as the first line of the file):

```ts
import { promptMteInfo } from "../ui/promptMteInfo";

describe("promptMteInfo", () => {
  it("truncates a long default title to the WME limit", () => {
    void promptMteInfo({
      title: "Rallye International du Valais 2026",
      userRank: 2,
      askDetails: true,
    });
    const title = document.querySelector<HTMLInputElement>("dialog input[type=text]")!;
    expect(title.value).toBe("Rallye International du V");
    document.body.replaceChildren();
  });

  it("asks only category and lock level when details come from slowUp", async () => {
    const result = promptMteInfo({ title: "x", userRank: 0, askDetails: false });
    expect(document.querySelectorAll("dialog input")).toHaveLength(0);
    document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!.click();
    await expect(result).resolves.toEqual({
      options: { category: "SPORTING_EVENT", lockLevel: 1 },
      manual: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/mteFormFiller.test.ts src/__tests__/promptMteInfo.test.ts`
Expected: FAIL — `categoryOptions` / `lockLevelOptions` not exported, `manualFormData` arity.

- [ ] **Step 3: Implement the form-data side (`src/mte/mteFormFiller.ts`)**

Add `import i18next from "i18next";` and, after `MTE_NAME_MAX`:

```ts
export type LockLevel = 1 | 2 | 3 | 4;

export interface MteEventOptions {
  category: MajorTrafficEventCategory;
  lockLevel: LockLevel;
}

export const DEFAULT_MTE_OPTIONS: MteEventOptions = { category: "SPORTING_EVENT", lockLevel: 1 };

/** Categories offered by WME's MTE form (PARTNER_USER_COMMS is not). */
export function categoryOptions(): { value: MajorTrafficEventCategory; label: string }[] {
  return [
    { value: "CONCERT", label: i18next.t("panel.mteInfo.categories.concert") },
    { value: "CONSTRUCTION", label: i18next.t("panel.mteInfo.categories.construction") },
    { value: "CRISIS", label: i18next.t("panel.mteInfo.categories.crisis") },
    { value: "DEMONSTRATION", label: i18next.t("panel.mteInfo.categories.demonstration") },
    { value: "DRIVING_ADVISORY", label: i18next.t("panel.mteInfo.categories.drivingAdvisory") },
    { value: "HOLIDAY/FESTIVAL", label: i18next.t("panel.mteInfo.categories.holidayFestival") },
    { value: "OTHER", label: i18next.t("panel.mteInfo.categories.other") },
    { value: "PARADE", label: i18next.t("panel.mteInfo.categories.parade") },
    { value: "SPORTING_EVENT", label: i18next.t("panel.mteInfo.categories.sportingEvent") },
    { value: "SUMMIT", label: i18next.t("panel.mteInfo.categories.summit") },
    {
      value: "UNPLANNED_DISRUPTION",
      label: i18next.t("panel.mteInfo.categories.unplannedDisruption"),
    },
  ];
}

/** WME ranks are 0-based: rank 0 may lock at level 1 only. */
export function lockLevelOptions(userRank: number): { value: LockLevel; disabled: boolean }[] {
  return ([1, 2, 3, 4] as const).map((value) => ({ value, disabled: value > userRank + 1 }));
}
```

In `MteFormData` change `category: MajorTrafficEventCategory | null;` to `category: MajorTrafficEventCategory;` and add `lockLevel: LockLevel;`.

In `fillMteForm`, replace the `if (data.category) { … }` block with:

```ts
  const sel = inForm("wz-select.category") as HTMLElement & { value: string };
  sel.value = data.category;
  sel.dispatchEvent(new CustomEvent("change", { bubbles: true, composed: true }));
  await sleep(150);

  // Lock chips are wz-checkable-chip#lockRank-0..3 (level 1..4).
  inForm(`wz-checkable-chip#lockRank-${data.lockLevel - 1}`)?.click();
  await sleep(150);
```

`slowupFormData` gains a third parameter `options: MteEventOptions` and returns `category: options.category, lockLevel: options.lockLevel` instead of `category: "SPORTING_EVENT"`. `manualFormData` gains the same parameter and returns `category: options.category, lockLevel: options.lockLevel` instead of `category: null`. Update both doc comments ("catégorie choisie dans la fenêtre Préparer le MTE").

- [ ] **Step 4: Rewrite `src/ui/promptMteInfo.ts`**

```ts
// Fenêtre « Préparer le MTE » : catégorie et niveau de verrouillage toujours ;
// titre / dates / description / URL seulement hors slowUp (l'API
// SchweizMobil les fournit pour un slowUp).

import i18next from "i18next";
import {
  DEFAULT_MTE_OPTIONS,
  MTE_NAME_MAX,
  categoryOptions,
  lockLevelOptions,
  type LockLevel,
  type MteEventOptions,
} from "../mte/mteFormFiller";
import type { MajorTrafficEventCategory } from "wme-sdk-typings";
import {
  dateTimeInput,
  readValue,
  wzChipSelect,
  wzSelect,
  wzTextInput,
  wzTextarea,
} from "./components/wz";
import { wzDialog } from "./components/wzDialog";

export interface ManualMteInfo {
  title: string;
  startDate: string; // "YYYY-MM-DDTHH:mm" (datetime-local)
  endDate: string; // "YYYY-MM-DDTHH:mm" (datetime-local)
  description: string;
  urlLink: string; // "" si absente
}

export interface MteInfoResult {
  options: MteEventOptions;
  /** null quand les détails viennent de l'API slowUp. */
  manual: ManualMteInfo | null;
}

/** Renvoie un message d'erreur i18n, ou null si la saisie est valide. */
export function validateManualMteInfo(info: ManualMteInfo): string | null {
  if (!info.title || !info.startDate || !info.endDate) {
    return i18next.t("panel.mteInfo.errorRequired");
  }
  if (info.endDate < info.startDate) return i18next.t("panel.mteInfo.errorDates");
  return null;
}

export async function promptMteInfo(defaults: {
  title: string;
  userRank: number;
  askDetails: boolean;
}): Promise<MteInfoResult | null> {
  const category = wzSelect({
    label: i18next.t("panel.mteInfo.category"),
    value: DEFAULT_MTE_OPTIONS.category,
    options: categoryOptions(),
  });
  const lockLevel = wzChipSelect({
    label: i18next.t("panel.mteInfo.lockLevel"),
    value: String(DEFAULT_MTE_OPTIONS.lockLevel),
    options: lockLevelOptions(defaults.userRank).map((option) => ({
      value: String(option.value),
      label: String(option.value),
      disabled: option.disabled,
    })),
  });

  // Limite WME du nom d'un MTE ; maxLength ne tronque pas la valeur par défaut.
  const title = wzTextInput({
    label: i18next.t("panel.mteInfo.titleLabel"),
    value: defaults.title.slice(0, MTE_NAME_MAX),
    maxLength: MTE_NAME_MAX,
  });
  const start = dateTimeInput({ label: i18next.t("panel.mteInfo.startDate") });
  const end = dateTimeInput({ label: i18next.t("panel.mteInfo.endDate") });
  // Une fermeture d'un jour est le cas courant : on recopie le début.
  start.input.addEventListener("change", () => {
    if (!end.input.value || end.input.value < start.input.value) {
      end.input.value = start.input.value;
    }
  });
  const dates = document.createElement("div");
  dates.className = "wmegj-row";
  dates.append(start.root, end.root);
  const description = wzTextarea({ label: i18next.t("panel.mteInfo.description") });
  const url = wzTextInput({ label: i18next.t("panel.mteInfo.url"), type: "url" });

  const body = defaults.askDetails
    ? [category, dates, title, description, url, lockLevel.root]
    : [category, lockLevel.root];

  let result: MteInfoResult | null = null;
  const confirmed = await wzDialog({
    title: i18next.t("panel.mteInfo.title"),
    body,
    primaryLabel: i18next.t("panel.mteInfo.ok"),
    cancelLabel: i18next.t("panel.finalFields.cancel"),
    focus: defaults.askDetails ? start.input : undefined,
    onPrimary: () => {
      const options: MteEventOptions = {
        category: readValue(category) as MajorTrafficEventCategory,
        lockLevel: Number(lockLevel.getValue()) as LockLevel,
      };
      if (!defaults.askDetails) {
        result = { options, manual: null };
        return null;
      }
      const manual: ManualMteInfo = {
        title: readValue(title).trim(),
        startDate: start.input.value,
        endDate: end.input.value,
        description: readValue(description).trim(),
        urlLink: readValue(url).trim(),
      };
      const error = validateManualMteInfo(manual);
      if (error) return error;
      result = { options, manual };
      return null;
    },
  });
  return confirmed ? result : null;
}
```

- [ ] **Step 5: Wire it in `MatchingSubTab.openMtePopup`**

Replace the body from `const refid = …` to the end of the `try` block with (the linked-MTE confirmation now comes first, so the user isn't asked for details they then throw away):

```ts
    const refid = entry.slowupDetails?.refid;
    const slowupPolygon = inflatedTrackPolygon(entry.track.geometry, 500);
    const mteKey = mteKeyOf(entry);

    const stored = mteStore.get(mteKey);
    if (
      stored &&
      !(await confirmDialog({
        title: i18next.t("panel.dialogs.mteLinkedTitle"),
        message: i18next.t("panel.matching.mteAlreadyLinked", { id: stored }),
        confirmLabel: i18next.t("panel.matching.mteCreateAnyway"),
        cancelLabel: i18next.t("panel.finalFields.cancel"),
      }))
    ) {
      return;
    }

    const info = await promptMteInfo({
      title: entry.displayName,
      userRank: this.wmeSDK.State.getUserInfo()?.rank ?? 0,
      askDetails: !refid,
    });
    if (!info) return;

    let source: MtePreparePopupDeps["source"];
    if (refid) source = { refid };
    else if (info.manual) source = { manual: info.manual };
    else return;

    // Remplit le formulaire WME ; l'ID est stocké quand l'utilisateur enregistre.
    try {
      const geometry = slowupPolygon?.geometry ?? null;
      const data =
        "refid" in source
          ? slowupFormData(await fetchSlowupFullDetails(source.refid), geometry, info.options)
          : manualFormData(source.manual, geometry, info.options);
      const draftId = await fillMteForm(this.wmeSDK, data);
      watchMteSaved(this.wmeSDK, draftId, (id) => {
        logger.info(`MTE enregistré : ${draftId} → ${id}`);
        mteStore.set(mteKey, id);
        this.updateLinkedMte(this.registry.getSelected());
      });
      return;
    } catch (err) {
      // Transition : on garde le popup copier-coller en secours.
      logger.warn("Remplissage du formulaire MTE impossible, popup de secours", err);
    }
```

(Task 4 already changed this `confirmModal` to `confirmDialog`; this step moves it above the prompt.) The `openMtePreparePopup({...})` call after the `catch` is unchanged.

- [ ] **Step 6: i18n keys**

FR (`panel.mteInfo`): set `"title": "Préparer le MTE"`, `"description": "Description"` and add:

```json
"category": "Catégorie de l'événement",
"lockLevel": "Niveau de verrouillage",
"categories": {
  "concert": "Concert",
  "construction": "Travaux",
  "crisis": "Situation de crise",
  "demonstration": "Manifestation",
  "drivingAdvisory": "Avis aux conducteurs locaux",
  "holidayFestival": "Célébrations",
  "other": "Autre",
  "parade": "Parade",
  "sportingEvent": "Événement sportif",
  "summit": "Sommet",
  "unplannedDisruption": "Perturbation imprévue"
}
```

EN (`panel.mteInfo`): `"title": "Prepare the MTE"`, `"description": "Description"`, `"category": "Event category"`, `"lockLevel": "Lock level"`, categories `Concert`, `Construction`, `Crisis`, `Demonstration`, `Driving advisory`, `Holiday / festival`, `Other`, `Parade`, `Sporting event`, `Summit`, `Unplanned disruption` (same keys).

- [ ] **Step 7: Run tests and type-check**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src locales
git commit -m "feat(mte): event category and lock level in the Prepare MTE dialog"
```

---

### Task 6: Final fields on the native dialog

**Files:**
- Rewrite: `src/ui/promptFinalFields.ts`
- Test: `src/__tests__/promptFinalFields.test.ts` (new; `promptFinalFieldsDefault.test.ts` stays)

**Interfaces:**
- Consumes: `wzDialog` (Task 3); `wzTextInput`, `wzCheckbox`, `readValue`, `isChecked` (Task 2).
- Produces: unchanged public API — `resolveDefaultMteId`, `PromptFinalFieldsOptions`, `promptFinalFields(options): Promise<FinalFields | null>`. The `el` / `labeledInput` exports are removed (Task 5 removed their last importer).

- [ ] **Step 1: Write the failing test**

`src/__tests__/promptFinalFields.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptFinalFields } from "../ui/promptFinalFields";

vi.spyOn(console, "warn").mockImplementation(() => {});

const inputs = () => [...document.querySelectorAll<HTMLInputElement>("dialog input[type=text]")];
const ok = () => document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!;

afterEach(() => document.body.replaceChildren());

describe("promptFinalFields", () => {
  it("returns the typed fields", async () => {
    const result = promptFinalFields({ defaults: { reason: "slowUp", mteId: "42" } });
    inputs()[2].value = "note";
    ok().click();
    await expect(result).resolves.toEqual({
      reason: "slowUp",
      ignoreTraffic: true,
      mteId: "42",
      comment: "note",
    });
  });

  it("blocks commas in CSV mode but not in apply mode", async () => {
    void promptFinalFields({ defaults: { reason: "a,b" } });
    ok().click();
    expect(document.querySelector(".wmegj-dialog-error")?.textContent).not.toBe("");
    document.body.replaceChildren();

    const applied = promptFinalFields({ defaults: { reason: "a,b" }, mode: "apply" });
    expect(inputs()).toHaveLength(2); // no comment field when applying
    ok().click();
    await expect(applied).resolves.toMatchObject({ reason: "a,b" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/promptFinalFields.test.ts`
Expected: FAIL — the current implementation opens a plain `<dialog>` without `.wmegj-button--primary`.

- [ ] **Step 3: Rewrite the prompt part of `src/ui/promptFinalFields.ts`**

Keep the file header comment (update it: "Native WME dialog collecting the fields required before exporting or applying closures."), keep `resolveDefaultMteId` and `PromptFinalFieldsOptions` as they are, delete `el`, `labeledInput` and the old `promptFinalFields`, and add:

```ts
import { isChecked, readValue, wzCheckbox, wzTextInput } from "./components/wz";
import { wzDialog } from "./components/wzDialog";

export async function promptFinalFields(
  options: PromptFinalFieldsOptions = {},
): Promise<FinalFields | null> {
  const { defaults, mteKey, mode = "download" } = options;
  const isApply = mode === "apply";

  const reason = wzTextInput({
    label: i18next.t(isApply ? "panel.finalFields.reasonApply" : "panel.finalFields.reason"),
    value: defaults?.reason ?? "",
  });
  const ignoreTraffic = wzCheckbox({
    label: i18next.t("panel.finalFields.ignoreTraffic"),
    checked: defaults?.ignoreTraffic ?? true,
  });
  const mteId = wzTextInput({
    label: i18next.t("panel.finalFields.mteId"),
    value: resolveDefaultMteId(defaults?.mteId, mteKey),
  });
  // Only the CSV has a comment column.
  const comment = wzTextInput({
    label: i18next.t("panel.finalFields.comment"),
    value: defaults?.comment ?? "",
  });

  let result: FinalFields | null = null;
  const confirmed = await wzDialog({
    title: i18next.t(isApply ? "panel.finalFields.titleApply" : "panel.finalFields.title"),
    body: isApply ? [reason, ignoreTraffic, mteId] : [reason, ignoreTraffic, mteId, comment],
    primaryLabel: i18next.t(isApply ? "panel.finalFields.okApply" : "panel.finalFields.ok"),
    cancelLabel: i18next.t("panel.finalFields.cancel"),
    focus: reason,
    onPrimary: () => {
      const fields: FinalFields = {
        reason: readValue(reason).trim(),
        ignoreTraffic: isChecked(ignoreTraffic),
        mteId: readValue(mteId).trim(),
        comment: isApply ? "" : readValue(comment).trim(),
      };
      // Commas would break the CSV columns; WME itself accepts them.
      const hasComma = [fields.reason, fields.comment, fields.mteId].some((v) => v.includes(","));
      if (!isApply && hasComma) return i18next.t("panel.finalFields.errorCommaInField");
      result = fields;
      return null;
    },
  });
  return confirmed ? result : null;
}
```

Note: the old apply mode returned the (hidden) comment default; `comment: ""` in apply mode is equivalent because apply never reads `comment`. Check with `grep -n "fields.comment" src -r` — expected only in `buildClosuresCsv.ts`.

- [ ] **Step 4: Run tests**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(ui): final fields on the native WME dialog"
```

---

### Task 7: Closure window on the native dialog

**Files:**
- Modify: `src/ui/components/promptClosureWindow.ts` (keep the types and `closureWindowDefaults`; rewrite `promptClosureWindow`, drop the local `el`)
- Test: `src/__tests__/promptClosureWindow.test.ts` (new)

**Interfaces:**
- Consumes: `wzDialog` (Task 3); `dateTimeInput`, `wzButton`, `wzLabel` (Task 2).
- Produces: unchanged `promptClosureWindow(defaults, mode): Promise<ClosureWindow[] | null>`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/promptClosureWindow.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptClosureWindow } from "../ui/components/promptClosureWindow";

vi.spyOn(console, "warn").mockImplementation(() => {});

const defaults = { date: "2026-10-05", startTime: "09:00", endTime: "17:30" };
const dates = () => [...document.querySelectorAll<HTMLInputElement>("dialog .wmegj-datetime")];
const ok = () => document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!;

afterEach(() => document.body.replaceChildren());

describe("promptClosureWindow", () => {
  it("returns the prefilled window", async () => {
    const result = promptClosureWindow(defaults, "apply");
    ok().click();
    await expect(result).resolves.toEqual([
      { startISO: "2026-10-05T09:00", endISO: "2026-10-05T17:30" },
    ]);
  });

  it("stays open when the end is not after the start", () => {
    void promptClosureWindow(defaults, "apply");
    dates()[1].value = "2026-10-05T09:00";
    ok().click();
    expect(document.querySelector("dialog")).not.toBeNull();
    expect(document.querySelector(".wmegj-dialog-error")?.textContent).not.toBe("");
  });

  it("adds a line on the last line's date and never removes the only line", () => {
    void promptClosureWindow(defaults, "apply");
    const removeButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".wmegj-icon-only")];
    expect(removeButtons()[0].disabled).toBe(true);
    document.querySelector<HTMLButtonElement>(".wmegj-button--text")!.click();
    expect(dates()).toHaveLength(4);
    expect(dates()[2].value).toBe("2026-10-05T09:00");
    expect(removeButtons()[0].disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/promptClosureWindow.test.ts`
Expected: FAIL — no `.wmegj-datetime` / `.wmegj-button--primary` in the current dialog.

- [ ] **Step 3: Rewrite `promptClosureWindow`**

Update the file header comment ("Native WME dialog collecting the closure time windows for CSV-less matching.") and replace the local `el` helper and `promptClosureWindow` with:

```ts
import { dateTimeInput, wzButton, wzLabel } from "./wz";
import { wzDialog } from "./wzDialog";

export async function promptClosureWindow(
  defaults: ClosureWindowDefaults,
  mode: "download" | "apply" = "download",
): Promise<ClosureWindow[] | null> {
  const lines: { start: HTMLInputElement; end: HTMLInputElement }[] = [];
  const linesBox = document.createElement("div");
  linesBox.className = "wmegj-dialog-body";

  const header = document.createElement("div");
  header.className = "wmegj-row";
  const spacer = document.createElement("span");
  spacer.className = "wmegj-row-fixed";
  spacer.style.width = "32px";
  header.append(
    wzLabel(i18next.t("panel.modal.closureWindow.start")),
    wzLabel(i18next.t("panel.modal.closureWindow.end")),
    spacer,
  );

  function refreshRemoveButtons(): void {
    linesBox.querySelectorAll<HTMLButtonElement>(".wmegj-icon-only").forEach((btn) => {
      btn.disabled = lines.length === 1;
    });
  }

  function addLine(date: string): HTMLInputElement {
    const start = dateTimeInput({ value: `${date}T${defaults.startTime}` }).input;
    start.setAttribute("aria-label", i18next.t("panel.modal.closureWindow.start"));
    const end = dateTimeInput({ value: `${date}T${defaults.endTime}` }).input;
    end.setAttribute("aria-label", i18next.t("panel.modal.closureWindow.end"));
    // Picking a start date carries it over to the end, keeping the end time.
    start.addEventListener("change", () => {
      const startDate = start.value.slice(0, 10);
      if (startDate) end.value = `${startDate}T${end.value.slice(11, 16) || defaults.endTime}`;
    });
    const line = { start, end };

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "wmegj-icon-only wmegj-row-fixed";
    removeBtn.title = i18next.t("panel.modal.closureWindow.removeLine");
    const icon = document.createElement("i");
    icon.className = "w-icon w-icon-trash";
    removeBtn.appendChild(icon);
    removeBtn.addEventListener("click", () => {
      lines.splice(lines.indexOf(line), 1);
      row.remove();
      refreshRemoveButtons();
    });

    const row = document.createElement("div");
    row.className = "wmegj-row";
    row.append(start, end, removeBtn);
    linesBox.appendChild(row);
    lines.push(line);
    refreshRemoveButtons();
    return start;
  }

  const addBtn = wzButton({
    text: i18next.t("panel.modal.closureWindow.addLine"),
    variant: "text",
    onClick: () => {
      const prevDate = lines[lines.length - 1]?.start.value.slice(0, 10) || defaults.date;
      addLine(prevDate).focus();
    },
  });
  addBtn.style.alignSelf = "flex-start";

  const firstStart = addLine(defaults.date);

  let windows: ClosureWindow[] = [];
  const confirmed = await wzDialog({
    title: i18next.t("panel.modal.closureWindow.title"),
    body: [header, linesBox, addBtn],
    primaryLabel: i18next.t(
      mode === "apply" ? "panel.modal.closureWindow.apply" : "panel.modal.closureWindow.download",
    ),
    cancelLabel: i18next.t("panel.modal.closureWindow.cancel"),
    focus: firstStart,
    onPrimary: () => {
      const collected: ClosureWindow[] = [];
      for (const line of lines) {
        const start = line.start.value;
        const end = line.end.value;
        if (start === "" || end === "") return i18next.t("panel.modal.closureWindow.errorRequired");
        // "YYYY-MM-DDTHH:MM": lexicographic order is chronological order.
        if (!(start < end)) return i18next.t("panel.modal.closureWindow.errorOrder");
        collected.push({ startISO: start, endISO: end });
      }
      windows = collected;
      return null;
    },
  });
  return confirmed ? windows : null;
}
```

Change `panel.modal.closureWindow.addLine` from "+ Ajouter un horaire" / "+ Add a time slot" to "Ajouter un horaire" / "Add a time slot" (a text button needs no "+").

- [ ] **Step 4: Run tests**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass (including the existing `closureWindowDefaults.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src locales
git commit -m "refactor(ui): closure window on the native WME dialog"
```

---

### Task 8: "Préparer MTE" helper window styling

**Files:**
- Modify: `src/ui/MtePreparePopup.ts` (`injectBaseStyles`, `copyButton`, `candidateRow`)

**Interfaces:**
- Consumes: `TOKEN_FALLBACKS_CSS` (Task 1).

- [ ] **Step 1: Replace `injectBaseStyles`**

```ts
import { TOKEN_FALLBACKS_CSS } from "./styles";

const RUBIK_URL = "https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&display=swap";

function injectBaseStyles(doc: Document): void {
  const font = doc.createElement("link");
  font.rel = "stylesheet";
  font.href = RUBIK_URL;
  doc.head.appendChild(font);

  const style = doc.createElement("style");
  style.textContent = `
    ${TOKEN_FALLBACKS_CSS}
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: Rubik, sans-serif;
      font-size: 14px;
      color: var(--content_p1);
      background: var(--background_default);
    }
    h1 { margin: 0 0 16px; font-size: 20px; font-weight: 500; color: var(--content_default); }
    .row { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
    .row .label, .block-header .label, label.label {
      font-size: 12px; font-weight: 500; color: var(--content_p1);
    }
    .row .label { min-width: 70px; }
    .row .value { flex: 1; overflow-wrap: anywhere; }
    .block { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
    .block-header { display: flex; justify-content: space-between; align-items: center; }
    textarea, input[type="text"] {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 8px;
      background: var(--surface_default);
      color: var(--content_default);
      font: inherit;
      padding: 8px 12px;
    }
    textarea { min-height: 80px; resize: vertical; font-size: 12px; }
    textarea:focus, input[type="text"]:focus {
      outline: none; border-color: var(--primary); background: var(--background_default);
    }
    button {
      border: none;
      border-radius: 100px;
      padding: 6px 14px;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--primary);
      background: var(--surface_default);
      cursor: pointer;
    }
    button:hover { background: var(--surface_variant); }
    button.copy { padding: 4px 10px; font-size: 12px; }
    button.candidate {
      text-align: left;
      border-radius: 8px;
      color: var(--content_p1);
      background: var(--background_default);
      border: 1px solid var(--separator_default);
    }
    button.candidate:hover { background: var(--surface_default); }
    .badge { font-size: 12px; color: var(--content_p3); padding: 4px 0; }
    .divider { border: none; border-top: 1px solid var(--separator_default); margin: 12px 0; }
    .mte-row { display: flex; gap: 8px; align-items: center; }
    .candidates { display: flex; flex-direction: column; gap: 4px; }
    .candidates-header { font-size: 12px; font-weight: 500; margin: 8px 0 2px; }
    .empty { font-size: 12px; color: var(--content_p3); margin: 6px 0 0; }
  `;
  doc.head.appendChild(style);
}
```

- [ ] **Step 2: Type-check, test, build**

Run: `npx tsc --noEmit -p . && npx vitest run && npm run compile`
Expected: all pass, bundle written to `.out/main.user.js`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/MtePreparePopup.ts
git commit -m "style(mte): WME look for the Prepare MTE helper window"
```

---

### Task 9: Rename to "WME Event Closures"

**Files:**
- Modify: `header.js`, `header-dev.template.js`, `main.user.ts:24`, `src/ui/MatchPanel.ts:61`, `locales/en/common.json` + `locales/fr/common.json` (`title`), `README.md` (title + install note)

- [ ] **Step 1: Apply the rename**

- `header.js`: `// @name         WME Event Closures` and `// @description  Turn event tracks (slowUps, rallies…) into WME closures: match the segments, prepare the MTE, apply the closures.`
- `header-dev.template.js`: `// @name         WME Event Closures (dev)` and the same `@description`.
- `main.user.ts`: `scriptName: "WME Event Closures",` (keep `scriptId: "wme-geojson"`).
- `MatchPanel.ts`: `tabLabel.textContent = "Event Closures";`
- Both locales: `"title": "WME Event Closures"`.
- `README.md`: first heading `# WME Event Closures`; add under it:

```markdown
> Formerly **WME GeoJSON**. Tampermonkey installs the renamed script as a new
> one: remove "WME GeoJSON" after installing it. Saved sessions are kept.
```

- [ ] **Step 2: Check no user-visible old name remains**

Run: `grep -rn "WME GeoJSON\|\"GeoJ\"" --include=*.ts --include=*.js --include=*.json --include=*.md . | grep -v node_modules | grep -v releases/ | grep -v docs/superpowers`
Expected: only the README "Formerly **WME GeoJSON**" line.

- [ ] **Step 3: Build and commit**

Run: `npx vitest run && npm run compile`
Expected: pass.

```bash
git add header.js header-dev.template.js main.user.ts src/ui/MatchPanel.ts locales README.md
git commit -m "chore: rename the script to WME Event Closures"
```

---

### Task 10: Lint and browser verification of batch A

**Files:** none new (fixes only if a check fails).

- [ ] **Step 1: Static checks**

Run: `npm run lint && npx tsc --noEmit -p . && npx vitest run && npm run compile`
Expected: no lint errors, no type errors, all tests pass, bundle written.

- [ ] **Step 2: Reload WME with the new build**

Reload the WME tab (the dev userscript `@require`s `.out/main.user.js`). Check the console for `[wme-geojson]` errors and for "Custom element … is not registered" warnings (a warning means a fallback is in use — note which).

- [ ] **Step 3: Check each dialog in WME**

For each, take a screenshot and compare with WME's save dialog (title, body, red "Annuler" left, blue primary right, no ×):

| Dialog | How to open |
|---|---|
| Préparer le MTE (manual) | Matching tab of a non-slowUp line → "Préparer MTE" (confirm "MTE déjà associé" first if linked) |
| MTE déjà associé | same, on a line with a linked MTE |
| Fenêtre de fermeture | "Appliquer les fermetures dans WME" without planning CSV |
| Champs finaux (apply) | continue the previous dialog with "Appliquer" — then **Annuler** (do not apply) |
| Recommencer à zéro ? | matching panel → "Recommencer à zéro" → **Annuler** |

For each dialog also check: Esc cancels; Enter in a text field submits; typing letters in a field does not trigger WME shortcuts; the category `wz-select` opens; lock chips above the editor's rank are disabled; the dialog does not overflow horizontally.

- [ ] **Step 4: Check the renamed tab**

Scripts tab shows "Event Closures" in full.

- [ ] **Step 5: Fix and commit any issue found**

Each fix gets its own commit (`fix(ui): …`). If `dismissible="false"` still shows a × or `componentOnReady` is missing, note it in the commit message and adjust `wzDialog` (e.g. call `showDialog()` after `customElements.whenDefined("wz-dialog")`).
