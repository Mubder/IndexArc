import { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../lib/clipboard";
import { normalizePastedPlain, plainToSimpleHtml } from "../lib/clipboardText";
import { textToNoteHtml } from "../sanitize";
import type { Settings } from "../types";
import { getTranslation, type TranslationDict } from "../utils/i18n";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import { SourceEditor, type CaretInfo, type SourceEditorHandle } from "./SourceEditor";
import { findTextMatches, type FindOptions } from "./findText";

interface OpenDoc {
  path: string;
  name: string;
  ext: string;
  editable: boolean;
  text: string;
  savedText: string;
  /** Blob URL for a read-only PDF, created once when the file is opened. */
  pdfUrl?: string;
}

const RECENT_KEY = "indexarc-recent-files";
const RECENT_ENC_KEY = "indexarc-recent-files-enc";

interface RecentFile { path: string; name: string }

function parseRecent(raw: string | null | undefined): RecentFile[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    return list.filter((x) => x && typeof x.path === "string" && typeof x.name === "string").slice(0, 12);
  } catch {
    return [];
  }
}

async function loadRecent(): Promise<RecentFile[]> {
  const encrypted = localStorage.getItem(RECENT_ENC_KEY);
  if (encrypted) {
    const plain = await window.electronAPI?.decryptText?.(encrypted);
    if (plain) return parseRecent(plain);
  }
  // Migrate the legacy plaintext list once; safeStorage may be unavailable.
  const legacy = parseRecent(localStorage.getItem(RECENT_KEY));
  if (legacy.length) await persistRecent(legacy);
  return legacy;
}

async function persistRecent(list: RecentFile[]): Promise<RecentFile[]> {
  const encrypted = await window.electronAPI?.encryptText?.(JSON.stringify(list));
  if (encrypted) {
    localStorage.setItem(RECENT_ENC_KEY, encrypted);
    localStorage.removeItem(RECENT_KEY);
  } else {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }
  return list;
}

function titleFrom(name: string): string {
  return name.replace(/\.[^.]+$/, "").slice(0, 80) || "Note";
}

