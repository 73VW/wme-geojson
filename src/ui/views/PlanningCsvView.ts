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
