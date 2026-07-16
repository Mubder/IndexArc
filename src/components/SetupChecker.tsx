import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Download, Play, Boxes, Cpu, ChevronDown, X, Info } from "lucide-react";
import { SystemStatus, Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface SetupCheckerProps {
  status: SystemStatus | null;
  settings: Settings | null;
  onConfigureAI: () => void;
  onRefresh: () => void;
}

const DISMISS_KEY = "indexarc-setup-dismissed";

function api<T = any>(url: string, opts?: RequestInit): Promise<T> {
  return fetch(url, opts).then((r) => r.json());
}

export const SetupChecker: React.FC<SetupCheckerProps> = ({
  status,
  settings,
  onConfigureAI,
  onRefresh,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1], vars?: Record<string, string>) => {
    let s = getTranslation(settings, key);
    if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    return s;
  };

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;
  const llmModel = settings?.ollama_llm_model || "qwen2.5:0.5b";

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);
  const [ollamaInstalled, setOllamaInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"" | "install" | "start" | "pull">("");
  const [note, setNote] = useState("");

  const ollamaOnline = !!status?.is_ollama_online;
  const ollamaModels: string[] = status?.ollama_models || [];
  const ollamaHasLlm = ollamaModels.some(
    (m) => m === llmModel || m.startsWith(llmModel.split(":")[0])
  );
  const geminiConfigured = !!status?.is_gemini_configured;
  const aiReady = (ollamaOnline && ollamaHasLlm) || geminiConfigured;

  useEffect(() => {
    let cancelled = false;
    if (!isElectron) {
      setOllamaInstalled(null);
      return;
    }
    window.electronAPI
      ?.checkOllamaInstalled()
      .then((ok) => {
        if (!cancelled) setOllamaInstalled(!!ok);
      })
      .catch(() => {
        if (!cancelled) setOllamaInstalled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isElectron, status?.is_ollama_online]);

  const needsAttention = useMemo(() => {
    if (!aiReady) return true;
    if (isElectron && ollamaInstalled === false) return true;
    if (isElectron && ollamaInstalled === true && !ollamaOnline) return true;
    if (ollamaOnline && !ollamaHasLlm) return true;
    return false;
  }, [aiReady, isElectron, ollamaInstalled, ollamaOnline, ollamaHasLlm]);

  useEffect(() => {
    if (needsAttention) setExpanded(true);
  }, [needsAttention]);

  const handleInstall = useCallback(async () => {
    if (!window.electronAPI) return;
    setBusy("install");
    setNote(t("setup_installing"));
    try {
      const res = await window.electronAPI.installOllama();
      if (res?.ok) {
        setOllamaInstalled(true);
        setNote("");
        setBusy("start");
        setNote(t("setup_starting"));
        await window.electronAPI.startOllama();
        onRefresh();
      } else {
        setNote(t("setup_install_failed"));
      }
    } catch {
      setNote(t("setup_install_failed"));
    } finally {
      setBusy("");
      setTimeout(() => setNote(""), 4000);
    }
  }, [onRefresh, t]);

  const handleStart = useCallback(async () => {
    if (!window.electronAPI) return;
    setBusy("start");
    setNote(t("setup_starting"));
    try {
      await window.electronAPI.startOllama();
      onRefresh();
    } finally {
      setBusy("");
      setTimeout(() => setNote(""), 3000);
    }
  }, [onRefresh, t]);

  const handlePull = useCallback(async () => {
    setBusy("pull");
    setNote(t("setup_pulling"));
    try {
      const res = await api("/api/ollama/ensure", { method: "POST" });
      if (res?.status === "success") {
        setNote(t("setup_pull_done"));
        onRefresh();
      } else {
        setNote(t("setup_install_failed"));
      }
    } catch {
      setNote(t("setup_install_failed"));
    } finally {
      setBusy("");
      setTimeout(() => setNote(""), 4000);
    }
  }, [onRefresh, t]);

  const openDownload = useCallback(() => {
    const url = "https://ollama.com/download";
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, "_blank");
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  const StatusDot = ({ ok, warn }: { ok: boolean; warn?: boolean }) =>
    ok ? (
      <CheckCircle2 className="w-4 h-4" style={{ color: "var(--emerald)" }} />
    ) : warn ? (
      <AlertTriangle className="w-4 h-4" style={{ color: "var(--amber)" }} />
    ) : (
      <XCircle className="w-4 h-4" style={{ color: "var(--danger)" }} />
    );

  const btnBase =
    "px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all disabled:opacity-50";

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: needsAttention ? "var(--amber-bg)" : "var(--bg-surface)",
        border: "1px solid " + (needsAttention ? "rgba(251,191,36,0.25)" : "var(--border)"),
      }}
    >
      <div className="flex items-center gap-2">
        <Info className="w-4 h-4" style={{ color: needsAttention ? "var(--amber)" : "var(--accent-bright)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("setup_title")}</span>
        <span className="text-[11px]" style={{ color: needsAttention ? "var(--amber)" : "var(--emerald)" }}>
          {needsAttention ? t("setup_needs_attention") : t("setup_all_set")}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-[11px] flex items-center gap-1"
          style={{ color: "var(--text-muted)" }}
        >
          {t("setup_collapse")}{" "}
          <ChevronDown className="w-3.5 h-3.5" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
        </button>
        <button type="button" onClick={dismiss} className="text-[11px]" style={{ color: "var(--text-muted)" }} title={t("setup_dismiss")}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5" style={{ color: "var(--text)" }}>
              <Boxes className="w-4 h-4" /> {t("setup_ollama")}
            </span>
            <span className="flex items-center gap-1">
              <StatusDot ok={ollamaOnline} warn={isElectron && ollamaInstalled === true && !ollamaOnline} />
              {ollamaOnline ? (
                <span style={{ color: "var(--emerald)" }}>{t("setup_ollama_online")}</span>
              ) : ollamaInstalled === true ? (
                <span style={{ color: "var(--amber)" }}>{t("setup_ollama_offline")}</span>
              ) : ollamaInstalled === false ? (
                <span style={{ color: "var(--danger)" }}>{t("setup_ollama_not_installed")}</span>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>{t("setup_ollama_not_installed")}</span>
              )}
            </span>

            {ollamaOnline && !ollamaHasLlm && (
              <span style={{ color: "var(--amber)" }}>· {t("setup_ollama_no_model")}</span>
            )}

            <div className="flex-1" />

            {!ollamaOnline && ollamaInstalled === false && isElectron && (
              <button
                type="button"
                onClick={handleInstall}
                disabled={busy !== ""}
                className={btnBase}
                style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.2)" }}
              >
                {busy === "install" ? <span className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                {busy === "install" ? t("setup_installing") : t("setup_install_ollama")}
              </button>
            )}
            {!ollamaOnline && ollamaInstalled === true && (
              <button
                type="button"
                onClick={handleStart}
                disabled={busy !== ""}
                className={btnBase}
                style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.2)" }}
              >
                <Play className="w-3.5 h-3.5" />
                {busy === "start" ? t("setup_starting") : t("setup_start_ollama")}
              </button>
            )}
            {ollamaOnline && !ollamaHasLlm && (
              <button
                type="button"
                onClick={handlePull}
                disabled={busy !== ""}
                className={btnBase}
                style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
              >
                {busy === "pull" ? <span className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                {busy === "pull" ? t("setup_pulling") : t("setup_pull_model", { model: llmModel })}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5" style={{ color: "var(--text)" }}>
              <Cpu className="w-4 h-4" /> {t("setup_configure_ai")}
            </span>
            <span className="flex items-center gap-1">
              <StatusDot ok={aiReady} />
              {aiReady ? (
                <span style={{ color: "var(--emerald)" }}>{t("setup_ai_ready")}</span>
              ) : (
                <span style={{ color: "var(--danger)" }}>{t("setup_ai_missing")}</span>
              )}
            </span>
            <div className="flex-1" />
            {!aiReady && (
              <button
                type="button"
                onClick={onConfigureAI}
                className={btnBase}
                style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
              >
                {t("setup_configure_ai")}
              </button>
            )}
          </div>

          {note && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{note}</p>
          )}

          {!ollamaOnline && ollamaInstalled === false && !isElectron && (
            <button
              type="button"
              onClick={openDownload}
              className={btnBase}
              style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              <Download className="w-3.5 h-3.5" /> {t("setup_open_download")}
            </button>
          )}

          <div className="pt-1 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-[11px] font-semibold pt-2" style={{ color: "var(--text-dim)" }}>{t("setup_howto_title")}</p>
            <ul className="text-[11px] list-disc pl-5 space-y-0.5" style={{ color: "var(--text-muted)" }}>
              <li>{t("setup_portable_note")}</li>
              <li>{t("setup_installer_note")}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupChecker;
