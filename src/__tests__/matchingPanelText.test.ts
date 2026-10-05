// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { instructionKey, navEnabled, stepNavState } from "../ui/matchingPanelText";
import type { Source, SubLine } from "../domain/types";
import { initFrench } from "./helpers/i18nFr";

beforeAll(initFrench);

const step = { lineIndex: 0, subLineIndex: 1 };

describe("instructionKey", () => {
  it("guides each situation with one sentence", () => {
    expect(instructionKey({ run: "idle", review: null, hasValidated: false })).toBe(
      "panel.matching.instructions.idle",
    );
    expect(instructionKey({ run: "idle", review: null, hasValidated: true })).toBe(
      "panel.matching.instructions.idleBrowse",
    );
    expect(instructionKey({ run: "waiting", review: null, hasValidated: true })).toBe(
      "panel.matching.validateOrCorrect",
    );
    expect(instructionKey({ run: "done", review: null, hasValidated: true })).toBe(
      "panel.matching.instructions.done",
    );
    expect(
      instructionKey({
        run: "done",
        review: { step, dirty: false, busy: false },
        hasValidated: true,
      }),
    ).toBe("panel.matching.instructions.review");
    expect(
      instructionKey({
        run: "waiting",
        review: { step, dirty: true, busy: false },
        hasValidated: true,
      }),
    ).toBe("panel.matching.instructions.reviewDirty");
  });
});

describe("navEnabled", () => {
  it("only while matching is not running", () => {
    for (const run of ["idle", "waiting", "paused", "error", "done"] as const) {
      expect(navEnabled(run, null)).toBe(true);
    }
    for (const run of ["stepping", "bursting", "pausePending"] as const) {
      expect(navEnabled(run, null)).toBe(false);
    }
    expect(navEnabled("done", { step, dirty: false, busy: true })).toBe(false);
  });
});

describe("stepNavState", () => {
  function sub(index: number, validated: boolean): SubLine {
    return {
      index,
      kmA: index * 2,
      kmB: index * 2 + 2,
      bbox: [0, 0, 0, 0],
      view: { lon: 0, lat: 0, zoom: 16 },
      segmentIds: validated ? [1, 2, 3] : [],
      validated,
    };
  }
  const source: Source = {
    schemaVersion: 1,
    sourceId: "s",
    kind: "geojson",
    hasCsv: false,
    cursor: null,
    lines: [
      {
        index: 0,
        bbox: [0, 0, 0, 0],
        geometry: { type: "MultiLineString", coordinates: [] },
        lengthKm: 6,
        subLines: [sub(0, true), sub(1, true), sub(2, true)],
        pendingTail: [],
      },
    ],
  };
  const steps = [0, 1, 2].map((subLineIndex) => ({ lineIndex: 0, subLineIndex }));

  it("labels the current step, its window and its segments", () => {
    const nav = stepNavState(source, step, steps, true);
    expect(nav.label).toBe("Ligne 1/1 · sous-ligne 2/3");
    expect(nav.caption).toBe("2.00 → 4.00 km · 3 segment(s)");
    expect(nav).toMatchObject({ validated: true, canPrev: true, canNext: true });
  });

  it("from outside the steps, only goes back to the last one", () => {
    const nav = stepNavState(source, null, steps, true);
    expect(nav).toMatchObject({ canPrev: true, canNext: false });
    expect(nav.label).toBe("3 sous-ligne(s) validée(s)");
  });

  it("is frozen while disabled", () => {
    expect(stepNavState(source, step, steps, false)).toMatchObject({
      canPrev: false,
      canNext: false,
    });
  });
});
