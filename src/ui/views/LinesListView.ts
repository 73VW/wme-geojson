import { i18next } from "../../../locales/i18n";
import { wzButton, wzTextInput } from "../components/wz";
import type { LineEntry } from "../../lines/types";
import { LineRowView } from "./LineRowView";

export interface LinesListProps {
  onLoadUrl: (url: string) => void;
  onClearUrl: () => void;
  onLoadFile: (file: File) => void;
  onClearFile: () => void;
  onSelect: (id: string) => void;
  onCenterAll: () => void;
  onCenterLine: (id: string) => void;
}

/**
 * Pure DOM view for the Lignes sub-tab: URL input + Load button, an inline
 * error slot, a source-type info line, and the list of LineRowViews.
 *
 * Uses the WME web components (wz-text-input / wz-button) so the sub-tab
 * matches the editor's native look.
 */
export class LinesListView {
  readonly root: HTMLElement;
  private readonly urlInputHost: HTMLElement;
  private currentUrl = "";
  private readonly errorEl: HTMLElement;
  private readonly sourceEl: HTMLElement;
  private readonly centerBtn: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly onSelect: (id: string) => void;
  private readonly onCenterLine: (id: string) => void;
  private readonly fileBadgeEl: HTMLDivElement;
  private readonly fileBadgeNameEl: HTMLSpanElement;
  private readonly clearUrlBtn: HTMLButtonElement;

