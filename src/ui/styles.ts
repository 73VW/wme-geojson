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
  .wmegj-panel-root {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 14px;
    color: var(--content_p1);
  }
  .wmegj-panel-root *,
  .wmegj-panel-root *::before,
  .wmegj-panel-root *::after {
    box-sizing: border-box;
  }
  .wmegj-panel-root wz-button {
    max-width: 100%;
  }
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
  .wmegj-line-list {
    display: flex;
    flex-direction: column;
  }
  .wmegj-line-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 4px 4px 4px 8px;
    border-bottom: 1px solid var(--separator_default);
    cursor: pointer;
  }
  .wmegj-line-row:hover {
    background: var(--background_variant);
  }
  .wmegj-line-row--loading {
    opacity: 0.6;
    cursor: default;
  }
  .wmegj-line-row--loading:hover {
    background: transparent;
  }
  .wmegj-line-pill {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .wmegj-line-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .wmegj-line-name {
    font-size: 14px;
    color: var(--content_default);
    overflow-wrap: anywhere;
  }
  .wmegj-line-caption {
    font-size: 12px;
    color: var(--content_p3);
  }
  .wmegj-line-progress {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--content_p2);
  }
  .wmegj-line-progress.is-done {
    color: var(--safe_variant);
  }
  .wmegj-line-warning {
    flex: 0 0 auto;
    color: var(--cautious_variant);
  }
  .wmegj-spinner {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border: 2px solid var(--hairline);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: wmegj-spin 0.7s linear infinite;
  }
  @keyframes wmegj-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .wmegj-lines {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .wmegj-block-button {
    align-self: stretch;
  }
  .wmegj-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .wmegj-caption {
    margin: 0;
    font-size: 12px;
    color: var(--content_p3);
  }
  .wmegj-load-error {
    margin: 0;
    font-size: 12px;
    color: var(--alarming_variant);
  }
  .wmegj-load-error:empty {
    display: none;
  }
  .wmegj-source-card {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 4px 8px 12px;
    border-radius: 8px;
    background: var(--surface_default);
  }
  .wmegj-source-card[hidden] {
    display: none;
  }
  .wmegj-source-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--content_default);
    overflow-wrap: anywhere;
  }
  .wmegj-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .wmegj-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
    border: none;
    background: none;
    color: var(--primary);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .wmegj-header-title {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    color: var(--content_default);
    overflow-wrap: anywhere;
  }
  .wmegj-panel-root [hidden],
  .wmegj-dialog-body [hidden] {
    display: none !important;
  }
  .wmegj-chip {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 12px;
    border-radius: 100px;
    background: var(--surface_default);
    color: var(--content_p1);
    font-size: 13px;
  }
  .wmegj-chip-remove {
    display: inline-flex;
    border: none;
    background: none;
    color: var(--content_p2);
    cursor: pointer;
    padding: 2px;
  }
  .wmegj-range {
    position: relative;
    height: 24px;
  }
  .wmegj-range-track,
  .wmegj-range-fill {
    position: absolute;
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 2px;
  }
  .wmegj-range-track {
    left: 0;
    right: 0;
    background: var(--hairline);
  }
  .wmegj-range-fill {
    background: var(--primary);
  }
  .wmegj-range input[type="range"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 24px;
    margin: 0;
    background: none;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
  }
  .wmegj-range input[type="range"]::-webkit-slider-runnable-track {
    background: none;
  }
  .wmegj-range input[type="range"]::-webkit-slider-thumb {
    pointer-events: auto;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border: 2px solid var(--background_default);
    border-radius: 50%;
    background: var(--primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    cursor: pointer;
  }
  .wmegj-range input[type="range"]::-moz-range-thumb {
    pointer-events: auto;
    width: 12px;
    height: 12px;
    border: 2px solid var(--background_default);
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
  }
  .wmegj-steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wmegj-matching-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .wmegj-step {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 12px;
    border-radius: 8px;
    background: var(--background_default);
    box-shadow: inset 0 0 0 1px var(--separator_default);
  }
  .wmegj-step.is-next {
    box-shadow: inset 0 0 0 1px var(--hairline_strong);
  }
  .wmegj-step-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wmegj-step-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface_variant);
    color: var(--content_p1);
    font-size: 12px;
    font-weight: 500;
  }
  .wmegj-step.is-next .wmegj-step-badge {
    background: var(--primary);
    color: var(--always_white);
  }
  .wmegj-step.is-done .wmegj-step-badge {
    background: var(--safe);
    color: var(--always_white);
  }
  .wmegj-step-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--content_default);
  }
  .wmegj-step .wmegj-caption:empty {
    display: none;
  }
  .wmegj-steps wz-button,
  .wmegj-steps .wmegj-button {
    max-width: 100%;
  }
  .wmegj-apply-status {
    white-space: pre-line;
  }
  .wmegj-apply-status:empty {
    display: none;
  }
  .wmegj-subtab-toggle {
    display: flex;
    margin: 10px 0 12px;
    border-bottom: 1px solid var(--separator_default);
  }
  .wmegj-subtab-toggle button {
    flex: 1;
    padding: 8px 6px;
    border: none;
    background: none;
    color: var(--content_p2);
    cursor: pointer;
  }
  .wmegj-subtab-toggle button.wmegj-subtab-active {
    color: var(--primary);
    box-shadow: inset 0 -2px 0 var(--primary);
  }
  .wmegj-button {
    min-height: 32px;
    padding: 0 16px;
    border: none;
    border-radius: 100px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .wmegj-button--primary {
    background: var(--primary);
    color: var(--always_white);
  }
  .wmegj-button--secondary,
  .wmegj-button--danger {
    background: var(--surface_default);
    color: var(--primary);
  }
  .wmegj-button--danger {
    color: var(--alarming_variant);
  }
  .wmegj-button--text {
    padding: 0;
    background: none;
    color: var(--primary);
  }
  .wmegj-button:disabled {
    opacity: 0.5;
    cursor: default;
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
