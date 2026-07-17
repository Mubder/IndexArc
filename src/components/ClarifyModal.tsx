import React, { useState } from "react";
import { VaultEntry, Settings } from "../types";
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
  clarifyFamily: VaultEntry["family"];
  setClarifyFamily: (v: VaultEntry["family"]) => void;
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
  clarifyFamily,
  setClarifyFamily,
  onSubmitClarify,
  settings = null,
}) => {
  if (!isOpen) return null;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
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
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("identify_modal_desc")}</p>

        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("identify_category_label")}</span>
          <select
            value={clarifyFamily}
            onChange={(e) => setClarifyFamily(e.target.value as VaultEntry["family"])}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
          >
            <option value="secret">{t("family_secret")}</option>
            <option value="command">{t("family_command")}</option>
            <option value="note">{t("family_note")}</option>
            <option value="unknown">{t("family_unknown")}</option>
          </select>
        </label>

        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>
            {t("name_label_secrets")}{" "}
            {(clarifyFamily === "secret" || clarifyFamily === "unknown") && (
              <span style={{ color: "var(--danger)" }}>*</span>
            )}
          </span>
          <input
            value={clarifyName}
            onChange={(e) => setClarifyName(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            placeholder={t("identify_placeholder_name")}
            autoFocus
          />
        </label>

        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("type_label")}</span>
          <input
            value={clarifyType}
            onChange={(e) => setClarifyType(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            placeholder={t("identify_placeholder_type")}
          />
        </label>

        <div className="block text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--text-dim)" }}>{t("identify_key_label")}</span>
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="text-xs"
              style={{ color: "var(--cyan)" }}
            >
              {revealed ? t("hide") : t("reveal")}
            </button>
          </div>
          <input
            value={clarifyValue}
            onChange={(e) => setClarifyValue(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none font-mono"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            placeholder={t("identify_placeholder_value")}
          />
          <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>{t("identify_keep_hint")}</p>
          {revealed && (
            <p
              className="text-[11px] break-all rounded px-2 py-1"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--emerald)",
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
              }}
            >
              {clarify.value}
            </p>
          )}
        </div>

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

export default ClarifyModal;
