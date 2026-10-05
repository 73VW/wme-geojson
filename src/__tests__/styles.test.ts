// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BASE_CSS, STYLE_ELEMENT_ID, TOKEN_FALLBACKS_CSS, injectStyles } from "../ui/styles";

describe("injectStyles", () => {
  it("injects the base stylesheet once per document", () => {
    injectStyles(document);
    injectStyles(document);
    const styles = document.querySelectorAll(`#${STYLE_ELEMENT_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(BASE_CSS);
  });

  it("uses WME tokens only, hex colours live in the fallback block", () => {
    expect(BASE_CSS).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(TOKEN_FALLBACKS_CSS).toContain("--primary: #0099ff");
  });

  it("leaves room under the last wz-button of a dialog body", () => {
    // wz-button's colour layer sticks out 0.33px below the button; as the last
    // child it made wz-dialog-content (overflow: auto) show a scrollbar.
    expect(BASE_CSS).toMatch(/\.wmegj-dialog-body \{[^}]*padding-bottom: 1px;/);
  });

  it("styles the sidebar panel root without horizontal overflow", () => {
    expect(BASE_CSS).toMatch(
      /\.wmegj-panel-root \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/,
    );
  });
});
