import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { copyTextToClipboard } from "../lib/clipboard";
import { CheckCircle2, XCircle, AlertTriangle, Copy, RefreshCw, X, HardDrive, Database } from "lucide-react";
import { HealthReport, Settings } from "../types";
import { getTranslation } from "../utils/i18n";
import { useDialogA11y } from "../hooks/useDialogA11y";

interface HealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings | null;
  initial?: HealthReport | null;
  onGoEmergency: () => void;
}

export const HealthModal: React.FC<HealthModalProps> = ({
  isOpen,
  onClose,
  settings,
  initial,
  onGoEmergency,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);
  const [report, setReport] = useState<HealthReport | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Read via ref: the effect must only fire on OPEN, not on every App-level
  // health refresh (a 60s poll + SSE replacements used to trigger a full
  // refetch while the modal was open).
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const dialogRef = useDialogA11y(isOpen, onClose);
  const titleId = useId();
  // Read via ref so fetchHealth stays stable (it is an effect dependency).
  const tRef = useRef(t);
  tRef.current = t;

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`${tRef.current("health_check_failed")} (HTTP ${res.status})`);
      const data = (await res.json()) as HealthReport;
      setReport(data);
    } catch (e: any) {
      setError(e?.message || tRef.current("health_check_unreachable"));
      setReport({ ok: false, overall: "attention", error: e?.message || "unreachable", checks: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (initialRef.current) setReport(initialRef.current);
      fetchHealth();
    }
  }, [isOpen, fetchHealth]);

  if (!isOpen) return null;

  const overall = report?.overall ?? "attention";
  const overallColor =
    overall === "healthy" ? "var(--emerald)" : overall === "degraded" ? "var(--amber)" : "var(--danger)";
  const overallLabel =
    overall === "healthy" ? t("health_healthy") : overall === "degraded" ? t("health_degraded") : t("health_attention");

  const copyDiagnostics = async () => {
    try {
      await copyTextToClipboard(JSON.stringify(report ?? { error }, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const fmtKb = (bytes: number | null | undefined) =>
    bytes === null || bytes === undefined ? "—" : `${(bytes / 1024).toFixed(1)} KB`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl p-5 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span id={titleId} className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("health_title")}</span>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ color: overallColor, background: "var(--bg-input)", border: "1px solid var(--border)" }}
          >
            {loading ? "…" : overallLabel}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={fetchHealth}
            disabled={loading}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 disabled:opacity-50"
            style={{ background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            <RefreshCw className="w-3 h-3" /> {t("health_refresh_btn")}
          </button>
          <button
            type="button"
            onClick={copyDiagnostics}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1"
            style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            <Copy className="w-3 h-3" /> {copied ? t("health_copied") : t("health_copy_btn")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("close_btn")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("health_subtitle")}</p>

        {error && (
          <p className="text-xs rounded-lg px-3 py-2" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248,113,113,0.25)" }}>
            {error}
          </p>
        )}

        {report?.server && (
          <div className="rounded-xl p-3 space-y-1.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text)" }}>
              <HardDrive className="w-3.5 h-3.5" style={{ color: "var(--accent-bright)" }} /> {t("health_data_label")}
            </div>
            <div className="text-[11px] break-all" style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {report.server.portable_root}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3" />
                {t("health_vault_label")}: {report.vault?.total ?? "—"} {t("health_entries_unit")} · {fmtKb(report.vault?.size)}
                {report.vault?.locked ? ` · ${t("health_locked")}` : report.vault?.encrypted ? ` · ${t("health_encrypted")}` : ""}
              </span>
              <span>{t("health_notes_label")}: {report.scratchpad?.tabs ?? "—"} {t("health_active_unit")} · {fmtKb(report.scratchpad?.size)}</span>
              <span>{t("health_backups_label")}: {report.backups?.count ?? 0} · {t("health_snapshots_label")}: {report.emergency?.count ?? 0}</span>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {(report?.checks ?? []).map((c) => (
            <div
              key={c.id}
              className="flex items-start gap-2 rounded-xl px-3 py-2"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
            >
              {c.ok ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--emerald)" }} />
              ) : c.severity === "critical" ? (
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--amber)" }} />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>{c.label}</div>
                <div className="text-[11px] break-words" style={{ color: "var(--text-muted)" }}>{c.detail}</div>
              </div>
            </div>
          ))}
          {!loading && (report?.checks ?? []).length === 0 && !error && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("health_no_results")}</p>
          )}
        </div>

        {(report?.alternates ?? []).length > 0 && (
          <div className="rounded-xl p-3 space-y-1.5" style={{ background: "var(--amber-bg)", border: "1px solid rgba(251,191,36,0.25)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--amber)" }}>
              {t("health_alternates_title")}
            </div>
            {(report?.alternates ?? []).map((a) => (
              <div key={a.root} className="text-[11px] break-all" style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                {a.root} — {a.vaultEncrypted ? t("health_encrypted_vault") : `${a.vaultEntries ?? 0} ${t("health_entries_unit")}`} · {a.scratchpadTabs ?? 0} {t("health_notes_unit")}
              </div>
            ))}
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t("health_alternates_hint")}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            onClose();
            onGoEmergency();
          }}
          className="w-full px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
        >
          {t("health_go_emergency")}
        </button>
      </div>
    </div>
  );
};

export default HealthModal;
