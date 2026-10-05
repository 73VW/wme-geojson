import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { formatSlowupDate } from "../../lines/displayName";
import type { LineEntry } from "../../lines/types";
import { wzIconButton } from "../components/wz";

export interface LineRowProps {
  entry: LineEntry;
  progress: LineProgress;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
}

/** "25.10.2026 · ✓ Terminé": slowUp date, then the matching progress. */
export function lineSubtitle(entry: LineEntry, progress: LineProgress): string {
  const parts: string[] = [];
  const date = entry.slowupDetails ? formatSlowupDate(entry.slowupDetails.date) : null;
  if (date) parts.push(date);
  if (progress.kind === "done") parts.push(`✓ ${i18next.t("panel.lines.progressDone")}`);
  if (progress.kind === "inProgress") {
    parts.push(i18next.t("panel.summary.inProgress", { percent: progress.percent }));
  }
  return parts.join(" · ");
}

/**
 * One line of the Lignes list as a WME list row (like a venue's "Noms
 * alternatifs"): colour dot + name, date and progress as subtitle, recenter
 * action. Not clickable while its slowUp details are loading.
 */
export class LineRowView {
  readonly root: HTMLElement;

  constructor(props: LineRowProps) {
    const { entry } = props;
    const isLoading = entry.slowupFetchStatus === "loading";

    this.root = document.createElement("wz-list-item");
    this.root.className = isLoading ? "wmegj-line-row wmegj-line-row--loading" : "wmegj-line-row";
    const subtitle = lineSubtitle(entry, props.progress);
    if (subtitle) this.root.setAttribute("subtitle", subtitle);
    if (!isLoading) {
      this.root.setAttribute("clickable", "");
      this.root.title = i18next.t("panel.lines.select");
      this.root.addEventListener("click", () => props.onSelect(entry.id));
    }

    const key = document.createElement("div");
    key.slot = "item-key";
    key.className = "wmegj-line-key";
    const dot = document.createElement("span");
    dot.className = "wmegj-line-pill";
    dot.style.backgroundColor = entry.color;
    const name = document.createElement("span");
    name.className = "wmegj-line-name";
    name.textContent = entry.slowupDetails?.title ?? entry.displayName;
    key.append(dot, name);
    if (entry.slowupFetchStatus === "error") {
      const warn = document.createElement("i");
      warn.className = "w-icon w-icon-alert-info wmegj-line-warning";
      warn.title = i18next.t("panel.lines.detailsError");
      key.appendChild(warn);
    }
    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "wmegj-spinner";
      spinner.title = i18next.t("panel.lines.detailsLoading");
      key.appendChild(spinner);
    }

    const actions = document.createElement("div");
    actions.slot = "actions";
    actions.appendChild(
      wzIconButton("w-icon-recenter", i18next.t("panel.lines.center"), () =>
        props.onCenter(entry.id),
      ),
    );

    this.root.append(key, actions);
  }
}
