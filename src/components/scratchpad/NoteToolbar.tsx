// The Scratchpad's top toolbar. The everyday actions stay visible (the
// note's application, save, copy, detect); AI tools and the rarer note tools
// sit in two menus so the bar stays one clean row.
import React, { useEffect, useState } from "react";
import { AlignJustify, ArrowLeftRight, Check, ChevronDown, Copy, History, KeyRound, LifeBuoy, Loader2, MoreHorizontal, Save, Sparkles, Trash2, Undo2, Wand2, Zap, ZapOff } from "lucide-react";
import type { Busy, RewriteStyle } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";
import { REWRITE_STYLES, REWRITE_STYLE_KEYS } from "./constants";
import { CursorMenu } from "./CursorMenu";

const btn = "h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const ghost: React.CSSProperties = { background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" };
const menuStyle: React.CSSProperties = { background: "var(--bg-surface-solid, var(--bg-surface))", border: "1px solid var(--border-glow)" };
const item = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-start text-xs hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed";

export interface NoteToolbarProps {
  appPicker: React.ReactNode;
  noteApp?: string;
  b: Busy;
  copied: boolean;
  hasSecret: boolean;
  hasText: boolean;
  isProtected: boolean;
  proofreaderOn: boolean;
  enablePredictions: boolean;
  canCompare: boolean;
  canUndoRephrase: boolean;
  style: RewriteStyle;
  setStyle: (s: RewriteStyle) => void;
  onSaveToApp: () => void;
  onSaveSecret: () => void;
  onSaveNote: () => void;
  onCopy: () => void;
  onDetect: () => void;
  onProofread: () => void;
  onRephrase: () => void;
  onUndoRephrase: () => void;
  onFormat: () => void;
  onTogglePredictions: () => void;
  onHistory: () => void;
  onCompare: () => void;
  onRescue: () => void;
  onClear: () => void;
  t: (key: keyof TranslationDict) => string;
}

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
  return { at, open };
}

