import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Server,
  Sparkles,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Copy,
  KeyRound,
  Terminal,
  Inbox,
  Settings,
  HelpCircle,
  ChevronRight,
  Save,
  SkipForward,
  Folder,
  FolderSearch,
  Ban,
  StickyNote,
  LayoutGrid,
} from "lucide-react";

/* ─── types ─── */
interface VaultEntry {
  id: string;
  value: string;
  type: string;
  name: string;
  raw_fragment: string;
  labels: string[];
  type_aliases: string[];
  status: "saved" | "needs_name" | "needs_type" | "needs_review";
  family: "secret" | "command" | "note" | "unknown";
  created_at: string;
  updated_at: string;
  notes?: string;
}

interface AnalyzeCandidate {
  temp_id: string;
  value: string;
  type: string;
  name: string;
  raw_fragment: string;
  labels: string[];
  type_aliases: string[];
  family: "secret" | "command" | "note" | "unknown";
  confidence: number;
  needs_type: boolean;
  needs_name: boolean;
  ready: boolean;
  model_notes?: string;
}

interface SystemStatus {
  portable_root: string;
  ai_provider: "local" | "api" | "auto";
  active_provider: string;
  is_ollama_online: boolean;
  ollama_models: string[];
  is_gemini_configured: boolean;
  stats: {
    total_saved: number;
    needs_attention: number;
    total_commands: number;
    total_notes: number;
    total_secrets: number;
  };
}

interface Settings {
  ai_provider: "local" | "api" | "auto";
  ollama_base_url: string;
  ollama_llm_model: string;
  ollama_embed_model: string;
  gemini_api_key: string;
  gemini_llm_model: string;
  gemini_embed_model: string;
  ui_language: "en" | "ar" | "both";
}

type Tab = "home" | "paste" | "folders" | "library" | "ask" | "settings" | "logs";

/** Library coarse filters (map UI labels → entry.family) */
type LibraryFilter = "all" | "secret" | "command" | "note" | "unknown" | "attention";

interface ScanCandidate extends AnalyzeCandidate {
  source_file?: string;
  source_name?: string;
  decision?: "pending" | "save" | "park" | "discard";
}

interface FolderScanSession {
  id: string;
  folder_path: string;
  created_at: string;
  status: "review" | "committed" | "discarded";
  watching: boolean;
  brief: string;
  summary: {
    folder_path: string;
    files_found: number;
    files_processed: number;
    files_skipped: number;
    candidates_total: number;
    candidates_ready: number;
    candidates_needs_review: number;
    candidates_discarded: number;
    provider_used: string;
    duration_ms: number;
  };
  processed_files: {
    path: string;
    name: string;
    size: number;
    candidates_found: number;
    ready: number;
    needs_review: number;
  }[];
  skipped_files: { path: string; name: string; reason: string }[];
  candidates: ScanCandidate[];
}

interface WatchedFolderRow {
  id: string;
  path: string;
  watching: boolean;
  live?: boolean;
  last_scan_at?: string;
}

