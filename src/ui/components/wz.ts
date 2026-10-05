// Typed factories for Waze Web Components.
// WME registers these custom elements on the host page; they are not part of
// the wme-sdk-typings package, so we use document.createElement with HTMLElement
// as the return type. A fallback to plain <button> / <input> makes the script
// functional in non-WME dev environments.

// Guard map: tracks which missing tag names we have already warned about so we
// don't spam the console when the factory is called many times in a session.
const missingTagWarned = new Set<string>();

function warnMissingTag(tagName: string): void {
  if (missingTagWarned.has(tagName)) return;
  missingTagWarned.add(tagName);
  console.warn(
    `[wme-geojson] Custom element <${tagName}> is not registered. ` +
      "Falling back to a plain HTML element. Some styling may differ.",
  );
}

// ---------------------------------------------------------------------------
// wz-button
// ---------------------------------------------------------------------------

export interface WzButtonProps {
  text: string;
  variant?: "primary" | "secondary" | "danger" | "text";
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * Create a <wz-button> element (or plain <button> when WME is not running).
 * Props are passed as attributes; the click handler is attached via addEventListener.
 */
export function wzButton(props: WzButtonProps): HTMLElement {
  const tagName = "wz-button";
  const isRegistered =
    typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;
  const variant = props.variant ?? "secondary";
  const color = variant === "danger" ? "secondary" : variant;

  if (!isRegistered) {
    warnMissingTag(tagName);
    // Plain button fallback — functionally equivalent, less fancy.
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = props.text;
    btn.disabled = props.disabled ?? false;
    btn.className = `wmegj-button wmegj-button--${variant}`;
    if (props.onClick) {
      btn.addEventListener("click", props.onClick);
    }
    return btn;
  }

  const el = document.createElement(tagName);
  el.className = `wmegj-button-host wmegj-button-host--${variant}`;
  el.setAttribute("color", color);
  el.setAttribute("size", "md");
  el.setAttribute("type", "button");
  el.textContent = props.text;
  (el as unknown as { text?: string }).text = props.text;
  (el as unknown as { color?: string }).color = color;
  (el as unknown as { size?: string }).size = "md";
  if (props.disabled) {
    el.setAttribute("disabled", "");
    (el as unknown as { disabled?: boolean }).disabled = true;
  }
  if (props.onClick) {
    el.addEventListener("click", props.onClick);
  }
  return el;
}

// ---------------------------------------------------------------------------
// wz-text-input
// ---------------------------------------------------------------------------

export interface WzTextInputProps {
  label?: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "url";
  disabled?: boolean;
  maxLength?: number;
  onInput?: (value: string) => void;
}

/**
 * Create a <wz-text-input> element (or plain <input> when WME is not running).
 * The `input` event fired by the wz-text-input carries the value in
 * `event.target.value` — same as a native input, so the fallback is identical.
 */
export function wzTextInput(props: WzTextInputProps): HTMLElement {
  const tagName = "wz-text-input";
  const isRegistered =
    typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;

  if (!isRegistered) {
    warnMissingTag(tagName);
    const wrapper = document.createElement("div");
    wrapper.className = "wmegj-input-group";
    if (props.label) {
      const lbl = document.createElement("label");
      lbl.className = "wmegj-input-label";
      lbl.textContent = props.label;
      wrapper.appendChild(lbl);
    }
    const input = document.createElement("input");
    input.className = "wmegj-text-input";
    input.type = props.type ?? "text";
    input.value = props.value ?? "";
    input.placeholder = props.placeholder ?? "";
    input.disabled = props.disabled ?? false;
    if (props.maxLength !== undefined) input.maxLength = props.maxLength;
    if (props.onInput) {
      const handler = props.onInput;
      input.addEventListener("input", () => {
        handler(input.value);
      });
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  const el = document.createElement(tagName);
  el.className = "wmegj-text-input-host";
  if (props.label) el.setAttribute("label", props.label);
  if (props.value) el.setAttribute("value", props.value);
  if (props.placeholder) el.setAttribute("placeholder", props.placeholder);
  if (props.type) el.setAttribute("type", props.type);
  if (props.disabled) el.setAttribute("disabled", "");
  if (props.maxLength !== undefined) el.setAttribute("maxlength", String(props.maxLength));
  (el as unknown as { value?: string }).value = props.value ?? "";
  (el as unknown as { placeholder?: string }).placeholder = props.placeholder ?? "";
  if (props.label) {
    (el as unknown as { label?: string }).label = props.label;
  }
  if (props.disabled) {
    (el as unknown as { disabled?: boolean }).disabled = true;
  }
  if (props.onInput) {
    const handler = props.onInput;
    el.addEventListener("input", (e: Event) => {
      // wz-text-input fires a standard InputEvent whose target is the inner
      // input; read .value from the host element via unknown cast since the
      // custom element type is not in our typings.
      const value =
        (el as unknown as { value: string }).value ?? (e.target as HTMLInputElement).value ?? "";
      handler(value);
    });
  }
  return el;
}

// ---------------------------------------------------------------------------
// wz-tabs
// ---------------------------------------------------------------------------

export interface WzTabSpec {
  /** Tab label shown in the tab bar. */
  label: string;
  /** Tab body content. */
  content: HTMLElement;
}

export interface WzTabsHandle {
  /** The root element to insert into the DOM. */
  root: HTMLElement;
  /** Activate the tab at `index` (0-based). */
  setActiveTab(index: number): void;
}

/**
 * Create a <wz-tabs> element with one <wz-tab> per spec (or a plain
 * button-toggle fallback when WME is not running).
 */
export function wzTabs(tabs: WzTabSpec[]): WzTabsHandle {
  const tagName = "wz-tabs";
  const isRegistered =
    typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;

  if (isRegistered) {
    let activeTabIndex = 0;
    const tabsEl = document.createElement(tagName);
    tabsEl.setAttribute("fixed", "");
    const tabEls: HTMLElement[] = [];
    tabs.forEach((spec, index) => {
      const tabEl = document.createElement("wz-tab");
      tabEl.setAttribute("label", spec.label);
      tabEl.setAttribute("tooltip", spec.label);
      // wz-tabs activates no tab on its own — mark the first one active so the
      // panel opens on a populated tab instead of a blank pane.
      if (index === 0) {
        tabEl.setAttribute("is-active", "");
      }
      tabEl.appendChild(spec.content);
      tabsEl.appendChild(tabEl);
      tabEls.push(tabEl);
    });

    // When the sidebar pane is hidden on load (display:none), <wz-tabs> measures
    // the active label at 0 width and the indicator renders as a zero-width line.
    // An IntersectionObserver fires once the pane first becomes visible; we then
    // re-click the active shadow label so the component re-measures and sizes the
    // indicator correctly.
    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            const labels = tabsEl.shadowRoot?.querySelectorAll(".wz-tab-label");
            const label = labels?.[activeTabIndex];
            if (label instanceof HTMLElement) {
              label.click();
            }
            break;
          }
        }
      });
      observer.observe(tabsEl);
    }

    return {
      root: tabsEl,
      setActiveTab(index: number): void {
        activeTabIndex = index;
        // Clicking the matching shadow-DOM label is the reliable mechanism.
        const labels = tabsEl.shadowRoot?.querySelectorAll(".wz-tab-label");
        const label = labels?.[index];
        if (label instanceof HTMLElement) {
          label.click();
        } else {
          // Fallback if the shadow bar has not rendered yet: drive is-active.
          tabEls.forEach((t, i) => {
            if (i === index) t.setAttribute("is-active", "");
            else t.removeAttribute("is-active");
          });
        }
      },
    };
  }

  warnMissingTag(tagName);
  // Plain button-toggle fallback for non-WME / test environments.
  const root = document.createElement("div");
  const toggle = document.createElement("div");
  toggle.className = "wmegj-subtab-toggle";
  const buttons: HTMLButtonElement[] = [];
  root.appendChild(toggle);

  const setActiveTab = (index: number): void => {
    tabs.forEach((spec, i) => {
      spec.content.style.display = i === index ? "" : "none";
      buttons[i]?.classList.toggle("wmegj-subtab-active", i === index);
    });
  };

  tabs.forEach((spec, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = spec.label;
    btn.addEventListener("click", () => setActiveTab(i));
    toggle.appendChild(btn);
    buttons.push(btn);
    root.appendChild(spec.content);
  });

  setActiveTab(0);

  return { root, setActiveTab };
}

