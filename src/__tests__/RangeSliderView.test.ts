// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRangeSlider } from "../ui/views/RangeSliderView";
import { initFrench } from "./helpers/i18nFr";

vi.spyOn(console, "warn").mockImplementation(() => {});
beforeAll(initFrench);

function setup(originKm = 0) {
  const onChange = vi.fn();
  const root = createRangeSlider({ totalKm: 30, originKm, onChange });
  const [min, max] = [...root.querySelectorAll<HTMLInputElement>("input[type=range]")];
  const move = (input: HTMLInputElement, value: number) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input"));
  };
  return { root, min, max, move, onChange };
}

describe("createRangeSlider", () => {
  it("puts both handles on one track", () => {
    const { root } = setup();
    expect(root.querySelectorAll(".wmegj-range input[type=range]")).toHaveLength(2);
  });

  it("reports the window and shows it with the roadbook origin", () => {
    const { root, min, move, onChange } = setup(12);
    move(min, 5);
    expect(onChange).toHaveBeenLastCalledWith(5, 30);
    expect(root.textContent).toContain("17.00 km – 42.00 km");
  });

  it("keeps the window ordered when the handles cross", () => {
    const { min, max, move, onChange } = setup();
    move(max, 10);
    move(min, 20);
    expect(onChange).toHaveBeenLastCalledWith(10, 20);
  });

  it("never gets stuck once both handles sit on the same spot", () => {
    // Stacked handles: only the top one (max) can be grabbed, in both directions.
    const { min, max, move, onChange } = setup();
    move(min, 10);
    move(max, 10);
    move(max, 5);
    expect(onChange).toHaveBeenLastCalledWith(5, 10);
    move(max, 25);
    expect(onChange).toHaveBeenLastCalledWith(10, 25);
    expect(min.value).toBe("10");
  });

  it("colours the selected part of the track", () => {
    const { root, min, max, move } = setup();
    move(min, 3);
    move(max, 15);
    const fill = root.querySelector<HTMLElement>(".wmegj-range-fill")!;
    expect(fill.style.left).toBe("10%");
    expect(fill.style.width).toBe("40%");
  });
});
