// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PlanningCsvView } from "../ui/views/PlanningCsvView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

describe("PlanningCsvView", () => {
  it("offers one CSV file input, without a duplicate label", () => {
    const view = new PlanningCsvView({ onFile: vi.fn(), onRemove: vi.fn() });
    expect(view.root.querySelectorAll("input[type=file]")).toHaveLength(1);
    expect(view.root.querySelector<HTMLInputElement>("input[type=file]")!.accept).toBe(".csv");
    expect(view.root.textContent).not.toContain("Importer le CSV de planning");
  });

  it("swaps the input for a removable chip once loaded", () => {
    const onRemove = vi.fn();
    const view = new PlanningCsvView({ onFile: vi.fn(), onRemove });
    const chip = () => view.root.querySelector<HTMLElement>(".wmegj-chip")!;
    const input = () => view.root.querySelector<HTMLElement>(".wmegj-planning-input")!;

    expect(chip().hidden).toBe(true);
    view.setLoaded(true);
    expect(chip().hidden).toBe(false);
    expect(input().hidden).toBe(true);
    expect(chip().textContent).toContain("Planning chargé");

    chip().querySelector<HTMLButtonElement>("button")!.click();
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows loading and errors", () => {
    const view = new PlanningCsvView({ onFile: vi.fn(), onRemove: vi.fn() });
    view.setLoading(true);
    expect(view.root.querySelector<HTMLElement>(".wmegj-planning-loading")!.hidden).toBe(false);
    view.showError("Ligne 3 invalide");
    expect(view.errorText()).toBe("Ligne 3 invalide");
    view.clearError();
    expect(view.errorText()).toBe("");
  });
});
