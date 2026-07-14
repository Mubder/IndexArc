import React, { useState } from "react";
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
  clarifyValue: string;
  setClarifyValue: (v: string) => void;
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
  clarifyValue,
  setClarifyValue,
  onSubmitClarify,
  settings = null,
}) => {
  if (!isOpen) return null;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);
  const [showValue, setShowValue] = useState(false);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div
        className="p-6 w-full max-w-md space-y-4 shadow-2xl"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "1rem",
          backdropFilter: "blur(10px)",
        }}
        dir="auto"
      >
        <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("identify_modal_title")}</h3>
        <p className="text-xs break-all" style={{ fontFamily: "var(--font-mono)", color: "var(--emerald)" }}>{showValue ? clarifyValue : maskValue(clarify.value)}</p>
        <button
          type="button"
          onClick={() => setShowValue(!showValue)}
          className="text-xs"
          style={{ color: "var(--cyan)" }}
        >
          {showValue ? t("hide") : t("reveal")}
        </button>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("identify_modal_desc")}</p>
        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("ui_language_label") === "لغة الواجهة / UI Language" ? "القيمة (مطلوبة)" : "Value (required)"}</span>
          <textarea
            value={clarifyValue}
            onChange={(e) => setClarifyValue(e.target.value)}
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)", resize: "vertical" }}
            placeholder={t("identify_placeholder_value")}
          />
        </label>
        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("ui_language_label") === "لغة الواجهة / UI Language" ? "ما هذا؟ (النوع)" : "What is this? (freeform type)"}</span>
          <input
            value={clarifyType}
            onChange={(e) => setClarifyType(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            placeholder={t("identify_placeholder_type")}
            autoFocus
          />
        </label>
        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("ui_language_label") === "لغة الواجهة / UI Language" ? "الاسم (مطلوب)" : "Name (required)"}</span>
          <input
            value={clarifyName}
            onChange={(e) => setClarifyName(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            placeholder={t("identify_placeholder_name")}
          />
        </label>
        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("ui_language_label") === "لغة الواجهة / UI Language" ? "القيمة / المفتاح" : "Value / Key"}</span>
          <input
            value={clarifyValue}
            onChange={(e) => setClarifyValue(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none font-mono"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            placeholder={t("ui_language_label") === "لغة الواجهة / UI Language" ? "أدخل القيمة" : "Enter value"}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("identify_cancel_btn")}
          </button>
          <button
            type="button"
            onClick={onSubmitClarify}
            className="px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: "var(--emerald)", color: "white" }}
          >
            {t("identify_save_btn")}
          </button>
        </div>
      </div>
    </div>
  );
};