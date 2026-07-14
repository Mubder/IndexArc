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
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          <FolderSearch className="w-4 h-4" style={{ color: "var(--cyan)" }} />
          {t("folder_watch_title")}
        </h2>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {t("folder_watch_desc")}
        </p>

        <div className="flex flex-wrap gap-2">
          <input
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder={t("folder_watch_placeholder")}
            className="flex-1 min-w-[220px] rounded-xl px-3 py-2 text-sm focus:outline-none transition-colors"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
          />
          <button
            type="button"
            onClick={onPickFolder}
            disabled={scanning}
            className="px-3 py-2 rounded-xl text-xs disabled:opacity-50 transition-all"
            style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
          >
            {t("browse_btn")}
          </button>
          <button
            type="button"
            onClick={() => onFolderScan()}
            disabled={scanning || !folderPath.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-all"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Folder className="w-4 h-4" />
            {scanning ? t("scanning_label") : t("scan_folder_btn")}
          </button>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {t("folder_watch_disk_desc")}{" "}
          {isElectron
            ? (t("ui_language_label") === "لغة الواجهة / UI Language" ? "(أو استخدم حوار Electron الأصلي)." : "(or use the Electron native dialog).")
            : ""}
        </p>
        <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-dim)" }}>
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
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("tracked_folders_title")}</h3>
          {watchedFolders.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
            >
              <div className="min-w-0">
                <div className="truncate" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{f.path}</div>
                <div style={{ color: "var(--text-muted)" }}>
                  {f.live || f.watching ? (
                    <span style={{ color: "var(--emerald)" }}>{t("live_watch_label")}</span>
                  ) : (
                    t("not_watching_label")
                  )}
                  {f.last_scan_at && ` · last scan ${new Date(f.last_scan_at).toLocaleString()}`}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg transition-all"
                  style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
                  onClick={() => {
                    setFolderPath(f.path);
                  }}
                >
                  {t("use_btn")}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg transition-all"
                  style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
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
          <div className="rounded-2xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-glow)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "var(--accent-bright)" }}>{t("scan_brief_title")}</h3>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
              {scanSession.brief}
            </pre>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-lg p-2" style={{ background: "var(--bg-base)", border: "1px solid var(--border)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--text)" }}>{scanSession.summary.files_processed}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("files_included")}</div>
              </div>
              <div className="rounded-lg p-2" style={{ background: "var(--bg-base)", border: "1px solid var(--border)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--amber)" }}>{scanSession.summary.files_skipped}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("files_skipped")}</div>
              </div>
              <div className="rounded-lg p-2" style={{ background: "var(--bg-base)", border: "1px solid var(--border)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--emerald)" }}>{scanSession.summary.candidates_ready}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("candidates_ready")}</div>
              </div>
              <div className="rounded-lg p-2" style={{ background: "var(--bg-base)", border: "1px solid var(--border)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--amber)" }}>{scanSession.summary.candidates_needs_review}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("candidates_needs_review")}</div>
              </div>
            </div>
          </div>

          {scanSession.skipped_files.length > 0 && (
            <details className="rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <summary className="text-xs font-semibold cursor-pointer" style={{ color: "var(--text-muted)" }}>
                {t("ui_language_label") === "لغة الواجهة / UI Language"
                  ? `غير مشمول (${scanSession.skipped_files.length} ملفات) — اضغط للتوسيع`
                  : `Not included (${scanSession.skipped_files.length} files) — click to expand`}
              </summary>
              <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
                {scanSession.skipped_files.map((s, i) => (
                  <div key={i} className="text-[11px] flex gap-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    <span className="shrink-0" style={{ color: "var(--amber)" }}>{s.reason}</span>
                    <span className="truncate" style={{ color: "var(--text-dim)" }} title={s.path}>{s.name}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("bulk_label")}</span>
            <button type="button" onClick={() => onSetAllDecisions("save")} className="px-2 py-1 text-[11px] rounded-lg transition-all" style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52, 211, 153, 0.2)" }}>{t("mark_all_save")}</button>
            <button type="button" onClick={() => onSetAllDecisions("park")} className="px-2 py-1 text-[11px] rounded-lg transition-all" style={{ background: "var(--amber-bg)", color: "var(--amber)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>{t("mark_all_park")}</button>
            <button type="button" onClick={() => onSetAllDecisions("discard")} className="px-2 py-1 text-[11px] rounded-lg transition-all" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248, 113, 113, 0.2)" }}>{t("mark_all_discard")}</button>
            <button type="button" onClick={() => onSetAllDecisions("pending")} className="px-2 py-1 text-[11px] rounded-lg" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>{t("reset_btn")}</button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDiscardScanSession}
              className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1 transition-all"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              <Ban className="w-3.5 h-3.5" /> {t("discard_review_btn")}
            </button>
            <button
              type="button"
              onClick={onApplyScanSession}
              disabled={applyingScan}
              className="px-4 py-1.5 text-xs rounded-lg font-medium disabled:opacity-50 flex items-center gap-1 transition-all"
              style={{ background: "var(--emerald)", color: "white" }}
            >
              <Save className="w-3.5 h-3.5" />
              {applyingScan ? t("applying_label") : t("apply_to_vault_btn")}
            </button>
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {t("apply_brief_desc")}
          </p>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {t("ui_language_label") === "لغة الواجهة / UI Language"
                ? `المرشحون المستخرجون (${scanSession.candidates.length})`
                : `Extracted candidates (${scanSession.candidates.length})`}
            </h3>
            {scanSession.candidates.map((c) => (
              <div
                key={c.temp_id}
                className="rounded-xl p-4 space-y-2 transition-all"
                style={{
                  background: c.decision === "discard"
                    ? "var(--bg-surface)"
                    : c.ready
                      ? "var(--bg-surface)"
                      : "var(--amber-bg)",
                  border: `1px solid ${c.decision === "discard" ? "var(--border)" : c.ready ? "var(--border)" : "rgba(251, 191, 36, 0.2)"}`,
                  opacity: c.decision === "discard" ? 0.5 : 1,
                }}
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="uppercase" style={{ color: "var(--text-muted)" }}>{c.family}</span>
                  {c.source_name && (
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--accent-bright)", background: "var(--accent-bg)" }}
                      title={c.source_file}
                    >
                      {c.source_name}
                    </span>
                  )}
                  {!c.ready && (
                    <span className="flex items-center gap-1" style={{ color: "var(--amber)" }}>
                      <AlertCircle className="w-3 h-3" />
                      {c.needs_type && t("needs_type_label")}
                      {c.needs_type && c.needs_name && " · "}
                      {c.needs_name && t("needs_name_label")}
                    </span>
                  )}
                  {c.ready && (
                    <span className="flex items-center gap-1" style={{ color: "var(--emerald)" }}>
                      <CheckCircle className="w-3 h-3" /> {t("ready_label")}
                    </span>
                  )}
                </div>
                <div className="rounded-lg px-3 py-2 break-all" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--emerald)", background: "var(--bg-input)", border: "1px solid var(--border)" }}>
                  {c.value}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={c.type}
                    onChange={(e) => onPatchScanCandidate(c.temp_id, { type: e.target.value })}
                    placeholder={t("type_placeholder")}
                    className="rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                  />
                  <input
                    value={c.name}
                    onChange={(e) => onPatchScanCandidate(c.temp_id, { name: e.target.value })}
                    placeholder={t("name_placeholder")}
                    className="rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["pending", "save", "park", "discard"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onPatchScanCandidate(c.temp_id, { decision: d })}
                      className="px-2 py-0.5 rounded text-[11px] transition-all"
                      style={{
                        border: `1px solid ${(c.decision || "pending") === d
                          ? d === "save" ? "rgba(52, 211, 153, 0.4)" : d === "discard" ? "rgba(248, 113, 113, 0.4)" : d === "park" ? "rgba(251, 191, 36, 0.4)" : "var(--border-glow)"
                          : "var(--border)"}`,
                        color: (c.decision || "pending") === d
                          ? d === "save" ? "var(--emerald)" : d === "discard" ? "var(--danger)" : d === "park" ? "var(--amber)" : "var(--accent-bright)"
                          : "var(--text-muted)",
                        background: (c.decision || "pending") === d
                          ? d === "save" ? "var(--emerald-bg)" : d === "discard" ? "var(--danger-bg)" : d === "park" ? "var(--amber-bg)" : "var(--accent-bg)"
                          : "transparent",
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!scanSession.candidates.length && (
              <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>{t("no_candidates_msg")}</p>
            )}
          </div>
        </div>
      )}

      {!scanSession && (
        <p className="text-sm flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <HelpCircle className="w-4 h-4" />
          {t("scan_folder_hint")}
        </p>
      )}
    </div>
  );
};
