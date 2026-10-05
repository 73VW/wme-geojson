// Review of one already-validated sub-line — the "editor within the
// editor": go to its map view, reselect its stored segments or re-run the
// matching on the same window, and save a corrected selection for that
// sub-line only. No SDK here: map, selection and matching come in as drivers.

import type { SourceStore } from "../state/SourceStore";
import { sameIds, sameStep, type StepRef } from "../domain/steps";
import type { ButtonView } from "../ui/matchingUiState";

export interface ReviewState {
  step: StepRef;
  /** The WME selection differs from the stored segments of the step. */
  dirty: boolean;
  /** A re-match is running. */
  busy: boolean;
}

export interface StepReviewDeps {
  store: SourceStore;
  map: {
    setMapCenter(lon: number, lat: number, zoom: number): void;
    waitIdle(): Promise<void>;
    setSelection(ids: number[]): void;
    getSelection(): number[];
  };
  match: { runMatchFor(step: StepRef): Promise<number[]> };
  /** Called after every state change, to re-render. */
  onChange(): void;
}

export class StepReview {
  private current: ReviewState | null = null;

  constructor(private readonly deps: StepReviewDeps) {}

  get state(): ReviewState | null {
    return this.current;
  }

  async open(step: StepRef): Promise<void> {
    const sub = this.subLine(step);
    if (!sub?.validated) return;
    this.current = { step, dirty: false, busy: false };
    this.deps.onChange();
    this.deps.map.setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
    await this.deps.map.waitIdle();
    // Drop whatever WME still has selected (frontier match, previous step).
    if (this.isOn(step)) this.selectMatched();
  }

  close(): void {
    this.current = null;
    this.deps.onChange();
  }

  selectMatched(): void {
    const ids = this.storedIds();
    if (ids) this.deps.map.setSelection(ids);
  }

  /** Re-run the matching on the same window; the result only goes to the selection. */
  async rematch(): Promise<void> {
    const state = this.current;
    if (!state || state.busy) return;
    this.current = { ...state, busy: true };
    this.deps.onChange();
    try {
      const ids = await this.deps.match.runMatchFor(state.step);
      // Closed or another step opened meanwhile: the result is not this review's.
      if (!this.isOn(state.step)) return;
      this.deps.map.setSelection(ids);
      this.selectionChanged(ids);
    } finally {
      if (this.current && this.isOn(state.step)) {
        this.current = { ...this.current, busy: false };
        this.deps.onChange();
      }
    }
  }

  selectionChanged(ids: number[]): void {
    const stored = this.storedIds();
    if (!this.current || !stored) return;
    const dirty = !sameIds(ids, stored);
    if (dirty === this.current.dirty) return;
    this.current = { ...this.current, dirty };
    this.deps.onChange();
  }

  /** Store the current WME selection as this sub-line's segments (only this one). */
  save(): void {
    const state = this.current;
    if (!state) return;
    const { lineIndex, subLineIndex } = state.step;
    this.deps.store.validateSubLine(lineIndex, subLineIndex, this.deps.map.getSelection());
    this.current = { ...state, dirty: false };
    this.deps.onChange();
  }

  cancel(): void {
    const state = this.current;
    if (!state) return;
    this.selectMatched();
    this.current = { ...state, dirty: false };
    this.deps.onChange();
  }

  private isOn(step: StepRef): boolean {
    return sameStep(this.current?.step ?? null, step);
  }

  private subLine(step: StepRef) {
    return this.deps.store.getSource()?.lines[step.lineIndex]?.subLines[step.subLineIndex];
  }

  private storedIds(): number[] | null {
    return this.current ? (this.subLine(this.current.step)?.segmentIds ?? null) : null;
  }
}

export interface ReviewControls {
  selectMatched: ButtonView;
  rematch: ButtonView;
  save: ButtonView;
  cancel: ButtonView;
}

const HIDDEN: ButtonView = { visible: false, enabled: false };

export function reviewControlsFor(state: ReviewState | null): ReviewControls {
  if (!state) return { selectMatched: HIDDEN, rematch: HIDDEN, save: HIDDEN, cancel: HIDDEN };
  const enabled = !state.busy;
  const clean: ButtonView = { visible: !state.dirty, enabled };
  const dirty: ButtonView = { visible: state.dirty, enabled };
  return { selectMatched: clean, rematch: clean, save: dirty, cancel: dirty };
}
