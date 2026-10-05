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
