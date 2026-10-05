// Header of the Matching sub-tab: back to the Lignes list, the line name,
// and "length · progress". The progress comes from the same persisted Source
// as the Lignes rows, so both always agree.

import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { wzIconButton } from "../components/wz";

export class MatchingHeaderView {
  readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly summaryEl: HTMLElement;

  constructor(props: { onBack: () => void }) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-header";

    const back = wzIconButton("w-icon-arrow-left", i18next.t("panel.matching.back"), props.onBack);
    back.classList.add("wmegj-back");

    const kicker = document.createElement("p");
    kicker.className = "wmegj-header-kicker";
    kicker.textContent = i18next.t("panel.matching.kicker");

    this.titleEl = document.createElement("h3");
    this.titleEl.className = "wmegj-header-title";

    this.summaryEl = document.createElement("p");
    this.summaryEl.className = "wmegj-caption wmegj-header-summary";

    const column = document.createElement("div");
    column.append(kicker, this.titleEl, this.summaryEl);
    this.root.append(back, column);
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