export default function DocumentApp() {
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [active, setActive] = useState("");
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [status, setStatus] = useState("");
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  const [richReady, setRichReady] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findAt, setFindAt] = useState(0);
  const [findTotal, setFindTotal] = useState(0);
  const [closeAsk, setCloseAsk] = useState<{ paths: string[]; names: string[]; then: "tab" | "window" } | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  /** Bumped when a file is reloaded so the uncontrolled rich editor remounts. */
  const [docEpoch, setDocEpoch] = useState(0);
  const [externalChange, setExternalChange] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [caret, setCaret] = useState({ line: 1, col: 1, count: 0 });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backups, setBackups] = useState<{ id: string; createdAt: string; size: number }[]>([]);

  // Read through a ref so callbacks created once always see the current language.
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;
  const t = (key: keyof TranslationDict) => getTranslation(settingsRef.current, key);

  const docsRef = useRef<OpenDoc[]>([]);
  const mdRef = useRef<MarkdownEditorHandle>(null);
  const sourceRef = useRef<SourceEditorHandle>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef("");
  const histRef = useRef<Record<string, { undo: string[]; redo: string[] }>>({});
  const editRef = useRef({ undo: () => {}, redo: () => {}, rich: false });
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const blobUrls = useRef<Set<string>>(new Set());
  const recentRef = useRef<RecentFile[]>([]);
  docsRef.current = docs;
  activeRef.current = active;
  recentRef.current = recent;

  useEffect(() => {
    const applyTheme = () => {
      const theme = localStorage.getItem("indexarc-theme") === "light" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", theme);
    };
    applyTheme();
    window.addEventListener("storage", applyTheme);
    window.addEventListener("focus", applyTheme);
    return () => {
      window.removeEventListener("storage", applyTheme);
      window.removeEventListener("focus", applyTheme);
    };
  }, []);

  // The Files window has its own document: load the user's language and apply
  // direction, exactly like the vault window does.
  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Settings | null) => setSettings(s))
      .catch(() => {});
    void loadRecent().then((list) => {
      recentRef.current = list;
      setRecent(list);
    });
  }, []);
  useEffect(() => {
    const isAr = settings?.ui_language === "ar";
    document.documentElement.setAttribute("lang", isAr ? "ar" : "en");
    document.documentElement.setAttribute("dir", isAr ? "rtl" : "ltr");
  }, [settings?.ui_language]);
  useEffect(() => () => {
    for (const url of blobUrls.current) URL.revokeObjectURL(url);
  }, []);
  useEffect(() => {
    const onFocus = () => setFocusTick((x) => x + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (!status) return;
    const id = window.setTimeout(() => setStatus(""), 5000);
    return () => window.clearTimeout(id);
  }, [status]);

  const openPaths = useCallback(async (paths: string[]) => {
    const api = window.electronAPI;
    if (!api?.readDocFile) return;
    for (const p of paths) {
      const already = docsRef.current.find((d) => d.path === p);
      if (already) {
        // Reopening a dirty file must never reload it from disk and throw away
        // what the user typed. Just bring the existing tab forward.
        setActive(already.path);
        setFilesOpen(false);
        continue;
      }
      const payload = await api.readDocFile(p);
      if (!payload?.ok || !payload.path) {
        setStatus(`${t("docs_cannot_open")}${payload?.reason ? ` (${payload.reason})` : ""}`);
        continue;
      }
      let pdfUrl: string | undefined;
      if (payload.pdfBase64) {
        try {
          const binary = atob(payload.pdfBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          blobUrls.current.add(pdfUrl);
        } catch {
          setStatus(t("docs_cannot_open"));
          continue;
        }
      }
      const text = payload.text || "";
      setDocs((prev) => {
        const next: OpenDoc = {
          path: payload.path,
          name: payload.name,
          ext: payload.ext,
          editable: payload.editable,
          text,
          savedText: text,
          pdfUrl,
        };
        return [...prev.filter((d) => d.path !== next.path), next];
      });
      setActive(payload.path);
      setMode("rich");
      setRichReady(false);
      setFindOpen(false);
      setReplaceOpen(false);
      setFindQuery("");
      setExternalChange(false);
      setDocEpoch((x) => x + 1);
      const nextRecent = [payload, ...recentRef.current.filter((r) => r.path !== payload.path)].slice(0, 12);
      recentRef.current = nextRecent;
      setRecent(nextRecent);
      void persistRecent(nextRecent);
    }
  }, []);

  const dropDocs = (paths: string[]) => {
    const gone = new Set(paths);
    for (const d of docsRef.current) {
      if (gone.has(d.path) && d.pdfUrl) {
        URL.revokeObjectURL(d.pdfUrl);
        blobUrls.current.delete(d.pdfUrl);
      }
    }
    const next = docsRef.current.filter((d) => !gone.has(d.path));
    setDocs(next);
    if (gone.has(activeRef.current)) setActive(next[0]?.path || "");
  };

  useEffect(() => {
    const api = window.electronAPI;
    void api?.takePendingDocs?.().then((paths) => { if (paths?.length) void openPaths(paths); });
    api?.onDocsOpen?.((paths) => { if (paths?.length) void openPaths(paths); });
  }, [openPaths]);

  // Serialize writes so two overlapping saves cannot land on disk out of
  // order. The last successfully written text becomes the saved baseline.
  const write = useCallback((doc: OpenDoc, text: string): Promise<boolean> => {
    const job = writeChain.current.then(async () => {
      const res = await window.electronAPI?.writeDocFile?.(doc.path, text);
      if (!res?.ok) {
        setStatus(`${t("docs_save_failed")}${res?.reason ? ` (${res.reason})` : ""}`);
        return false;
      }
      setDocs((prev) => prev.map((d) => (d.path === doc.path ? { ...d, savedText: text } : d)));
      setStatus(t("docs_saved_status"));
      return true;
    });
    writeChain.current = job.then(() => {}, () => {});
    return job;
  }, []);

  // The app-wide quit handshake flushes the vault renderer; the Files window
  // holds on-disk edits too, so write them synchronously before exit.
  useEffect(() => {
    const flush = () => {
      const dirty = docsRef.current.filter((d) => d.editable && d.text !== d.savedText);
      for (const d of dirty) {
        try { window.electronAPI?.writeDocFileSync?.(d.path, d.text); } catch { /* best effort */ }
      }
      if (dirty.length) {
        setDocs((prev) => prev.map((d) => (dirty.some((x) => x.path === d.path) ? { ...d, savedText: d.text } : d)));
      }
      window.electronAPI?.docsFlushComplete?.();
    };
    window.electronAPI?.onDocsFlushRequest?.(flush);
  }, []);

  const askClose = (paths: string[], then: "tab" | "window") => {
    const dirty = docsRef.current.filter((d) => paths.includes(d.path) && d.text !== d.savedText);
    if (!dirty.length) {
      if (then === "window") window.electronAPI?.docsCloseResult?.(true);
      else dropDocs(paths);
      return;
    }
    setCloseAsk({ paths, names: dirty.map((d) => d.name), then });
  };
  const askCloseRef = useRef(askClose);
  askCloseRef.current = askClose;

  useEffect(() => {
    window.electronAPI?.onDocsRequestClose?.(() => {
      askCloseRef.current(docsRef.current.map((d) => d.path), "window");
    });
  }, []);

  const current = docs.find((d) => d.path === active) || docs[0];
  const currentRef = useRef<OpenDoc | undefined>(undefined);
  currentRef.current = current;
  const openPathsRef = useRef(openPaths);
  openPathsRef.current = openPaths;
  const isMarkdown = (ext: string) => ext === ".md" || ext === ".markdown";
  const sourceActive = !!current && current.editable && (mode === "source" || !isMarkdown(current.ext));
  const richActive = !!current && current.editable && isMarkdown(current.ext) && mode === "rich";

  // Detect edits made outside this window by comparing the on-disk text with
  // the last saved baseline whenever the window regains focus.
  useEffect(() => {
    if (!current || !current.editable) {
      setExternalChange(false);
      return;
    }
    let cancelled = false;
    const saved = current.savedText;
    void window.electronAPI?.readDocFile?.(current.path).then((payload) => {
      if (cancelled || !payload?.ok || typeof payload.text !== "string") return;
      setExternalChange(payload.text !== saved);
    });
    return () => { cancelled = true; };
  }, [current?.path, current?.savedText, focusTick]);

  const reloadCurrent = async () => {
    if (!current) return;
    if (current.text !== current.savedText && !window.confirm(t("docs_reload_confirm"))) return;
    const payload = await window.electronAPI?.readDocFile?.(current.path);
    if (!payload?.ok || typeof payload.text !== "string") {
      setStatus(t("docs_cannot_open"));
      return;
    }
    const text = payload.text;
    setDocs((prev) => prev.map((d) => (d.path === current.path ? { ...d, text, savedText: text } : d)));
    setExternalChange(false);
    setRichReady(false);
    setDocEpoch((x) => x + 1);
  };

  const updateText = (text: string, record = true) => {
    if (!current || !current.editable) return;
    if (record) {
      const h = histRef.current[current.path] ?? { undo: [], redo: [] };
      h.undo.push(current.text);
      if (h.undo.length > 200) h.undo.shift();
      h.redo = [];
      histRef.current[current.path] = h;
    }
    setDocs((prev) => prev.map((d) => (d.path === current.path ? { ...d, text } : d)));
  };

  const undoEdit = () => {
    if (!current) return;
    if (richActive) {
      mdRef.current?.undo();
      return;
    }
    if (sourceActive) {
      sourceRef.current?.undo();
      return;
    }
    const h = histRef.current[current.path];
    const prev = h?.undo.pop();
    if (prev == null || !h) return;
    h.redo.push(current.text);
    updateText(prev, false);
  };

  const redoEdit = () => {
    if (!current) return;
    if (richActive) {
      mdRef.current?.redo();
      return;
    }
    if (sourceActive) {
      sourceRef.current?.redo();
      return;
    }
    const h = histRef.current[current.path];
    const next = h?.redo.pop();
    if (next == null || !h) return;
    h.undo.push(current.text);
    updateText(next, false);
  };
  editRef.current = {
    undo: undoEdit,
    redo: redoEdit,
    // Both editors own their own history; the custom array is only for the
    // plain fallback, so skip the global handler while a real editor is shown.
    rich: richActive || sourceActive,
  };

  const addToScratchpad = async () => {
    if (!current) return;
    const statusRes = await fetch("/api/vault/status");
    const vault = statusRes.ok ? await statusRes.json() : null;
    if (vault?.needs_setup) {
      setStatus(t("docs_setup_first"));
      return;
    }
    if (vault?.is_locked && vault?.encryption_enabled) {
      setAskPassword(true);
      return;
    }
    await saveNote(current);
  };

  const saveNote = async (doc: OpenDoc, pw?: string) => {
    if (pw) {
      const unlocked = await fetch("/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!unlocked.ok) {
        setStatus(t("docs_bad_password"));
        return;
      }
    }
    const id = crypto.randomUUID();
    const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: textToNoteHtml(doc.text || ""),
        title: titleFrom(doc.name),
        title_custom: true,
      }),
    });
    setAskPassword(false);
    setPassword("");
    if (res.ok) {
      window.electronAPI?.notifyScratchpadChanged?.();
      setStatus(t("docs_added"));
    } else {
      setStatus(t("docs_add_failed"));
    }
  };

  const findCaseRef = useRef(findCase);
  const findRegexRef = useRef(findRegex);
  findCaseRef.current = findCase;
  findRegexRef.current = findRegex;
  const findOpts = (): FindOptions => ({ caseSensitive: findCaseRef.current, regex: findRegexRef.current });

  const replaceCurrent = (all: boolean) => {
    if (!current?.editable || !sourceRef.current || !findQuery.trim()) return;
    const editor = sourceRef.current;
    const source = editor.getValue();
    const hits = findTextMatches(source, findQuery, findOpts());
    if (!hits.length) return;
    if (all) {
      let out = "";
      let last = 0;
      for (const hit of hits) {
        out += source.slice(last, hit.index) + replaceQuery;
        last = hit.index + hit.length;
      }
      out += source.slice(last);
      editor.setValue(out);
      setFindTotal(0);
      requestAnimationFrame(() => findRef.current?.focus());
      return;
    }
    const hit = hits[findAt] ?? hits[0];
    editor.setValue(source.slice(0, hit.index) + replaceQuery + source.slice(hit.index + hit.length));
    setFindAt(0);
    jumpTo(findQuery, 0);
  };

  const jumpTo = (query: string, nth: number) => {
    if (!current) return;
    if (richActive && richReady) {
      const total = mdRef.current?.selectMatch(query, nth, findOpts()) ?? 0;
      setFindTotal(total);
      if (total) setFindAt(((nth % total) + total) % total);
      requestAnimationFrame(() => findRef.current?.focus());
      return;
    }
    if (!sourceRef.current) return;
    const editor = sourceRef.current;
    const hits = findTextMatches(editor.getValue(), query, findOpts());
    setFindTotal(hits.length);
    if (!hits.length) return;
    const at = ((nth % hits.length) + hits.length) % hits.length;
    setFindAt(at);
    const hit = hits[at];
    editor.selectRange(hit.index, hit.index + hit.length);
    editor.scrollToSelection();
    requestAnimationFrame(() => findRef.current?.focus());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "f") {
        if (!currentRef.current?.editable) return;
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findRef.current?.select(), 0);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        const doc = currentRef.current;
        if (!doc?.editable) return;
        e.preventDefault();
        void write(doc, doc.text);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "o") {
        e.preventDefault();
        void window.electronAPI?.pickDocFiles?.().then((paths) => {
          if (paths?.length) void openPathsRef.current(paths);
        });
        return;
      }
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && !editRef.current.rich && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || (key === "z" && e.shiftKey)) editRef.current.redo();
        else editRef.current.undo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [write]);

  const finishClose = async (choice: "save" | "discard" | "cancel") => {
    const ask = closeAsk;
    if (!ask) return;
    if (choice === "cancel") {
      if (ask.then === "window") window.electronAPI?.docsCloseResult?.(false);
      setCloseAsk(null);
      return;
    }
    if (choice === "save") {
      for (const p of ask.paths) {
        const d = docsRef.current.find((x) => x.path === p);
        if (d && d.text !== d.savedText) {
          const ok = await write(d, d.text);
          if (!ok) {
            setCloseAsk(null);
            return;
          }
        }
      }
    }
    setCloseAsk(null);
    if (ask.then === "window") window.electronAPI?.docsCloseResult?.(true);
    else dropDocs(ask.paths);
  };

  const openHistory = async () => {
    if (!current) return;
    const res = await window.electronAPI?.listDocBackups?.(current.path);
    setBackups(res?.items || []);
    setHistoryOpen(true);
  };

  const restoreBackup = async (id: string) => {
    if (!current) return;
    const res = await window.electronAPI?.readDocBackup?.(current.path, id);
    if (res?.ok && typeof res.text === "string") {
      await write(current, res.text);
      setHistoryOpen(false);
    } else {
      setStatus(t("docs_cannot_open"));
    }
  };

  const copyDoc = () => {
    if (!current?.text) return;
    const plain = normalizePastedPlain(current.text) || current.text;
    void copyTextToClipboard(plain, { html: plainToSimpleHtml(plain) });
    setStatus(t("docs_copied"));
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-app, #0a0f1e)", color: "var(--text)" }}>
      <header className="flex items-center gap-3 px-4 h-14 shrink-0">
        <div className="font-semibold">IndexArc</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{t("docs_title")}</div>
      </header>
      <div className="px-4 pb-2 relative">
        <button type="button" className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-xs" style={{ border: "1px solid var(--border)", color: "var(--text)" }} onClick={() => setFilesOpen((v) => !v)}>
          <span>{current ? current.name : t("docs_title")}{current && current.text !== current.savedText ? " •" : ""}</span>
          <span style={{ color: "var(--text-muted)" }}>{docs.length > 1 ? docs.length : ""} ▾</span>
        </button>
        {filesOpen && (
          <div className="absolute z-20 mt-1 w-80 rounded-xl p-1.5 text-xs" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-hover)", boxShadow: "var(--shadow-card)" }}>
            <button type="button" className="w-full text-start px-2 py-1.5 rounded-lg" style={{ color: "var(--accent-bright)" }} onClick={() => { setFilesOpen(false); void window.electronAPI?.pickDocFiles?.().then((paths) => { if (paths?.length) void openPaths(paths); }); }}>{t("docs_open_ellipsis")}</button>
            <div className="px-2 pt-2 pb-1 text-[10px] tracking-wide" style={{ color: "var(--text-muted)" }}>{t("docs_open_header")}</div>
            {docs.length === 0 && <div className="px-2 py-1" style={{ color: "var(--text-muted)" }}>{t("docs_nothing_open")}</div>}
            {docs.map((d) => (
              <div key={d.path} className="flex items-center gap-1 rounded-lg" style={{ background: d.path === current?.path ? "var(--accent-bg)" : "transparent" }}>
                <button type="button" className="flex-1 text-start px-2 py-1.5 truncate" onClick={() => { setActive(d.path); setRichReady(false); setFindOpen(false); setReplaceOpen(false); setExternalChange(false); setFilesOpen(false); }}>{d.name}{d.text !== d.savedText ? " •" : ""}</button>
                <button type="button" aria-label={`${t("docs_close")} ${d.name}`} className="px-2" style={{ color: "var(--text-muted)" }} onClick={() => { setFilesOpen(false); askClose([d.path], "tab"); }}>×</button>
              </div>
            ))}
            <div className="px-2 pt-2 pb-1 text-[10px] tracking-wide" style={{ color: "var(--text-muted)" }}>{t("docs_recent")}</div>
            {recent.filter((r) => !docs.some((d) => d.path === r.path)).length === 0 && <div className="px-2 py-1" style={{ color: "var(--text-muted)" }}>{t("docs_no_earlier")}</div>}
            {recent.filter((r) => !docs.some((d) => d.path === r.path)).map((r) => (
              <button key={r.path} type="button" className="w-full text-start px-2 py-1.5 rounded-lg truncate" title={r.path} onClick={() => { setFilesOpen(false); void openPaths([r.path]); }}>{r.name}</button>
            ))}
          </div>
        )}
      </div>
      {current && (
        <div className="flex items-center gap-2 px-4 pb-3 text-xs">
          <div className="min-w-0">
            <div className="font-medium truncate">{current.name}</div>
            <div className="truncate" style={{ color: "var(--text-muted)" }}>{current.path}</div>
          </div>
          <span style={{ color: current.editable ? (current.text === current.savedText ? "var(--emerald)" : "var(--amber)") : "var(--text-muted)" }}>
            {current.editable ? (current.text === current.savedText ? t("docs_saved") : t("docs_unsaved")) : t("docs_readonly")}
          </span>
          <span className="flex-1" />
          {externalChange && current.editable && (
            <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border-glow)", background: "var(--amber-bg)", color: "var(--amber)" }} onClick={() => void reloadCurrent()}>{t("docs_reload")}</button>
          )}
          {current.editable ? (
            <>
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={undoEdit}>{t("docs_undo")}</button>
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={redoEdit}>{t("docs_redo")}</button>
              <button type="button" className="px-3 py-1 rounded-full" disabled={current.text === current.savedText} style={{ border: "1px solid var(--border)", background: current.text === current.savedText ? "transparent" : "var(--accent)", color: current.text === current.savedText ? "var(--text-muted)" : "#fff" }} onClick={() => void write(current, current.text)}>{t("docs_save")}</button>
              {isMarkdown(current.ext) && (
                <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => { setMode(mode === "rich" ? "source" : "rich"); setRichReady(false); setFindOpen(false); setReplaceOpen(false); }}>{mode === "rich" ? t("docs_source") : t("docs_rich")}</button>
              )}
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => { setFindOpen(true); setTimeout(() => findRef.current?.select(), 0); }}>{t("docs_find")}</button>
              {!(isMarkdown(current.ext) && mode === "rich") && (
                <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => { setReplaceOpen((v) => !v); setFindOpen(true); setTimeout(() => findRef.current?.select(), 0); }}>{t("docs_replace")}</button>
              )}
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={copyDoc}>{t("docs_copy")}</button>
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => void openHistory()}>{t("docs_history")}</button>
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border-glow)", background: "var(--accent-bg)" }} onClick={() => void addToScratchpad()}>{t("docs_add_scratchpad")}</button>
            </>
          ) : null}
        </div>
      )}
      {externalChange && current?.editable && (
        <p className="px-4 pb-2 text-xs" style={{ color: "var(--amber)" }}>{t("docs_external_change")}</p>
      )}
      {findOpen && current && current.editable && (
        <form
          className="mx-4 mb-2 flex items-center gap-2 text-xs"
          onSubmit={(e) => { e.preventDefault(); jumpTo(findQuery, findAt + 1); }}
        >
          <input
            ref={findRef}
            value={findQuery}
            onChange={(e) => { setFindQuery(e.target.value); setFindAt(0); jumpTo(e.target.value, 0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setFindOpen(false); }
              if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); jumpTo(findQuery, findAt - 1); }
            }}
            placeholder={t("docs_find_placeholder")}
            className="app-input flex-1 px-3 py-1"
            autoFocus
          />
          <span style={{ color: "var(--text-muted)" }}>{findQuery.trim() ? `${findTotal ? findAt + 1 : 0} of ${findTotal}` : ""}</span>
          <button type="button" title={t("docs_match_case")} aria-label={t("docs_match_case")} className="px-2 py-1 rounded-lg font-mono" style={{ border: "1px solid var(--border)", background: findCase ? "var(--accent)" : "transparent", color: findCase ? "#fff" : "var(--text-muted)" }} onClick={() => { setFindCase((v) => !v); setFindAt(0); setTimeout(() => jumpTo(findQuery, 0), 0); }}>Aa</button>
          <button type="button" title={t("docs_regex")} aria-label={t("docs_regex")} className="px-2 py-1 rounded-lg font-mono" style={{ border: "1px solid var(--border)", background: findRegex ? "var(--accent)" : "transparent", color: findRegex ? "#fff" : "var(--text-muted)" }} onClick={() => { setFindRegex((v) => !v); setFindAt(0); setTimeout(() => jumpTo(findQuery, 0), 0); }}>.*</button>
          <button type="button" className="px-2 py-1 rounded-lg" style={{ border: "1px solid var(--border)" }} onClick={() => jumpTo(findQuery, findAt - 1)}>{t("docs_prev")}</button>
          <button type="submit" className="px-2 py-1 rounded-lg" style={{ border: "1px solid var(--border)" }}>{t("docs_next")}</button>
          <button type="button" className="px-2 py-1" style={{ color: "var(--text-muted)" }} onClick={() => setFindOpen(false)}>{t("docs_close")}</button>
        </form>
      )}
      {findOpen && replaceOpen && current && current.editable && (
        <div className="mx-4 mb-2 flex items-center gap-2 text-xs">
          <input
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            placeholder={t("docs_replace_placeholder")}
            className="app-input flex-1 px-3 py-1"
          />
          <button type="button" className="px-2 py-1 rounded-lg" style={{ border: "1px solid var(--border)" }} onClick={() => replaceCurrent(false)}>{t("docs_replace")}</button>
          <button type="button" className="px-2 py-1 rounded-lg" style={{ border: "1px solid var(--border)" }} onClick={() => replaceCurrent(true)}>{t("docs_replace_all")}</button>
        </div>
      )}
      <div className="flex-1 min-h-0 mx-4 mb-4 rounded-2xl overflow-hidden flex flex-col" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        {!current && <p className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>{t("docs_empty_hint")}</p>}
        {current && current.ext === ".pdf" && current.pdfUrl && (
          <iframe title={current.name} src={current.pdfUrl} className="w-full h-full" style={{ border: 0 }} />
        )}
        {current && isMarkdown(current.ext) && (
          <div data-doc-scroll className={mode === "rich" ? "h-full overflow-auto" : "hidden"}>
            {!richReady && <pre className="doc-fill" dir="auto">{current.text}</pre>}
            <div className={richReady ? "block" : "hidden"}>
              <MarkdownEditor
                ref={mdRef}
                key={`${current.path}:${mode}:${docEpoch}`}
                value={current.text}
                onChange={(markdown) => updateText(markdown, false)}
                onReady={() => setRichReady(true)}
              />
            </div>
          </div>
        )}
        {sourceActive && (
          <>
            <div className="flex-1 min-h-0" data-doc-scroll>
              <SourceEditor
                ref={sourceRef}
                key={`${current!.path}:${mode}:${docEpoch}`}
                value={current!.text}
                ext={current!.ext}
                normalizePaste={current!.ext === ".txt" || current!.ext === ".text" || (isMarkdown(current!.ext) && mode === "source")}
                onChange={(text) => updateText(text, false)}
                onCaret={(info: CaretInfo) => setCaret(info)}
              />
            </div>
            <div className="shrink-0 px-3 py-1 text-[10px] flex justify-end gap-3" style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <span>Ln {caret.line}, Col {caret.col}</span>
              <span>{caret.count} chars</span>
            </div>
          </>
        )}
      </div>
      {status && <p className="px-4 pb-3 text-xs" style={{ color: "var(--text-muted)" }}>{status}</p>}
      {historyOpen && current && (
        <div className="mx-4 mb-4 rounded-xl p-3 text-xs" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)", maxHeight: "30vh", overflowY: "auto" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold flex-1">{t("docs_history_title")} — {current.name}</span>
            <button type="button" className="px-2 py-1" style={{ color: "var(--text-muted)" }} onClick={() => setHistoryOpen(false)}>{t("docs_close")}</button>
          </div>
          {backups.length === 0 && <p style={{ color: "var(--text-muted)" }}>{t("docs_history_empty")}</p>}
          {backups.map((b) => (
            <div key={b.id} className="flex items-center gap-2 py-1" style={{ borderTop: "1px solid var(--border)" }}>
              <span className="flex-1">{new Date(b.createdAt).toLocaleString()}</span>
              <span style={{ color: "var(--text-muted)" }}>{Math.max(1, Math.round(b.size / 1024))} KB</span>
              <button type="button" className="px-2 py-0.5 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => void restoreBackup(b.id)}>{t("docs_restore")}</button>
            </div>
          ))}
        </div>
      )}
      {closeAsk && (
        <div className="mx-4 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <span className="flex-1">{t("docs_close_ask")} {closeAsk.names.join(", ")}</span>
          <button type="button" className="px-3 py-1 rounded-full" style={{ background: "var(--accent)", color: "#fff" }} onClick={() => void finishClose("save")}>{t("docs_save")}</button>
          <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => void finishClose("discard")}>{t("docs_dont_save")}</button>
          <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => void finishClose("cancel")}>{t("docs_cancel")}</button>
        </div>
      )}
      {askPassword && current && (
        <form className="px-4 pb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveNote(current, password); }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("docs_password_placeholder")} className="app-input px-3 py-1 text-sm" autoFocus />
          <button type="submit" className="px-3 py-1 rounded-full text-xs" style={{ border: "1px solid var(--border)" }}>{t("docs_unlock_add")}</button>
        </form>
      )}
    </div>
  );
}
