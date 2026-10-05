// Shared stylesheet. WME exposes its design tokens as CSS variables on
// <body>; everything here reads them so the script follows the editor's theme.

export const STYLE_ELEMENT_ID = "wmegj-styles";

/** Token values copied from WME, for documents that don't have them (MTE window). */
export const TOKEN_FALLBACKS_CSS = `
  :root {
    --primary: #0099ff;
    --primary_variant: #0075e3;
    --content_default: #202124;
    --content_p1: #3c4043;
    --content_p2: #55595e;
    --content_p3: #72767d;
    --background_default: #ffffff;
    --background_variant: #f2f4f7;
    --surface_default: #f2f4f7;
    --surface_variant: #e8eaed;
    --separator_default: #e8eaed;
    --hairline: #d5d7db;
    --hairline_strong: #90959c;
    --alarming: #ff5252;
    --alarming_variant: #e42828;
    --cautious: #ffc400;
    --cautious_variant: #e37400;
    --safe: #1bab50;
    --safe_variant: #118742;
    --leading_icon: #90959c;
    --always_white: #ffffff;
  }
`;

export const BASE_CSS = `
  .wmegj-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    /* wz-button's colour layer overflows by 0.33px: room so the dialog doesn't scroll. */
    padding-bottom: 1px;
  }
  .wmegj-dialog-body > wz-text-input,
  .wmegj-dialog-body > wz-textarea,
  .wmegj-dialog-body > wz-select {
    width: 100%;
  }
  .wmegj-dialog-error {
    color: var(--alarming_variant);
  }
  .wmegj-dialog-error:empty {
    display: none;
  }
  .wmegj-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .wmegj-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--content_p1);
  }
  .wmegj-row {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }
  .wmegj-row > * {
    flex: 1 1 0;
    min-width: 0;
  }
  .wmegj-row > .wmegj-row-fixed {
    flex: 0 0 auto;
  }
  .wmegj-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  /* Date + time pair, native inputs dressed as wz-text-input (WME's MTE form). */
  .wmegj-datetime {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 80px;
    gap: 8px;
    min-width: 0;
  }
  .wmegj-date,
  .wmegj-time {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--surface_default);
    color: var(--content_default);
    font: inherit;
    font-size: 14px;
  }
  .wmegj-date:hover,
  .wmegj-time:hover {
    background: var(--surface_variant);
  }
  .wmegj-date:focus,
  .wmegj-time:focus {
    outline: none;
    border-color: var(--primary);
    background: var(--background_default);
  }
  /* WME's time field has no picker. */
  .wmegj-time::-webkit-calendar-picker-indicator {
    display: none;
  }
  .wmegj-icon-only {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--content_p2);
    cursor: pointer;
  }
  .wmegj-icon-only:hover:not(:disabled) {
    background: var(--surface_default);
  }
  .wmegj-icon-only:disabled {
    color: var(--hairline);
    cursor: default;
  }
  /* Fallback when wz-dialog is not registered (tests, future WME changes). */
  dialog.wmegj-dialog-fallback {
    border: none;
    border-radius: 8px;
    padding: 24px;
    width: min(400px, 90vw);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
    font-family: inherit;
  }
  .wmegj-dialog-controls:not(wz-dialog-controls) {
    display: flex;
    flex-direction: row-reverse;
    gap: 8px;
    margin-top: 20px;
  }
`;

/** Inject BASE_CSS into `doc` once; later calls are no-ops. */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = BASE_CSS;
  doc.head.appendChild(style);
}
