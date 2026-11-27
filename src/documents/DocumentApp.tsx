import { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../lib/clipboard";
import { normalizePastedPlain, plainToSimpleHtml } from "../lib/clipboardText";
import { textToNoteHtml } from "../sanitize";
import { MarkdownEditor } from "./MarkdownEditor";

interface OpenDoc {
  path: string;
  name: string;
  ext: string;
  editable: boolean;
  text: string;
  savedText: string;
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
  const docsRef = useRef<OpenDoc[]>([]);
  docsRef.current = docs;

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
  const saveTimers = useRef<Record<string, number>>({});

  const openPaths = useCallback(async (paths: string[]) => {
    const api = window.electronAPI;
    if (!api?.readDocFile) return;
    for (const p of paths) {
      const payload = await api.readDocFile(p);
      if (!payload?.ok || !payload.path) {
        setStatus(payload?.reason ? `Could not open that file (${payload.reason}).` : "That file cannot be opened here.");
        continue;
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
        };
        const without = prev.filter((d) => d.path !== next.path);
        return [...without, next];
      });
      setActive(payload.path);
      setMode("rich");
      setRichReady(false);
    }
  }, []);

  const closeDoc = (path: string) => {
    const next = docs.filter((d) => d.path !== path);
    setDocs(next);
    if (active === path) setActive(next[0]?.path || "");
  };

  useEffect(() => {
    const api = window.electronAPI;
    void api?.takePendingDocs?.().then((paths) => { if (paths?.length) void openPaths(paths); });
    api?.onDocsOpen?.((paths) => { if (paths?.length) void openPaths(paths); });
  }, [openPaths]);

  const write = useCallback(async (doc: OpenDoc, text: string) => {
    const res = await window.electronAPI?.writeDocFile?.(doc.path, text);
    if (!res?.ok) {
      setStatus("Save failed.");
      return false;
    }
    setDocs((prev) => prev.map((d) => (d.path === doc.path && d.text === text ? { ...d, savedText: text } : d)));
    setStatus("Saved");
    return true;
  }, []);

  const scheduleSave = useCallback((doc: OpenDoc, text: string) => {
    const prev = saveTimers.current[doc.path];
    if (prev) window.clearTimeout(prev);
    saveTimers.current[doc.path] = window.setTimeout(() => { void write(doc, text); }, 700);
  }, [write]);

  useEffect(() => {
    const flush = () => {
      for (const d of docsRef.current) {
        if (d.editable && d.text !== d.savedText) window.electronAPI?.writeDocFileSync?.(d.path, d.text);
      }
    };
    window.addEventListener("beforeunload", flush);
    window.electronAPI?.onDocsRequestClose?.(() => {
      const dirty = docsRef.current.filter((d) => d.editable && d.text !== d.savedText);
      if (!dirty.length) {
        window.electronAPI?.docsCloseResult?.(true);
        return;
      }
      const ok = window.confirm("Save changes to the open files before closing?");
      if (!ok) {
        window.electronAPI?.docsCloseResult?.(false);
        return;
      }
      for (const d of dirty) window.electronAPI?.writeDocFileSync?.(d.path, d.text);
      window.electronAPI?.docsCloseResult?.(true);
    });
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  const current = docs.find((d) => d.path === active) || docs[0];

  const updateText = (text: string) => {
    if (!current || !current.editable) return;
    setDocs((prev) => prev.map((d) => (d.path === current.path ? { ...d, text } : d)));
    scheduleSave({ ...current, text }, text);
  };

  const addToScratchpad = async () => {
    if (!current) return;
    const statusRes = await fetch("/api/vault/status");
    const vault = statusRes.ok ? await statusRes.json() : null;
    if (vault?.needs_setup) {
      setStatus("Create the master password in the vault window first.");
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
        setStatus("Password was not accepted.");
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
      setStatus("Added to the scratchpad. The file itself is unchanged.");
    } else {
      setStatus("Could not add the note.");
    }
  };

  const copyDoc = () => {
    if (!current?.text) return;
    const plain = normalizePastedPlain(current.text) || current.text;
    void copyTextToClipboard(plain, { html: plainToSimpleHtml(plain) });
    setStatus("Copied");
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-app, #0a0f1e)", color: "var(--text)" }}>
      <header className="flex items-center gap-3 px-4 h-14 shrink-0">
        <div className="font-semibold">IndexArc</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Files</div>
      </header>
      <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
        {docs.map((d) => (
          <span key={d.path} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs" style={{ border: "1px solid var(--border)", background: d.path === current?.path ? "var(--accent-bg)" : "transparent", color: "var(--text)" }}>
            <button type="button" onClick={() => { setActive(d.path); setRichReady(false); }}>{d.name}{d.editable && d.text !== d.savedText ? " •" : ""}</button>
            <button type="button" aria-label={`Close ${d.name}`} onClick={() => closeDoc(d.path)} className="px-1" style={{ color: "var(--text-muted)" }}>×</button>
          </span>
        ))}
      </div>
      {current && (
        <div className="flex items-center gap-2 px-4 pb-3 text-xs">
          <div className="min-w-0">
            <div className="font-medium truncate">{current.name}</div>
            <div className="truncate" style={{ color: "var(--text-muted)" }}>{current.path}</div>
          </div>
          <span style={{ color: current.text === current.savedText ? "var(--emerald)" : "var(--amber)" }}>
            {current.editable ? (current.text === current.savedText ? "Saved" : "Saving") : "Read only"}
          </span>
          <span className="flex-1" />
          {current.ext === ".md" || current.ext === ".markdown" ? (
            <>
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => setMode("rich")}>Rich</button>
              <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={() => setMode("source")}>Source</button>
            </>
          ) : null}
          <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border)" }} onClick={copyDoc}>Copy</button>
          <button type="button" className="px-3 py-1 rounded-full" style={{ border: "1px solid var(--border-glow)", background: "var(--accent-bg)" }} onClick={() => void addToScratchpad()}>Add to scratchpad</button>
        </div>
      )}
      <div className="flex-1 min-h-0 mx-4 mb-4 rounded-2xl overflow-hidden flex flex-col" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        {!current && <p className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Open a markdown, JSON, YAML, or other text file.</p>}
        {current && (current.ext === ".md" || current.ext === ".markdown") && (
          <div className={mode === "rich" ? "block h-full overflow-auto" : "hidden"}>
            {!richReady && <pre className="doc-fill" dir="auto">{current.text}</pre>}
            <div className={richReady ? "block" : "hidden"}>
              <MarkdownEditor key={current.path} value={current.savedText} onChange={updateText} onReady={() => setRichReady(true)} />
            </div>
          </div>
        )}
        {current && current.editable && (mode === "source" || (current.ext !== ".md" && current.ext !== ".markdown")) && (
          <textarea
            value={current.text}
            dir="auto"
            spellCheck={false}
            onChange={(e) => updateText(e.target.value)}
            onPaste={(e) => {
              const incoming = e.clipboardData?.getData("text/plain");
              if (!incoming || (current.ext !== ".txt" && current.ext !== ".text" && mode !== "source")) return;
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.selectionStart ?? current.text.length;
              const end = el.selectionEnd ?? current.text.length;
              const norm = normalizePastedPlain(incoming);
              const next = current.text.slice(0, start) + norm + current.text.slice(end);
              updateText(next);
            }}
            className="w-full h-full min-h-[70vh] p-8 bg-transparent outline-none resize-none"
            style={{ fontFamily: current.ext === ".txt" || current.ext === ".text" ? "var(--font-sans)" : "var(--font-mono)", color: "var(--text)" }}
          />
        )}
      </div>
      {status && <p className="px-4 pb-3 text-xs" style={{ color: "var(--text-muted)" }}>{status}</p>}
      {askPassword && current && (
        <form className="px-4 pb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveNote(current, password); }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Master password" className="app-input px-3 py-1 text-sm" autoFocus />
          <button type="submit" className="px-3 py-1 rounded-full text-xs" style={{ border: "1px solid var(--border)" }}>Unlock and add</button>
        </form>
      )}
    </div>
  );
}
