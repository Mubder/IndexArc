// Scratchpad ↔ Applications: which application a note belongs to (picker
// chip) and which notes the tab strip shows (filter).
import React, { useCallback, useEffect, useState } from "react";
import { AppWindow, Check, ChevronDown, Layers, Plus } from "lucide-react";
import { normalizeAppName, sameName, summarizeApps } from "../../../shared/apps";
import type { ScratchTab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { CursorMenu } from "./CursorMenu";

type T = (key: keyof TranslationDict) => string;
/** Filter value: every note, notes of no application, or one application's name. */
export const SHOW_ALL = "__all__";
export const SHOW_NONE = "__none__";

/** Application names: those in the vault plus any a note already uses. */
export function useAppNames(tabs: ScratchTab[]): [string[], () => void] {
  const [vault, setVault] = useState<string[]>([]);
  const load = useCallback(() => {
    fetch("/api/entries")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setVault(summarizeApps(Array.isArray(list) ? list : []).map((a) => a.name)))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  const names = [...vault];
  for (const tab of tabs) if (tab.app && !names.some((n) => sameName(n, tab.app))) names.push(tab.app);
  names.sort((a, b) => a.localeCompare(b));
  return [names, load];
}

export function filterTabs(tabs: ScratchTab[], show: string): ScratchTab[] {
  if (show === SHOW_ALL) return tabs;
  if (show === SHOW_NONE) return tabs.filter((x) => !x.app);
  return tabs.filter((x) => sameName(x.app, show));
}

const menuStyle: React.CSSProperties = { background: "var(--bg-surface-solid, var(--bg-surface))", border: "1px solid var(--border-glow)" };
const item = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-start text-xs hover:bg-[var(--bg-hover)]";

function useMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setAt(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [at]);
  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (at) return setAt(null);
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ x: r.left, y: r.bottom + 4 });
  };
  return { at, open, close: () => setAt(null) };
}

/** The application selector at the start of the tab strip: only the chosen application's notes are shown. */
export function NoteFilter({ show, setShow, apps, t }: { show: string; setShow: (v: string) => void; apps: string[]; t: T }) {
  const m = useMenu();
  const label = show === SHOW_ALL ? t("notes_show_all") : show === SHOW_NONE ? t("notes_show_none") : show;
  const pick = (v: string) => {
    setShow(v);
    m.close();
  };
  return (
    <>
      <button
        type="button"
        onClick={m.open}
        aria-haspopup="menu"
        aria-expanded={!!m.at}
        className="note-app-select h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
        style={{ background: show === SHOW_ALL ? "var(--bg-input)" : "var(--accent-bg)", color: show === SHOW_ALL ? "var(--text-dim)" : "var(--accent-bright)", border: show === SHOW_ALL ? "1px solid var(--border)" : "1px solid var(--border-glow)" }}
        title={t("notes_show")}
        aria-label={`${t("notes_show")}: ${label}`}
      >
        {show === SHOW_ALL ? <Layers className="w-3.5 h-3.5" /> : <AppWindow className="w-3.5 h-3.5" />}
        <span className="flex-1 min-w-0 truncate text-start">{label}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>
      {m.at && (
        <CursorMenu x={m.at.x} y={m.at.y} className="z-50 rounded-xl shadow-2xl p-1.5 w-56 max-h-80 overflow-auto" style={menuStyle}>
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("notes_show")}</div>
          <MenuItem on={show === SHOW_ALL} label={t("notes_show_all")} onClick={() => pick(SHOW_ALL)} />
          {apps.length > 0 && <div className="my-1 h-px" style={{ background: "var(--border)" }} />}
          {apps.map((a) => (
            <MenuItem key={a} on={sameName(show, a)} label={a} icon onClick={() => pick(a)} />
          ))}
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <MenuItem on={show === SHOW_NONE} label={t("notes_show_none")} onClick={() => pick(SHOW_NONE)} />
        </CursorMenu>
      )}
    </>
  );
}

/** The note's application chip: shows it, and changes it. */
export function NoteAppPicker({ app, apps, onChange, disabled, t }: { app?: string; apps: string[]; onChange: (app: string | null) => void; disabled?: boolean; t: T }) {
  const m = useMenu();
  const [draft, setDraft] = useState<string | null>(null);
  const pick = (v: string | null) => {
    onChange(v);
    m.close();
    setDraft(null);
  };
  return (
    <>
      <button
        type="button"
        onClick={m.open}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!m.at}
        className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-50"
        style={{ background: app ? "var(--accent-bg)" : "transparent", color: app ? "var(--accent-bright)" : "var(--text-muted)", border: app ? "1px solid var(--border-glow)" : "1px dashed var(--border)" }}
        title={t("notes_app_title")}
      >
        <AppWindow className="w-3.5 h-3.5 shrink-0" />
        <span className="max-w-[9rem] truncate">{app || t("notes_app_none")}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {m.at && (
        <CursorMenu x={m.at.x} y={m.at.y} className="z-50 rounded-xl shadow-2xl p-1.5 w-60 max-h-80 overflow-auto" style={menuStyle}>
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("notes_app_title")}</div>
          {apps.map((a) => (
            <MenuItem key={a} on={sameName(app, a)} label={a} icon onClick={() => pick(a)} />
          ))}
          {draft === null ? (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} onClick={(e) => { e.stopPropagation(); setDraft(""); }}>
              <Plus className="w-3.5 h-3.5" /> {t("apps_new")}
            </button>
          ) : (
            <form className="px-1 py-1" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); const n = normalizeAppName(draft); if (n) pick(n); }}>
              <input autoFocus className="app-input w-full text-xs px-2 py-1" placeholder={t("apps_name_placeholder")} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} />
            </form>
          )}
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <MenuItem on={!app} label={t("notes_app_none")} onClick={() => pick(null)} />
        </CursorMenu>
      )}
    </>
  );
}

function MenuItem({ on, label, onClick, icon }: { on: boolean; label: string; onClick: () => void; icon?: boolean }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} className={item} style={{ color: on ? "var(--accent-bright)" : "var(--text-dim)" }} onClick={onClick}>
      {icon ? <AppWindow className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5" />}
      <span className="flex-1 truncate">{label}</span>
      {on && <Check className="w-3.5 h-3.5" />}
    </button>
  );
}
