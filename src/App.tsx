import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Search,
  Plus,
  Server,
  Sparkles,
  Settings as SettingsIcon,
  Terminal,
  Folder,
  KeyRound,
  ChevronRight,
  Lock,
} from "lucide-react";

import {
  VaultEntry,
  AnalyzeCandidate,
  SystemStatus,
  Settings,
  Tab,
  LibraryFilter,
  ScanCandidate,
  FolderScanSession,
  WatchedFolderRow,
} from "./types";

import { readJson } from "./utils";
import { getTranslation } from "./utils/i18n";

// Subcomponents
import { HomeTab } from "./components/HomeTab";
import { AnalyzeTab } from "./components/AnalyzeTab";
import { FoldersTab } from "./components/FoldersTab";
import { AskTab } from "./components/AskTab";
import { LibraryTab } from "./components/LibraryTab";
import { SettingsTab } from "./components/SettingsTab";
import { LogsTab } from "./components/LogsTab";
import { LockScreen } from "./components/LockScreen";

// Modals
import { FsBrowserModal } from "./components/FsBrowserModal";
import { ClarifyModal } from "./components/ClarifyModal";

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [attention, setAttention] = useState<VaultEntry[]>([]);
  const [logs, setLogs] = useState<{ time: string; type: string; message: string }[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const t = useCallback(
    (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key),
    [settings]
  );

  // paste / analyze
  const [paste, setPaste] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [pasteId, setPasteId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AnalyzeCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [providerUsed, setProviderUsed] = useState("");

  // ask
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [askResults, setAskResults] = useState<
    { entry: VaultEntry; score: number; match_reason: string }[]
  >([]);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askAnswerProvider, setAskAnswerProvider] = useState<string>("");

  // library
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryQuery, setLibraryQuery] = useState("");

  // folder scan
  const [folderPath, setFolderPath] = useState("");
  const [folderWatch, setFolderWatch] = useState(true);
  const [folderUseAi, setFolderUseAi] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanSession, setScanSession] = useState<FolderScanSession | null>(null);
  const [watchedFolders, setWatchedFolders] = useState<WatchedFolderRow[]>([]);
  const [applyingScan, setApplyingScan] = useState(false);
  const scanSessionIdRef = useRef<string | null>(null);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.selectFolder;

  // Server-side folder browser (reads disk in place — no upload)
  const [fsBrowserOpen, setFsBrowserOpen] = useState(false);
  const [fsPath, setFsPath] = useState("");
  const [fsParent, setFsParent] = useState<string | null>(null);
  const [fsEntries, setFsEntries] = useState<{ name: string; path: string; isDirectory: boolean }[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState("");

  // clarify modal
  const [clarify, setClarify] = useState<VaultEntry | null>(null);
  const [clarifyType, setClarifyType] = useState("");
  const [clarifyName, setClarifyName] = useState("");

  const [vaultStatus, setVaultStatus] = useState<{ is_locked: boolean; encryption_enabled: boolean } | null>(null);

  const fetchVaultStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/status");
      if (res.ok) {
        setVaultStatus(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleLockVault = async () => {
    try {
      const res = await fetch("/api/vault/lock", { method: "POST" });
      if (res.ok) {
        setVaultStatus((prev) => prev ? { ...prev, is_locked: true } : null);
        setEntries([]);
        setAttention([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  /** Prevent poll/refresh from wiping in-progress Settings form edits */
  const settingsDirtyRef = useRef(false);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    settingsDirtyRef.current = true;
    setSettings((prev) => (prev ? { ...prev, ...patch } : (patch as Settings)));
  }, []);

  useEffect(() => {
    scanSessionIdRef.current = scanSession?.id ?? null;
  }, [scanSession?.id]);

  const fetchAll = useCallback(async () => {
    try {
      // First, fetch the vault status
      const vRes = await fetch("/api/vault/status");
      if (vRes.ok) {
        const vStatus = await vRes.json();
        setVaultStatus(vStatus);
        
        if (vStatus.is_locked) {
          // Locked: Only logs and settings can be fetched
          const [lg, se] = await Promise.all([
            fetch("/api/logs").then((r) => r.json()),
            fetch("/api/settings").then((r) => r.json()),
          ]);
          setLogs(lg);
          if (!settingsDirtyRef.current) {
            setSettings(se);
          }
          return;
        }
      }

      const [st, en, att, lg, se, folders] = await Promise.all([
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/entries").then((r) => r.json()),
        fetch("/api/entries?status=attention").then((r) => r.json()),
        fetch("/api/logs").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
        fetch("/api/folders").then((r) => r.json()).catch(() => ({ folders: [] })),
      ]);
      setStatus(st);
      setEntries(en);
      setAttention(att);
      setLogs(lg);
      // Only load settings from server when form is clean (not mid-edit)
      if (!settingsDirtyRef.current) {
        setSettings(se);
      }
      setWatchedFolders(folders.folders || []);

      // keep active scan session in sync (watch updates)
      const sid = scanSessionIdRef.current;
      if (sid) {
        const sres = await fetch(`/api/folders/sessions/${sid}`);
        if (sres.ok) {
          const s = await sres.json();
          if (s.status === "review") setScanSession(s);
        }
      } else {
        const active = await fetch("/api/folders/sessions/active");
        if (active.ok) setScanSession(await active.json());
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchVaultStatus();
  }, [fetchVaultStatus]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 5000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const handleAnalyze = async () => {
    if (!paste.trim()) return;
    setAnalyzing(true);
    setCandidates([]);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: paste }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyze failed");
      setPasteId(data.paste_id);
      setCandidates(data.candidates || []);
      setProviderUsed(data.provider_used || "");
      const sel: Record<string, boolean> = {};
      for (const c of data.candidates || []) sel[c.temp_id] = true;
      setSelected(sel);
      setTab("paste");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAnalyzing(false);
      fetchAll();
    }
  };

  const updateCandidate = (tempId: string, patch: Partial<AnalyzeCandidate>) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.temp_id !== tempId) return c;
        const next = { ...c, ...patch };
        next.needs_type = !String(next.type || "").trim() && (next.family === "secret" || next.family === "unknown");
        next.needs_name =
          !String(next.name || "").trim() && (next.family === "secret" || next.family === "unknown");
        if (next.family === "note" || next.family === "command") {
          next.needs_type = false;
          next.needs_name = false;
        }
        next.ready = !next.needs_type && !next.needs_name;
        return next;
      })
    );
  };

  const handleSaveSelected = async (parkIncomplete: boolean) => {
    const items = candidates.filter((c) => selected[c.temp_id]);
    if (!items.length) return;
    const payload = items.map((c) => ({
      value: c.value,
      type: c.type,
      name: c.name,
      raw_fragment: c.raw_fragment,
      labels: c.labels,
      type_aliases: c.type_aliases,
      family: c.family,
    }));
    const endpoint = parkIncomplete ? "/api/entries/park" : "/api/entries/save";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paste_id: pasteId, candidates: payload }),
    });
    if (res.ok) {
      setCandidates([]);
      setPaste("");
      setPasteId(null);
      fetchAll();
      setTab("home");
    } else {
      const err = await res.json();
      alert(err.error || "Save failed");
    }
  };

  const handleAsk = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setAsking(true);
    setAskAnswer(null);
    setAskAnswerProvider("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setAskResults(data.results || []);
      setAskAnswer(data.answer || null);
      setAskAnswerProvider(data.provider_used || "");
      setTab("ask");
    } catch {
      setAskResults([]);
      setAskAnswer(null);
      setAskAnswerProvider("");
    } finally {
      setAsking(false);
      fetchAll();
    }
  };

  const openClarify = (entry: VaultEntry) => {
    setClarify(entry);
    setClarifyType(entry.type === "unidentified" ? "" : entry.type);
    setClarifyName(entry.name === "unnamed" ? "" : entry.name);
  };

  const submitClarify = async () => {
    if (!clarify) return;
    if (!clarifyType.trim() || !clarifyName.trim()) {
      alert("Type and name are required / النوع والاسم مطلوبان");
      return;
    }
    const res = await fetch(`/api/entries/${clarify.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: clarifyType.trim(), name: clarifyName.trim() }),
    });
    if (res.ok) {
      setClarify(null);
      fetchAll();
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm("Delete this entry permanently?")) return;
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    fetchAll();
  };

  const saveSettings = async () => {
    if (!settings) return;
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const saved = await res.json().catch(() => settings);
    settingsDirtyRef.current = false;
    if (saved && typeof saved === "object" && saved.ai_provider) {
      setSettings(saved as Settings);
    }
    // When using local/auto, ensure models exist and warm the LLM into memory
    if (settings.ai_provider === "local" || settings.ai_provider === "auto") {
      try {
        await fetch("/api/ollama/ensure", { method: "POST" });
      } catch {
        /* optional */
      }
    }
    fetchAll();
    alert("Settings saved · تم الحفظ");
  };

  const warmOllama = async () => {
    try {
      const res = await fetch("/api/ollama/warm", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Warm failed");
      alert(`LLM loaded: ${data.model}\nCheck: ollama ps`);
      fetchAll();
    } catch (e: any) {
      alert(e.message || "Could not load Ollama LLM");
    }
  };

  const loadFsDir = async (dirPath: string) => {
    setFsLoading(true);
    setFsError("");
    try {
      const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const res = await fetch(`/api/fs/list${q}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Cannot list folder");
      setFsPath(data.path || dirPath || "");
      setFsParent(data.parent ?? null);
      setFsEntries(data.entries || []);
    } catch (e: any) {
      setFsError(e.message || "Failed to list directory");
      setFsEntries([]);
    } finally {
      setFsLoading(false);
    }
  };

  const pickFolder = async () => {
    // Desktop Electron: OS native dialog → absolute path
    if (window.electronAPI?.selectFolder) {
      const folder = await window.electronAPI.selectFolder();
      if (folder) setFolderPath(folder);
      return;
    }
    // Web: browse the machine's disk via the local server (in place, no upload)
    setFsBrowserOpen(true);
    await loadFsDir("");
  };

  const handleFolderScan = async (pathOverride?: string) => {
    const target = (pathOverride ?? folderPath).trim();
    if (!target) return;
    setScanning(true);
    try {
      const res = await fetch("/api/folders/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: target,
          watch: folderWatch,
          use_ai: folderUseAi,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setFolderPath(target);
      setScanSession(data);
      setFsBrowserOpen(false);
      setTab("folders");
      fetchAll();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setScanning(false);
    }
  };

  const patchScanCandidate = async (tempId: string, patch: Partial<ScanCandidate>) => {
    if (!scanSession) return;
    // optimistic local update
    setScanSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        candidates: prev.candidates.map((c) => {
          if (c.temp_id !== tempId) return c;
          const next = { ...c, ...patch };
          const secretLike = next.family === "secret" || next.family === "unknown";
          next.needs_type = secretLike && !String(next.type || "").trim();
          next.needs_name = secretLike && !String(next.name || "").trim();
          next.ready = !next.needs_type && !next.needs_name;
          return next;
        }),
      };
    });
    await fetch(`/api/folders/sessions/${scanSession.id}/candidates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: [{ temp_id: tempId, ...patch }] }),
    });
  };

  const setAllDecisions = async (decision: "save" | "park" | "discard" | "pending") => {
    if (!scanSession) return;
    const candidatesPayload = scanSession.candidates.map((c) => ({
      temp_id: c.temp_id,
      decision,
    }));
    setScanSession({
      ...scanSession,
      candidates: scanSession.candidates.map((c) => ({ ...c, decision })),
    });
    await fetch(`/api/folders/sessions/${scanSession.id}/candidates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: candidatesPayload }),
    });
  };

  const applyScanSession = async () => {
    if (!scanSession) return;
    setApplyingScan(true);
    try {
      const res = await fetch(`/api/folders/sessions/${scanSession.id}/apply`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      alert(
        `Saved ${data.saved_count} · Unidentified ${data.parked_count} · Discarded ${data.discarded_count}`
      );
      setScanSession(null);
      fetchAll();
      setTab("home");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setApplyingScan(false);
    }
  };

  const discardScanSession = async () => {
    if (!scanSession) return;
    if (!confirm("Discard this entire scan review? Nothing will be saved.")) return;
    await fetch(`/api/folders/sessions/${scanSession.id}/discard`, { method: "POST" });
    setScanSession(null);
    fetchAll();
  };

  const nav: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = useMemo(
    () => [
      { id: "home", label: t("tab_home"), icon: <Layers className="w-4 h-4" />, badge: attention.length || undefined },
      { id: "paste", label: t("tab_paste"), icon: <Plus className="w-4 h-4" /> },
      {
        id: "folders",
        label: t("tab_folders"),
        icon: <Folder className="w-4 h-4" />,
        badge: scanSession?.status === "review" ? scanSession.summary.candidates_needs_review || undefined : undefined,
      },
      { id: "ask", label: t("tab_ask"), icon: <Search className="w-4 h-4" /> },
      { id: "library", label: t("tab_library"), icon: <KeyRound className="w-4 h-4" /> },
      { id: "settings", label: t("tab_settings"), icon: <SettingsIcon className="w-4 h-4" /> },
      { id: "logs", label: t("tab_logs"), icon: <Terminal className="w-4 h-4" /> },
    ],
    [attention.length, scanSession, t]
  );

  if (vaultStatus?.is_locked) {
    return (
      <LockScreen
        settings={settings}
        onUnlockSuccess={() => {
          fetchVaultStatus();
          fetchAll();
        }}
      />
    );
  }

  return (
    <div
      className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased flex flex-col"
      dir={settings?.ui_language === "ar" ? "rtl" : "ltr"}
    >
      {/* ribbon */}
      <div className="bg-slate-900 border-b border-slate-800 text-xs py-2 px-6 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-slate-300">{t("ribbon_portable")}</span>
          {status && (
            <span className="text-slate-500 font-mono hidden md:inline truncate max-w-md" title={status.portable_root}>
              {status.portable_root}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {vaultStatus?.encryption_enabled && !vaultStatus?.is_locked && (
            <button
              onClick={handleLockVault}
              className="flex items-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/20 transition-all text-[11px] font-medium"
            >
              <Lock className="w-3 h-3" />
              <span>{t("sec_lock_btn")}</span>
            </button>
          )}
          <span className="text-slate-500">
            {t("ai_status")}:{" "}
            <span className="text-amber-400 font-mono">
              {status?.active_provider || "…"} ({status?.ai_provider || "auto"})
            </span>
          </span>
          <span
            className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
              status?.is_ollama_online
                ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                : "text-slate-400 bg-slate-800 border border-slate-700"
            }`}
          >
            {status?.is_ollama_online ? t("ollama_status_on") : t("ollama_status_off")}
          </span>
          <span
            className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
              status?.is_gemini_configured
                ? "text-indigo-300 bg-indigo-500/10 border border-indigo-500/20"
                : "text-slate-400 bg-slate-800 border border-slate-700"
            }`}
          >
            {status?.is_gemini_configured ? t("api_key_configured") : t("api_key_empty")}
          </span>
        </div>
      </div>

      <header className="px-6 py-5 bg-slate-900/50 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              {t("app_title")}
              <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded border border-slate-700">
                Vault 2.0
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              {t("app_subtitle")}
            </p>
          </div>
        </div>
        <form onSubmit={handleAsk} className="flex gap-2 w-full max-w-xl">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ask_header_placeholder")}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={asking}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            <Search className="w-4 h-4" />
            {asking ? "…" : t("ask_btn")}
          </button>
        </form>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <nav className="space-y-1">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                tab === n.id
                  ? "bg-slate-800 text-white border-l-4 border-indigo-500"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <span className="flex items-center gap-3">
                {n.icon}
                {n.label}
              </span>
              {n.badge ? (
                <span className="text-[10px] bg-amber-500 text-slate-950 font-bold px-1.5 py-0.5 rounded-full">
                  {n.badge}
                </span>
              ) : tab === n.id ? (
                <ChevronRight className="w-4 h-4 opacity-50" />
              ) : null}
            </button>
          ))}

          <div className="mt-6 p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2 text-xs">
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Vault stats</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-950 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-white">{status?.stats.total_saved ?? 0}</div>
                <div className="text-slate-500">Saved</div>
              </div>
              <div className="bg-slate-950 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-amber-400">{status?.stats.needs_attention ?? 0}</div>
                <div className="text-slate-500">Unidentified</div>
              </div>
              <div className="bg-slate-950 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-sky-400">{status?.stats.total_secrets ?? 0}</div>
                <div className="text-slate-500">Secrets</div>
              </div>
              <div className="bg-slate-950 rounded-lg p-2 border border-slate-800">
                <div className="text-lg font-bold text-teal-400">{status?.stats.total_commands ?? 0}</div>
                <div className="text-slate-500">Commands</div>
              </div>
            </div>
          </div>
        </nav>

        <section className="lg:col-span-3 space-y-6">
          {tab === "home" && (
            <HomeTab
              paste={paste}
              setPaste={setPaste}
              onAnalyze={handleAnalyze}
              analyzing={analyzing}
              attention={attention}
              entries={entries}
              onOpenClarify={openClarify}
              onDeleteEntry={deleteEntry}
              settings={settings}
            />
          )}

          {tab === "paste" && (
            <AnalyzeTab
              paste={paste}
              setPaste={setPaste}
              onAnalyze={handleAnalyze}
              analyzing={analyzing}
              providerUsed={providerUsed}
              candidates={candidates}
              selected={selected}
              setSelected={setSelected}
              onSaveSelected={handleSaveSelected}
              onUpdateCandidate={updateCandidate}
              settings={settings}
            />
          )}

          {tab === "folders" && (
            <FoldersTab
              folderPath={folderPath}
              setFolderPath={setFolderPath}
              onPickFolder={pickFolder}
              onFolderScan={handleFolderScan}
              scanning={scanning}
              folderWatch={folderWatch}
              setFolderWatch={setFolderWatch}
              folderUseAi={folderUseAi}
              setFolderUseAi={setFolderUseAi}
              watchedFolders={watchedFolders}
              scanSession={scanSession}
              onRemoveWatchedFolder={async (id) => {
                await fetch(`/api/folders/${id}`, { method: "DELETE" });
                fetchAll();
              }}
              onSetAllDecisions={setAllDecisions}
              onDiscardScanSession={discardScanSession}
              onApplyScanSession={applyScanSession}
              applyingScan={applyingScan}
              onPatchScanCandidate={patchScanCandidate}
              isElectron={isElectron}
              settings={settings}
            />
          )}

          {tab === "ask" && (
            <AskTab
              query={query}
              setQuery={setQuery}
              onAsk={handleAsk}
              asking={asking}
              askResults={askResults}
              answer={askAnswer}
              providerUsed={askAnswerProvider}
              onOpenClarify={openClarify}
              onDeleteEntry={deleteEntry}
              settings={settings}
            />
          )}

          {tab === "library" && (
            <LibraryTab
              entries={entries}
              libraryFilter={libraryFilter}
              setLibraryFilter={setLibraryFilter}
              libraryQuery={libraryQuery}
              setLibraryQuery={setLibraryQuery}
              onFetchAll={fetchAll}
              onOpenClarify={openClarify}
              onDeleteEntry={deleteEntry}
              settings={settings}
            />
          )}

          {tab === "settings" && settings && (
            <SettingsTab
              settings={settings}
              onPatchSettings={patchSettings}
              status={status}
              onWarmOllama={warmOllama}
              onSaveSettings={saveSettings}
              vaultStatus={vaultStatus}
              onRefreshVaultStatus={fetchVaultStatus}
            />
          )}

          {tab === "logs" && (
            <LogsTab logs={logs} />
          )}
        </section>
      </main>

      {/* Server filesystem browser — pick folder in place */}
      <FsBrowserModal
        isOpen={fsBrowserOpen}
        onClose={() => setFsBrowserOpen(false)}
        fsPath={fsPath}
        fsParent={fsParent}
        fsEntries={fsEntries}
        fsLoading={fsLoading}
        fsError={fsError}
        onLoadFsDir={loadFsDir}
        onSelectFolder={setFolderPath}
        onFolderScan={handleFolderScan}
        scanning={scanning}
        settings={settings}
      />

      {/* Clarify modal */}
      {clarify && (
        <ClarifyModal
          isOpen={!!clarify}
          onClose={() => setClarify(null)}
          clarify={clarify}
          clarifyType={clarifyType}
          setClarifyType={setClarifyType}
          clarifyName={clarifyName}
          setClarifyName={setClarifyName}
          onSubmitClarify={submitClarify}
          settings={settings}
        />
      )}
    </div>
  );
}
