import React from "react";
import { HelpCircle, RefreshCw } from "lucide-react";
import { VaultEntry, Settings, LibraryFilter } from "../types";
import { EntryCard } from "./EntryCard";
import { getTranslation } from "../utils/i18n";

interface LogsTabProps {
  logs: { time: string; type: string; message: string }[];
}

export const LogsTab: React.FC<LogsTabProps> = ({ logs }) => {
  return (
    <div className="rounded-2xl p-4 font-mono text-[11px] max-h-[70vh] overflow-y-auto" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      {!logs.length && (
        <p className="text-center py-8" style={{ color: "var(--text-muted)" }}>No logs yet</p>
      )}
      {logs.map((l, i) => (
        <div key={i} className="flex gap-3 py-1 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="shrink-0" style={{ color: "var(--text-muted)" }}>{l.time}</span>
          <span className="shrink-0 w-20" style={{ color: "var(--accent-bright)" }}>{l.type}</span>
          <span style={{ color: "var(--text-dim)" }}>{l.message}</span>
        </div>
      ))}
    </div>
  );
};
