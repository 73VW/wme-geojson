// Visible-distance window: two range inputs stacked on one track, so the
// operator drags two handles on the same bar.

import { i18next } from "../../../locales/i18n";
import { wzLabel } from "../components/wz";

export function createRangeSlider(props: {
  totalKm: number;
  /** Roadbook km at the start of the display geometry (labels only). */
  originKm: number;
  onChange: (lo: number, hi: number) => void;
}): HTMLElement {
  const { totalKm, originKm } = props;
  const section = document.createElement("section");
  section.className = "wmegj-section";

  const valueLabel = document.createElement("p");
  valueLabel.className = "wmegj-caption";

  const range = document.createElement("div");
  range.className = "wmegj-range";
  const track = document.createElement("div");
  track.className = "wmegj-range-track";
  const fill = document.createElement("div");
  fill.className = "wmegj-range-fill";

  const makeInput = (value: number): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(totalKm);
    input.step = "0.01";
    input.value = String(value);
    return input;
  };
  const minInput = makeInput(0);
  const maxInput = makeInput(totalKm);
  range.append(track, fill, minInput, maxInput);

  const render = (lo: number, hi: number): void => {
    valueLabel.textContent = i18next.t("panel.range.window", {
      min: (lo + originKm).toFixed(2),
      max: (hi + originKm).toFixed(2),
    });
    fill.style.left = `${(lo / totalKm) * 100}%`;
    fill.style.width = `${((hi - lo) / totalKm) * 100}%`;
  };

  // The handles may cross: the window is always [smaller, larger]. Clamping
  // instead would trap the lower handle under the upper one once they meet.
  const onInput = (): void => {
    const a = Number(minInput.value);
    const b = Number(maxInput.value);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    render(lo, hi);
    props.onChange(lo, hi);
  };
  minInput.addEventListener("input", onInput);
  maxInput.addEventListener("input", onInput);

  render(0, totalKm);
  section.append(wzLabel(i18next.t("panel.range.title")), valueLabel, range);
  return section;
}
