import { useEffect, useRef, useState } from "react";
import { RefreshCw, Download } from "lucide-react";
import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

type Check = NonNullable<Awaited<ReturnType<NonNullable<NonNullable<Window["electronAPI"]>["checkForUpdates"]>>>>;

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

const SECONDARY = { background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" } as const;

/** Run the opt-in startup check once per app session. */
let startupCheckDone = false;

export interface UpdatesSectionProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: (key: keyof TranslationDict) => string;
}

export function UpdatesSection({ onPatchSettings, settings, t }: UpdatesSectionProps) {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const subscribed = useRef(false);

  useEffect(() => {
    if (!api?.onUpdateEvent || subscribed.current) return;
    subscribed.current = true;
    api.onUpdateEvent((name, payload) => {
      if (name === "update-progress") setProgress(Number(payload?.percent) || 0);
      if (name === "update-ready") {
        setReady(true);
        setProgress(null);
      }
      if (name === "update-error") {
        setError(String(payload?.message || ""));
        setProgress(null);
      }
    });
  }, [api]);

  if (!api?.checkForUpdates) return null; // browser/dev: no updater

  const check = async () => {
    setChecking(true);
    setError("");
    try {
      setResult(await api.checkForUpdates!());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    setError("");
    setProgress(0);
    const r = await api.downloadUpdate?.();
    if (!r?.ok) {
      setProgress(null);
      setError(r?.reason || "download failed");
    }
  };

  const note = (() => {
    if (!result) return "";
    if (result.status === "error") return fill(t("update_error"), { m: result.message || "" });
    if (result.status === "unsupported") return t("update_unsupported");
    if (result.status === "current") return fill(t("update_current"), { v: result.current });
    return fill(t("update_available"), { v: result.latest || "" });
  })();
  const manualOnly = result?.status === "available" && !result.canInstall;

  return (
    <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
        <RefreshCw className="w-3.5 h-3.5" /> {t("update_title")}
      </h3>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("update_desc")}</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!settings.update_check_on_start}
          onChange={(e) => onPatchSettings({ update_check_on_start: e.target.checked })}
          className="accent-blue-500"
        />
        <span className="text-xs" style={{ color: "var(--text)" }}>{t("update_on_start")}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={check} disabled={checking || progress !== null} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={SECONDARY}>
          {checking ? t("update_checking") : t("update_check_now")}
        </button>
        {result?.status === "available" && result.canInstall && !ready && (
          <button type="button" onClick={download} disabled={progress !== null} className="btn-primary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" />
            {progress !== null ? fill(t("update_downloading"), { n: progress }) : t("update_download")}
          </button>
        )}
        {ready && (
          <button type="button" onClick={() => api.installUpdate?.()} className="btn-primary text-xs px-3 py-1.5 rounded-lg">
            {t("update_install")}
          </button>
        )}
        {(manualOnly || result?.status === "error") && (
          <button type="button" onClick={() => api.openExternal(result!.releasesUrl)} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={SECONDARY}>
            {t("update_view_release")}
          </button>
        )}
      </div>
      {note && <p className="text-xs" style={{ color: "var(--text)" }} aria-live="polite">{note}</p>}
      {manualOnly && (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {result!.reason === "portable" ? t("update_portable") : t("update_unsigned")}
        </p>
      )}
      {error && <p className="text-[11px]" style={{ color: "var(--rose, #f43f5e)" }}>{error}</p>}
    </div>
  );
}

/**
 * Opt-in startup check: when enabled, look once per session and return the
 * newer version (or null). Used by the app shell to show a toast.
 */
export async function startupUpdateCheck(settings: Settings | null): Promise<string | null> {
  if (startupCheckDone || !settings?.update_check_on_start) return null;
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (!api?.checkForUpdates) return null;
  startupCheckDone = true;
  try {
    const r = await api.checkForUpdates();
    return r.status === "available" ? r.latest || null : null;
  } catch {
    return null;
  }
}
