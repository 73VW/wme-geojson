// The Matching sidebar's three steps — 1. Correspondance, 2. MTE,
// 3. Fermetures — each ticked when done, with a single primary button: the
// next step's. Pure DOM; MatchingSubTab computes the state.

import { i18next } from "../../../locales/i18n";
import type { LineProgress } from "../../domain/lineProgress";
import { wzButton } from "../components/wz";

/** null: no MTE linked. `name: null`: linked, but not loaded in WME. */
export type LinkedMte = { name: string | null } | null;

export interface StepsState {
  matching: LineProgress;
  resumeAt: { line: number; subLine: number } | null;
  linkedMte: LinkedMte;
  canPrepareMte: boolean;
  applying: boolean;
}

export function nextStep(state: StepsState): 1 | 2 | 3 {
  if (state.matching.kind !== "done") return 1;
  if (state.linkedMte === null) return 2;
  return 3;
}

type Variant = "primary" | "secondary";

/** Switch a wz-button (or its fallback <button>) between primary and secondary. */
function setVariant(button: HTMLElement, variant: Variant): void {
  button.setAttribute("color", variant);
  (button as unknown as { color?: string }).color = variant;
  button.classList.toggle("wmegj-button--primary", variant === "primary");
  button.classList.toggle("wmegj-button--secondary", variant === "secondary");
}

function setDisabled(button: HTMLElement, disabled: boolean): void {
  button.toggleAttribute("disabled", disabled);
  (button as unknown as { disabled?: boolean }).disabled = disabled;
}

function setText(button: HTMLElement, text: string): void {
  button.textContent = text;
  (button as unknown as { text?: string }).text = text;
}

interface StepParts {
  root: HTMLElement;
  badge: HTMLElement;
  note: HTMLElement;
}

function buildStep(number: number, title: string, ...content: HTMLElement[]): StepParts {
  const root = document.createElement("wz-card");
  root.className = "wmegj-step";
  root.setAttribute("size", "sm");
  root.setAttribute("variant", "elevated");
  root.setAttribute("elevation", "0");
  const header = document.createElement("div");
  header.className = "wmegj-card-header";
  const badge = document.createElement("span");
  badge.className = "wmegj-step-badge";
  badge.textContent = String(number);
  const titleEl = document.createElement("wz-subhead5");
  titleEl.className = "wmegj-step-title";
  titleEl.textContent = title;
  header.append(badge, titleEl);
  const note = document.createElement("p");
  note.className = "wmegj-caption";
  const body = document.createElement("div");
  body.className = "wmegj-step-body";
  body.append(header, note, ...content);
  root.append(body);
  return { root, badge, note };
}

export class MatchingStepsView {
  readonly root: HTMLElement;
  /** Progress / report of "Appliquer" — written by MatchingSubTab. */
  readonly applyStatusEl: HTMLElement;
  private readonly steps: StepParts[];
  private readonly matchingBtn: HTMLElement;
  private readonly mteBtn: HTMLElement;
  private readonly applyBtn: HTMLElement;
  private readonly csvBtn: HTMLElement;

  constructor(props: {
    onOpenMatching: () => void;
    onPrepareMte: () => void;
    onApply: () => void;
    onDownloadCsv: () => void;
  }) {
    this.matchingBtn = wzButton({ text: "", variant: "primary", onClick: props.onOpenMatching });
    this.mteBtn = wzButton({
      text: i18next.t("panel.steps.prepareMte"),
      variant: "secondary",
      onClick: props.onPrepareMte,
    });
    this.applyBtn = wzButton({
      text: i18next.t("panel.applyClosures"),
      variant: "secondary",
      onClick: props.onApply,
    });
    this.csvBtn = wzButton({
      text: i18next.t("panel.steps.csvFallback"),
      variant: "text",
      onClick: props.onDownloadCsv,
    });
    this.applyStatusEl = document.createElement("div");
    this.applyStatusEl.className = "wmegj-caption wmegj-apply-status";

    this.steps = [
      buildStep(1, i18next.t("panel.steps.matching"), this.matchingBtn),
      buildStep(2, i18next.t("panel.steps.mte"), this.mteBtn),
      buildStep(
        3,
        i18next.t("panel.steps.closures"),
        this.applyBtn,
        this.csvBtn,
        this.applyStatusEl,
      ),
    ];

    this.root = document.createElement("div");
    this.root.className = "wmegj-steps";
    this.root.append(...this.steps.map((step) => step.root));
  }

  setState(state: StepsState): void {
    const next = nextStep(state);
    const matchingDone = state.matching.kind === "done";
    const done = [matchingDone, state.linkedMte !== null, false];
    this.steps.forEach((step, index) => {
      step.root.classList.toggle("is-next", index + 1 === next);
      step.root.setAttribute("elevation", index + 1 === next ? "1" : "0");
      step.root.classList.toggle("is-done", done[index]);
      step.badge.textContent = done[index] ? "✓" : String(index + 1);
    });

    // 1. Matching
    setText(this.matchingBtn, this.matchingLabel(state));
    setVariant(this.matchingBtn, next === 1 ? "primary" : "secondary");

    // 2. MTE
    this.steps[1].note.textContent = this.mteNote(state.linkedMte);
    setVariant(this.mteBtn, next === 2 ? "primary" : "secondary");
    setDisabled(this.mteBtn, !state.canPrepareMte);
    this.mteBtn.title = state.canPrepareMte ? "" : i18next.t("panel.matching.prepareMteDisabled");

    // 3. Closures — usable without an MTE once matching is complete.
    const closuresBlocked = !matchingDone || state.applying;
    setVariant(this.applyBtn, next === 3 ? "primary" : "secondary");
    setDisabled(this.applyBtn, closuresBlocked);
    setDisabled(this.csvBtn, closuresBlocked);
    const blockedTitle = matchingDone ? "" : i18next.t("panel.applyClosuresDisabled");
    this.applyBtn.title = blockedTitle;
    this.csvBtn.title = blockedTitle;
  }

  private matchingLabel(state: StepsState): string {
    if (state.resumeAt) return i18next.t("panel.steps.resume", state.resumeAt);
    if (state.matching.kind === "done") return i18next.t("panel.steps.review");
    return i18next.t("panel.steps.open");
  }

  private mteNote(linked: LinkedMte): string {
    if (linked === null) return "";
    if (linked.name) return i18next.t("panel.steps.mteLinked", { name: linked.name });
    return i18next.t("panel.steps.mteLinkedUnloaded");
  }
}
