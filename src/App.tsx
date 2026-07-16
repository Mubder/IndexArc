import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Search,
  Plus,
  Server,
  Sparkles,
  Settings as SettingsIcon,
  Terminal,
  StickyNote,
  Folder,
  KeyRound,
  ChevronRight,
  Lock,
  Sun,
  Moon,
  Globe,
  Menu,
  X,
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
import { ScratchpadTab } from "./components/ScratchpadTab";
import { FoldersTab } from "./components/FoldersTab";
import { AskTab } from "./components/AskTab";
import { LibraryTab } from "./components/LibraryTab";
import { SettingsTab } from "./components/SettingsTab";
import { LogsTab } from "./components/LogsTab";
import { LockScreen } from "./components/LockScreen";
import { SetupChecker } from "./components/SetupChecker";

// Modals
import { FsBrowserModal } from "./components/FsBrowserModal";
import { ClarifyModal } from "./components/ClarifyModal";
import { ConfirmModal } from "./components/ConfirmModal";

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem("indexarc-tab");
    return (saved === "home" || saved === "paste" || saved === "scratchpad" || saved === "folders" || saved === "library" || saved === "ask" || saved === "settings" || saved === "logs")
      ? (saved as Tab)
      : "home";
  });
  useEffect(() => {
    localStorage.setItem("indexarc-tab", tab);
  }, [tab]);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("indexarc-theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [attention, setAttention] = useState<VaultEntry[]>([]);
  const [logs, setLogs] = useState<{ time: string; type: string; message: string }[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: "success" | "error" | "info" }[]>([]);
  const toastIdRef = useRef(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

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
  const [clarifyValue, setClarifyValue] = useState("");

  // confirm modal
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void; onCancel?: () => void; confirmText?: string } | null>(null);
  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void, confirmText?: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      setConfirmState({
        open: true,
        title,
        message,
        confirmText,
        onConfirm: async () => {
          await onConfirm();
          resolve();
        },
        onCancel: () => reject(),
      });
    });
  }, []);
  const closeConfirm = useCallback(() => setConfirmState(null), []);

  const [vaultStatus, setVaultStatus] = useState<{ is_locked: boolean; encryption_enabled: boolean } | null>(null);

  // Theme management
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("indexarc-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const toggleLanguage = useCallback(() => {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = prev.ui_language || "en";
      const next = current === "en" ? "ar" : "en";
      return { ...prev, ui_language: next };
    });
  }, []);

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
        fetch("/api/status").then((r) => r.json()).catch(() => null),
        fetch("/api/entries").then((r) => r.json()).catch(() => []),
        fetch("/api/entries?status=attention").then((r) => r.json()).catch(() => []),
        fetch("/api/logs").then((r) => r.json()).catch(() => []),
        fetch("/api/settings").then((r) => r.json()).catch(() => null),
        fetch("/api/folders").then((r) => r.json()).catch(() => ({ folders: [] })),
      ]);
      setStatus(st);
      if (Array.isArray(en)) setEntries(en);
      if (Array.isArray(att)) setAttention(att);
      setLogs(lg);
      // Only load settings from server when form is clean (not mid-edit)
      if (!settingsDirtyRef.current && se) {
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
      showToast(e.message, "error");
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
      showToast(err.error || "Save failed", "error");
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
    setClarifyValue("");
  };

  const submitClarify = async () => {
    if (!clarify) return;
    if (!clarifyName.trim()) {
      showToast("Name is required / الاسم مطلوب", "error");
      return;
    }
    const value = clarifyValue.trim() || clarify.value;
    const res = await fetch(`/api/entries/${clarify.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: clarifyType.trim(), name: clarifyName.trim(), value }),
    });
    if (res.ok) {
      setClarify(null);
      fetchAll();
    }
  };

  const removeEntriesLocally = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setEntries((prev) => prev.filter((e) => !idSet.has(e.id)));
    setAttention((prev) => prev.filter((e) => !idSet.has(e.id)));
  }, []);

  const deleteEntry = async (id: string) => {
    showConfirm("Delete Entry", "Delete this entry permanently?", async () => {
      await fetch(`/api/entries/${id}`, { method: "DELETE" });
      removeEntriesLocally([id]);
      await fetchAll();
    }, "Delete");
  };

  const bulkDeleteEntries = async (ids: string[]) => {
    if (ids.length === 0) return;
    return showConfirm(
      "Delete Entries",
      `Delete ${ids.length} selected entr${ids.length === 1 ? "y" : "ies"} permanently?`,
      async () => {
        // Optimistic update first so the UI reflects the deletion immediately.
        removeEntriesLocally(ids);
        await fetch("/api/entries/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        await fetchAll();
      },
      "Delete"
    );
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
    showToast("Settings saved · تم الحفظ", "success");
  };

  const warmOllama = async () => {
    try {
      const res = await fetch("/api/ollama/warm", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Warm failed");
      const parts = [`classify: ${data.model}`];
      if (data.embed_model) parts.push(`embed: ${data.embed_model}`);
      showToast(`Models loaded · ${parts.join(" · ")}`, "success");
      fetchAll();
    } catch (e: any) {
      showToast(e.message || "Could not load Ollama LLM", "error");
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
      showToast(e.message, "error");
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
      showToast(
        `Saved ${data.saved_count} · Unidentified ${data.parked_count} · Discarded ${data.discarded_count}`, "success"
      );
      setScanSession(null);
      fetchAll();
      setTab("home");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setApplyingScan(false);
    }
  };

  const discardScanSession = async () => {
    if (!scanSession) return;
    showConfirm("Discard Scan", "Discard this entire scan review? Nothing will be saved.", async () => {
      await fetch(`/api/folders/sessions/${scanSession.id}/discard`, { method: "POST" });
      setScanSession(null);
      fetchAll();
    }, "Discard");
  };

  const nav: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = useMemo(
    () => [
      { id: "home", label: t("tab_home"), icon: <Layers className="w-4 h-4" />, badge: attention.length || undefined },
      { id: "paste", label: t("tab_paste"), icon: <Plus className="w-4 h-4" /> },
      { id: "scratchpad", label: t("tab_scratchpad"), icon: <StickyNote className="w-4 h-4" /> },
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
      className="h-full font-sans antialiased flex flex-col relative overflow-hidden"
      style={{ background: "var(--bg-root)", color: "var(--text)" }}
    >
      {/* Animated Background */}
      <div className="bg-canvas">
        <div className="bg-grid" />
        <div className="bg-glow" />
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
      </div>
      <div className="scanline" />

      {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Main App Shell */}
        <div className="relative z-10 flex flex-1 min-h-0" style={{ paddingTop: "0" }}>
          {/* Sidebar - desktop: always visible, mobile: drawer */}
          <aside
            className={`
              w-60 flex-shrink-0 flex flex-col border-r 
              ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} 
              md:translate-x-0
              transition-transform duration-250 ease-out
              z-50 md:z-auto
              fixed md:static inset-y-0 left-0
            `}
            style={{
              background: "var(--glass)",
              backdropFilter: "blur(20px)",
              borderColor: "var(--border)",
            }}
          >
          {/* Navigation */}
          <nav className="flex-1 p-3 flex flex-col gap-0.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider px-3 pt-3 pb-1.5 flex items-center gap-2"
              style={{ color: "var(--text-muted)" }}
            >
              Vault
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            </div>
            {nav.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setTab(n.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative overflow-hidden"
                style={{
                  color: tab === n.id ? "var(--accent-bright)" : "var(--text-dim)",
                  background: tab === n.id ? "var(--bg-active)" : "transparent",
                }}
              >
                {tab === n.id && (
                  <div
                    className="absolute left-0 top-1/4 bottom-1/4 w-0.5 rounded-r"
                    style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
                  />
                )}
                <span className="opacity-60">{n.icon}</span>
                <span className="flex-1 text-left">{n.label}</span>
                {n.badge ? (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "var(--amber-bg)", color: "var(--amber)" }}
                  >
                    {n.badge}
                  </span>
                ) : null}
              </button>
            ))}

            <div
              className="text-[10px] font-semibold uppercase tracking-wider px-3 pt-4 pb-1.5 flex items-center gap-2"
              style={{ color: "var(--text-muted)" }}
            >
              Tools
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            </div>
          </nav>

          {/* Stats */}
          <div
            className="mx-3 mb-3 p-4 rounded-xl border"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)", backdropFilter: "blur(10px)" }}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-2.5"
              style={{ color: "var(--text-muted)" }}
            >
              Vault Overview
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { val: status?.stats.total_saved ?? 0, lbl: "Saved" },
                { val: status?.stats.needs_attention ?? 0, lbl: "Pending" },
                { val: status?.stats.total_secrets ?? 0, lbl: "Secrets" },
                { val: status?.stats.total_commands ?? 0, lbl: "Commands" },
              ].map((s) => (
                <div
                  key={s.lbl}
                  className="text-center py-1.5 rounded-lg border"
                  style={{ background: "var(--accent-bg)", borderColor: "rgba(37, 99, 235, 0.06)" }}
                >
                  <div
                    className="text-lg font-bold"
                    style={{
                      background: "linear-gradient(135deg, var(--accent-bright), var(--cyan))",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {s.val}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    {s.lbl}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Top Bar - Fixed Layout */}
          <header
            className="flex items-center gap-4 px-6 py-3 border-b flex-shrink-0"
            style={{
              background: "var(--glass)",
              backdropFilter: "blur(12px)",
              borderColor: "var(--border)",
            }}
          >
            {/* Brand/Title - hidden on mobile, shown on desktop */}
            <div className="flex items-center gap-3 flex-shrink-0 hidden md:flex">
              <img
                src="/Logo1.png"
                alt="IndexArc"
                className="w-9 h-9 rounded-xl object-contain"
                style={{ boxShadow: "0 0 20px var(--accent-glow)" }}
              />
              <div>
                <h1
                  className="text-base font-bold"
                  style={{
                    background: "linear-gradient(135deg, var(--text), var(--accent-bright))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  IndexArc
                </h1>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Portable Vault
                </span>
              </div>
            </div>

            {/* Mobile brand - shown only on mobile */}
            <div className="flex items-center gap-2 flex-shrink-0 md:hidden">
              <img
                src="/Logo1.png"
                alt="IndexArc"
                className="w-8 h-8 rounded-xl object-contain"
                style={{ boxShadow: "0 0 20px var(--accent-glow)" }}
              />
              <span className="text-sm font-bold" style={{ color: "var(--text)" }}>IndexArc</span>
            </div>

            {/* Search - Center */}
            <div className="flex-1 max-w-2xl relative order-3 md:order-none md:max-w-xl">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk(e)}
                placeholder={t("ask_header_placeholder") || "Search entries, tokens, commands..."}
                className="w-full pl-9 pr-16 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-input)",
                  color: "var(--text)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-glow)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.08)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-input)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[10px]"
                style={{
                  background: "var(--accent-bg)",
                  border: "1px solid rgba(37, 99, 235, 0.15)",
                  color: "var(--text-muted)",
                }}
              >
                Ctrl K
              </span>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 rounded-xl border transition-all md:hidden"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                aria-label={sidebarOpen ? "Close menu" : "Open menu"}
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {/* AI Status */}
              {status?.is_ollama_online && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border"
                  style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--emerald)" }} />
                  <span className="font-mono" style={{ color: "var(--text-dim)" }}>
                    {status?.ai_provider || "auto"}
                  </span>
                </div>
              )}

              {/* Encryption Badge */}
              {vaultStatus?.encryption_enabled && (
                <div
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border"
                  style={{
                    background: "var(--emerald-bg)",
                    color: "var(--emerald)",
                    borderColor: "rgba(52, 211, 153, 0.12)",
                  }}
                >
                  <Lock className="w-3 h-3" />
                  AES-256
                </div>
              )}

              {/* Lock Button */}
              {vaultStatus?.encryption_enabled && !vaultStatus?.is_locked && (
                <button
                  onClick={handleLockVault}
                  className="p-2 rounded-xl border transition-all"
                  style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                  title={t("sec_lock_btn") || "Lock vault"}
                >
                  <Lock className="w-4 h-4" />
                </button>
              )}

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-xl border transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* Language Toggle */}
              <button
                onClick={toggleLanguage}
                className="p-2 rounded-xl border transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                title={`Switch to ${settings?.ui_language === "ar" ? "English" : "Arabic"}`}
              >
                <Globe className="w-4 h-4" />
              </button>

              {/* New Entry */}
              <button
                onClick={() => setTab("paste")}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{
                  background: "linear-gradient(135deg, var(--accent), #1d4ed8)",
                  boxShadow: "0 0 20px var(--accent-glow), 0 2px 8px rgba(0,0,0,0.3)",
                }}
              >
                + New
              </button>
            </div>
          </header>

          {/* Content Area */}
          <main dir={settings?.ui_language === "ar" ? "rtl" : "ltr"} className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
            <SetupChecker
              status={status}
              settings={settings}
              onConfigureAI={() => setTab("settings")}
              onRefresh={fetchAll}
            />

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

            {tab === "scratchpad" && (
              <ScratchpadTab settings={settings} />
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
                onBulkDeleteEntries={bulkDeleteEntries}
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
          </main>
        </div>
      </div>

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

      {/* Confirm modal */}
      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.open}
          onClose={() => {
            confirmState.onCancel?.();
            closeConfirm();
          }}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          confirmText={confirmState.confirmText}
        />
      )}

      {/* Toast notifications */}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="toast-icon">
              {t.type === "success" && "✓"}
              {t.type === "error" && "✕"}
              {t.type === "info" && "i"}
            </div>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
