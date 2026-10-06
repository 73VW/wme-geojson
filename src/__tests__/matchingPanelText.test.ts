// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import {
  instructionKey,
  navEnabled,
  navTarget,
  panelStatusKey,
  stepNavState,
} from "../ui/matchingPanelText";
import type { Source, SubLine } from "../domain/types";
import { initFrench } from "./helpers/i18nFr";

beforeAll(initFrench);

const step = { lineIndex: 0, subLineIndex: 1 };

describe("instructionKey", () => {
  it("guides each situation with one sentence", () => {
    expect(
      instructionKey({ run: "idle", review: null, hasValidated: false, complete: false }),
    ).toBe("panel.matching.instructions.idle");
    expect(instructionKey({ run: "idle", review: null, hasValidated: true, complete: false })).toBe(
      "panel.matching.instructions.idleBrowse",
    );
    expect(
      instructionKey({ run: "waiting", review: null, hasValidated: true, complete: false }),
    ).toBe("panel.matching.validateOrCorrect");
    expect(instructionKey({ run: "done", review: null, hasValidated: true, complete: false })).toBe(
      "panel.matching.instructions.done",
    );
    expect(
      instructionKey({
        run: "done",
        review: { step, dirty: false, busy: false },
        hasValidated: true,
        complete: false,
      }),
    ).toBe("panel.matching.instructions.review");
    expect(
      instructionKey({
        run: "waiting",
        review: { step, dirty: true, busy: false },
        hasValidated: true,
        complete: false,
      }),
    ).toBe("panel.matching.instructions.reviewDirty");
  });
});

describe("navEnabled", () => {
  it("only while matching is not running", () => {
    for (const run of ["idle", "waiting", "paused", "error", "done"] as const) {
      expect(navEnabled(run, null, false)).toBe(true);
    }
    for (const run of ["stepping", "bursting", "pausePending"] as const) {
      expect(navEnabled(run, null, false)).toBe(false);
    }
    expect(navEnabled("done", { step, dirty: false, busy: true }, false)).toBe(false);
  });

  it("is locked while the frontier re-match runs", () => {
    expect(navEnabled("waiting", null, true)).toBe(false);
  });
});

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

describe("stepNavState", () => {
  const steps = [0, 1, 2].map((subLineIndex) => ({ lineIndex: 0, subLineIndex }));

  it("labels the current step, its window and its segments", () => {
    const nav = stepNavState(source, step, steps, true, false);
    expect(nav.label).toBe("Sous-ligne 2/3");
    expect(nav.caption).toBe("2,00 → 4,00 km · 3 segments");
    expect(nav).toMatchObject({ validated: true, canPrev: true, canNext: true });
  });

  it("keeps the line part when the source has several lines", () => {
    const two: Source = { ...source, lines: [source.lines[0], source.lines[0]] };
    expect(stepNavState(two, step, steps, true, false).label).toBe("Ligne 1/2 · sous-ligne 2/3");
  });

  it("uses singular for one segment", () => {
    const one: Source = {
      ...source,
      lines: [
        {
          ...source.lines[0],
          subLines: [sub(0, true), { ...sub(1, true), segmentIds: [1] }, sub(2, true)],
        },
      ],
    };
    expect(stepNavState(one, step, steps, true, false).caption).toContain("1 segment");
    expect(stepNavState(one, step, steps, true, false).caption).not.toContain("segments");
  });

  it("from outside the steps, only goes back to the last one", () => {
    const nav = stepNavState(source, null, steps, true, false);
    expect(nav).toMatchObject({ canPrev: true, canNext: false });
    expect(nav.label).toBe("3 sous-lignes validées");
  });

  it("is frozen while disabled", () => {
    expect(stepNavState(source, step, steps, false, false)).toMatchObject({
      canPrev: false,
      canNext: false,
    });
  });

  it("offers › on the last step when it leaves the review", () => {
    const last = { lineIndex: 0, subLineIndex: 2 };
    expect(stepNavState(source, last, steps, true, false).canNext).toBe(false);
    expect(stepNavState(source, last, steps, true, true).canNext).toBe(true);
    expect(stepNavState(source, last, steps, false, true).canNext).toBe(false);
  });
});

describe("navTarget", () => {
  const steps = [0, 1, 2].map((subLineIndex) => ({ lineIndex: 0, subLineIndex }));
  const last = { lineIndex: 0, subLineIndex: 2 };

  it("moves to the neighbour step", () => {
    expect(navTarget(steps, step, 1, true)).toEqual(last);
    expect(navTarget(steps, step, -1, true)).toEqual({ lineIndex: 0, subLineIndex: 0 });
  });

  it("exits the review past the last step only when asked", () => {
    expect(navTarget(steps, last, 1, true)).toBe("exit");
    expect(navTarget(steps, last, 1, false)).toBeNull();
    expect(navTarget(steps, null, 1, true)).toBeNull();
    expect(navTarget(steps, { lineIndex: 0, subLineIndex: 0 }, -1, true)).toBeNull();
  });
});

describe("finished lines", () => {
  it("say done instead of offering to start", () => {
    expect(panelStatusKey("idle", true)).toBe("done");
    expect(panelStatusKey("idle", false)).toBe("ready");
    expect(panelStatusKey("waiting", true)).toBe("waiting");
    expect(instructionKey({ run: "idle", review: null, hasValidated: true, complete: true })).toBe(
      "panel.matching.instructions.done",
    );
  });
});

describe("frontier caption", () => {
  it("carries the pending match count", () => {
    const pendingSource: Source = {
      ...source,
      lines: [
        {
          ...source.lines[0],
          subLines: [sub(0, true), sub(1, false)],
          pendingTail: [{ kmA: 4, kmB: 6 }],
        },
      ],
    };
    const frontier = { lineIndex: 0, subLineIndex: 1 };
    const nav = stepNavState(
      pendingSource,
      frontier,
      [{ lineIndex: 0, subLineIndex: 0 }, frontier],
      true,
      false,
      7,
    );
    expect(nav.caption).toBe("2,00 → 4,00 km · 7 segments identifiés");
  });
});
