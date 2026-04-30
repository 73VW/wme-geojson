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
  const isRegistered = typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;

  if (!isRegistered) {
    warnMissingTag(tagName);
    // Plain button fallback — functionally equivalent, less fancy.
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = props.text;
    btn.disabled = props.disabled ?? false;
    if (props.onClick) {
      btn.addEventListener("click", props.onClick);
    }
    return btn;
  }

  const el = document.createElement(tagName);
  el.setAttribute("text", props.text);
  if (props.variant) {
    el.setAttribute("variant", props.variant);
  }
  if (props.disabled) {
    el.setAttribute("disabled", "");
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
  const isRegistered = typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;

  if (!isRegistered) {
    warnMissingTag(tagName);
    const wrapper = document.createElement("div");
    if (props.label) {
      const lbl = document.createElement("label");
      lbl.textContent = props.label;
      lbl.style.display = "block";
      lbl.style.fontSize = "12px";
      lbl.style.fontWeight = "600";
      lbl.style.marginBottom = "2px";
      wrapper.appendChild(lbl);
    }
    const input = document.createElement("input");
    input.type = props.type ?? "text";
    input.value = props.value ?? "";
    input.placeholder = props.placeholder ?? "";
    input.disabled = props.disabled ?? false;
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
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
  if (props.label) el.setAttribute("label", props.label);
  if (props.value) el.setAttribute("value", props.value);
  if (props.placeholder) el.setAttribute("placeholder", props.placeholder);
  if (props.type) el.setAttribute("type", props.type);
  if (props.disabled) el.setAttribute("disabled", "");
  if (props.onInput) {
    const handler = props.onInput;
    el.addEventListener("input", (e: Event) => {
      // wz-text-input fires a standard InputEvent whose target is the inner
      // input; read .value from the host element via unknown cast since the
      // custom element type is not in our typings.
      const value = (el as unknown as { value: string }).value ?? (e.target as HTMLInputElement).value ?? "";
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
  onFile?: (file: File) => void;
}

/**
 * Return a raw <input type="file"> styled via the `wmegj-file-input` CSS class.
 * We keep this as a plain input — wz-file-input is not consistently available
 * across WME builds, and a native file input is perfectly functional.
 */
export function fileInput(props: FileInputProps): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = props.accept;
  input.className = "wmegj-file-input";
  if (props.onFile) {
    const handler = props.onFile;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) handler(file);
    });
  }
  return input;
}