// ---------------------------------------------------------------------------
// file input (raw <input type="file">)
// ---------------------------------------------------------------------------

export interface FileInputProps {
  accept: string;
  buttonLabel?: string;
  onFile?: (file: File) => void;
}

/**
 * Create a <wz-file-input> when WME exposes it, otherwise fall back to a
 * native <input type="file">. In both cases the selected value is cleared
 * after handling so re-selecting the same file still emits an event.
 */
export function fileInput(props: FileInputProps): HTMLElement {
  const tagName = "wz-file-input";
  const isRegistered =
    typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;

  if (isRegistered) {
    const el = document.createElement(tagName);
    el.className = "wmegj-file-input-host";
    el.setAttribute("accepted-file-types", props.accept);
    el.setAttribute("max-files-batch-size", "1");
    el.setAttribute("max-file-size-bytes", String(Number.MAX_VALUE));
    el.setAttribute("enable-drag-and-drop", "");
    if (props.buttonLabel) {
      el.setAttribute("upload-button-label", props.buttonLabel);
    }

    if (props.onFile) {
      const handler = props.onFile;
      const resetNestedInput = () => {
        const nestedInput = findNestedFileInput(el);
        if (nestedInput) {
          nestedInput.value = "";
        }
      };

      el.addEventListener(
        "click",
        () => {
          resetNestedInput();
        },
        { capture: true },
      );

      el.addEventListener("filesSelected", (event: Event) => {
        const file = getFirstSelectedFile((event as CustomEvent<unknown>).detail);
        if (file) {
          handler(file);
        }
        resetNestedInput();
      });

      queueMicrotask(() => {
        resetNestedInput();
      });
    }

    return el;
  }

  warnMissingTag(tagName);
  const input = document.createElement("input");
  input.type = "file";
  input.accept = props.accept;
  input.className = "wmegj-file-input wmegj-text-input";
  if (props.onFile) {
    const handler = props.onFile;
    input.addEventListener("click", () => {
      input.value = "";
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) {
        handler(file);
      }
      input.value = "";
    });
  }
  return input;
}

