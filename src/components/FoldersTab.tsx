import React from "react";
import { AlertCircle, Ban, CheckCircle, Folder, FolderSearch, HelpCircle, Save } from "lucide-react";
import { FolderScanSession, WatchedFolderRow, ScanCandidate, Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface FoldersTabProps {
  folderPath: string;
  setFolderPath: (v: string) => void;
  onPickFolder: () => Promise<void>;
  onFolderScan: (pathOverride?: string) => Promise<void>;
  scanning: boolean;
  folderWatch: boolean;
  setFolderWatch: (v: boolean) => void;
  folderUseAi: boolean;
  setFolderUseAi: (v: boolean) => void;
  watchedFolders: WatchedFolderRow[];
  scanSession: FolderScanSession | null;
  onRemoveWatchedFolder: (id: string) => Promise<void>;
  onSetAllDecisions: (decision: "save" | "park" | "discard" | "pending") => Promise<void>;
  onDiscardScanSession: () => Promise<void>;
  onApplyScanSession: () => Promise<void>;
  applyingScan: boolean;
  onPatchScanCandidate: (tempId: string, patch: Partial<ScanCandidate>) => Promise<void>;
  isElectron: boolean;
  settings: Settings | null;
}

export const FoldersTab: React.FC<FoldersTabProps> = ({
  folderPath,
  setFolderPath,
  onPickFolder,
  onFolderScan,
  scanning,
  folderWatch,
  setFolderWatch,
  folderUseAi,
  setFolderUseAi,
  watchedFolders,
  scanSession,
  onRemoveWatchedFolder,
  onSetAllDecisions,
  onDiscardScanSession,
  onApplyScanSession,
  applyingScan,
  onPatchScanCandidate,
  isElectron,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <div className="space-y-5">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <FolderSearch className="w-4 h-4 text-indigo-400" />
          {t("folder_watch_title")}
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          {t("folder_watch_desc")}
        </p>

        <div className="flex flex-wrap gap-2">
          <input
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder={t("folder_watch_placeholder")}
            className="flex-1 min-w-[220px] bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={onPickFolder}
            disabled={scanning}
            className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {t("browse_btn")}
          </button>
          <button
            type="button"
            onClick={() => onFolderScan()}
            disabled={scanning || !folderPath.trim()}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            <Folder className="w-4 h-4" />
            {scanning ? t("scanning_label") : t("scan_folder_btn")}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          {t("folder_watch_disk_desc")}{" "}
          {isElectron
            ? (t("ui_language_label") === "لغة الواجهة / UI Language" ? "(أو استخدم حوار Electron الأصلي)." : "(or use the Electron native dialog).")
            : ""}
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={folderWatch}
              onChange={(e) => setFolderWatch(e.target.checked)}
            />
            {t("folder_watch_keep")}
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={folderUseAi}
              onChange={(e) => setFolderUseAi(e.target.checked)}
            />
            {t("folder_watch_ai")}
          </label>
        </div>
      </div>

      {watchedFolders.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("tracked_folders_title")}</h3>
          {watchedFolders.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-mono text-slate-300 truncate">{f.path}</div>
                <div className="text-slate-500">
                  {f.live || f.watching ? (
                    <span className="text-emerald-400">{t("live_watch_label")}</span>
                  ) : (
                    t("not_watching_label")
                  )}
                  {f.last_scan_at && ` · last scan ${new Date(f.last_scan_at).toLocaleString()}`}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800"
                  onClick={() => {
                    setFolderPath(f.path);
                  }}
                >
                  {t("use_btn")}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg border border-slate-700 text-red-400 hover:bg-red-950/40"
                  onClick={() => onRemoveWatchedFolder(f.id)}
                >
                  {t("remove_btn")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {scanSession && scanSession.status === "review" && (
        <div className="space-y-4">
          {/* Brief report */}
          <div className="bg-slate-950 border border-indigo-500/30 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-indigo-300">{t("scan_brief_title")}</h3>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
              {scanSession.brief}
            </pre>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-white">{scanSession.summary.files_processed}</div>
                <div className="text-[10px] text-slate-500">{t("files_included")}</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-amber-400">{scanSession.summary.files_skipped}</div>
                <div className="text-[10px] text-slate-500">{t("files_skipped")}</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-emerald-400">{scanSession.summary.candidates_ready}</div>
                <div className="text-[10px] text-slate-500">{t("candidates_ready")}</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-amber-300">{scanSession.summary.candidates_needs_review}</div>
                <div className="text-[10px] text-slate-500">{t("candidates_needs_review")}</div>
              </div>
            </div>
          </div>

          {/* Skipped files */}
          {scanSession.skipped_files.length > 0 && (
            <details className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <summary className="text-xs font-semibold text-slate-400 cursor-pointer">
                {t("ui_language_label") === "لغة الواجهة / UI Language"
                  ? `غير مشمول (${scanSession.skipped_files.length} ملفات) — اضغط للتوسيع`
                  : `Not included (${scanSession.skipped_files.length} files) — click to expand`}
              </summary>
              <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
                {scanSession.skipped_files.map((s, i) => (
                  <div key={i} className="text-[11px] font-mono flex gap-2 text-slate-500">
                    <span className="text-amber-500/80 shrink-0">{s.reason}</span>
                    <span className="truncate text-slate-400" title={s.path}>{s.name}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Bulk actions */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-500">{t("bulk_label")}</span>
            <button type="button" onClick={() => onSetAllDecisions("save")} className="px-2 py-1 text-[11px] rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30">{t("mark_all_save")}</button>
            <button type="button" onClick={() => onSetAllDecisions("park")} className="px-2 py-1 text-[11px] rounded-lg bg-amber-600/20 text-amber-300 border border-amber-500/30">{t("mark_all_park")}</button>
            <button type="button" onClick={() => onSetAllDecisions("discard")} className="px-2 py-1 text-[11px] rounded-lg bg-red-600/20 text-red-300 border border-red-500/30">{t("mark_all_discard")}</button>
            <button type="button" onClick={() => onSetAllDecisions("pending")} className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 text-slate-400">{t("reset_btn")}</button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDiscardScanSession}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:text-white flex items-center gap-1"
            >
              <Ban className="w-3.5 h-3.5" /> {t("discard_review_btn")}
            </button>
            <button
              type="button"
              onClick={onApplyScanSession}
              disabled={applyingScan}
              className="px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium disabled:opacity-50 flex items-center gap-1"
            >
              <Save className="w-3.5 h-3.5" />
              {applyingScan ? t("applying_label") : t("apply_to_vault_btn")}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            {t("apply_brief_desc")}
          </p>

          {/* Candidates */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">
              {t("ui_language_label") === "لغة الواجهة / UI Language"
                ? `المرشحون المستخرجون (${scanSession.candidates.length})`
                : `Extracted candidates (${scanSession.candidates.length})`}
            </h3>
            {scanSession.candidates.map((c) => (
              <div
                key={c.temp_id}
                className={`border rounded-xl p-4 space-y-2 ${
                  c.decision === "discard"
                    ? "opacity-50 border-slate-800 bg-slate-950/40"
                    : c.ready
                      ? "bg-slate-900/60 border-slate-700"
                      : "bg-amber-950/20 border-amber-500/30"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="uppercase text-slate-400">{c.family}</span>
                  {c.source_name && (
                    <span className="font-mono text-indigo-300/80 bg-indigo-500/10 px-1.5 py-0.5 rounded" title={c.source_file}>
                      {c.source_name}
                    </span>
                  )}
                  {!c.ready && (
                    <span className="text-amber-300 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {c.needs_type && t("needs_type_label")}
                      {c.needs_type && c.needs_name && " · "}
                      {c.needs_name && t("needs_name_label")}
                    </span>
                  )}
                  {c.ready && (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> {t("ready_label")}
                    </span>
                  )}
                </div>
                <div className="font-mono text-sm text-emerald-300 bg-slate-950 rounded-lg px-3 py-2 break-all">
                  {c.value}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={c.type}
                    onChange={(e) => onPatchScanCandidate(c.temp_id, { type: e.target.value })}
                    placeholder={t("type_placeholder")}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <input
                    value={c.name}
                    onChange={(e) => onPatchScanCandidate(c.temp_id, { name: e.target.value })}
                    placeholder={t("name_placeholder")}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["pending", "save", "park", "discard"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onPatchScanCandidate(c.temp_id, { decision: d })}
                      className={`px-2 py-0.5 rounded text-[11px] border ${
                        (c.decision || "pending") === d
                          ? d === "save"
                            ? "border-emerald-500 text-emerald-300 bg-emerald-500/10"
                            : d === "discard"
                              ? "border-red-500 text-red-300 bg-red-500/10"
                              : d === "park"
                                ? "border-amber-500 text-amber-300 bg-amber-500/10"
                                : "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                          : "border-slate-700 text-slate-500"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!scanSession.candidates.length && (
              <p className="text-sm text-slate-500 italic">{t("no_candidates_msg")}</p>
            )}
          </div>
        </div>
      )}

      {!scanSession && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {t("scan_folder_hint")}
        </p>
      )}
    </div>
  );
};
