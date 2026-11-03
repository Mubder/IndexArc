import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";
import { createPortal } from "react-dom";

export interface ProtectModalProps {
  protectConfirmInput: string;
  protectError: string;
  protectInputRef: RefObject<HTMLInputElement | null>;
  protectModal: { mode: "on" | "off"; tabId: string; } | null;
  protectShowInput: boolean;
  setProtectConfirmInput: Dispatch<SetStateAction<string>>;
  setProtectError: Dispatch<SetStateAction<string>>;
  setProtectModal: Dispatch<SetStateAction<{ mode: "on" | "off"; tabId: string; } | null>>;
  setProtectShowInput: Dispatch<SetStateAction<boolean>>;
  submitProtect: () => Promise<void>;
  t: (key: keyof TranslationDict) => string;
}

export function ProtectModal({ protectConfirmInput, protectError, protectInputRef, protectModal, protectShowInput, setProtectConfirmInput, setProtectError, setProtectModal, setProtectShowInput, submitProtect, t }: ProtectModalProps) {
  return (
    <>
      {/* Protect / Unprotect modal — portaled to <body> so nothing in the
          scratchpad tree (overlays, selection rules, drag handlers) can make
          the confirm field inert. */}
      {protectModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center p-4"
            style={{ background: "rgba(2,6,23,0.7)", backdropFilter: "blur(4px)" }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setProtectModal(null);
                setProtectError("");
              }
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl p-5 space-y-3"
              style={{ background: "var(--bg-surface-solid, var(--bg-surface))", border: "1px solid var(--border)", boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {protectModal.mode === "on" ? (
                <>
                  <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                    🛡️ {t("protect_confirm_title" as any) || "Protect this note?"}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                    {t("protect_confirm_msg" as any) || "A protected note cannot be edited, renamed, deleted, archived, or sent to AI. You can remove protection anytime with your confirmation word."}
                  </p>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => { setProtectModal(null); setProtectError(""); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                    >
                      {t("identify_cancel_btn") || "Cancel"}
                    </button>
                    <button
                      onClick={submitProtect}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "#f87171" }}
                    >
                      🔒 {t("protect_enable" as any) || "Protect note"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                    🔓 {t("protect_remove_title" as any) || "Remove protection"}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                    {t("protect_remove_msg" as any) || "Type UNPROTECT (or your master password if the vault is encrypted) to allow edits and deletion again."}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      ref={protectInputRef}
                      autoFocus
                      type={protectShowInput ? "text" : "password"}
                      value={protectConfirmInput}
                      onChange={(e) => { setProtectConfirmInput(e.target.value); setProtectError(""); }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") submitProtect();
                        if (e.key === "Escape") { setProtectModal(null); setProtectError(""); }
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="UNPROTECT"
                      aria-label={t("protect_remove_title" as any) || "Confirmation word or master password"}
                      className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                      style={{
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-glow)",
                        color: "var(--text)",
                        fontFamily: "var(--font-mono)",
                        cursor: "text",
                        caretColor: "var(--accent-bright)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setProtectShowInput((v) => !v)}
                      className="px-2 py-2 rounded-lg text-xs"
                      title={protectShowInput ? "Hide" : "Show"}
                      style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text-muted)" }}
                    >
                      {protectShowInput ? "🙈" : "👁"}
                    </button>
                  </div>
                  {protectError && (
                    <p className="text-xs" style={{ color: "#f87171" }}>{protectError}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => { setProtectModal(null); setProtectError(""); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                    >
                      {t("identify_cancel_btn") || "Cancel"}
                    </button>
                    <button
                      onClick={submitProtect}
                      disabled={!protectConfirmInput.trim()}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                      style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)", color: "var(--accent-bright)" }}
                    >
                      {t("protect_remove_btn" as any) || "Remove protection"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