  constructor(props: LinesListProps) {
    this.onSelect = props.onSelect;
    this.onCenterLine = props.onCenterLine;
    this.root = document.createElement("div");
    this.root.classList.add("wmegj-panel-root");

    const urlRow = document.createElement("section");
    urlRow.className = "wmegj-section";

    const urlLabelEl = document.createElement("p");
    urlLabelEl.className = "wmegj-input-label";
    urlLabelEl.textContent = i18next.t("panel.lines.urlLabel");
    urlRow.appendChild(urlLabelEl);

    // Wraps just the input (no label) so the "×" can be absolutely
    // positioned against the input's own box, like a native clear icon.
    const urlFieldWrap = document.createElement("div");
    urlFieldWrap.style.position = "relative";

    this.urlInputHost = wzTextInput({
      type: "url",
      placeholder: "https://…",
      onInput: (value) => {
        this.currentUrl = value;
      },
    });
    urlFieldWrap.appendChild(this.urlInputHost);

    const clearUrlBtn = document.createElement("button");
    clearUrlBtn.className = "wmegj-url-clear";
    clearUrlBtn.style.position = "absolute";
    clearUrlBtn.style.right = "8px";
    clearUrlBtn.style.top = "50%";
    clearUrlBtn.style.transform = "translateY(-50%)";
    clearUrlBtn.style.background = "none";
    clearUrlBtn.style.border = "none";
    clearUrlBtn.style.cursor = "pointer";
    clearUrlBtn.style.fontSize = "16px";
    clearUrlBtn.style.lineHeight = "1";
    clearUrlBtn.style.padding = "2px";
    clearUrlBtn.style.display = "none";
    clearUrlBtn.textContent = "×";
    clearUrlBtn.title = i18next.t("panel.lines.urlClear");
    clearUrlBtn.addEventListener("click", () => props.onClearUrl());
    urlFieldWrap.appendChild(clearUrlBtn);

    urlRow.appendChild(urlFieldWrap);
    this.clearUrlBtn = clearUrlBtn;

    const loadBtn = wzButton({
      text: i18next.t("panel.lines.urlLoad"),
      variant: "primary",
      onClick: () => props.onLoadUrl(this.currentUrl.trim()),
    });
    loadBtn.classList.add("wmegj-load-btn");
    urlRow.appendChild(loadBtn);

    this.errorEl = document.createElement("p");
    this.errorEl.className = "wmegj-url-error";
    this.errorEl.style.display = "none";
    urlRow.appendChild(this.errorEl);

    this.root.appendChild(urlRow);

    const fileRow = document.createElement("section");
    fileRow.className = "wmegj-section";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".geojson,.gpx,.kml,.kmz";
    fileInput.style.display = "none";
    fileRow.appendChild(fileInput);

    const chooseBtn = wzButton({
      text: "📂 Choisir un fichier (.geojson / .gpx / .kml / .kmz)",
      variant: "secondary",
      onClick: () => fileInput.click(),
    });
    fileRow.appendChild(chooseBtn);

    const fileBadgeEl = document.createElement("div");
    fileBadgeEl.className = "wmegj-file-badge";
    fileBadgeEl.style.display = "none";
    fileBadgeEl.style.marginTop = "6px";
    fileBadgeEl.style.alignItems = "center";
    fileBadgeEl.style.gap = "6px";

    const fileBadgeNameEl = document.createElement("span");
    fileBadgeNameEl.className = "wmegj-file-badge-name";
    fileBadgeEl.appendChild(fileBadgeNameEl);

    const clearBtn = document.createElement("button");
    clearBtn.className = "wmegj-file-badge-clear";
    clearBtn.style.background = "none";
    clearBtn.style.border = "none";
    clearBtn.style.cursor = "pointer";
    clearBtn.style.padding = "0";
    clearBtn.style.fontSize = "14px";
    clearBtn.textContent = "×";
    clearBtn.addEventListener("click", () => props.onClearFile());
    fileBadgeEl.appendChild(clearBtn);

    fileRow.appendChild(fileBadgeEl);

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) props.onLoadFile(file);
    });

    this.fileBadgeEl = fileBadgeEl;
    this.fileBadgeNameEl = fileBadgeNameEl;

    this.root.appendChild(fileRow);

    this.sourceEl = document.createElement("p");
    this.sourceEl.className = "wmegj-source-line";
    this.root.appendChild(this.sourceEl);

    this.centerBtn = wzButton({
      text: i18next.t("panel.lines.centerAll"),
      variant: "secondary",
      onClick: props.onCenterAll,
    });
    this.centerBtn.style.display = "none";
    this.centerBtn.style.margin = "4px 0 8px";
    this.root.appendChild(this.centerBtn);

    this.listEl = document.createElement("section");
    this.listEl.className = "wmegj-section";
    this.root.appendChild(this.listEl);
  }

  /** Pre-fill the URL field (e.g. from the query param). */
  setUrl(url: string): void {
    this.currentUrl = url;
    // The wz host exposes `.value`; the plain-input fallback nests an <input>.
    (this.urlInputHost as unknown as { value?: string }).value = url;
    this.urlInputHost.setAttribute("value", url);
    const nested = this.urlInputHost.querySelector("input");
    if (nested) nested.value = url;
  }

  /** Show or hide the "×" button that clears a URL-loaded track. */
  setUrlLoaded(loaded: boolean): void {
    this.clearUrlBtn.style.display = loaded ? "inline" : "none";
  }

  setEntries(entries: readonly LineEntry[]): void {
    this.listEl.replaceChildren();
    if (entries.length === 0) {
      this.sourceEl.textContent = "";
      this.centerBtn.style.display = "none";
      const empty = document.createElement("p");
      empty.className = "wmegj-lines-empty";
      empty.textContent = i18next.t("panel.lines.empty");
      this.listEl.appendChild(empty);
      return;
    }
    this.sourceEl.textContent =
      entries.length === 1
        ? i18next.t("panel.lines.sourceFeature")
        : i18next.t("panel.lines.sourceCollection", { count: entries.length });
    this.centerBtn.style.display = "";
    for (const entry of entries) {
      const row = new LineRowView({ entry, onSelect: this.onSelect, onCenter: this.onCenterLine });
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

  /** Show or hide the file badge. Pass null to hide. */
  setLoadedFile(name: string | null): void {
    if (name !== null) {
      this.fileBadgeNameEl.textContent = `📄 ${name}`;
      this.fileBadgeEl.style.display = "flex";
    } else {
      this.fileBadgeEl.style.display = "none";
    }
  }
}
