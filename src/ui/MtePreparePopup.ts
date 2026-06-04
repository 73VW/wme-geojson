// src/ui/MtePreparePopup.ts
//
// Ouvre les infos « Préparer MTE » dans une vraie fenêtre détachée du
// navigateur (window.open) pour que l'utilisateur puisse interagir avec
// WME en parallèle (copier-coller dans le formulaire de création du MTE).
//
// Note de runtime : tout le JS tourne dans le contexte de la page WME
// (mêmes globals GM, SDK, mteStore, navigator.clipboard) — seuls les
// nœuds DOM ciblent le `document` de la fenêtre popup.

import i18next from "i18next";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { fetchSlowupFullDetails } from "../lines/slowupClient";
import type { SlowupFullDetails } from "../lines/types";
import {
  byUrl,
  candidatesByBbox,
  mteStore,
  type MteCandidate,
  type MteSdk,
} from "../mte";

export interface MtePreparePopupDeps {
  refid: number;
  slowupBbox: [number, number, number, number];
  /** Track buffered by 500m (or null if geometry empty). Used as the polygon
   * GeoJSON the user pastes into the MTE creation form. */
  slowupPolygon: Feature<Polygon | MultiPolygon> | null;
  mteSdk: MteSdk;
}

// Une fenêtre par refid : si l'utilisateur reclique, on focus celle déjà
// ouverte plutôt que d'en empiler une seconde.
const openWindows = new Map<number, Window>();

const POPUP_FEATURES = "width=640,height=860,scrollbars=yes,resizable=yes,menubar=no,toolbar=no";

export async function openMtePreparePopup(deps: MtePreparePopupDeps): Promise<void> {
  // 1. Refocus s'il y a déjà une fenêtre ouverte pour ce refid.
  const existing = openWindows.get(deps.refid);
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }

  // 2. window.open DOIT être appelé dans le gesture handler synchrone,
  //    sinon les popup blockers bloquent. On ouvre AVANT le fetch.
  const popup = window.open("", `wme-mte-prep-${deps.refid}`, POPUP_FEATURES);
  if (!popup) {
    alert(i18next.t("panel.mtePopup.blocked"));
    return;
  }

  openWindows.set(deps.refid, popup);
  popup.addEventListener("beforeunload", () => {
    openWindows.delete(deps.refid);
  });

  const doc = popup.document;
  doc.title = i18next.t("panel.mtePopup.loading");

  injectBaseStyles(doc);
  const { titleEl, bodyEl } = renderShell(doc);

  // 3. Fetch lazy après que la fenêtre est ouverte.
  let details: SlowupFullDetails;
  try {
    details = await fetchSlowupFullDetails(deps.refid);
  } catch (err) {
    if (popup.closed) return;
    titleEl.textContent = i18next.t("panel.mtePopup.error");
    bodyEl.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  if (popup.closed) return;

  doc.title = `SlowUP ${details.title}`;
  renderContent(popup, titleEl, bodyEl, details, deps);
}

// ---------------------------------------------------------------------------
// Shell + styles
// ---------------------------------------------------------------------------

function injectBaseStyles(doc: Document): void {
  const style = doc.createElement("style");
  style.textContent = `
    *,*::before,*::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #222;
      background: #fafafa;
    }
    h1 { margin: 0 0 16px 0; font-size: 18px; font-weight: 700; }
    .row { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
    .row .label { font-size: 13px; font-weight: 600; min-width: 70px; }
    .row .value { flex: 1; word-break: break-all; }
    .block { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
    .block-header { display: flex; justify-content: space-between; align-items: center; }
    .block-header .label { font-size: 13px; font-weight: 600; }
    textarea {
      width: 100%;
      min-height: 80px;
      font-size: 12px;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      resize: vertical;
      font-family: inherit;
      background: #fff;
    }
    input[type="text"] {
      padding: 6px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
    }
    button {
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid #bbb;
      border-radius: 4px;
      background: #f4f4f4;
    }
    button:hover { background: #eaeaea; }
    button.copy { padding: 3px 8px; }
    button.candidate {
      text-align: left;
      padding: 6px 8px;
      border: 1px solid #ddd;
      background: #fff;
    }
    button.candidate:hover { background: #f0f7ff; }
    .badge { font-size: 12px; color: #555; padding: 4px 0; }
    .divider { border: none; border-top: 1px solid #e3e3e3; margin: 10px 0; }
    .mte-row { display: flex; gap: 8px; align-items: center; }
    .candidates { display: flex; flex-direction: column; gap: 4px; }
    .candidates-header { font-size: 12px; font-weight: 600; margin: 6px 0 2px 0; }
    .empty { font-size: 12px; color: #888; margin: 6px 0 0 0; }
  `;
  doc.head.appendChild(style);
}

