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
  const variant = props.variant ?? "secondary";

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
  el.setAttribute("text", props.text);
  el.textContent = props.text;
  (el as unknown as { text?: string }).text = props.text;
  el.setAttribute("variant", variant);
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
  const isRegistered = typeof customElements !== "undefined" && customElements.get(tagName) !== undefined;

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
  input.className = "wmegj-file-input wmegj-text-input";
  if (props.onFile) {
    const handler = props.onFile;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) handler(file);
    });
  }
  return input;
}
