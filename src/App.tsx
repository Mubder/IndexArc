import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyTextToClipboard, setSecretClipboardClearSeconds } from "./lib/clipboard";
import {
  Layers,
  Search,
  Sparkles,
  Settings as SettingsIcon,
  StickyNote,
  Folder,
  KeyRound,
  AppWindow,
} from "lucide-react";

import {
  SystemStatus,
  Settings,
  Tab,
  LibraryFilter,
  WatchedFolderRow,
  HealthReport,
} from "./types";

import { getTranslation } from "./utils/i18n";
import { focusScratchpadNote, offerNoteToScratchpad } from "./noteHandoff";

// Subcomponents — Scratchpad is TipTap-heavy, lazy-split to keep main bundle ~220kB
import { HomeTab } from "./components/HomeTab";
const ScratchpadTab = React.lazy(() => import("./components/ScratchpadTab"));
import { AnalyzeTab } from "./components/AnalyzeTab";
import { FoldersTab } from "./components/FoldersTab";
import { AskTab } from "./components/AskTab";
import { LibraryTab } from "./components/LibraryTab";
import { ApplicationsTab } from "./components/apps/ApplicationsTab";
import { useSSE } from "./hooks/useSSE";
import { SettingsTab } from "./components/SettingsTab";
import { LockScreen } from "./components/LockScreen";
import { purgeScratchpadMirrorOnLock } from "./scratchpadSaveQueue";
import { ScratchpadConflictBanner } from "./components/ScratchpadConflictBanner";
import { flushEverything } from "./lib/flushOnExit";
import { SetupScreen } from "./components/SetupScreen";
import { SetupChecker } from "./components/SetupChecker";
import { HealthModal } from "./components/HealthModal";

// Modals
import { FsBrowserModal } from "./components/FsBrowserModal";
import { CommandPaletteModal } from "./components/CommandPaletteModal";
import { DialogModals } from "./components/app/DialogModals";
import { HealthBanners } from "./components/app/HealthBanners";
import { TopBar } from "./components/app/TopBar";
import { Sidebar } from "./components/app/Sidebar";
import { EncryptMigrationBanner } from "./components/app/EncryptMigrationBanner";
import { useFolderScanActions } from "./components/app/useFolderScanActions";
import { useSettingsActions } from "./components/app/useSettingsActions";
import { useEntryActions } from "./components/app/useEntryActions";
import { useClarify } from "./components/app/useClarify";
import { usePasteActions } from "./components/app/usePasteActions";
import { useConfirmDialog } from "./components/app/useConfirmDialog";
import { useToasts } from "./components/app/useToasts";
import { useSettingsPatch } from "./components/app/useSettingsPatch";
import { useVault, vaultStore } from "./state/vaultStore";
import { startupUpdateCheck } from "./components/settings/UpdatesSection";
import { fill } from "./components/home/DashboardCards";