function maskValue(v: string) {
  if (!v) return "••••";
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function statusLabel(s: VaultEntry["status"]) {
  switch (s) {
    case "needs_name":
      return "Needs name";
    case "needs_type":
      return "Needs type";
    case "needs_review":
      return "Needs review";
    default:
      return "Saved";
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [attention, setAttention] = useState<VaultEntry[]>([]);
  const [logs, setLogs] = useState<{ time: string; type: string; message: string }[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

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

  // reveal / copy
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // clarify modal
  const [clarify, setClarify] = useState<VaultEntry | null>(null);
  const [clarifyType, setClarifyType] = useState("");
  const [clarifyName, setClarifyName] = useState("");

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
    fetchAll();
    const t = setInterval(fetchAll, 5000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const copyText = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

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
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setAskResults(data.results || []);
      setTab("ask");
    } catch {
      setAskResults([]);
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

  /** Parse API JSON safely (avoids "Unexpected token <" when HTML is returned) */
  const readJson = async (res: Response) => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Server returned non-JSON (${res.status}). ${text.slice(0, 80).replace(/\s+/g, " ")}…`
      );
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
    const candidates = scanSession.candidates.map((c) => ({
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
      body: JSON.stringify({ candidates }),
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
      { id: "home", label: "Home / الرئيسية", icon: <Layers className="w-4 h-4" />, badge: attention.length || undefined },
      { id: "paste", label: "Paste & Analyze", icon: <Plus className="w-4 h-4" /> },
      {
        id: "folders",
        label: "Folder Watcher",
        icon: <Folder className="w-4 h-4" />,
        badge: scanSession?.status === "review" ? scanSession.summary.candidates_needs_review || undefined : undefined,
      },
      { id: "ask", label: "Ask / اسأل", icon: <Search className="w-4 h-4" /> },
      { id: "library", label: "Library", icon: <KeyRound className="w-4 h-4" /> },
      { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
      { id: "logs", label: "Logs", icon: <Terminal className="w-4 h-4" /> },
    ],
    [attention.length, scanSession]
  );

  const libraryCounts = useMemo(() => {
    const c = {
      all: entries.length,
      secret: 0,
      command: 0,
      note: 0,
      unknown: 0,
      attention: 0,
    };
    for (const e of entries) {
      if (e.family === "secret") c.secret++;
      else if (e.family === "command") c.command++;
      else if (e.family === "note") c.note++;
      else if (e.family === "unknown") c.unknown++;
      if (e.status !== "saved") c.attention++;
    }
    return c;
  }, [entries]);

  const libraryFiltered = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    return entries.filter((e) => {
      if (libraryFilter === "attention") {
        if (e.status === "saved") return false;
      } else if (libraryFilter !== "all" && e.family !== libraryFilter) {
        return false;
      }
      if (!q) return true;
      const blob = `${e.name} ${e.type} ${e.value} ${e.raw_fragment} ${(e.labels || []).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [entries, libraryFilter, libraryQuery]);

  const libraryChips: {
    id: LibraryFilter;
    label: string;
    icon: React.ReactNode;
    activeClass: string;
  }[] = [
    {
      id: "all",
      label: "All",
      icon: <LayoutGrid className="w-3.5 h-3.5" />,
      activeClass: "bg-slate-100 text-slate-900 border-slate-100",
    },
    {
      id: "secret",
      label: "Keys",
      icon: <KeyRound className="w-3.5 h-3.5" />,
      activeClass: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    },
    {
      id: "command",
      label: "Commands",
      icon: <Terminal className="w-3.5 h-3.5" />,
      activeClass: "bg-sky-500/20 text-sky-200 border-sky-500/40",
    },
    {
      id: "note",
      label: "Notes",
      icon: <StickyNote className="w-3.5 h-3.5" />,
      activeClass: "bg-violet-500/20 text-violet-200 border-violet-500/40",
    },
    {
      id: "unknown",
      label: "Unidentified",
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      activeClass: "bg-rose-500/20 text-rose-200 border-rose-500/40",
    },
    {
      id: "attention",
      label: "Needs review",
      icon: <Inbox className="w-3.5 h-3.5" />,
      activeClass: "bg-orange-500/20 text-orange-200 border-orange-500/40",
    },
  ];

  const EntryCard: React.FC<{
    entry: VaultEntry;
    score?: number;
    reason?: string;
  }> = ({ entry, score, reason }) => {
    const show = revealed[entry.id];
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-white truncate">{entry.name}</span>
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                {entry.type}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {entry.family}
              </span>
              {entry.status !== "saved" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
                  {statusLabel(entry.status)}
                </span>
              )}
            </div>
            {(score !== undefined || reason) && (
              <p className="text-[11px] text-slate-500 mt-1">
                {score !== undefined && `Score ${(score * 100).toFixed(0)}%`}
                {reason ? ` · ${reason}` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setRevealed((r) => ({ ...r, [entry.id]: !r[entry.id] }))}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              title="Reveal"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => copyText(entry.id, entry.value)}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              title="Copy"
            >
              <Copy className="w-4 h-4" />
            </button>
            {entry.status !== "saved" && (
              <button
                type="button"
                onClick={() => openClarify(entry)}
                className="px-2 py-1 text-[11px] rounded-lg bg-amber-600/20 text-amber-300 border border-amber-500/30"
              >
                Identify
              </button>
            )}
            <button
              type="button"
              onClick={() => deleteEntry(entry.id)}
              className="p-1.5 rounded-lg hover:bg-red-950 text-slate-500 hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="font-mono text-sm text-emerald-300/90 bg-slate-950/60 rounded-lg px-3 py-2 break-all border border-slate-800">
          {show ? entry.value : maskValue(entry.value)}
          {copied === entry.id && (
            <span className="ml-2 text-[10px] text-emerald-500">Copied</span>
          )}
        </div>
        {entry.raw_fragment && entry.raw_fragment !== entry.value && (
          <p className="text-[11px] text-slate-500 font-mono truncate" title={entry.raw_fragment}>
            src: {entry.raw_fragment}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased flex flex-col" dir="auto">
      {/* ribbon */}
      <div className="bg-slate-900 border-b border-slate-800 text-xs py-2 px-6 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-slate-300">IndexArc Vault · Portable</span>
          {status && (
            <span className="text-slate-500 font-mono hidden md:inline truncate max-w-md" title={status.portable_root}>
              {status.portable_root}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500">
            AI:{" "}
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
            Ollama {status?.is_ollama_online ? "on" : "off"}
          </span>
          <span
            className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
              status?.is_gemini_configured
                ? "text-indigo-300 bg-indigo-500/10 border border-indigo-500/20"
                : "text-slate-400 bg-slate-800 border border-slate-700"
            }`}
          >
            API {status?.is_gemini_configured ? "key" : "—"}
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
              IndexArc
              <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded border border-slate-700">
                Vault 2.0
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Paste · Extract · Name · Ask (EN / العربية) · Single-folder portable
            </p>
          </div>
        </div>
        <form onSubmit={handleAsk} className="flex gap-2 w-full max-w-xl">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask: Telegram ID · توكن بوت mybot_1 · my bot token?"
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={asking}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            <Search className="w-4 h-4" />
            {asking ? "…" : "Ask"}
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
          {/* HOME */}
          {tab === "home" && (
            <>
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-teal-400" /> Quick paste
                </h2>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={4}
                  placeholder={`Paste secrets, .env blocks, commands, or notes…\nمثال: TELEGRAM_ALLOWED_USERS "123456789"`}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-teal-500"
                />
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || !paste.trim()}
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {analyzing ? "Analyzing…" : "Analyze & extract"}
                </button>
              </div>

              {attention.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                    <Inbox className="w-4 h-4" />
                    Unidentified / يحتاج مراجعة ({attention.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Secrets waiting for type and/or name before they are fully saved.
                  </p>
                  <div className="space-y-2">
                    {attention.map((e) => (
                      <EntryCard key={e.id} entry={e} />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-300">Recent saved</h2>
                <div className="space-y-2">
                  {entries
                    .filter((e) => e.status === "saved")
                    .slice(0, 8)
                    .map((e) => (
                      <EntryCard key={e.id} entry={e} />
                    ))}
                  {!entries.filter((e) => e.status === "saved").length && (
                    <p className="text-sm text-slate-500 italic">No saved entries yet. Paste something above.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* PASTE / REVIEW */}
          {tab === "paste" && (
            <div className="space-y-4">
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">Paste & multi-extract</h2>
                  {providerUsed && (
                    <span className="text-[11px] font-mono text-slate-400">via {providerUsed}</span>
                  )}
                </div>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={5}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
                  placeholder="Whole .env, single key, command, or note…"
                />
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || !paste.trim()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50"
                >
                  {analyzing ? "Analyzing…" : "Re-analyze"}
                </button>
              </div>

              {candidates.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Candidates ({candidates.length}) — edit type/name, then save
                    </h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveSelected(false)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" /> Save selected
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveSelected(true)}
                        className="px-3 py-1.5 rounded-lg bg-amber-700/80 hover:bg-amber-600 text-xs font-medium flex items-center gap-1"
                        title="Park incomplete items in Unidentified"
                      >
                        <SkipForward className="w-3.5 h-3.5" /> Park incomplete
                      </button>
                    </div>
                  </div>

                  {candidates.map((c) => (
                    <div
                      key={c.temp_id}
                      className={`border rounded-xl p-4 space-y-3 ${
                        c.ready
                          ? "bg-slate-900/60 border-slate-700"
                          : "bg-amber-950/20 border-amber-500/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!selected[c.temp_id]}
                          onChange={(e) =>
                            setSelected((s) => ({ ...s, [c.temp_id]: e.target.checked }))
                          }
                        />
                        <span className="text-[10px] uppercase text-slate-400">{c.family}</span>
                        <span className="text-[10px] text-slate-500">
                          conf {Math.round(c.confidence * 100)}%
                        </span>
                        {!c.ready && (
                          <span className="text-[10px] text-amber-300 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {c.needs_type && "needs type"}
                            {c.needs_type && c.needs_name && " · "}
                            {c.needs_name && "needs name"}
                          </span>
                        )}
                        {c.ready && (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> ready
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-sm text-emerald-300 bg-slate-950 rounded-lg px-3 py-2 break-all">
                        {c.value}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="text-xs space-y-1 block">
                          <span className="text-slate-400">Type (freeform)</span>
                          <input
                            value={c.type}
                            onChange={(e) => updateCandidate(c.temp_id, { type: e.target.value })}
                            placeholder="e.g. telegram bot token / Hermes profile id"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="text-xs space-y-1 block">
                          <span className="text-slate-400">Name (required for secrets)</span>
                          <input
                            value={c.name}
                            onChange={(e) => updateCandidate(c.temp_id, { name: e.target.value })}
                            placeholder="e.g. mybot_1"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {(["secret", "command", "note", "unknown"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => updateCandidate(c.temp_id, { family: f })}
                            className={`px-2 py-0.5 rounded border ${
                              c.family === f
                                ? "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                                : "border-slate-700 text-slate-500"
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      {c.model_notes && (
                        <p className="text-[11px] text-slate-500">{c.model_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!candidates.length && (
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Analyze a paste to review multiple extracted entries at once.
                </p>
              )}
            </div>
          )}

          {/* FOLDER WATCHER */}
          {tab === "folders" && (
            <div className="space-y-5">
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <FolderSearch className="w-4 h-4 text-indigo-400" />
                  Watch / scan folder into portable vault
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Reads supported text/config files under a folder, extracts secrets, tokens, commands, and notes.
                  Nothing is written to the vault until you review the brief and choose save / identify / discard.
                </p>

                <div className="flex flex-wrap gap-2">
                  <input
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    placeholder="Absolute folder path e.g. G:\secrets or D:\env"
                    className="flex-1 min-w-[220px] bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={pickFolder}
                    disabled={scanning}
                    className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    Browse…
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFolderScan()}
                    disabled={scanning || !folderPath.trim()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    <Folder className="w-4 h-4" />
                    {scanning ? "Scanning…" : "Scan folder"}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  The app reads the folder <strong className="text-slate-400">in place on disk</strong> (no upload).
                  Browse navigates this machine’s filesystem through the local server
                  {isElectron ? " (or use the Electron native dialog)." : "."}
                </p>
                <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={folderWatch}
                      onChange={(e) => setFolderWatch(e.target.checked)}
                    />
                    Keep watching for new/changed files
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={folderUseAi}
                      onChange={(e) => setFolderUseAi(e.target.checked)}
                    />
                    Use AI per file (slower; default is fast heuristics)
                  </label>
                </div>
              </div>

              {watchedFolders.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tracked folders</h3>
                  {watchedFolders.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-slate-300 truncate">{f.path}</div>
                        <div className="text-slate-500">
                          {f.live || f.watching ? (
                            <span className="text-emerald-400">Live watch</span>
                          ) : (
                            "Not watching"
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
                          Use
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded-lg border border-slate-700 text-red-400 hover:bg-red-950/40"
                          onClick={async () => {
                            await fetch(`/api/folders/${f.id}`, { method: "DELETE" });
                            fetchAll();
                          }}
                        >
                          Remove
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
                    <h3 className="text-sm font-semibold text-indigo-300">Scan brief / ملخص المسح</h3>
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                      {scanSession.brief}
                    </pre>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                        <div className="text-lg font-bold text-white">{scanSession.summary.files_processed}</div>
                        <div className="text-[10px] text-slate-500">Files included</div>
                      </div>
                      <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                        <div className="text-lg font-bold text-amber-400">{scanSession.summary.files_skipped}</div>
                        <div className="text-[10px] text-slate-500">Not included</div>
                      </div>
                      <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                        <div className="text-lg font-bold text-emerald-400">{scanSession.summary.candidates_ready}</div>
                        <div className="text-[10px] text-slate-500">Ready</div>
                      </div>
                      <div className="bg-slate-900 rounded-lg p-2 border border-slate-800">
                        <div className="text-lg font-bold text-amber-300">{scanSession.summary.candidates_needs_review}</div>
                        <div className="text-[10px] text-slate-500">Need type/name</div>
                      </div>
                    </div>
                  </div>

                  {/* Skipped files */}
                  {scanSession.skipped_files.length > 0 && (
                    <details className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                      <summary className="text-xs font-semibold text-slate-400 cursor-pointer">
                        Not included ({scanSession.skipped_files.length} files) — click to expand
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
                    <span className="text-xs text-slate-500">Bulk:</span>
                    <button type="button" onClick={() => setAllDecisions("save")} className="px-2 py-1 text-[11px] rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30">Mark all save</button>
                    <button type="button" onClick={() => setAllDecisions("park")} className="px-2 py-1 text-[11px] rounded-lg bg-amber-600/20 text-amber-300 border border-amber-500/30">Mark all park</button>
                    <button type="button" onClick={() => setAllDecisions("discard")} className="px-2 py-1 text-[11px] rounded-lg bg-red-600/20 text-red-300 border border-red-500/30">Mark all discard</button>
                    <button type="button" onClick={() => setAllDecisions("pending")} className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 text-slate-400">Reset</button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={discardScanSession}
                      className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:text-white flex items-center gap-1"
                    >
                      <Ban className="w-3.5 h-3.5" /> Discard review
                    </button>
                    <button
                      type="button"
                      onClick={applyScanSession}
                      disabled={applyingScan}
                      className="px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium disabled:opacity-50 flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {applyingScan ? "Applying…" : "Apply to vault"}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Apply: <strong className="text-slate-400">save</strong> (or ready+pending) → vault ·{" "}
                    incomplete/park → Unidentified inbox · <strong className="text-slate-400">discard</strong> → ignored.
                  </p>

                  {/* Candidates */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-white">
                      Extracted candidates ({scanSession.candidates.length})
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
                              {c.needs_type && "needs type"}
                              {c.needs_type && c.needs_name && " · "}
                              {c.needs_name && "needs name"}
                            </span>
                          )}
                          {c.ready && (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> ready
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-sm text-emerald-300 bg-slate-950 rounded-lg px-3 py-2 break-all">
                          {c.value}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            value={c.type}
                            onChange={(e) => patchScanCandidate(c.temp_id, { type: e.target.value })}
                            placeholder="Type (freeform)"
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                          />
                          <input
                            value={c.name}
                            onChange={(e) => patchScanCandidate(c.temp_id, { name: e.target.value })}
                            placeholder="Name (required for secrets)"
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(["pending", "save", "park", "discard"] as const).map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => patchScanCandidate(c.temp_id, { decision: d })}
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
                      <p className="text-sm text-slate-500 italic">No candidates extracted from this folder.</p>
                    )}
                  </div>
                </div>
              )}

              {!scanSession && (
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Scan a folder to get a brief of included vs skipped files, then save or discard each extract.
                </p>
              )}
            </div>
          )}

          {/* ASK */}
          {tab === "ask" && (
            <div className="space-y-4">
              <form onSubmit={handleAsk} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
                  placeholder="what is my Telegram ID؟ · توكن بوت mybot_1"
                />
                <button
                  type="submit"
                  disabled={asking}
                  className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-sm font-medium disabled:opacity-50"
                >
                  {asking ? "…" : "Search"}
                </button>
              </form>
              <div className="space-y-2">
                {askResults.map((r) => (
                  <EntryCard
                    key={r.entry.id}
                    entry={r.entry}
                    score={r.score}
                    reason={r.match_reason}
                  />
                ))}
                {!askResults.length && (
                  <p className="text-sm text-slate-500 italic">No results yet. Try Arabic or English.</p>
                )}
              </div>
            </div>
          )}

          {/* LIBRARY */}
          {tab === "library" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">
                  Library{" "}
                  <span className="text-slate-500 font-normal">
                    ({libraryFiltered.length}
                    {libraryFilter !== "all" || libraryQuery.trim()
                      ? ` of ${entries.length}`
                      : ""}
                    )
                  </span>
                </h2>
                <button type="button" onClick={fetchAll} className="text-slate-400 hover:text-white p-1" title="Refresh">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Kind filters */}
              <div className="flex flex-wrap gap-2">
                {libraryChips.map((chip) => {
                  const count = libraryCounts[chip.id];
                  const active = libraryFilter === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setLibraryFilter(chip.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? chip.activeClass
                          : "bg-slate-900/60 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200"
                      }`}
                    >
                      {chip.icon}
                      {chip.label}
                      <span
                        className={`min-w-[1.25rem] text-center rounded-full px-1 py-0.5 text-[10px] tabular-nums ${
                          active ? "bg-black/25 text-inherit" : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Text within library */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  placeholder="Filter by name, type, value…"
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-2">
                {libraryFiltered.map((e) => (
                  <EntryCard key={e.id} entry={e} />
                ))}
                {!entries.length && (
                  <p className="text-sm text-slate-500 italic">Vault is empty.</p>
                )}
                {!!entries.length && !libraryFiltered.length && (
                  <p className="text-sm text-slate-500 italic">
                    No entries match this filter
                    {libraryQuery.trim() ? ` for “${libraryQuery.trim()}”` : ""}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {tab === "settings" && settings && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-5 max-w-xl">
              <h2 className="text-sm font-semibold text-white">AI provider (user choice)</h2>
              <div className="flex flex-wrap gap-2">
                {(["auto", "local", "api"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patchSettings({ ai_provider: m })}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border ${
                      settings.ai_provider === m
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {m === "auto" && "Auto"}
                    {m === "local" && (
                      <span className="flex items-center gap-1">
                        <Server className="w-3.5 h-3.5" /> Local Ollama
                      </span>
                    )}
                    {m === "api" && (
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Cloud API
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                Active now:{" "}
                <span className="text-indigo-300 font-mono">{status?.active_provider || "…"}</span>
                {settings.ai_provider === "auto" && " · Auto uses Ollama when online, else Gemini API"}
              </p>

              {/* Local Ollama panel */}
              {(settings.ai_provider === "local" || settings.ai_provider === "auto") && (
                <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300 flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5" /> Local Ollama models
                    </h3>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        status?.is_ollama_online
                          ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                          : "text-rose-300 border-rose-500/30 bg-rose-500/10"
                      }`}
                    >
                      {status?.is_ollama_online ? "online" : "offline"}
                    </span>
                  </div>
                  <label className="block text-xs space-y-1">
                    <span className="text-slate-400">Ollama base URL</span>
                    <input
                      value={settings.ollama_base_url}
                      onChange={(e) => patchSettings({ ollama_base_url: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-xs space-y-1">
                      <span className="text-slate-400">LLM (classify / extract)</span>
                      <select
                        value={settings.ollama_llm_model}
                        onChange={(e) => patchSettings({ ollama_llm_model: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
                      >
                        {/* keep current even if not in list */}
                        {!status?.ollama_models?.some(
                          (m) =>
                            m === settings.ollama_llm_model ||
                            m.startsWith(settings.ollama_llm_model.split(":")[0])
                        ) && (
                          <option value={settings.ollama_llm_model}>
                            {settings.ollama_llm_model}
                          </option>
                        )}
                        {(status?.ollama_models || []).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input
                        value={settings.ollama_llm_model}
                        onChange={(e) => patchSettings({ ollama_llm_model: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-400"
                        placeholder="or type model name"
                      />
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className="text-slate-400">Embed (search vectors)</span>
                      <select
                        value={settings.ollama_embed_model}
                        onChange={(e) => patchSettings({ ollama_embed_model: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
                      >
                        {!status?.ollama_models?.some(
                          (m) =>
                            m === settings.ollama_embed_model ||
                            m.startsWith(settings.ollama_embed_model.split(":")[0])
                        ) && (
                          <option value={settings.ollama_embed_model}>
                            {settings.ollama_embed_model}
                          </option>
                        )}
                        {(status?.ollama_models || []).map((m) => (
                          <option key={`e-${m}`} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input
                        value={settings.ollama_embed_model}
                        onChange={(e) => patchSettings({ ollama_embed_model: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-400"
                        placeholder="or type model name"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Paste/Analyze uses the <strong className="text-slate-400">LLM</strong>. Ask search uses{" "}
                    <strong className="text-slate-400">embed</strong>. Click Load LLM so{" "}
                    <code className="text-slate-400">ollama ps</code> shows both.
                  </p>
                  <button
                    type="button"
                    onClick={warmOllama}
                    className="px-3 py-1.5 rounded-lg bg-sky-700/80 hover:bg-sky-600 text-xs font-medium"
                  >
                    Load LLM into memory
                  </button>
                </div>
              )}

              {/* Cloud API panel */}
              {(settings.ai_provider === "api" || settings.ai_provider === "auto") && (
                <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Cloud API (Gemini)
                  </h3>
                  {!settings.gemini_api_key && settings.ai_provider === "api" && (
                    <p className="text-[11px] text-amber-300/90 border border-amber-500/20 bg-amber-500/10 rounded-lg px-2 py-1.5">
                      Add a Gemini API key below, then Save. Without a key, analyze falls back to heuristics only.
                    </p>
                  )}
                  <label className="block text-xs space-y-1">
                    <span className="text-slate-400">Gemini API key</span>
                    <input
                      type="password"
                      value={settings.gemini_api_key}
                      onChange={(e) => patchSettings({ gemini_api_key: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
                      placeholder="AIza…"
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-xs space-y-1">
                      <span className="text-slate-400">Gemini LLM</span>
                      <select
                        value={settings.gemini_llm_model}
                        onChange={(e) => patchSettings({ gemini_llm_model: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
                      >
                        {[
                          "gemini-2.0-flash",
                          "gemini-2.0-flash-lite",
                          "gemini-1.5-flash",
                          "gemini-1.5-pro",
                          settings.gemini_llm_model,
                        ]
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className="text-slate-400">Gemini embed</span>
                      <select
                        value={settings.gemini_embed_model}
                        onChange={(e) => patchSettings({ gemini_embed_model: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
                      >
                        {["text-embedding-004", "embedding-001", settings.gemini_embed_model]
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                All vault data lives in <code className="text-slate-400">data/</code> and settings in{" "}
                <code className="text-slate-400">config/</code> next to the app — copy the whole folder to a USB
                drive and run anywhere.
              </p>

              <button
                type="button"
                onClick={saveSettings}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium"
              >
                Save settings
              </button>
            </div>
          )}

          {/* LOGS */}
          {tab === "logs" && (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] max-h-[70vh] overflow-y-auto space-y-1">
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">{l.time}</span>
                  <span className="text-indigo-400 shrink-0 w-16">{l.type}</span>
                  <span className="text-slate-300">{l.message}</span>
                </div>
              ))}
              {!logs.length && <p className="text-slate-500">No logs yet.</p>}
            </div>
          )}
        </section>
      </main>

      {/* Server filesystem browser — pick folder in place */}
      {fsBrowserOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">Select folder on this machine</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Reads in place · no upload · path the server can access
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFsBrowserOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
              <button
                type="button"
                disabled={!fsParent && !!fsPath}
                onClick={() => loadFsDir(fsParent || "")}
                className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 text-slate-300 disabled:opacity-40"
              >
                ↑ Up
              </button>
              <button
                type="button"
                onClick={() => loadFsDir("")}
                className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 text-slate-300"
              >
                Roots
              </button>
              <div className="flex-1 font-mono text-[11px] text-slate-400 truncate" title={fsPath}>
                {fsPath || "(drives & home)"}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[40vh]">
              {fsLoading && (
                <p className="p-4 text-xs text-slate-500">Loading…</p>
              )}
              {fsError && (
                <p className="p-4 text-xs text-red-400">{fsError}</p>
              )}
              {!fsLoading &&
                !fsError &&
                fsEntries.map((ent) => (
                  <button
                    key={ent.path}
                    type="button"
                    onClick={() => loadFsDir(ent.path)}
                    className="w-full text-left px-4 py-2.5 text-sm border-b border-slate-800/80 hover:bg-slate-800/60 flex items-center gap-2"
                  >
                    <Folder className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="truncate font-mono text-slate-200">{ent.name}</span>
                  </button>
                ))}
              {!fsLoading && !fsError && !fsEntries.length && (
                <p className="p-4 text-xs text-slate-500">No subfolders here. You can still select this path.</p>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setFsBrowserOpen(false)}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!fsPath || scanning}
                onClick={() => {
                  setFolderPath(fsPath);
                  setFsBrowserOpen(false);
                }}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Use this path
              </button>
              <button
                type="button"
                disabled={!fsPath || scanning}
                onClick={() => handleFolderScan(fsPath)}
                className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium disabled:opacity-40"
              >
                {scanning ? "Scanning…" : "Scan this folder"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clarify modal */}
      {clarify && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Identify secret / تعريف السر</h3>
            <p className="text-xs text-slate-400 font-mono break-all">{maskValue(clarify.value)}</p>
            <label className="block text-xs space-y-1">
              <span className="text-slate-400">What is this? (freeform type)</span>
              <input
                value={clarifyType}
                onChange={(e) => setClarifyType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                placeholder="telegram bot token / Hermes API key…"
                autoFocus
              />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-slate-400">Name (required)</span>
              <input
                value={clarifyName}
                onChange={(e) => setClarifyName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                placeholder="mybot_1"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setClarify(null)}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitClarify}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
