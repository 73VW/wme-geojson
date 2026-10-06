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

  it("spaces the sections of the Matching sidebar", () => {
    expect(BASE_CSS).toMatch(/\.wmegj-matching-body \{[^}]*gap: 16px;/);
  });

  it("styles the matching panel as a WME card", () => {
    expect(BASE_CSS).toMatch(
      /\.wmegj-guided-overlay \{[^}]*background: var\(--background_default\);/,
    );
    expect(BASE_CSS).toMatch(/\.wmegj-guided-overlay \{[^}]*box-shadow:/);
  });

  it("removes the internal margin of WME cards", () => {
    expect(BASE_CSS).toMatch(/\.wmegj-panel-root wz-card \{[^}]*--wz-card-margin: 0;/);
  });

  it("makes line rows clickable over the full list width", () => {
    // wz-list pads its rows by 16px: the hover stopped short and the cursor stayed an arrow.
    expect(BASE_CSS).toMatch(/wz-list\.wmegj-line-list \{[^}]*padding: 0;/);
    expect(BASE_CSS).toMatch(/\.wmegj-line-row\[clickable\] \{[^}]*cursor: pointer;/);
    expect(BASE_CSS).toMatch(
      /\.wmegj-line-row\[clickable\]:hover \{[^}]*background: var\(--background_variant\);/,
    );
    // The native inner tint is inset by the row padding: two greys on hover.
    expect(BASE_CSS).toMatch(/\.wmegj-line-row \{[^}]*--ink_on_primary_hovered: transparent;/);
  });
});
