import React from "react";
import { VaultEntry, Settings } from "../types";
import { maskValue } from "../utils";
import { getTranslation } from "../utils/i18n";

interface ClarifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  clarify: VaultEntry;
  clarifyType: string;
  setClarifyType: (v: string) => void;
  clarifyName: string;
  setClarifyName: (v: string) => void;
  onSubmitClarify: () => Promise<void>;
  settings?: Settings | null;
}

export const ClarifyModal: React.FC<ClarifyModalProps> = ({
  isOpen,
  onClose,
  clarify,
  clarifyType,
  setClarifyType,
  clarifyName,
  setClarifyName,
  onSubmitClarify,
  settings = null,
}) => {
  if (!isOpen) return null;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl" dir="auto">
        <h3 className="text-lg font-semibold text-white">{t("identify_modal_title")}</h3>
        <p className="text-xs text-slate-400 font-mono break-all">{maskValue(clarify.value)}</p>
        <p className="text-xs text-slate-500">{t("identify_modal_desc")}</p>
        <label className="block text-xs space-y-1">
          <span className="text-slate-400">{t("ui_language_label") === "لغة الواجهة / UI Language" ? "ما هذا؟ (النوع)" : "What is this? (freeform type)"}</span>
          <input
            value={clarifyType}
            onChange={(e) => setClarifyType(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            placeholder={t("identify_placeholder_type")}
            autoFocus
          />
        </label>
        <label className="block text-xs space-y-1">
          <span className="text-slate-400">{t("ui_language_label") === "لغة الواجهة / UI Language" ? "الاسم (مطلوب)" : "Name (required)"}</span>
          <input
            value={clarifyName}
            onChange={(e) => setClarifyName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            placeholder={t("identify_placeholder_name")}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
          >
            {t("identify_cancel_btn")}
          </button>
          <button
            type="button"
            onClick={onSubmitClarify}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
          >
            {t("identify_save_btn")}
          </button>
        </div>
      </div>
    </div>
  );
};
