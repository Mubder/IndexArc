import React from "react";
import type { UpsertReportItem, UpsertStatus } from "./appsApi";

const TONE: Record<UpsertStatus, { fg: string; bg: string }> = {
  new: { fg: "var(--emerald)", bg: "var(--emerald-bg)" },
  update: { fg: "var(--amber)", bg: "var(--amber-bg)" },
  same: { fg: "var(--text-muted)", bg: "var(--bg-input)" },
};

/** What a save into an application will do, key by key: new, update or unchanged. */
export function UpsertPreview({
  items,
  label,
  checked,
  onToggle,
}: {
  items: UpsertReportItem[];
  label: (s: UpsertStatus) => string;
  checked?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      {items.map((i, n) => (
        <label
          key={i.key}
          className="flex items-center gap-2 px-3 py-2 text-xs"
          style={{ borderTop: n ? "1px solid var(--border)" : undefined, cursor: onToggle ? "pointer" : undefined }}
        >
          {onToggle && <input type="checkbox" checked={checked?.has(i.key) ?? true} onChange={() => onToggle(i.key)} disabled={i.status === "same"} />}
          <span className="font-mono truncate flex-1" style={{ color: "var(--text)" }} dir="ltr">{i.key}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0" style={{ color: TONE[i.status].fg, background: TONE[i.status].bg }}>
            {label(i.status)}
          </span>
        </label>
      ))}
    </div>
  );
}