function findNestedFileInput(root: ParentNode): HTMLInputElement | null {
  if ("querySelector" in root) {
    const directMatch = root.querySelector("input[type='file']");
    if (directMatch instanceof HTMLInputElement) {
      return directMatch;
    }
  }

  if (!(root instanceof DocumentFragment) && !(root instanceof Element)) {
    return null;
  }

  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    const shadowRoot = child.shadowRoot;
    if (!shadowRoot) {
      continue;
    }

    const nestedMatch = findNestedFileInput(shadowRoot);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function getFirstSelectedFile(detail: unknown): File | null {
  if (detail instanceof File) {
    return detail;
  }

  if (detail instanceof FileList) {
    return detail[0] ?? null;
  }

  if (Array.isArray(detail)) {
    return detail.find((item): item is File => item instanceof File) ?? null;
  }

  if (typeof detail === "object" && detail !== null) {
    const detailRecord = detail as Record<string, unknown>;
    const files = detailRecord["files"];
    if (files instanceof FileList) {
      return files[0] ?? null;
    }
    if (Array.isArray(files)) {
      return files.find((item): item is File => item instanceof File) ?? null;
    }
  }

  return null;
}

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
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      select.appendChild(optionEl);
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
    if (useChips) {
      el.setAttribute("size", "md");
      // Otherwise the chip toggles itself after our handler and undoes it.
      el.setAttribute("controlled", "");
    }
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

export interface DateTimeField {
  root: HTMLElement;
  /** Date part, with the browser's calendar picker. */
  date: HTMLInputElement;
  /** Time part, typed (no picker), like WME's MTE form. */
  time: HTMLInputElement;
  /** "YYYY-MM-DDTHH:mm", or "" until both parts are filled. */
  getValue(): string;
  setValue(value: string): void;
}

/**
 * Date + time pair laid out like WME's MTE form. WME's own pickers have no
 * documented API, so these are native inputs dressed like wz-text-input.
 */
export function dateTimeInput(props: { label?: string; value?: string }): DateTimeField {
  const date = document.createElement("input");
  date.type = "date";
  date.className = "wmegj-date";
  const time = document.createElement("input");
  time.type = "time";
  time.className = "wmegj-time";
  if (props.label) {
    date.setAttribute("aria-label", props.label);
    time.setAttribute("aria-label", props.label);
  }

  const pair = document.createElement("div");
  pair.className = "wmegj-datetime";
  pair.append(date, time);

  let root: HTMLElement = pair;
  if (props.label) {
    root = document.createElement("div");
    root.className = "wmegj-field";
    root.append(wzLabel(props.label), pair);
  }

  const field: DateTimeField = {
    root,
    date,
    time,
    getValue: () => (date.value && time.value ? `${date.value}T${time.value}` : ""),
    setValue: (value) => {
      const [datePart = "", timePart = ""] = value.split("T");
      date.value = datePart;
      time.value = timePart.slice(0, 5);
    },
  };
  if (props.value) field.setValue(props.value);
  return field;
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
