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
  variant?: "primary" | "secondary" | "danger";
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
