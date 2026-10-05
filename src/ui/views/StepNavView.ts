// "‹  Ligne 1/1 · sous-ligne 3/8  ›" with the km window underneath: steps
// through the validated sub-lines (and the one being validated).

export interface StepNavState {
  label: string;
  caption: string;
  validated: boolean;
  canPrev: boolean;
  canNext: boolean;
}

function arrow(icon: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wmegj-icon-only";
  const i = document.createElement("i");
  i.className = `w-icon ${icon}`;
  button.appendChild(i);
  return button;
}

export class StepNavView {
  readonly root: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly captionEl: HTMLElement;

  constructor(props: { onPrev: () => void; onNext: () => void }) {
    this.root = document.createElement("div");
    this.root.className = "wmegj-step-nav";
    this.prev = arrow("w-icon-chevron-left");
    this.next = arrow("w-icon-chevron-right");
    this.prev.addEventListener("click", () => props.onPrev());
    this.next.addEventListener("click", () => props.onNext());

    const text = document.createElement("div");
    text.className = "wmegj-step-nav-text";
    this.labelEl = document.createElement("span");
    this.labelEl.className = "wmegj-step-nav-label";
    this.captionEl = document.createElement("span");
    this.captionEl.className = "wmegj-caption";
    text.append(this.labelEl, this.captionEl);

    this.root.append(this.prev, text, this.next);
  }

  setState(state: StepNavState): void {
    this.labelEl.textContent = state.label;
    this.captionEl.textContent = state.caption;
    this.root.classList.toggle("is-validated", state.validated);
    this.prev.disabled = !state.canPrev;
    this.next.disabled = !state.canNext;
  }
}
