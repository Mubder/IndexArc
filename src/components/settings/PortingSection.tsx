import { useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { TranslationDict } from "../../utils/i18n";

type T = (key: keyof TranslationDict) => string;

interface Candidate {
  value: string;
  name: string;
  type: string;
  family: string;
  labels: string[];
  notes?: string;
}

const field = { background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" } as const;
const card = { background: "var(--bg-surface)", border: "1px solid var(--border)" } as const;
const SAVE_BATCH = 200;

function saveFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Import from .env / Bitwarden / 1Password / KeePass / IndexArc; export .env or encrypted (R6.2). */
export function PortingSection({ t, encrypted }: { t: T; encrypted: boolean }) {
  // Import
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [importPass, setImportPass] = useState("");
  const [preview, setPreview] = useState<{ format: string; candidates: Candidate[]; skipped: Record<string, number> } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importMsg, setImportMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Export
  const [format, setFormat] = useState<"indexarc" | "env">("indexarc");
  const [master, setMaster] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [plainOk, setPlainOk] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  const runPreview = async (f = file, passphrase = importPass) => {
    if (!f) return;
    setImportMsg("");
    setPreview(null);
    const res = await fetch("/api/porting/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: f.text, filename: f.name, passphrase: passphrase || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setImportMsg(data.error || t("failed_generic"));
    setPreview(data);
    setSelected(new Set(data.candidates.map((_: Candidate, i: number) => i)));
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const text = await f.text();
    const next = { name: f.name, text };
    setFile(next);
    setImportPass("");
    await runPreview(next, "");
  };

  const doImport = async () => {
    if (!preview) return;
    setBusy(true);
    setImportMsg("");
    try {
      const items = preview.candidates.filter((_, i) => selected.has(i));
      let saved = 0;
      for (let i = 0; i < items.length; i += SAVE_BATCH) {
        const res = await fetch("/api/entries/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paste_id: `import-${preview.format}`, items: items.slice(i, i + SAVE_BATCH) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t("failed_generic"));
        saved += Array.isArray(data.entries) ? data.entries.length : 0;
      }
      setImportMsg(t("port_imported").replace("{n}", String(saved)));
      setPreview(null);
      setFile(null);
    } catch (e: any) {
      setImportMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    setExportMsg("");
    if (format === "indexarc") {
      if (pass1.length < 12) return setExportMsg(t("port_pass_short"));
      if (pass1 !== pass2) return setExportMsg(t("pw_mismatch"));
    } else if (!plainOk) return setExportMsg(t("port_plain_confirm"));
    const res = await fetch("/api/porting/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, password: master, passphrase: format === "indexarc" ? pass1 : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setExportMsg(data.error || t("failed_generic"));
    saveFile(data.filename, data.content);
    setMaster("");
    setPass1("");
    setPass2("");
    setPlainOk(false);
    setExportMsg(t("port_exported").replace("{n}", String(data.count)));
  };

  const needsPass = !!importMsg && /passphrase/i.test(importMsg);

  return (
    <div id="porting-section" className="space-y-4 rounded-xl p-5 mt-4 scroll-mt-4" style={card}>
      <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("port_title")}</h2>
      {/* Import */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
          <ArrowDownToLine className="w-3.5 h-3.5" /> {t("port_import_title")}
        </h3>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>{t("port_import_desc")}</p>
        <input ref={fileRef} type="file" accept=".env,.txt,.json,.csv,.xml,.iaexport" className="hidden" onChange={onPick} />
        <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
          {t("port_choose_file")}
        </button>
        {file && (needsPass || /\.iaexport$/i.test(file.name)) && !preview && (
          <div className="flex gap-2">
            <input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} placeholder={t("port_passphrase")} aria-label={t("port_passphrase")} className="flex-1 rounded-lg px-3 py-1.5 text-xs" style={field} />
            <button type="button" onClick={() => runPreview()} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent)", color: "white" }}>
              {t("port_open")}
            </button>
          </div>
        )}
        {preview && (
          <div className="space-y-2">
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              {t("port_found").replace("{n}", String(preview.candidates.length)).replace("{format}", preview.format)}
              {Object.entries(preview.skipped).map(([k, v]) => ` · ${k}: ${v}`).join("")}
            </p>
            <ul className="max-h-56 overflow-auto rounded-lg p-2 space-y-1" style={{ border: "1px solid var(--border)" }}>
              {preview.candidates.map((c, i) => (
                <li key={i}>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(i);
                        else s.delete(i);
                        setSelected(s);
                      }}
                    />
                    <span className="truncate" style={{ color: "var(--text)" }}>{c.name}</span>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>{c.type}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" onClick={doImport} disabled={busy || selected.size === 0} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>
              {busy ? "…" : t("port_import_btn").replace("{n}", String(selected.size))}
            </button>
          </div>
        )}
        {importMsg && <p role="status" className="text-[11px]" style={{ color: "var(--text-muted)" }}>{importMsg}</p>}
      </div>

      {/* Export */}
      <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
          <ArrowUpFromLine className="w-3.5 h-3.5" /> {t("port_export_title")}
        </h3>
        <div className="flex gap-3 text-xs" role="radiogroup">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={format === "indexarc"} onChange={() => setFormat("indexarc")} /> {t("port_fmt_encrypted")}
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={format === "env"} onChange={() => setFormat("env")} /> {t("port_fmt_env")}
          </label>
        </div>
        {encrypted && (
          <input type="password" value={master} onChange={(e) => setMaster(e.target.value)} placeholder={t("rk_password_prompt")} aria-label={t("rk_password_prompt")} className="w-full rounded-lg px-3 py-1.5 text-xs" style={field} />
        )}
        {format === "indexarc" ? (
          <div className="flex gap-2">
            <input type="password" value={pass1} onChange={(e) => setPass1(e.target.value)} placeholder={t("port_new_passphrase")} aria-label={t("port_new_passphrase")} className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-xs" style={field} />
            <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder={t("pw_confirm")} aria-label={t("pw_confirm")} className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-xs" style={field} />
          </div>
        ) : (
          <label className="flex items-start gap-2 text-[11px] cursor-pointer" style={{ color: "var(--amber)" }}>
            <input type="checkbox" checked={plainOk} onChange={(e) => setPlainOk(e.target.checked)} className="mt-0.5" />
            <span>{t("port_plain_warning")}</span>
          </label>
        )}
        <button type="button" onClick={doExport} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent)", color: "white" }}>
          {t("port_export_btn")}
        </button>
        {exportMsg && <p role="status" className="text-[11px]" style={{ color: "var(--text-muted)" }}>{exportMsg}</p>}
      </div>
    </div>
  );
}
