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
  candidatesByName,
  mteStore,
  type MteKey,
  type MteRef,
  type MteSdk,
} from "../mte";
import type { ManualMteInfo } from "./promptMteInfo";

const NAME_FILTER_NEEDLE = "slowup";

export interface MtePreparePopupDeps {
  /** Clé mteStore : refid pour un slowup, id de ligne sinon. */
  mteKey: MteKey;
  /** Slowup : détails récupérés via SchweizMobil. Sinon : infos saisies. */
  source: { refid: number } | { manual: ManualMteInfo };
  slowupBbox: [number, number, number, number];
  /** Track buffered by 500m (or null if geometry empty). Used as the polygon
   * GeoJSON the user pastes into the MTE creation form. */
  slowupPolygon: Feature<Polygon | MultiPolygon> | null;
  mteSdk: MteSdk;
}

/** Ce que le popup affiche, quelle que soit l'origine des infos. */
interface PopupContent {
  heading: string;
  dateText: string;
  abstracts: Record<"en" | "fr" | "de" | "it", string>;
  urlLink: string;
  candidates(mtes: MteRef[]): MteRef[];
  candidatesHeader: string;
  noCandidates: string;
}

// Une fenêtre par clé : si l'utilisateur reclique, on focus celle déjà
// ouverte plutôt que d'en empiler une seconde.
const openWindows = new Map<MteKey, Window>();

const POPUP_FEATURES = "width=640,height=860,scrollbars=yes,resizable=yes,menubar=no,toolbar=no";

export async function openMtePreparePopup(deps: MtePreparePopupDeps): Promise<void> {
  // 1. Refocus s'il y a déjà une fenêtre ouverte pour cette clé.
  const existing = openWindows.get(deps.mteKey);
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }

  // 2. window.open DOIT être appelé dans le gesture handler synchrone,
  //    sinon les popup blockers bloquent. On ouvre AVANT le fetch.
  const popup = window.open("", `wme-mte-prep-${deps.mteKey}`, POPUP_FEATURES);
  if (!popup) {
    alert(i18next.t("panel.mtePopup.blocked"));
    return;
  }

  openWindows.set(deps.mteKey, popup);
  popup.addEventListener("beforeunload", () => {
    openWindows.delete(deps.mteKey);
  });

  const doc = popup.document;
  doc.title = i18next.t("panel.mtePopup.loading");

  injectBaseStyles(doc);
  const { titleEl, bodyEl } = renderShell(doc);

  // 3. Fetch lazy après que la fenêtre est ouverte.
  let content: PopupContent;
  try {
    content =
      "refid" in deps.source
        ? slowupContent(await fetchSlowupFullDetails(deps.source.refid))
        : manualContent(deps.source.manual, deps.slowupBbox);
  } catch (err) {
    if (popup.closed) return;
    titleEl.textContent = i18next.t("panel.mtePopup.error");
    bodyEl.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  if (popup.closed) return;

  doc.title = content.heading;
  renderContent(popup, titleEl, bodyEl, content, deps);
}

function slowupContent(details: SlowupFullDetails): PopupContent {
  return {
    heading: `SlowUP ${details.title}`,
    dateText: formatDateForEditor(details.date),
    abstracts: details.abstracts,
    urlLink: details.urlLink,
    candidates: (mtes) => candidatesByName(mtes, NAME_FILTER_NEEDLE),
    candidatesHeader: i18next.t("panel.mtePopup.candidatesHeader"),
    noCandidates: i18next.t("panel.mtePopup.noCandidates"),
  };
}

