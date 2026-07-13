import React, { useState } from "react";
import { Eye, EyeOff, Copy, Trash2 } from "lucide-react";
import { VaultEntry, Settings } from "../types";
import { maskValue, statusLabel } from "../utils";
import { getTranslation } from "../utils/i18n";

interface EntryCardProps {
  entry: VaultEntry;
  score?: number;
  reason?: string;
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings?: Settings | null;
}

export const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  score,
  reason,
  onOpenClarify,
  onDeleteEntry,
  settings = null,
}) => {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(entry.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white truncate">{entry.name}</span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
              {entry.type}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              {entry.family}
            </span>
            {entry.status !== "saved" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
                {statusLabel(entry.status)}
              </span>
            )}
          </div>
          {(score !== undefined || reason) && (
            <p className="text-[11px] text-slate-500 mt-1">
              {score !== undefined && `Score ${(score * 100).toFixed(0)}%`}
              {reason ? ` · ${reason}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
            title={show ? t("hide") : t("reveal")}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
            title={t("copy")}
          >
            <Copy className="w-4 h-4" />
          </button>
          {entry.status !== "saved" && (
            <button
              type="button"
              onClick={() => onOpenClarify(entry)}
              className="px-2 py-1 text-[11px] rounded-lg bg-amber-600/20 text-amber-300 border border-amber-500/30"
            >
              {t("identify")}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteEntry(entry.id)}
            className="p-1.5 rounded-lg hover:bg-red-950 text-slate-500 hover:text-red-400"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="font-mono text-sm text-emerald-300/90 bg-slate-950/60 rounded-lg px-3 py-2 break-all border border-slate-800">
        {show ? entry.value : maskValue(entry.value)}
        {copied && (
          <span className="ml-2 text-[10px] text-emerald-500">{t("copied")}</span>
        )}
      </div>
      {entry.raw_fragment && entry.raw_fragment !== entry.value && (
        <p className="text-[11px] text-slate-500 font-mono truncate" title={entry.raw_fragment}>
          src: {entry.raw_fragment}
        </p>
      )}
    </div>
  );
};
