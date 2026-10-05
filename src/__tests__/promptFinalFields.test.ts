// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptFinalFields } from "../ui/promptFinalFields";

vi.spyOn(console, "warn").mockImplementation(() => {});

const inputs = () => [...document.querySelectorAll<HTMLInputElement>("dialog input[type=text]")];
const ok = () => document.querySelector<HTMLButtonElement>(".wmegj-button--primary")!;

afterEach(() => document.body.replaceChildren());

describe("promptFinalFields", () => {
  it("returns the typed fields", async () => {
    const result = promptFinalFields({ defaults: { reason: "slowUp", mteId: "42" } });
    inputs()[2].value = "note";
    ok().click();
    await expect(result).resolves.toEqual({
      reason: "slowUp",
      ignoreTraffic: true,
      mteId: "42",
      comment: "note",
    });
  });

  it("blocks commas in CSV mode but not in apply mode", async () => {
    void promptFinalFields({ defaults: { reason: "a,b" } });
    ok().click();
    expect(document.querySelector(".wmegj-dialog-error")?.textContent).not.toBe("");
    document.body.replaceChildren();

    const applied = promptFinalFields({ defaults: { reason: "a,b" }, mode: "apply" });
    expect(inputs()).toHaveLength(2); // no comment field when applying
    ok().click();
    await expect(applied).resolves.toMatchObject({ reason: "a,b", comment: "" });
  });
});
