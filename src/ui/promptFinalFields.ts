// Native WME dialog collecting the fields required before exporting or
// applying closures.

import i18next from "i18next";
import type { FinalFields } from "../csv/buildClosuresCsv";
import { mteStore, type MteKey } from "../mte/mteStore";
import { isChecked, readValue, wzCheckbox, wzTextInput } from "./components/wz";
import { wzDialog } from "./components/wzDialog";

/** MTE id to prefill: explicit default first, then the one linked to the line. */
export function resolveDefaultMteId(
  explicit: string | undefined,
  mteKey: MteKey | undefined,
): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (mteKey !== undefined) return mteStore.get(mteKey) ?? "";
  return "";
}

export interface PromptFinalFieldsOptions {
  defaults?: Partial<FinalFields>;
  mteKey?: MteKey;
  /** "apply" adds closures in WME: no CSV, so no comment column and no comma rule. */
  mode?: "download" | "apply";
}

export async function promptFinalFields(
  options: PromptFinalFieldsOptions = {},
): Promise<FinalFields | null> {
  const { defaults, mteKey, mode = "download" } = options;
  const isApply = mode === "apply";

  const reason = wzTextInput({
    label: i18next.t(isApply ? "panel.finalFields.reasonApply" : "panel.finalFields.reason"),
    value: defaults?.reason ?? "",
  });
  const ignoreTraffic = wzCheckbox({
    label: i18next.t("panel.finalFields.ignoreTraffic"),
    checked: defaults?.ignoreTraffic ?? true,
  });
  const mteId = wzTextInput({
    label: i18next.t("panel.finalFields.mteId"),
    value: resolveDefaultMteId(defaults?.mteId, mteKey),
  });
  // Only the CSV has a comment column.
  const comment = wzTextInput({
    label: i18next.t("panel.finalFields.comment"),
    value: defaults?.comment ?? "",
  });

  let result: FinalFields | null = null;
  const confirmed = await wzDialog({
    title: i18next.t(isApply ? "panel.finalFields.titleApply" : "panel.finalFields.title"),
    body: isApply ? [reason, ignoreTraffic, mteId] : [reason, ignoreTraffic, mteId, comment],
    primaryLabel: i18next.t(isApply ? "panel.finalFields.okApply" : "panel.finalFields.ok"),
    cancelLabel: i18next.t("panel.finalFields.cancel"),
    focus: reason,
    onPrimary: () => {
      const fields: FinalFields = {
        reason: readValue(reason).trim(),
        ignoreTraffic: isChecked(ignoreTraffic),
        mteId: readValue(mteId).trim(),
        comment: isApply ? "" : readValue(comment).trim(),
      };
      // Commas would break the CSV columns; WME itself accepts them.
      const hasComma = [fields.reason, fields.comment, fields.mteId].some((v) => v.includes(","));
      if (!isApply && hasComma) return i18next.t("panel.finalFields.errorCommaInField");
      result = fields;
      return null;
    },
  });
  return confirmed ? result : null;
}
