// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { StepNavView } from "../ui/views/StepNavView";

const state = {
  label: "Ligne 1/1 · sous-ligne 3/8",
  caption: "9.10 → 14.30 km",
  validated: true,
  canPrev: true,
  canNext: false,
};

describe("StepNavView", () => {
  it("shows the step and its window, ticked when validated", () => {
    const view = new StepNavView({ onPrev: vi.fn(), onNext: vi.fn() });
    view.setState(state);
    expect(view.root.textContent).toContain("Ligne 1/1 · sous-ligne 3/8");
    expect(view.root.textContent).toContain("9.10 → 14.30 km");
    expect(view.root.classList.contains("is-validated")).toBe(true);
  });

  it("moves with ‹ › and disables them at the ends or while busy", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const view = new StepNavView({ onPrev, onNext });
    view.setState(state);
    const [prev, next] = [...view.root.querySelectorAll<HTMLButtonElement>("button")];
    prev.click();
    expect(onPrev).toHaveBeenCalled();
    expect(next.disabled).toBe(true);
    view.setState({ ...state, canPrev: false });
    expect(prev.disabled).toBe(true);
  });
});