export function NoteToolbar(p: NoteToolbarProps) {
  const { t, b } = p;
  const ai = useMenu();
  const more = useMenu();
  const aiBusy = b.proofread || b.rewrite;

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {p.appPicker}

      {/* Primary save: into the note's application when it has one. */}
      {p.noteApp ? (
        <button type="button" onClick={p.onSaveToApp} disabled={b.save} className={btn} style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52, 211, 153, 0.25)" }} title={t("notes_save_to_app_title")}>
          {b.save ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
          <span className="max-w-[12rem] truncate">{fill(t("notes_save_to_app"), { app: p.noteApp })}</span>
        </button>
      ) : p.hasSecret ? (
        <button type="button" onClick={p.onSaveSecret} disabled={b.save} className={btn} style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52, 211, 153, 0.2)" }}>
          {b.save ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
          {b.save ? t("scratchpad_saving") : t("scratchpad_save_secret")}
        </button>
      ) : (
        <button type="button" onClick={p.onSaveNote} disabled={b.save} className={btn} style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}>
          {b.save ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {b.save ? t("scratchpad_saving") : t("scratchpad_save_note")}
        </button>
      )}

      <button type="button" onClick={p.onCopy} disabled={!p.hasText} className={btn} style={p.copied ? { ...ghost, color: "var(--emerald)" } : ghost} title={t("notes_copy_all_title")}>
        {p.copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {p.copied ? t("scratchpad_copied") : t("notes_copy_all")}
      </button>

      <button type="button" onClick={p.onDetect} disabled={b.analyze || !p.hasText} className={btn} style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}>
        {b.analyze ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {b.analyze ? t("scratchpad_detecting") : t("scratchpad_detect")}
      </button>

      <div className="w-px h-5 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />

      <button type="button" onClick={ai.open} aria-haspopup="menu" aria-expanded={!!ai.at} className={btn} style={{ ...ghost, color: "var(--amber)" }}>
        {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {b.rewrite ? t("scratchpad_rewriting") : t("notes_ai")}
        <ChevronDown className="w-3 h-3" />
      </button>
      {p.canUndoRephrase && (
        <button type="button" onClick={p.onUndoRephrase} disabled={b.rewrite} className={btn} style={ghost} title={t("scratchpad_rephrase_undo")}>
          <Undo2 className="w-3.5 h-3.5" /> {t("scratchpad_rephrase_undo")}
        </button>
      )}

      <div className="flex-1" />

      <button type="button" onClick={more.open} aria-haspopup="menu" aria-expanded={!!more.at} aria-label={t("notes_more")} title={t("notes_more")} className="h-8 w-8 inline-flex items-center justify-center rounded-lg transition-all cursor-pointer" style={ghost}>
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {ai.at && (
        <CursorMenu x={ai.at.x} y={ai.at.y} className="z-50 rounded-xl shadow-2xl p-1.5 w-64" style={menuStyle}>
          {p.proofreaderOn && !p.isProtected && (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.proofread || !p.hasText} onClick={p.onProofread}>
              <Wand2 className="w-3.5 h-3.5" style={{ color: "var(--amber)" }} /> {t("scratchpad_proofread")}
            </button>
          )}
          <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.rewrite || !p.hasText} onClick={p.onRephrase}>
            <Wand2 className="w-3.5 h-3.5" style={{ color: "var(--accent-bright)" }} />
            <span className="flex-1">{t("scratchpad_rephrase")}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t(REWRITE_STYLE_KEYS[p.style] as keyof TranslationDict) || p.style}</span>
          </button>
          <div className="flex flex-wrap gap-1 px-2.5 pb-1.5 pt-0.5" role="radiogroup" aria-label={t("notes_rephrase_style")} onClick={(e) => e.stopPropagation()}>
            {REWRITE_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={p.style === s}
                onClick={() => p.setStyle(s)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: p.style === s ? "var(--accent-bg)" : "var(--bg-input)", color: p.style === s ? "var(--accent-bright)" : "var(--text-muted)", border: p.style === s ? "1px solid var(--border-glow)" : "1px solid var(--border)" }}
              >
                {t(REWRITE_STYLE_KEYS[s] as keyof TranslationDict) || s}
              </button>
            ))}
          </div>
          {!p.isProtected && (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={!p.hasText} onClick={p.onFormat} title={t("format_paragraphs_title")}>
              <AlignJustify className="w-3.5 h-3.5" style={{ color: "#38bdf8" }} /> {t("format_paragraphs")}
            </button>
          )}
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <button type="button" role="menuitemcheckbox" aria-checked={p.enablePredictions} className={item} style={{ color: "var(--text-dim)" }} onClick={(e) => { e.stopPropagation(); p.onTogglePredictions(); }} title={p.enablePredictions ? t("predictions_enabled_title") : t("predictions_disabled_title")}>
            {p.enablePredictions ? <Zap className="w-3.5 h-3.5" style={{ color: "var(--accent-bright)" }} /> : <ZapOff className="w-3.5 h-3.5" />}
            <span className="flex-1">{t("predictions_label")}</span>
            <strong style={{ color: p.enablePredictions ? "var(--accent-bright)" : "var(--text-muted)" }}>{p.enablePredictions ? t("state_on") : t("state_off")}</strong>
          </button>
        </CursorMenu>
      )}

      {more.at && (
        <CursorMenu x={more.at.x} y={more.at.y} className="z-50 rounded-xl shadow-2xl p-1.5 w-56" style={menuStyle}>
          {p.noteApp && (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.save} onClick={p.hasSecret ? p.onSaveSecret : p.onSaveNote}>
              <Save className="w-3.5 h-3.5" /> {p.hasSecret ? t("scratchpad_save_secret") : t("scratchpad_save_note")}
            </button>
          )}
          <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} onClick={p.onHistory} title={t("scratchpad_history_title")}>
            <History className="w-3.5 h-3.5" /> {t("scratchpad_history")}
          </button>
          <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={!p.canCompare} onClick={p.onCompare} title={t("scratchpad_compare_title")}>
            <ArrowLeftRight className="w-3.5 h-3.5" /> {t("scratchpad_compare")}
          </button>
          <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} onClick={p.onRescue} title={t("scratchpad_rescue_title")}>
            <LifeBuoy className="w-3.5 h-3.5" /> {t("scratchpad_rescue")}
          </button>
          {!p.isProtected && (
            <>
              <div className="my-1 h-px" style={{ background: "var(--border)" }} />
              <button type="button" role="menuitem" className={item} style={{ color: "var(--danger)" }} disabled={!p.hasText} onClick={p.onClear}>
                <Trash2 className="w-3.5 h-3.5" /> {t("scratchpad_clear")}
              </button>
            </>
          )}
        </CursorMenu>
      )}
    </div>
  );
}
