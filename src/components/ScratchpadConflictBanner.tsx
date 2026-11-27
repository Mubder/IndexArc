import { useEffect, useState } from "react";
import { getScratchpadConflicts, resolveScratchpadConflict, subscribeScratchpadConflicts } from "../scratchpadSaveQueue";
import type { TranslationDict } from "../utils/i18n";

/** Stays mounted on every page, so leaving the Scratchpad does not drop the choice. */
export function ScratchpadConflictBanner({ t }: { t: (key: keyof TranslationDict) => string }) {
  const [items, setItems] = useState(getScratchpadConflicts);
  useEffect(() => subscribeScratchpadConflicts(() => setItems(getScratchpadConflicts())), []);
  if (!items.length) return null;
  const c = items[0];
  return (
    <div className="mx-8 mt-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)", color: "var(--text)" }}>
      <span>{t("scratchpad_conflict_msg")}{c.title ? ` — ${c.title}` : ""}</span>
      <span className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={() => resolveScratchpadConflict(c.id, false)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}>
          {t("scratchpad_conflict_load")}
        </button>
        <button type="button" onClick={() => resolveScratchpadConflict(c.id, true)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--bg-input)", color: "var(--text)", border: "1px solid var(--border-input)" }}>
          {t("scratchpad_conflict_keep")}
        </button>
      </span>
    </div>
  );
}
