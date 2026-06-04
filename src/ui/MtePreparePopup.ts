// src/ui/MtePreparePopup.ts
import i18next from "i18next";
import { fetchSlowupFullDetails } from "../lines/slowupClient";
import type { SlowupFullDetails } from "../lines/types";
import { byUrl, candidatesByBbox, mteStore, type MteCandidate, type MteRef, type MteSdk } from "../mte";

export interface MtePreparePopupDeps {
  refid: number;
  slowupBbox: [number, number, number, number];
  mteSdk: MteSdk;
}

let openInstance: HTMLDialogElement | null = null;

export async function openMtePreparePopup(deps: MtePreparePopupDeps): Promise<void> {
  if (openInstance) {
    openInstance.close();
    openInstance.remove();
    openInstance = null;
  }

  const dialog = document.createElement("dialog");
  dialog.style.cssText = "border:none;border-radius:8px;padding:24px 28px;max-width:560px;width:92vw;box-shadow:0 6px 32px rgba(0,0,0,.25);";
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  openInstance = dialog;

  function close() {
    dialog.close();
    dialog.remove();
    if (openInstance === dialog) openInstance = null;
  }

  const title = document.createElement("h3");
  title.style.cssText = "margin:0 0 12px 0;font-size:16px;font-weight:700;";
  title.textContent = i18next.t("panel.mtePopup.loading");
  dialog.appendChild(title);

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:12px;";
  dialog.appendChild(body);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = i18next.t("panel.mtePopup.close");
  closeBtn.style.cssText = "margin-top:12px;padding:6px 14px;cursor:pointer;align-self:flex-end;";
  closeBtn.addEventListener("click", close);
  dialog.appendChild(closeBtn);

  document.body.appendChild(dialog);
  dialog.showModal();

  // Lazy fetch
  let details: SlowupFullDetails;
  try {
    details = await fetchSlowupFullDetails(deps.refid);
  } catch (err) {
    title.textContent = i18next.t("panel.mtePopup.error");
    body.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  renderContent(title, body, details, deps);
}

function renderContent(
  title: HTMLElement,
  body: HTMLElement,
  details: SlowupFullDetails,
  deps: MtePreparePopupDeps,
): void {
  title.textContent = `SlowUP ${details.title}`;
  body.innerHTML = "";

  body.appendChild(copyRow(i18next.t("panel.mtePopup.titleLabel"), `SlowUP ${details.title}`));
  body.appendChild(copyRow(i18next.t("panel.mtePopup.dateLabel"), details.date));
  body.appendChild(copyRow(i18next.t("panel.mtePopup.urlLabel"), details.urlLink));

  body.appendChild(divider());

  for (const lang of ["fr", "en", "de", "it"] as const) {
    body.appendChild(abstractBlock(lang.toUpperCase(), details.abstracts[lang]));
  }

  body.appendChild(divider());

  // MTE ID section
  const mteSection = document.createElement("div");
  mteSection.style.cssText = "display:flex;flex-direction:column;gap:6px;";

  const mteLabel = document.createElement("label");
  mteLabel.textContent = i18next.t("panel.mtePopup.mteIdLabel");
  mteLabel.style.cssText = "font-size:13px;font-weight:600;";
  mteSection.appendChild(mteLabel);

  const inputRow = document.createElement("div");
  inputRow.style.cssText = "display:flex;gap:8px;align-items:center;";
  const mteInput = document.createElement("input");
  mteInput.type = "text";
  mteInput.style.cssText = "flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;";
  const badge = document.createElement("span");
  badge.style.cssText = "font-size:12px;color:#555;";
  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = i18next.t("panel.mtePopup.refresh");
  refreshBtn.style.cssText = "padding:6px 12px;cursor:pointer;";
  inputRow.appendChild(mteInput);
  inputRow.appendChild(refreshBtn);
  mteSection.appendChild(inputRow);
  mteSection.appendChild(badge);

  const candidatesContainer = document.createElement("div");
  candidatesContainer.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  mteSection.appendChild(candidatesContainer);

  body.appendChild(mteSection);

  function runResolution(): void {
    const mtes = deps.mteSdk.listMtes();
    const stored = mteStore.get(deps.refid);
    const auto = byUrl(mtes, details.urlLink);
    candidatesContainer.innerHTML = "";

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
        const empty = document.createElement("p");
        empty.style.cssText = "margin:6px 0 0 0;font-size:12px;color:#888;";
        empty.textContent = i18next.t("panel.mtePopup.noCandidates");
        candidatesContainer.appendChild(empty);
      } else {
        const header = document.createElement("p");
        header.style.cssText = "margin:6px 0 0 0;font-size:12px;font-weight:600;";
        header.textContent = i18next.t("panel.mtePopup.candidatesHeader");
        candidatesContainer.appendChild(header);
        for (const c of candidates) {
          candidatesContainer.appendChild(candidateRow(c, () => {
            mteInput.value = c.mte.id;
            mteStore.set(deps.refid, c.mte.id);
            badge.textContent = i18next.t("panel.mtePopup.badgeManual");
          }));
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

function copyRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center;";
  const lab = document.createElement("span");
  lab.textContent = `${label} :`;
  lab.style.cssText = "font-size:13px;font-weight:600;min-width:60px;";
  const val = document.createElement("span");
  val.textContent = value;
  val.style.cssText = "flex:1;font-size:13px;word-break:break-all;";
  const btn = copyButton(value);
  row.appendChild(lab);
  row.appendChild(val);
  row.appendChild(btn);
  return row;
}

function abstractBlock(langLabel: string, text: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
  const label = document.createElement("span");
  label.textContent = `Abstract ${langLabel}`;
  label.style.cssText = "font-size:13px;font-weight:600;";
  header.appendChild(label);
  header.appendChild(copyButton(text));
  const box = document.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  box.style.cssText = "width:100%;min-height:60px;font-size:12px;padding:6px;border:1px solid #ddd;border-radius:4px;resize:vertical;font-family:inherit;";
  wrap.appendChild(header);
  wrap.appendChild(box);
  return wrap;
}

function copyButton(value: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = i18next.t("panel.mtePopup.copy");
  btn.style.cssText = "padding:4px 8px;font-size:12px;cursor:pointer;";
  btn.addEventListener("click", () => {
    void navigator.clipboard.writeText(value);
  });
  return btn;
}

function divider(): HTMLElement {
  const hr = document.createElement("hr");
  hr.style.cssText = "border:none;border-top:1px solid #eee;margin:4px 0;";
  return hr;
}

function candidateRow(c: MteCandidate, onPick: () => void): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.style.cssText = "text-align:left;padding:6px 8px;border:1px solid #ddd;border-radius:4px;background:#fafafa;cursor:pointer;font-size:12px;";
  row.textContent = `[#${c.mte.id}] ${c.mte.name || "(sans nom)"} — overlap ${c.overlap.toFixed(4)}°²`;
  row.addEventListener("click", onPick);
  return row;
}
