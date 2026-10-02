import { describe, expect, it } from "vitest";
import { slowupFormData, toEditorDateTime } from "../mte/mteFormFiller";

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
    );
    expect(data.start).toBe("2026-10-25T09:00");
    expect(data.end).toBe("2026-10-25T17:30");
    expect(data.text).toEqual({ name: "SlowUP Valais", description: "en" });
    expect(data.translation).toEqual({ lang: "fr", name: "SlowUP Valais", description: "fr" });
  });
});
