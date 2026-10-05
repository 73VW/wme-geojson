// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MatchingStepsView, nextStep, type StepsState } from "../ui/views/MatchingStepsView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

const base: StepsState = {
  matching: { kind: "notStarted" },
  resumeAt: null,
  linkedMte: null,
  canPrepareMte: true,
  applying: false,
};

function setup(state: Partial<StepsState>) {
  const props = {
    onOpenMatching: vi.fn(),
    onPrepareMte: vi.fn(),
    onApply: vi.fn(),
    onDownloadCsv: vi.fn(),
  };
  const view = new MatchingStepsView(props);
  view.setState({ ...base, ...state });
  const steps = [...view.root.querySelectorAll<HTMLElement>(".wmegj-step")];
  const primary = view.root.querySelectorAll(".wmegj-button--primary");
  return { view, props, steps, primary };
}

describe("nextStep", () => {
  it("is matching until it is done, then the MTE, then the closures", () => {
    expect(nextStep(base)).toBe(1);
    expect(nextStep({ ...base, matching: { kind: "inProgress", percent: 50 } })).toBe(1);
    expect(nextStep({ ...base, matching: { kind: "done" } })).toBe(2);
    expect(nextStep({ ...base, matching: { kind: "done" }, linkedMte: { name: null } })).toBe(3);
  });
});

describe("MatchingStepsView", () => {
  it("renders the steps as WME cards, the next one raised", () => {
    const { steps } = setup({});
    expect(steps.every((step) => step.tagName === "WZ-CARD")).toBe(true);
    expect(steps[0].getAttribute("elevation")).toBe("1");
    expect(steps[1].getAttribute("elevation")).toBe("0");
  });

  it("has exactly one primary action: the next step's", () => {
    const { steps, primary } = setup({});
    expect(steps).toHaveLength(3);
    expect(primary).toHaveLength(1);
    expect(steps[0].contains(primary[0])).toBe(true);
    expect(steps[0].classList.contains("is-next")).toBe(true);
  });

  it("resumes where the session stopped", () => {
    const { steps, props } = setup({
      matching: { kind: "inProgress", percent: 40 },
      resumeAt: { line: 1, subLine: 8 },
    });
    const button = steps[0].querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Reprendre (ligne 1 / sous-ligne 8)");
    button.click();
    expect(props.onOpenMatching).toHaveBeenCalled();
  });

  it("keeps closures available without an MTE once matching is done", () => {
    const { steps, primary, props } = setup({ matching: { kind: "done" } });
    expect(steps[0].classList.contains("is-done")).toBe(true);
    expect(steps[1].contains(primary[0])).toBe(true);
    const apply = steps[2].querySelector<HTMLButtonElement>(".wmegj-button--secondary")!;
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(props.onApply).toHaveBeenCalled();
  });

  it("blocks closures until matching is done, and while applying", () => {
    const notDone = setup({ matching: { kind: "inProgress", percent: 10 } });
    for (const button of notDone.steps[2].querySelectorAll<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
    }
    const applying = setup({
      matching: { kind: "done" },
      linkedMte: { name: "x" },
      applying: true,
    });
    for (const button of applying.steps[2].querySelectorAll<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
    }
  });

  it("names the linked MTE, and never shows its id", () => {
    const named = setup({ matching: { kind: "done" }, linkedMte: { name: "RIV 2026 SS7+11" } });
    expect(named.steps[1].textContent).toContain("RIV 2026 SS7+11");
    expect(named.steps[1].classList.contains("is-done")).toBe(true);

    const unloaded = setup({ linkedMte: { name: null } });
    expect(unloaded.steps[1].textContent).toContain("MTE associé");
    expect(unloaded.steps[1].textContent).not.toMatch(/\d\.\d\.[0-9a-f]{8}/);
  });
});
