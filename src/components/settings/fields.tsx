import React from "react";
import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

// API keys are write-only (the server never returns stored key material), so
// this input keeps a local draft and only sends a value on blur. Leaving it
// empty keeps the stored key. "✓ saved" shows a key exists server-side.
export const KeyInput: React.FC<{
  field: string;
  configured?: boolean;
  placeholder?: string;
  onCommit: (patch: Partial<Settings>) => void;
  t: (key: keyof TranslationDict) => string;
}> = ({ field, configured, placeholder, onCommit, t }) => {
  const [draft, setDraft] = React.useState("");
  return (
    <input
      type="password"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft.trim();
        if (v) {
          onCommit({ [field]: v } as Partial<Settings>);
          setDraft("");
        }
      }}
      className="w-full rounded-lg px-2 py-1.5 text-sm"
      style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
      placeholder={configured ? `••••••••   (${t("key_saved_type_to_replace")})` : placeholder || ""}
    />
  );
};

export const SavedBadge: React.FC<{ ok?: boolean; t: (key: keyof TranslationDict) => string }> = ({ ok, t }) =>
  ok ? (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ color: "var(--accent-bright)", background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}
    >
      ✓ {t("key_saved_badge")}
    </span>
  ) : null;
