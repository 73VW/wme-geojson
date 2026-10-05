import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { SLOWUPS_GEOJSON_URL } from "../../lines/slowupClient";
import type { LineEntry } from "../../lines/types";
import {
  fileInput,
  readValue,
  wzButton,
  wzIconButton,
  wzLabel,
  wzTextInput,
} from "../components/wz";
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
  private readonly cardIconEl: HTMLElement;
  private readonly sourceSection: HTMLElement;
  private readonly linesSection: HTMLElement;
  private readonly loader: HTMLElement;
  private readonly changeBtn: HTMLElement;
  private readonly listEl: HTMLElement;
  private hasSource = false;
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
    this.cardEl = document.createElement("wz-card");
    this.cardEl.setAttribute("size", "sm");
    this.cardEl.setAttribute("variant", "elevated");
    this.cardEl.setAttribute("elevation", "0");
    this.cardEl.className = "wmegj-source-card";
    const header = document.createElement("div");
    header.className = "wmegj-card-header";
    this.cardIconEl = document.createElement("i");
    this.cardNameEl = document.createElement("wz-subhead5");
    this.cardNameEl.className = "wmegj-source-name";
    const actions = document.createElement("div");
    actions.className = "wmegj-card-actions";
    const centerAll = wzIconButton(
      "w-icon-recenter",
      i18next.t("panel.lines.centerAll"),
      props.onCenterAll,
    );
    centerAll.classList.add("wmegj-source-center");
    const clear = wzIconButton(
      "w-icon-x",
      i18next.t("panel.lines.clearSource"),
      props.onClearSource,
    );
    clear.classList.add("wmegj-source-clear");
    actions.append(centerAll, clear);
    header.append(this.cardIconEl, this.cardNameEl, actions);
    this.cardCountEl = document.createElement("wz-caption");
    this.cardCountEl.className = "wmegj-source-count";
    this.cardEl.append(header, this.cardCountEl);

    this.sourceSection = document.createElement("section");
    this.sourceSection.className = "wmegj-section";
    this.sourceSection.append(wzLabel(i18next.t("panel.lines.sourceTitle")), this.cardEl);

    this.changeBtn = wzButton({
      text: i18next.t("panel.lines.changeSource"),
      variant: "text",
      onClick: () => this.setLoaderOpen(true),
    });
    this.changeBtn.classList.add("wmegj-change-source");

    this.loader = document.createElement("div");
    this.loader.className = "wmegj-section wmegj-loader";
    this.loader.append(slowupsBtn, other);

    this.listEl = document.createElement("wz-list");
    this.listEl.className = "wmegj-line-list";
    this.linesSection = document.createElement("section");
    this.linesSection.className = "wmegj-section";
    this.linesSection.append(wzLabel(i18next.t("panel.lines.linesTitle")), this.listEl);

    this.setSource(null);
    this.root.append(
      this.sourceSection,
      this.changeBtn,
      this.loader,
      this.errorEl,
      this.linesSection,
    );
  }

  private setLoaderOpen(open: boolean): void {
    this.loader.hidden = !open;
    this.changeBtn.hidden = open || !this.hasSource;
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
    this.hasSource = source !== null;
    this.sourceSection.hidden = !this.hasSource;
    this.cardEl.hidden = !this.hasSource;
    this.linesSection.hidden = !this.hasSource;
    this.setLoaderOpen(!this.hasSource);
    if (source) {
      this.cardNameEl.textContent = sourceName(source);
      this.cardIconEl.className = `w-icon ${source.kind === "file" ? "w-icon-script" : "w-icon-link"}`;
    }
  }

  setEntries(entries: readonly LineEntry[], progressOf: (id: string) => LineProgress): void {
    this.cardCountEl.textContent = i18next.t("panel.lines.lineCount", { count: entries.length });
    this.listEl.replaceChildren();
    if (entries.length === 0) {
      if (this.hasSource) {
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