function manualContent(info: ManualMteInfo, bbox: [number, number, number, number]): PopupContent {
  const day = info.startDate.slice(0, 10);
  const start = formatDateTimeForEditor(info.startDate);
  const end = formatDateTimeForEditor(info.endDate);
  const d = info.description;
  return {
    heading: info.title,
    dateText: `${start} - ${end}`,
    abstracts: { en: d, fr: d, de: d, it: d },
    urlLink: info.urlLink,
    // Le SDK n'expose pas la géométrie des MTE : seul le filtre par date agit.
    candidates: (mtes) => candidatesByBbox(mtes, bbox, day).map((c) => c.mte),
    candidatesHeader: i18next.t("panel.mtePopup.candidatesHeaderDate", {
      date: formatDateForEditor(day),
    }),
    noCandidates: i18next.t("panel.mtePopup.noCandidatesDate", { date: formatDateForEditor(day) }),
  };
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
  content: PopupContent,
  deps: MtePreparePopupDeps,
): void {
  const doc = popup.document;
  titleEl.textContent = content.heading;
  bodyEl.replaceChildren();

  // Order matches the MTE editor form: geojson, date, title, abstracts
  // (EN/FR/DE/IT), URL, then MTE ID (rendered below).
  if (deps.slowupPolygon) {
    const polygonGeoJson = JSON.stringify(deps.slowupPolygon.geometry, null, 2);
    bodyEl.appendChild(
      textBlock(doc, popup, i18next.t("panel.mtePopup.polygonLabel"), polygonGeoJson),
    );
  }

  bodyEl.appendChild(copyRow(doc, popup, i18next.t("panel.mtePopup.dateLabel"), content.dateText));
  bodyEl.appendChild(copyRow(doc, popup, i18next.t("panel.mtePopup.titleLabel"), content.heading));

  bodyEl.appendChild(divider(doc));

  for (const lang of ["en", "fr", "de", "it"] as const) {
    bodyEl.appendChild(
      textBlock(doc, popup, `Abstract ${lang.toUpperCase()}`, content.abstracts[lang]),
    );
  }

  bodyEl.appendChild(divider(doc));

  if (content.urlLink) {
    bodyEl.appendChild(copyRow(doc, popup, i18next.t("panel.mtePopup.urlLabel"), content.urlLink));
    bodyEl.appendChild(divider(doc));
  }

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
    console.info(
      "[mtePopup] resolving for",
      deps.mteKey,
      "/ title:",
      content.heading,
      "/ urlLink:",
      content.urlLink,
      "/ normalized MTEs:",
      mtes,
    );
    const stored = mteStore.get(deps.mteKey);
    const autoUrl = byUrl(mtes, content.urlLink);
    candidatesContainer.replaceChildren();

    if (stored) {
      mteInput.value = stored;
      badge.textContent = i18next.t("panel.mtePopup.badgeStored");
    } else if (autoUrl) {
      mteInput.value = autoUrl.id;
      mteStore.set(deps.mteKey, autoUrl.id);
      badge.textContent = i18next.t("panel.mtePopup.badgeAutoUrl");
    } else {
      mteInput.value = "";
      badge.textContent = i18next.t("panel.mtePopup.badgeNone");
    }

    // Toujours afficher la liste pré-filtrée (nom « slowup » pour un slowup,
    // MTE actifs à la date de début sinon). L'utilisateur clique pour
    // sélectionner manuellement. Quand le SDK exposera un urlLink, l'auto
    // détection ci-dessus prendra le relais sans changement supplémentaire.
    const candidates = content.candidates(mtes);
    if (candidates.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "empty";
      empty.textContent = content.noCandidates;
      candidatesContainer.appendChild(empty);
    } else {
      const header = doc.createElement("p");
      header.className = "candidates-header";
      header.textContent = content.candidatesHeader;
      candidatesContainer.appendChild(header);
      for (const m of candidates) {
        candidatesContainer.appendChild(
          candidateRow(doc, m, () => {
            mteInput.value = m.id;
            mteStore.set(deps.mteKey, m.id);
            badge.textContent = i18next.t("panel.mtePopup.badgeManual");
          }),
        );
      }
    }
  }

  mteInput.addEventListener("input", () => {
    mteStore.set(deps.mteKey, mteInput.value);
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

// "YYYY-MM-DDTHH:mm" (datetime-local) → "DD/MM/YYYY HH:mm".
function formatDateTimeForEditor(value: string): string {
  const [date, time = ""] = value.split("T");
  return `${formatDateForEditor(date)} ${time}`.trim();
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

function candidateRow(doc: Document, m: MteRef, onPick: () => void): HTMLElement {
  const row = doc.createElement("button");
  row.type = "button";
  row.className = "candidate";
  const dates = m.startDate && m.endDate ? ` — ${m.startDate} → ${m.endDate}` : "";
  row.textContent = `[#${m.id}] ${m.name || "(sans nom)"}${dates}`;
  row.addEventListener("click", onPick);
  return row;
}
