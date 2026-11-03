import { LifeBuoy, Save, RotateCcw, HardDriveDownload, Lock } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { SystemStatus } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export type EmergencySnapshot = {
  name: string;
  size: number;
  created_at: string;
  encrypted: boolean;
  has_vault?: boolean;
  has_notes?: boolean;
  locations: string[];
};

export interface EmergencySectionProps {
  confirmRestore: string | null;
  emgBusy: boolean;
  emgMsg: string;
  fmtDate: (iso: string) => string;
  handleCreateSnapshot: () => Promise<void>;
  handleRestoreSnapshot: (name: string) => Promise<void>;
  loadSnapshots: () => Promise<void>;
  onOpenHealth: (() => void) | undefined;
  setConfirmRestore: Dispatch<SetStateAction<string | null>>;
  snapshots: EmergencySnapshot[];
  status: SystemStatus | null;
  t: (key: keyof TranslationDict) => string;
}

export function EmergencySection({ confirmRestore, emgBusy, emgMsg, fmtDate, handleCreateSnapshot, handleRestoreSnapshot, loadSnapshots, onOpenHealth, setConfirmRestore, snapshots, status, t }: EmergencySectionProps) {
  return (
    <>
      <div className="space-y-4 rounded-xl p-5 mt-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 pb-2" style={{ color: "var(--accent-bright)", borderBottom: "1px solid var(--border)" }}>
          <LifeBuoy className="w-4 h-4" /> {t("emergency_title")}
        </h3>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
          {t("emergency_desc")}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={emgBusy}
            onClick={handleCreateSnapshot}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            <Save className="w-3.5 h-3.5" /> {t("emergency_create_btn")}
          </button>
          <button
            type="button"
            disabled={emgBusy}
            onClick={loadSnapshots}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            <RotateCcw className="w-3.5 h-3.5" /> {t("emergency_refresh_btn")}
          </button>
        </div>

        {emgMsg && (
          <p className="text-[10px] font-mono" style={{ color: "var(--emerald)" }}>{emgMsg}</p>
        )}

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {snapshots.length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t("emergency_empty")}
            </p>
          )}
          {snapshots.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
            >
              <div className="min-w-0">
                <div className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                  <HardDriveDownload className="w-3 h-3 shrink-0" style={{ color: "var(--cyan)" }} />
                  <span className="truncate" style={{ fontFamily: "var(--font-mono)" }}>{fmtDate(s.created_at)}</span>
                  {s.encrypted && (
                    <Lock className="w-3 h-3 shrink-0" style={{ color: "var(--emerald)" }} />
                  )}
                  {s.has_vault === false && s.has_notes === false && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0"
                      style={{ color: "var(--amber)", background: "var(--amber-bg)", border: "1px solid rgba(251, 191, 36, 0.3)" }}
                      title="This snapshot contains no vault entries and no notes — restoring it changes nothing. Pick an older, larger snapshot."
                    >
                      empty
                    </span>
                  )}
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {(s.size / 1024).toFixed(1)} KB · {s.locations.length} {t("emergency_copies")}
                </div>
              </div>
              {confirmRestore === s.name ? (
                <div className="flex flex-col gap-1.5 shrink-0 items-end">
                  {s.has_vault === false && s.has_notes === false && (
                    <span className="text-[10px] text-right" style={{ color: "var(--amber)" }}>
                      Empty snapshot — restores nothing.
                    </span>
                  )}
                  <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={emgBusy}
                    onClick={() => handleRestoreSnapshot(s.name)}
                    className="px-2 py-1 rounded text-[10px] font-medium disabled:opacity-50"
                    style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248, 113, 113, 0.2)" }}
                  >
                    {t("emergency_confirm_restore")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestore(null)}
                    className="px-2 py-1 rounded text-[10px] font-medium"
                    style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  >
                    {t("identify_cancel_btn")}
                  </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={emgBusy}
                  onClick={() => setConfirmRestore(s.name)}
                  className="px-2.5 py-1 rounded text-[10px] font-medium shrink-0 disabled:opacity-50"
                  style={{ background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
                >
                  {t("emergency_restore_btn")}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {t("vault_data_location")}
      </p>
      {status?.portable_root && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
          <span className="text-[11px] break-all" style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {status.portable_root}
          </span>
          <div className="flex-1" />
          {onOpenHealth && (
            <button
              type="button"
              onClick={onOpenHealth}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0"
              style={{ background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
            >
              {t("health_open_btn")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
