import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { formatSlowupDate } from "../../lines/displayName";
import type { LineEntry } from "../../lines/types";

export interface LineRowProps {
  entry: LineEntry;
  progress: LineProgress;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/**
 * One line of the Lignes list, in WME's list style: colour dot, name (slowUp
 * date underneath), progress, recenter icon. The whole row selects the line,
 * except while its slowUp details are still loading.
 */
export class LineRowView {
  readonly root: HTMLElement;

  constructor(props: LineRowProps) {
    const { entry } = props;
    const isLoading = entry.slowupFetchStatus === "loading";

    this.root = document.createElement("div");
    this.root.className = isLoading ? "wmegj-line-row wmegj-line-row--loading" : "wmegj-line-row";
    if (!isLoading) {
      this.root.title = i18next.t("panel.lines.select");
      this.root.addEventListener("click", () => props.onSelect(entry.id));
    }

    const dot = document.createElement("span");
    dot.className = "wmegj-line-pill";
    dot.style.backgroundColor = entry.color;

    const text = document.createElement("div");
    text.className = "wmegj-line-text";
    const name = document.createElement("span");
    name.className = "wmegj-line-name";
    name.textContent = entry.slowupDetails?.title ?? entry.displayName;
    text.appendChild(name);
    const date = entry.slowupDetails ? formatSlowupDate(entry.slowupDetails.date) : null;
    if (date) {
      const caption = document.createElement("span");
      caption.className = "wmegj-line-caption";
      caption.textContent = date;
      text.appendChild(caption);
    }

    this.root.append(dot, text);

    if (entry.slowupFetchStatus === "error") {
      const warn = document.createElement("i");
      warn.className = "w-icon w-icon-alert-info wmegj-line-warning";
      warn.title = i18next.t("panel.lines.detailsError");
      this.root.appendChild(warn);
    }

    const progressEl = renderProgress(props.progress);
    if (progressEl) this.root.appendChild(progressEl);

    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "wmegj-spinner";
      spinner.title = i18next.t("panel.lines.detailsLoading");
      this.root.appendChild(spinner);
      return;
    }

    const centerBtn = document.createElement("button");
    centerBtn.type = "button";
    centerBtn.className = "wmegj-icon-only";
    centerBtn.title = i18next.t("panel.lines.center");
    const centerIcon = document.createElement("i");
    centerIcon.className = "w-icon w-icon-recenter";
    centerBtn.appendChild(centerIcon);
    centerBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      props.onCenter(entry.id);
    });
    this.root.appendChild(centerBtn);
  }
}

function renderProgress(progress: LineProgress): HTMLElement | null {
  if (progress.kind === "notStarted") return null;
  const el = document.createElement("span");
  el.className = "wmegj-line-progress";
  if (progress.kind === "done") {
    el.classList.add("is-done");
    el.textContent = `✓ ${i18next.t("panel.lines.progressDone")}`;
  } else {
    el.textContent = i18next.t("panel.lines.progressPercent", { percent: progress.percent });
  }
  return el;
}
