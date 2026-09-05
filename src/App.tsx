import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Search,
  Server,
  Sparkles,
  Settings as SettingsIcon,
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
import { offerNoteToScratchpad } from "./noteHandoff";

// Subcomponents — Scratchpad is TipTap-heavy, lazy-split to keep main bundle ~220kB
import { HomeTab } from "./components/HomeTab";
const ScratchpadTab = React.lazy(() => import("./components/ScratchpadTab"));
import { AnalyzeTab } from "./components/AnalyzeTab";
import { FoldersTab } from "./components/FoldersTab";
import { AskTab } from "./components/AskTab";
import { LibraryTab } from "./components/LibraryTab";
import { useSSE } from "./hooks/useSSE";
import { SettingsTab } from "./components/SettingsTab";
import { LockScreen } from "./components/LockScreen";
import { SetupChecker } from "./components/SetupChecker";

// Modals
import { FsBrowserModal } from "./components/FsBrowserModal";
import { ClarifyModal } from "./components/ClarifyModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { CommandPaletteModal } from "./components/CommandPaletteModal";
import Starfield from "./components/Starfield";

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem("indexarc-tab");
    return (saved === "home" || saved === "scratchpad" || saved === "folders" || saved === "library" || saved === "ask" || saved === "settings")
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
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  // folder scan
  const [folderPath, setFolderPath] = useState("");
  const [folderWatch, setFolderWatch] = useState(true);
  const [folderUseAi, setFolderUseAi] = useState(true);
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
  const [clarifyFamily, setClarifyFamily] = useState<VaultEntry["family"]>("secret");

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
          try {
            await onConfirm();
            resolve();
          } catch (e) {
            reject(e);
          }
          setConfirmState(null);
        },
        onCancel: () => {
          // Cancelling is not an error: resolve so an uncaught rejection can
          // never blank the app via the error boundary.
          resolve();
          setConfirmState(null);
        },
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
  const patchTimerRef = useRef<any>(null);

  const toggleLanguage = useCallback(() => {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = prev.ui_language || "en";
      const next = (current === "en" ? "ar" : "en") as "ar" | "en";
      const updated = { ...prev, ui_language: next };
      // Persist immediately so the background poll doesn't revert the change
      settingsDirtyRef.current = true;
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      })
        .then((r) => r.json())
        .then((saved) => {
          settingsDirtyRef.current = false;
          if (saved && typeof saved === "object" && (saved as Settings).ai_provider) {
            setSettings(saved as Settings);
          }
        })
        .catch(() => {
          settingsDirtyRef.current = false;
        });
      return updated;
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

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    settingsDirtyRef.current = true;
    setSettings((prev) => {
      const next = prev ? { ...prev, ...patch } : (patch as Settings);
      if (next) {
        localStorage.setItem(
          "indexarc-settings-preset",
          JSON.stringify({
            font_size_en: next.font_size_en || 14,
            font_size_ar: next.font_size_ar || 16,
            ui_language: next.ui_language || "en",
          })
        );
      }
      return next;
    });

    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .then((r) => r.json())
        .then((saved) => {
          settingsDirtyRef.current = false;
          if (saved && typeof saved === "object" && (saved as Settings).ai_provider) {
            setSettings(saved as Settings);
          }
        })
        .catch(() => {
          settingsDirtyRef.current = false;
        });
    }, 300);
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
    // SSE replaces polling — fetchAll is triggered by server-sent events
    const t = setInterval(fetchAll, 30000); // Fallback poll every 30s (SSE is primary)
    return () => clearInterval(t);
  }, [fetchAll]);

  // SSE: refetch data when server state changes
  useSSE(useCallback((msg) => {
    if (msg.event === "vault-changed" || msg.event === "entries-changed" || msg.event === "folders-changed" || msg.event === "settings-changed") {
      fetchAll();
    }
  }, [fetchAll]));

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

  const discardCandidate = (tempId: string) => {
    setCandidates((prev) => prev.filter((c) => c.temp_id !== tempId));
    setSelected((prev) => {
      const n = { ...prev };
      delete n[tempId];
      return n;
    });
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
    setClarifyFamily(entry.family || "secret");
  };

  const submitClarify = async () => {
    if (!clarify) return;
    const secretLike = clarifyFamily === "secret" || clarifyFamily === "unknown";
    if (secretLike && !clarifyName.trim()) {
      showToast("Name is required / الاسم مطلوب", "error");
      return;
    }
    const value = clarifyValue.trim() || clarify.value;
    const res = await fetch(`/api/entries/${clarify.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: clarifyType.trim(),
        name: clarifyName.trim(),
        value,
        family: clarifyFamily,
      }),
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
    }, "Delete").catch((e) => console.error("delete failed:", e?.message || e));
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
      showToast("Loading LLM into memory... · جارٍ التحميل", "info");
      const res = await fetch("/api/ollama/warm", { method: "POST" });
      const data = await readJson(res);
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
    }, "Discard").catch((e) => console.error("discard failed:", e?.message || e));
  };

  const nav: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = useMemo(
    () => [
      { id: "home", label: t("tab_home"), icon: <Layers className="w-4 h-4" />, badge: attention.length || undefined },
      { id: "scratchpad", label: t("tab_scratchpad"), icon: <StickyNote className="w-4 h-4" /> },
      { id: "analyze", label: t("tab_paste"), icon: <Sparkles className="w-4 h-4" />, badge: candidates.length || undefined },
      { id: "ask", label: t("tab_ask"), icon: <Search className="w-4 h-4" /> },
      { id: "library", label: t("tab_library"), icon: <KeyRound className="w-4 h-4" /> },
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
      className="h-full font-sans antialiased flex flex-col relative overflow-x-hidden"
      style={{
        background: "var(--bg-root)",
        color: "var(--text)",
      }}
    >
      {/* Animated Background */}
      <Starfield />
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
          <nav className="flex-1 p-3 flex flex-col gap-1">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider px-3 pt-2 pb-2 flex items-center gap-2"
              style={{ color: "var(--text-muted)" }}
            >
              Vault
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            </div>
            {nav.map((n) => {
              const isActive = tab === n.id;
              return (
              <button
                key={n.id}
                type="button"
                onClick={() => setTab(n.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-all relative group"
                style={{
                  borderRadius: "9999px",
                  color: isActive ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
                  background: isActive ? "var(--tab-active-bg)" : "var(--tab-inactive-bg)",
                  border: `1px solid ${isActive ? "var(--tab-active-border)" : "var(--tab-inactive-border)"}`,
                  boxShadow: isActive ? "var(--tab-active-shadow)" : "none",
                }}
              >
                <span style={{ color: isActive ? "var(--accent-bright)" : "inherit", opacity: isActive ? 1 : 0.75 }}>{n.icon}</span>
                <span className="flex-1 text-left truncate font-medium">{n.label}</span>
                {n.badge ? (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                    style={{ background: isActive ? "var(--accent)" : "var(--amber-bg)", color: isActive ? "#fff" : "var(--amber)" }}
                  >
                    {n.badge}
                  </span>
                ) : null}
              </button>
              );
            })}

            <div
              className="text-[11px] font-semibold uppercase tracking-wider px-3 pt-4 pb-2 flex items-center gap-2"
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
              {([
                { val: status?.stats.total_saved ?? 0, lbl: "Saved", filter: "all" },
                { val: status?.stats.needs_attention ?? 0, lbl: "Pending", filter: "attention" },
                { val: status?.stats.total_secrets ?? 0, lbl: "Secrets", filter: "secret" },
                { val: status?.stats.total_commands ?? 0, lbl: "Commands", filter: "command" },
              ] as { val: number; lbl: string; filter: LibraryFilter }[]).map((s) => (
                <button
                  key={s.lbl}
                  type="button"
                  onClick={() => {
                    setLibraryFilter(s.filter);
                    setTab("library");
                  }}
                  className="text-center py-1.5 rounded-lg border transition-all hover:brightness-125 cursor-pointer"
                  style={{ background: "var(--accent-bg)", borderColor: "rgba(37, 99, 235, 0.06)" }}
                  title={`Open ${s.lbl} in Library`}
                >
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{
                      background: "linear-gradient(135deg, var(--accent-bright), var(--cyan))",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {s.val}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider font-medium" style={{ color: "var(--text-muted)" }}>
                    {s.lbl}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Built with Kazma.ai credit (clickable → opens in default browser) */}
          <button
            type="button"
            onClick={() => window.electronAPI?.openExternal?.("https://kazma.ai")}
            className="mt-auto m-3 p-3 rounded-xl flex items-center gap-3 transition-all hover:brightness-125 text-left"
            style={{
              borderColor: "var(--border-glow)",
              background: "var(--accent-bg)",
              boxShadow: "0 0 16px var(--accent-glow)",
            }}
            title="https://kazma.ai"
          >
            <img
              src="/kazma-logo.jpeg"
              alt="Kazma.ai"
              className="h-10 w-10 rounded-lg object-contain flex-shrink-0"
            />
            <div className="leading-snug">
              <div className="text-[11px] font-semibold" style={{ color: "var(--accent-bright)" }}>
                {t("built_with_kazma")}
              </div>
              <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                {t("kazma_tagline")}
              </div>
            </div>
          </button>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
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

              {/* Command Palette Trigger */}
              <button
                onClick={() => setCmdPaletteOpen(true)}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-muted)" }}
                title="Global Search (Ctrl + K)"
              >
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>Search...</span>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "var(--bg-input)" }}>Ctrl+K</kbd>
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
                onClick={() => setTab("home")}
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
              <React.Suspense fallback={<div className="p-6 text-sm" style={{color:"var(--text-muted)"}}>Loading scratchpad…</div>}>
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
                onReopenInScratchpad={(title, html) => {
                  // In-memory handoff — note content must not touch browser storage.
                  offerNoteToScratchpad({ title, html });
                  setTab("scratchpad");
                }}
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
                logs={logs}
              />
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
          clarifyValue={clarifyValue}
          setClarifyValue={setClarifyValue}
          clarifyFamily={clarifyFamily}
          setClarifyFamily={setClarifyFamily}
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

      {/* Global Command Palette Modal */}
      <CommandPaletteModal
        isOpen={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        entries={entries}
        onSelectEntry={(entry) => {
          if (entry.family === "note") {
            setTab("library");
            setLibraryQuery(entry.name);
          } else {
            navigator.clipboard?.writeText(entry.value);
            showToast(`Copied ${entry.name}`, "success");
          }
        }}
        onNavigateTab={(t) => setTab(t)}
        settings={settings}
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
