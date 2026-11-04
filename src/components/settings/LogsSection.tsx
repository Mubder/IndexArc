import { Terminal } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { TranslationDict } from "../../utils/i18n";

export interface LogsSectionProps {
  logs: { time: string; type: string; message: string; }[];
  t: (key: keyof TranslationDict) => string;
}

export function LogsSection({ logs, t }: LogsSectionProps) {
  return (
    <>
      <div className="space-y-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between gap-2 pt-3">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Terminal className="w-4 h-4" style={{ color: "var(--accent-bright)" }} /> {t("tab_logs")}
            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-active)", color: "var(--text-muted)" }}>
              {logs.length}
            </span>
          </h2>
          <button
            type="button"
            disabled={!logs.length}
            onClick={() => {
              const text = logs.map((l) => `${l.time}\t${l.type}\t${l.message}`).join("\n");
              void copyTextToClipboard(text);
            }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-40"
            style={{ background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            {t("logs_copy_all")}
          </button>
        </div>
        <div className="rounded-xl p-4 font-mono text-[11px] h-[60vh] min-h-[320px] overflow-y-auto" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
          {!logs.length && (
            <p className="text-center py-6" style={{ color: "var(--text-muted)" }}>{t("logs_empty")}</p>
          )}
          {logs.slice().reverse().map((l, i) => (
            <div key={i} className="flex gap-3 py-1 border-b items-start" style={{ borderColor: "var(--border)" }}>
              <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{l.time}</span>
              <span className="shrink-0 w-24" style={{ color: "var(--accent-bright)" }}>{l.type}</span>
              <span className="break-all whitespace-pre-wrap" style={{ color: "var(--text-dim)" }}>{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