export default function App() {
  // All valid Tab values (write and read sides must be symmetric — "analyze"
  // used to be dropped on restore).
  const TAB_VALUES = ["home", "scratchpad", "analyze", "folders", "library", "apps", "ask", "settings"] as const;
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem("indexarc-tab");
    return (TAB_VALUES as readonly string[]).includes(saved || "") ? (saved as Tab) : "home";
  });
  useEffect(() => {
    localStorage.setItem("indexarc-tab", tab);
  }, [tab]);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("indexarc-theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });
  const [status, setStatus] = useState<SystemStatus | null>(null);
  // Secret-bearing vault/session state lives in one store (src/state/vaultStore.ts).
  const entries = useVault((s) => s.entries);
  const attention = useVault((s) => s.attention);
  const { entries: setEntries, attention: setAttention } = vaultStore.set;
  const [logs, setLogs] = useState<{ time: string; type: string; message: string }[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // On phones the sidebar is a drawer: picking a tab closes it.
  useEffect(() => {
    setSidebarOpen(false);
  }, [tab]);
  // Encryption-migration banner dismissal is intentionally per-session: an
  // unencrypted vault should be surfaced again on every launch until fixed.
  const [encryptBannerDismissed, setEncryptBannerDismissed] = useState(false);

  const t = useCallback(
    (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key),
    [settings]
  );
  const { showToast, toasts } = useToasts();

  // paste / analyze
  const paste = useVault((s) => s.paste);
  const pasteId = useVault((s) => s.pasteId);
  const candidates = useVault((s) => s.candidates);
  const selected = useVault((s) => s.selected);
  const providerUsed = useVault((s) => s.providerUsed);
  const { paste: setPaste, pasteId: setPasteId, candidates: setCandidates, selected: setSelected, providerUsed: setProviderUsed } = vaultStore.set;
  const [analyzing, setAnalyzing] = useState(false);

  // ask
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const askResults = useVault((s) => s.askResults);
  const askAnswer = useVault((s) => s.askAnswer);
  const askAnswerProvider = useVault((s) => s.askAnswerProvider);
  const { askResults: setAskResults, askAnswer: setAskAnswer, askAnswerProvider: setAskAnswerProvider } = vaultStore.set;

  // library
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  // folder scan
  const [folderPath, setFolderPath] = useState("");
  const [folderWatch, setFolderWatch] = useState(true);
  const [folderUseAi, setFolderUseAi] = useState(true);
  const [scanning, setScanning] = useState(false);
  const scanSession = useVault((s) => s.scanSession);
  const setScanSession = vaultStore.set.scanSession;
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
  const { closeConfirm, confirmState, showConfirm } = useConfirmDialog();

  const [vaultStatus, setVaultStatus] = useState<{ is_locked: boolean; encryption_enabled: boolean; needs_setup?: boolean; migration_recommended?: boolean } | null>(null);
  const [integrityWarnings, setIntegrityWarnings] = useState<string[]>([]);
  const [integrityDismissed, setIntegrityDismissed] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);

  // Theme management
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("indexarc-theme", theme);
  }, [theme]);
  // Language / direction management (drives Arabic font via CSS)
  useEffect(() => {
    const isAr = settings?.ui_language === "ar";
    document.documentElement.setAttribute("lang", isAr ? "ar" : "en");
    document.documentElement.setAttribute("dir", isAr ? "rtl" : "ltr");
  }, [settings?.ui_language]);

  // Apply initial font size preset from localStorage before server response on startup
  useEffect(() => {
    try {
      const savedPreset = localStorage.getItem("indexarc-settings-preset");
      if (savedPreset) {
        const parsed = JSON.parse(savedPreset);
        const root = document.documentElement;
        const en = parsed.font_size_en || 14;
        const ar = parsed.font_size_ar || 16;
        const isAr = parsed.ui_language === "ar";
        root.style.setProperty("--font-size-en", `${en}px`);
        root.style.setProperty("--font-size-ar", `${ar}px`);
        root.style.setProperty("--arabic-font-scale", (ar / en).toFixed(4));
        root.style.setProperty("font-size", isAr ? `${ar}px` : `${en}px`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Font size settings management — scales Arabic font appropriately even when UI is in English
  useEffect(() => {
    const root = document.documentElement;
    const en = settings?.font_size_en || 14;
    const ar = settings?.font_size_ar || 16;
    const isAr = settings?.ui_language === "ar";
    root.style.setProperty("--font-size-en", `${en}px`);
    root.style.setProperty("--font-size-ar", `${ar}px`);
    root.style.setProperty("--arabic-font-scale", (ar / en).toFixed(4));
    root.style.setProperty("font-size", isAr ? `${ar}px` : `${en}px`);

    localStorage.setItem(
      "indexarc-settings-preset",
      JSON.stringify({
        font_size_en: en,
        font_size_ar: ar,
        ui_language: settings?.ui_language || "en",
      })
    );
  }, [settings?.font_size_en, settings?.font_size_ar, settings?.ui_language]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  /** Prevent poll/refresh from wiping in-progress Settings form edits */
  const settingsDirtyRef = useRef(false);
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const h = (await res.json()) as HealthReport;
        setHealth(h);
        if (Array.isArray(h.integrity?.warnings) && h.integrity.warnings.length) {
          setIntegrityWarnings(h.integrity.warnings);
        }
      }
    } catch {
      setHealth({ ok: false, overall: "attention", error: "unreachable", checks: [] });
    }
  }, []);

  // Purge secret-bearing working state from renderer memory — entries,
  // pasted tokens, unsaved candidates and ask results must not survive the
  // lock in React state (heap-scrape exposure). Runs for EVERY lock path:
  // the manual button, and server-side auto-lock / lock-on-minimize that the
  // UI only learns about through fetchAll.
  const purgeSecretState = useCallback(() => {
    vaultStore.purgeSecrets();
    purgeScratchpadMirrorOnLock();
  }, []);

  const handleLockVault = async () => {
    try {
      // Land the newest note text BEFORE the lock closes the store.
      await flushEverything();
      const res = await fetch("/api/vault/lock", { method: "POST" });
      if (res.ok) {
        setVaultStatus((prev) => prev ? { ...prev, is_locked: true } : null);
        purgeSecretState();
      }
    } catch (e) {
      console.error(e);
    }
  };
  const { patchSettings, toggleLanguage } = useSettingsPatch({ patchTimerRef, setSettings, settings, settingsDirtyRef, showToast, t });

  useEffect(() => {
    scanSessionIdRef.current = scanSession?.id ?? null;
  }, [scanSession?.id]);

  // fetchAll sequencing (AUD-008): the 30s poll, SSE events, and post-mutation
  // calls fire it concurrently; an older, slower response could resolve last
  // and overwrite fresher state (resurrected deleted entries / stale flash).
  // A generation counter makes stale responses no-ops.
  const fetchAllGenRef = useRef(0);
  const fetchAll = useCallback(async () => {
    const gen = ++fetchAllGenRef.current;
    const isStale = () => gen !== fetchAllGenRef.current;
    try {
      // First, fetch the vault status
      const vRes = await fetch("/api/vault/status");
      if (vRes.ok) {
        const vStatus = await vRes.json();

        if (vStatus.is_locked) {
          // Locked: Only logs and settings can be fetched
          const [lg, se] = await Promise.all([
            fetch("/api/logs").then((r) => r.json()).catch(() => []),
            fetch("/api/settings").then((r) => r.json()).catch(() => null),
          ]);
          if (isStale()) return;
          setVaultStatus(vStatus);
          purgeSecretState();
          if (Array.isArray(lg)) setLogs(lg);
          if (!settingsDirtyRef.current && se && typeof se === "object") {
            setSettings(se);
          }
          return;
        }
        if (!isStale()) setVaultStatus(vStatus);
      }

      const [st, en, att, lg, se, folders] = await Promise.all([
        fetch("/api/status").then((r) => r.json()).catch(() => null),
        fetch("/api/entries").then((r) => r.json()).catch(() => []),
        fetch("/api/entries?status=attention").then((r) => r.json()).catch(() => []),
        fetch("/api/logs").then((r) => r.json()).catch(() => []),
        fetch("/api/settings").then((r) => r.json()).catch(() => null),
        fetch("/api/folders").then((r) => r.json()).catch(() => ({ folders: [] })),
      ]);
      if (isStale()) return; // a newer fetchAll started — discard this batch
      setStatus(st);
      if (Array.isArray(en)) setEntries(en);
      if (Array.isArray(att)) setAttention(att);
      // An error/non-array payload (401, 500, SPA fallback) must never replace
      // the log array — SettingsTab renders logs.slice(), so a stray object
      // here crashed the whole app.
      if (Array.isArray(lg)) setLogs(lg);
      // Only load settings from server when form is clean (not mid-edit)
      if (!settingsDirtyRef.current && se) {
        setSettings(se);
      }
      setWatchedFolders(folders.folders || []);

      // keep active scan session in sync (watch updates)
      const sid = scanSessionIdRef.current;
      if (sid) {
        const sres = await fetch(`/api/folders/sessions/${sid}`);
        if (sres.ok && !isStale()) {
          const s = await sres.json();
          if (s.status === "review") setScanSession(s);
        }
      } else if (!isStale()) {
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
    // SSE replaces polling — fetchAll is triggered by server-sent events
    const t = setInterval(fetchAll, 30000); // Fallback poll every 30s (SSE is primary)
    return () => clearInterval(t);
  }, [fetchAll]);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 60000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  // Auto-lock counts USER activity only: background polls are GETs and are
  // ignored server-side, so real keyboard/pointer/scroll input is reported
  // with a throttled ping. Without it, reading the vault would auto-lock.
  useEffect(() => {
    const PING_EVERY_MS = 30_000;
    let last = 0;
    const onInput = () => {
      const now = Date.now();
      if (now - last < PING_EVERY_MS) return;
      last = now;
      fetch("/api/activity", { method: "POST" }).catch(() => {});
    };
    const events = ["keydown", "pointerdown", "wheel", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, onInput, { passive: true, capture: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, onInput, { capture: true });
    };
  }, []);

  // SSE: refetch data when server state changes
  useSSE(useCallback((msg) => {
    if (msg.event === "vault-changed" || msg.event === "entries-changed" || msg.event === "folders-changed" || msg.event === "settings-changed") {
      fetchAll();
      fetchHealth();
    }
  }, [fetchAll, fetchHealth]));

  // Data-integrity check result (quarantine/corruption warnings from the store)
  useEffect(() => {
    fetch("/api/integrity")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.warnings) && d.warnings.length) setIntegrityWarnings(d.warnings);
      })
      .catch(() => {});
  }, []);

  // Lock-on-minimize: when the window is hidden and the setting is on, lock.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Opt-in update check, once per session after settings arrive.
  useEffect(() => {
    if (!settings?.update_check_on_start) return;
    void startupUpdateCheck(settings).then((v) => {
      if (v) showToast(fill(t("update_toast_available"), { v }), "info");
    });
  }, [settings?.update_check_on_start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSecretClipboardClearSeconds(settings?.clipboard_clear_seconds);
  }, [settings?.clipboard_clear_seconds]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && settingsRef.current?.lock_on_minimize) {
        // Save first, lock second: the hide-time note flush and this lock used
        // to race, and when the lock won the last words typed were refused.
        void flushEverything()
          .catch(() => {})
          .then(() => fetch("/api/vault/lock", { method: "POST" }))
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const { discardCandidate, handleAnalyze, handleSaveSelected, updateCandidate } = usePasteActions({ candidates, fetchAll, paste, pasteId, selected, setAnalyzing, setCandidates, setPaste, setPasteId, setProviderUsed, setSelected, setTab, showConfirm, showToast, t });

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
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        // Server/network failures must not masquerade as "no results".
        throw new Error(data?.error || t("ask_failed"));
      }
      setAskResults(data.results || []);
      setAskAnswer(data.answer || null);
      setAskAnswerProvider(data.provider_used || "");
      setTab("ask");
    } catch (e: any) {
      setAskResults([]);
      setAskAnswer(null);
      setAskAnswerProvider("");
      showToast(e?.message || t("ask_failed"), "error");
    } finally {
      setAsking(false);
      fetchAll();
    }
  };
  const { clarify, clarifyFamily, clarifyName, clarifyType, clarifyValue, openClarify, setClarify, setClarifyFamily, setClarifyName, setClarifyType, setClarifyValue, submitClarify } = useClarify({ fetchAll, showToast, t });
  const { bulkDeleteEntries, deleteEntry, saveEntryUpdate } = useEntryActions({ fetchAll, setAttention, setEntries, showConfirm, showToast, t });
  const { saveSettings, warmOllama } = useSettingsActions({ fetchAll, setSettings, settings, settingsDirtyRef, showToast, t });
  const { applyScanSession, discardScanSession, handleFolderScan, loadFsDir, patchScanCandidate, pickFolder, setAllDecisions } = useFolderScanActions({ fetchAll, folderPath, folderUseAi, folderWatch, scanSession, setApplyingScan, setFolderPath, setFsBrowserOpen, setFsEntries, setFsError, setFsLoading, setFsParent, setFsPath, setScanSession, setScanning, setTab, showConfirm, showToast, t });

  const nav: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = useMemo(
    () => [
      { id: "home", label: t("tab_home"), icon: <Layers className="w-4 h-4" />, badge: attention.length || undefined },
      { id: "scratchpad", label: t("tab_scratchpad"), icon: <StickyNote className="w-4 h-4" /> },
      { id: "analyze", label: t("tab_paste"), icon: <Sparkles className="w-4 h-4" />, badge: candidates.length || undefined },
      { id: "ask", label: t("tab_ask"), icon: <Search className="w-4 h-4" /> },
      { id: "library", label: t("tab_library"), icon: <KeyRound className="w-4 h-4" /> },
      { id: "apps", label: t("tab_apps"), icon: <AppWindow className="w-4 h-4" /> },
      {
        id: "folders",
        label: t("tab_folders"),
        icon: <Folder className="w-4 h-4" />,
        badge: scanSession?.status === "review" ? scanSession.summary.candidates_needs_review || undefined : undefined,
      },
      { id: "settings", label: t("tab_settings"), icon: <SettingsIcon className="w-4 h-4" /> },
    ],
    [attention.length, scanSession, t]
  );

  // Encrypted-by-default: a brand-new vault is unusable until a master
  // password exists (no skip path). Checked BEFORE the lock gate — a fresh
  // vault is never locked.
  if (vaultStatus?.needs_setup) {
    return (
      <SetupScreen
        settings={settings}
        onSetupSuccess={() => {
          fetchVaultStatus();
          fetchAll();
        }}
      />
    );
  }

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
      className="h-full font-sans antialiased flex flex-col relative overflow-clip"
      style={{
        background: "var(--bg-app, var(--bg-root))",
        color: "var(--text)",
      }}
    >
      {/* Animated Background */}


      <EncryptMigrationBanner encryptBannerDismissed={encryptBannerDismissed} setEncryptBannerDismissed={setEncryptBannerDismissed} setTab={setTab} t={t} vaultStatus={vaultStatus} />

        {/* Main App Shell */}
        <div className="relative z-10 flex flex-1 min-h-0" style={{ paddingTop: "0" }}>
          {/* Mobile drawer overlay: inside the shell so it stacks under the sidebar (z-50) */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          <Sidebar nav={nav} setTab={setTab} sidebarOpen={sidebarOpen} settings={settings} vaultStatus={vaultStatus} handleLockVault={handleLockVault} t={t} tab={tab} />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <TopBar handleAsk={handleAsk} handleLockVault={handleLockVault} health={health} query={query} setCmdPaletteOpen={setCmdPaletteOpen} setHealthOpen={setHealthOpen} setQuery={setQuery} setSidebarOpen={setSidebarOpen} setTab={setTab} settings={settings} sidebarOpen={sidebarOpen} status={status} t={t} theme={theme} toggleLanguage={toggleLanguage} toggleTheme={toggleTheme} vaultStatus={vaultStatus} />
          <ScratchpadConflictBanner t={t} />

          {/* Content Area */}
          <main dir={settings?.ui_language === "ar" ? "rtl" : "ltr"} className="flex-1 min-h-0 overflow-y-auto px-8 py-6 app-main">
            <SetupChecker
              status={status}
              settings={settings}
              onConfigureAI={() => setTab("settings")}
              onRefresh={fetchAll}
              health={health}
              onOpenHealth={() => setHealthOpen(true)}
              onlyWhenAttention={tab !== "home"}
            />

            <HealthBanners compact health={health} integrityDismissed={integrityDismissed} integrityWarnings={integrityWarnings} setHealthOpen={setHealthOpen} setIntegrityDismissed={setIntegrityDismissed} t={t} />

            {tab === "home" && (
              <HomeTab
                paste={paste}
                setPaste={setPaste}
                onAnalyze={handleAnalyze}
                onOpenAnalyzeTab={() => setTab("analyze")}
                analyzing={analyzing}
                providerUsed={providerUsed}
                candidates={candidates}
                selected={selected}
                setSelected={setSelected}
                onSaveSelected={handleSaveSelected}
                onUpdateCandidate={updateCandidate}
                onDiscardCandidate={discardCandidate}
                attention={attention}
                entries={entries}
                onOpenClarify={openClarify}
                onDeleteEntry={deleteEntry}
                settings={settings}
                status={status}
                health={health}
                scanSession={scanSession}
                encrypted={!!vaultStatus?.encryption_enabled}
                onOpenLibrary={(f) => {
                  setLibraryFilter(f);
                  setTab("library");
                }}
                onOpenHealth={() => setHealthOpen(true)}
                onOpenFolders={() => setTab("folders")}
                onOpenSettings={() => setTab("settings")}
              />
            )}

            {tab === "analyze" && (
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
                onDiscardCandidate={discardCandidate}
                settings={settings}
              />
            )}

            {tab === "scratchpad" && (
              <React.Suspense fallback={<div className="p-6 text-sm" style={{color:"var(--text-muted)"}}>{t("loading_scratchpad")}</div>}>
                <ScratchpadTab settings={settings} />
              </React.Suspense>
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
                  try {
                    const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
                    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
                  } catch {
                    showToast(t("folder_remove_failed"), "error");
                  }
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
                onSaveEntry={saveEntryUpdate}
                onReopenInScratchpad={(title, html) => {
                  // In-memory handoff — note content must not touch browser storage.
                  offerNoteToScratchpad({ title, html });
                  setTab("scratchpad");
                }}
                settings={settings}
              />
            )}

            {tab === "apps" && (
              <ApplicationsTab
                entries={entries}
                settings={settings}
                onFetchAll={fetchAll}
                showConfirm={showConfirm}
                showToast={showToast}
                onOpenNote={(id, app) => {
                  focusScratchpadNote(id, app);
                  setTab("scratchpad");
                }}
              />
            )}

            {tab === "settings" && (
              settings ? (
                <SettingsTab
                  settings={settings}
                  onPatchSettings={patchSettings}
                  status={status}
                  onWarmOllama={warmOllama}
                  onSaveSettings={saveSettings}
                  vaultStatus={vaultStatus}
                  onRefreshVaultStatus={fetchVaultStatus}
                  logs={logs}
                  onOpenHealth={() => setHealthOpen(true)}
                />
              ) : (
                // Never render NOTHING for a tab: "Encrypt Now" is clickable
                // within milliseconds of launch (the banner needs only vault
                // status), while settings arrive with the first fetchAll —
                // this gap used to blank the whole lower half of the app.
                <div className="flex items-center justify-center py-16 text-sm" style={{ color: "var(--text-muted)" }}>
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-3" />
                  {t("loading_settings") || "Loading settings…"}
                </div>
              )
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

      <DialogModals clarify={clarify} clarifyFamily={clarifyFamily} clarifyName={clarifyName} clarifyType={clarifyType} clarifyValue={clarifyValue} closeConfirm={closeConfirm} confirmState={confirmState} setClarify={setClarify} setClarifyFamily={setClarifyFamily} setClarifyName={setClarifyName} setClarifyType={setClarifyType} setClarifyValue={setClarifyValue} settings={settings} submitClarify={submitClarify} />

      {/* Global Command Palette Modal */}
      <CommandPaletteModal
        isOpen={cmdPaletteOpen}
        onOpen={() => setCmdPaletteOpen(true)}
        onClose={() => setCmdPaletteOpen(false)}
        entries={entries}
        onSelectEntry={(entry) => {
          if (entry.family === "note") {
            setTab("library");
            setLibraryQuery(entry.name);
          } else {
            void (async () => {
              const ok = await copyTextToClipboard(entry.value, { sensitive: true });
              showToast(ok ? fill(t("toast_copied_name"), { name: entry.name }) : t("copy_failed"), ok ? "success" : "error");
            })();
          }
        }}
        onNavigateTab={(t) => setTab(t)}
        settings={settings}
      />

      {/* App health diagnostics */}
      <HealthModal
        isOpen={healthOpen}
        onClose={() => {
          setHealthOpen(false);
          fetchHealth();
        }}
        settings={settings}
        initial={health}
        onGoEmergency={() => setTab("settings")}
      />

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
