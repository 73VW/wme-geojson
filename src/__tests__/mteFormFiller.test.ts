import { describe, expect, it } from "vitest";
import {
  categoryOptions,
  lockLevelOptions,
  manualFormData,
  slowupFormData,
  toEditorDateTime,
} from "../mte/mteFormFiller";

describe("mteFormFiller", () => {
  it("converts datetime-local to the WME picker format", () => {
    expect(toEditorDateTime("2026-10-25T09:00")).toEqual(["25/10/2026", "09:00"]);
  });

  it("builds slowUp form data with default hours and FR translation", () => {
    const data = slowupFormData(
      {
        refid: 1,
        title: "Valais",
        date: "2026-10-25",
        urlLink: "https://example.org",
        abstracts: { en: "en", fr: "fr", de: "de", it: "it" },
      },
      null,
      { category: "SPORTING_EVENT", lockLevel: 1 },
    );
    expect(data.start).toBe("2026-10-25T09:00");
    expect(data.end).toBe("2026-10-25T17:30");
    expect(data.text).toEqual({ name: "SlowUP Valais", description: "en" });
    expect(data.translation).toEqual({ lang: "fr", name: "SlowUP Valais", description: "fr" });
  });
});

const options = { category: "PARADE", lockLevel: 2 } as const;

describe("MTE event options", () => {
  it("carries category and lock level into the form data", () => {
    const data = manualFormData(
      {
        title: "Course",
        startDate: "2026-10-05T09:00",
        endDate: "2026-10-05T17:00",
        description: "",
        urlLink: "",
      },
      null,
      options,
    );
    expect(data.category).toBe("PARADE");
    expect(data.lockLevel).toBe(2);
  });

  it("offers the categories of the native form, sporting event included", () => {
    const values = categoryOptions().map((option) => option.value);
    expect(values).toContain("SPORTING_EVENT");
    expect(values).not.toContain("PARTNER_USER_COMMS");
    expect(values).toHaveLength(11);
  });

  it("disables lock levels above the editor's rank (rank 0 = level 1)", () => {
    expect(lockLevelOptions(1)).toEqual([
      { value: 1, disabled: false },
      { value: 2, disabled: false },
      { value: 3, disabled: true },
      { value: 4, disabled: true },
    ]);
    expect(lockLevelOptions(5).every((option) => !option.disabled)).toBe(true);
  });
});
