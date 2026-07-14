import React from "react";
import { Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "primary";
  settings?: Settings | null;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = "danger",
  settings = null,
}) => {
  if (!isOpen) return null;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

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
        <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>{message}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {cancelText || t("identify_cancel_btn")}
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className="px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{
              background: variant === "danger" ? "var(--danger)" : "var(--accent)",
              color: "white",
            }}
          >
            {confirmText || t("identify_save_btn")}
          </button>
        </div>
      </div>
    </div>
  );
};