function renderShell(doc: Document): { titleEl: HTMLElement; bodyEl: HTMLElement } {
  const titleEl = doc.createElement("h1");
  titleEl.textContent = i18next.t("panel.mtePopup.loading");
  doc.body.appendChild(titleEl);

  const bodyEl = doc.createElement("div");
  doc.body.appendChild(bodyEl);

  return { titleEl, bodyEl };
}

// ---------------------------------------------------------------------------
// Content rendering (after fetch resolved)
// ---------------------------------------------------------------------------

function renderContent(
  popup: Window,
  titleEl: HTMLElement,
  bodyEl: HTMLElement,
  details: SlowupFullDetails,
  deps: MtePreparePopupDeps,
): void {
  const doc = popup.document;
  titleEl.textContent = `SlowUP ${details.title}`;
  bodyEl.replaceChildren();

  // Order matches the MTE editor form: geojson, date, title, abstracts
  // (EN/FR/DE/IT), URL, then MTE ID (rendered below).
  if (deps.slowupPolygon) {
    const polygonGeoJson = JSON.stringify(deps.slowupPolygon.geometry, null, 2);
    bodyEl.appendChild(
      textBlock(doc, popup, i18next.t("panel.mtePopup.polygonLabel"), polygonGeoJson),
    );
  }

  bodyEl.appendChild(copyRow(doc, popup, i18next.t("panel.mtePopup.dateLabel"), formatDateForEditor(details.date)));
  bodyEl.appendChild(copyRow(doc, popup, i18next.t("panel.mtePopup.titleLabel"), `SlowUP ${details.title}`));

  bodyEl.appendChild(divider(doc));

  for (const lang of ["en", "fr", "de", "it"] as const) {
    bodyEl.appendChild(textBlock(doc, popup, `Abstract ${lang.toUpperCase()}`, details.abstracts[lang]));
  }

  bodyEl.appendChild(divider(doc));

  bodyEl.appendChild(copyRow(doc, popup, i18next.t("panel.mtePopup.urlLabel"), details.urlLink));

  bodyEl.appendChild(divider(doc));

  // MTE ID section
  const mteSection = doc.createElement("div");
  mteSection.className = "block";

  const mteLabel = doc.createElement("label");
  mteLabel.textContent = i18next.t("panel.mtePopup.mteIdLabel");
  mteLabel.className = "label";
  mteSection.appendChild(mteLabel);

  const inputRow = doc.createElement("div");
  inputRow.className = "mte-row";

  const mteInput = doc.createElement("input");
  mteInput.type = "text";
  mteInput.style.flex = "1";

  const refreshBtn = doc.createElement("button");
  refreshBtn.textContent = i18next.t("panel.mtePopup.refresh");

  inputRow.appendChild(mteInput);
  inputRow.appendChild(refreshBtn);
  mteSection.appendChild(inputRow);

  const badge = doc.createElement("div");
  badge.className = "badge";
  mteSection.appendChild(badge);

  const candidatesContainer = doc.createElement("div");
  candidatesContainer.className = "candidates";
  mteSection.appendChild(candidatesContainer);

  bodyEl.appendChild(mteSection);

  function runResolution(): void {
    const mtes = deps.mteSdk.listMtes();
    const stored = mteStore.get(deps.refid);
    const auto = byUrl(mtes, details.urlLink);
    candidatesContainer.replaceChildren();

    if (stored) {
      mteInput.value = stored;
      badge.textContent = i18next.t("panel.mtePopup.badgeStored");
    } else if (auto) {
      mteInput.value = auto.id;
      mteStore.set(deps.refid, auto.id);
      badge.textContent = i18next.t("panel.mtePopup.badgeAutoUrl");
    } else {
      mteInput.value = "";
      badge.textContent = i18next.t("panel.mtePopup.badgeNone");
      const candidates = candidatesByBbox(mtes, deps.slowupBbox, details.date);
      if (candidates.length === 0) {
        const empty = doc.createElement("p");
        empty.className = "empty";
        empty.textContent = i18next.t("panel.mtePopup.noCandidates");
        candidatesContainer.appendChild(empty);
      } else {
        const header = doc.createElement("p");
        header.className = "candidates-header";
        header.textContent = i18next.t("panel.mtePopup.candidatesHeader");
        candidatesContainer.appendChild(header);
        for (const c of candidates) {
          candidatesContainer.appendChild(
            candidateRow(doc, c, () => {
              mteInput.value = c.mte.id;
              mteStore.set(deps.refid, c.mte.id);
              badge.textContent = i18next.t("panel.mtePopup.badgeManual");
            }),
          );
        }
      }
    }
  }

  mteInput.addEventListener("input", () => {
    mteStore.set(deps.refid, mteInput.value);
    badge.textContent = i18next.t("panel.mtePopup.badgeManual");
  });

  refreshBtn.addEventListener("click", runResolution);

  runResolution();
}

