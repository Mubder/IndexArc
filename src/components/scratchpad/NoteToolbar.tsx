// Note actions live on the right of the writing bar: the scratchpad keeps
// itself (Saved), filing a copy is Save as note, Copy is the words, and
// everything else is the ··· menu.
import React, { useEffect, useState } from "react";
import { AlignJustify, ArrowLeftRight, Check, Copy, History, KeyRound, LifeBuoy, Loader2, MoreHorizontal, Save, Sparkles, Trash2, Undo2, Wand2, Zap, ZapOff } from "lucide-react";
import type { Busy, RewriteStyle } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";
import { REWRITE_STYLES, REWRITE_STYLE_KEYS } from "./constants";
import { CursorMenu } from "./CursorMenu";

const quiet = "quiet-btn inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const menuStyle: React.CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border-hover)", boxShadow: "var(--shadow-card)" };
const item = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-start text-xs hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed";
const heading = "px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wide";

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
    setAt({ x: r.right - 230, y: r.bottom + 4 });
  };
  return { at, open };
}

export function NoteToolbar(p: NoteToolbarProps) {
  const { t, b } = p;
  const more = useMenu();
  const saveLabel = p.noteApp
    ? fill(t("notes_save_to_app"), { app: p.noteApp })
    : p.hasSecret
      ? t("scratchpad_save_secret")
      : t("scratchpad_save_note");
  const onSave = p.noteApp ? p.onSaveToApp : p.hasSecret ? p.onSaveSecret : p.onSaveNote;

  return (
    <div className="editor-note-actions">
      {p.appPicker}
      <span className="text-xs" style={{ color: "var(--emerald)" }}>{b.save ? t("scratchpad_saving") : t("scratchpad_kept")}</span>
      <button type="button" className={quiet} onClick={onSave} disabled={b.save} title={saveLabel}>
        {b.save ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : p.noteApp || p.hasSecret ? <KeyRound className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
        <span className="max-w-[10rem] truncate">{saveLabel}</span>
      </button>
      <button type="button" className={quiet} onClick={p.onCopy} disabled={!p.hasText} title={t("notes_copy_all_title")}>
        {p.copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {p.copied ? t("scratchpad_copied") : t("notes_copy_all")}
      </button>
      <button type="button" className={quiet} onClick={more.open} aria-haspopup="menu" aria-expanded={!!more.at} aria-label={t("notes_more")} title={t("notes_more")}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {more.at && (
        <CursorMenu x={more.at.x} y={more.at.y} className="z-50 rounded-xl p-1.5 w-56" style={menuStyle}>
          <div className={heading} style={{ color: "var(--text-muted)" }}>{t("scratchpad_detect")}</div>
          <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.analyze || !p.hasText} onClick={p.onDetect}>
            <Sparkles className="w-3.5 h-3.5" /> {t("scratchpad_detect")}
          </button>
          {p.proofreaderOn && !p.isProtected && (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.proofread || !p.hasText} onClick={p.onProofread}>
              <Wand2 className="w-3.5 h-3.5" /> {b.proofread ? t("scratchpad_proofreading") : t("scratchpad_proofread")}
            </button>
          )}
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <div className={heading} style={{ color: "var(--text-muted)" }}>{t("scratchpad_rephrase")}</div>
          <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.rewrite || !p.hasText} onClick={p.onRephrase}>
            <Wand2 className="w-3.5 h-3.5" />
            <span className="flex-1">{b.rewrite ? t("scratchpad_rewriting") : t("scratchpad_rephrase")}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t(REWRITE_STYLE_KEYS[p.style] as keyof TranslationDict) || p.style}</span>
          </button>
          <div className="flex flex-wrap gap-1 px-2.5 pb-1.5" role="radiogroup" aria-label={t("notes_rephrase_style")} onClick={(e) => e.stopPropagation()}>
            {REWRITE_STYLES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={p.style === s} onClick={() => p.setStyle(s)} className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: p.style === s ? "var(--accent-bg)" : "var(--bg-input)", color: p.style === s ? "var(--accent-bright)" : "var(--text-muted)", border: `1px solid ${p.style === s ? "var(--border-hover)" : "var(--border)"}` }}>
                {t(REWRITE_STYLE_KEYS[s] as keyof TranslationDict) || s}
              </button>
            ))}
          </div>
          {p.canUndoRephrase && (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={b.rewrite} onClick={p.onUndoRephrase}>
              <Undo2 className="w-3.5 h-3.5" /> {t("scratchpad_rephrase_undo")}
            </button>
          )}
          {!p.isProtected && (
            <button type="button" role="menuitem" className={item} style={{ color: "var(--text-dim)" }} disabled={!p.hasText} onClick={p.onFormat} title={t("format_paragraphs_title")}>
              <AlignJustify className="w-3.5 h-3.5" /> {t("format_paragraphs")}
            </button>
          )}
          <button type="button" role="menuitemcheckbox" aria-checked={p.enablePredictions} className={item} style={{ color: "var(--text-dim)" }} onClick={(e) => { e.stopPropagation(); p.onTogglePredictions(); }}>
            {p.enablePredictions ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
            <span className="flex-1">{t("predictions_label")}</span>
            <strong style={{ color: p.enablePredictions ? "var(--accent-bright)" : "var(--text-muted)" }}>{p.enablePredictions ? t("state_on") : t("state_off")}</strong>
          </button>
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
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