// ---------------------------------------------------------------------------
// DOM helpers (parameterized by popup document)
// ---------------------------------------------------------------------------

// Slowup API renvoie "YYYY-MM-DD" ; l'éditeur MTE attend "DD/MM/YYYY".
// Si l'entrée ne matche pas le format ISO court attendu, on la renvoie telle quelle.
function formatDateForEditor(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, yyyy, mm, dd] = match;
  return `${dd}/${mm}/${yyyy}`;
}

function copyRow(doc: Document, popup: Window, label: string, value: string): HTMLElement {
  const row = doc.createElement("div");
  row.className = "row";
  const lab = doc.createElement("span");
  lab.className = "label";
  lab.textContent = `${label} :`;
  const val = doc.createElement("span");
  val.className = "value";
  val.textContent = value;
  row.appendChild(lab);
  row.appendChild(val);
  row.appendChild(copyButton(doc, popup, value));
  return row;
}

function textBlock(doc: Document, popup: Window, fullLabel: string, text: string): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "block";
  const header = doc.createElement("div");
  header.className = "block-header";
  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = fullLabel;
  header.appendChild(label);
  header.appendChild(copyButton(doc, popup, text));
  const box = doc.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  wrap.appendChild(header);
  wrap.appendChild(box);
  return wrap;
}

function copyButton(doc: Document, popup: Window, value: string): HTMLButtonElement {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "copy";
  btn.textContent = i18next.t("panel.mtePopup.copy");
  btn.addEventListener("click", () => {
    void writeClipboard(popup, value).then(() => {
      const prev = btn.textContent;
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = prev;
      }, 800);
    });
  });
  return btn;
}

async function writeClipboard(popup: Window, value: string): Promise<void> {
  // Préférer le clipboard du popup pour éviter les problèmes de focus
  // quand la fenêtre principale n'est pas active.
  const target = popup.navigator?.clipboard ?? navigator.clipboard;
  if (target) {
    try {
      await target.writeText(value);
      return;
    } catch {
      // fallthrough vers execCommand
    }
  }
  // Fallback : textarea temporaire + execCommand("copy") dans le popup.
  const doc = popup.document;
  const ta = doc.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  doc.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    doc.execCommand("copy");
  } finally {
    ta.remove();
  }
}

function divider(doc: Document): HTMLElement {
  const hr = doc.createElement("hr");
  hr.className = "divider";
  return hr;
}

function candidateRow(doc: Document, c: MteCandidate, onPick: () => void): HTMLElement {
  const row = doc.createElement("button");
  row.type = "button";
  row.className = "candidate";
  row.textContent = `[#${c.mte.id}] ${c.mte.name || "(sans nom)"} — overlap ${c.overlap.toFixed(4)}°²`;
  row.addEventListener("click", onPick);
  return row;
}
