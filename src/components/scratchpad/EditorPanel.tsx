import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Busy, NoteBidiMode, ScratchTab, Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";
import type { Editor } from "@tiptap/react";
import type { SpellRect } from "./domText";
import { Loader2, KeyRound, Save, Copy, Trash2, Sparkles, Wand2, Zap, ZapOff, AlignJustify, History, ArrowLeftRight, LifeBuoy, Undo2, Bold, Italic, Underline, Highlighter, BookPlus, EyeOff, ArrowUp, ArrowDown } from "lucide-react";
import { htmlToPlainText } from "../../lib/noteHtml";
import { RewriteStyle } from "../../types";
import { REWRITE_STYLES, REWRITE_STYLE_KEYS } from "./constants";
import { getTranslation } from "../../utils/i18n";
import React from "react";
import { safeGetHTML } from "./domText";
import { CursorMenu } from "./CursorMenu";
import { EditorContent } from "@tiptap/react";

export interface EditorPanelProps {
  active: ScratchTab;
  activeCharCount: number;
  activeId: string;
  activeIsPinned: boolean;
  activeIsProtected: boolean;
  activeReadingTime: number;
  activeWordCount: number;
  analyze: (id: string, content: string) => Promise<void>;
  b: Busy;
  bidiMode: NoteBidiMode;
  canScrollDown: boolean;
  canScrollUp: boolean;
  contextMenu: { x: number; y: number; word: string; range: Range | null; suggestions: string[]; loading: boolean; } | null;
  copied: boolean;
  detectedDir: "ltr" | "rtl";
  enablePredictions: boolean;
  ghostCompletion: string;
  handleAddToDictionary: (word: string) => Promise<void>;
  handleApplySuggestion: (replacement: string) => void;
  handleCopy: () => Promise<void>;
  handleIgnoreWord: (word: string) => Promise<void>;
  handleOpenRevisions: () => Promise<void>;
  handleProofread: () => Promise<void>;
  handleRephrase: () => Promise<void>;
  handleSaveNote: () => Promise<void>;
  handleSaveSecret: () => Promise<void>;
  handleSmartSplitParagraphs: () => void;
  handleUndoRephrase: () => void;
  hasSecret: boolean;
  highlightColor: string;
  noteFontSize: number;
  noteOverflows: boolean;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  openCompare: () => void;
  openRescue: () => Promise<void>;
  recordSnapshot: (tabId: string, content: string, reason?: string | undefined) => Promise<void>;
  rephraseUndo: Record<string, string[]>;
  scrollEditor: (direction: "top" | "bottom") => void;
  setContent: (id: string, content: string) => void;
  setContextMenu: Dispatch<SetStateAction<{ x: number; y: number; word: string; range: Range | null; suggestions: string[]; loading: boolean; } | null>>;
  setGhostCompletion: Dispatch<SetStateAction<string>>;
  setProtectConfirmInput: Dispatch<SetStateAction<string>>;
  setProtectError: Dispatch<SetStateAction<string>>;
  setProtectModal: Dispatch<SetStateAction<{ mode: "on" | "off"; tabId: string; } | null>>;
  setSlashOpen: Dispatch<SetStateAction<boolean>>;
  setStyle: Dispatch<SetStateAction<RewriteStyle>>;
  settings: Settings | null;
  shellRef: RefObject<HTMLDivElement | null>;
  slashOpen: boolean;
  spellRects: SpellRect[];
  statusMsg: string;
  style: RewriteStyle;
  t: (key: keyof TranslationDict) => string;
  tabs: ScratchTab[];
  tiptap: Editor;
  togglePin: () => Promise<void>;
  togglePredictions: () => void;
  triggerAutocomplete: (prefixText: string) => void;
}

export function EditorPanel({ active, activeCharCount, activeId, activeIsPinned, activeIsProtected, activeReadingTime, activeWordCount, analyze, b, bidiMode, canScrollDown, canScrollUp, contextMenu, copied, detectedDir, enablePredictions, ghostCompletion, handleAddToDictionary, handleApplySuggestion, handleCopy, handleIgnoreWord, handleOpenRevisions, handleProofread, handleRephrase, handleSaveNote, handleSaveSecret, handleSmartSplitParagraphs, handleUndoRephrase, hasSecret, highlightColor, noteFontSize, noteOverflows, onContextMenu, onKeyDown, openCompare, openRescue, recordSnapshot, rephraseUndo, scrollEditor, setContent, setContextMenu, setGhostCompletion, setProtectConfirmInput, setProtectError, setProtectModal, setSlashOpen, setStyle, settings, shellRef, slashOpen, spellRects, statusMsg, style, t, tabs, tiptap, togglePin, togglePredictions, triggerAutocomplete }: EditorPanelProps) {
  return (
    <>
        {/* Toolbar — grouped action clusters with uniform button sizing:
            Note | AI | Tools …(spacer)… Rephrase. Groups stay together when
            the bar wraps; every control is h-8 so the row stays aligned. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {/* ── Note actions ── */}
          <div className="flex items-center gap-1.5">
            {hasSecret ? (
              <button
                type="button"
                onClick={handleSaveSecret}
                disabled={b.save}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52, 211, 153, 0.2)" }}
              >
                {b.save ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 shrink-0" />}
                {b.save ? t("scratchpad_saving") : t("scratchpad_save_secret")}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={b.save}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
              >
                {b.save ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Save className="w-3.5 h-3.5 shrink-0" />}
                {b.save ? t("scratchpad_saving") : t("scratchpad_save_note")}
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer"
              style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              <Copy className="w-3.5 h-3.5 shrink-0" />
              {copied ? t("scratchpad_copied") : t("scratchpad_copy")}
            </button>
            {!activeIsProtected && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("confirm_clear_note"))) {
                    recordSnapshot(activeId, active?.content || "", "Before Clear");
                    setContent(activeId, "");
                  }
                }}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer"
                style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                {t("scratchpad_clear")}
              </button>
            )}
          </div>

          <div className="w-px h-5 shrink-0" style={{ background: "var(--border)" }} />

          {/* ── AI actions ── */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => analyze(activeId, htmlToPlainText(active?.content || ""))}
              disabled={b.analyze || !htmlToPlainText(active?.content || "").trim()}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
            >
              {b.analyze ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 shrink-0" />}
              {b.analyze ? t("scratchpad_detecting") : t("scratchpad_detect")}
            </button>
            {settings?.enable_ai_proofreader !== false && !activeIsProtected && (
              <button
                type="button"
                onClick={handleProofread}
                disabled={b.proofread || !(active?.content || "").trim()}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "transparent", color: "var(--amber)", border: "1px solid rgba(245, 158, 11, 0.2)" }}
                title={t("scratchpad_proofread")}
              >
                {b.proofread ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 shrink-0" />}
                {t("scratchpad_proofread")}
              </button>
            )}
            <button
              type="button"
              onClick={togglePredictions}
              title={enablePredictions ? t("predictions_enabled_title") : t("predictions_disabled_title")}
              aria-pressed={enablePredictions}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer"
              style={{
                background: enablePredictions ? "rgba(99, 102, 241, 0.15)" : "transparent",
                color: enablePredictions ? "var(--accent-bright)" : "var(--text-muted)",
                border: `1px solid ${enablePredictions ? "rgba(99, 102, 241, 0.4)" : "var(--border)"}`,
              }}
            >
              {enablePredictions ? <Zap className="w-3.5 h-3.5 shrink-0" /> : <ZapOff className="w-3.5 h-3.5 shrink-0" />}
              <span>{t("predictions_label")}: <strong>{enablePredictions ? t("state_on") : t("state_off")}</strong></span>
            </button>
          </div>

          <div className="w-px h-5 shrink-0" style={{ background: "var(--border)" }} />

          {/* ── Note tools ── */}
          <div className="flex items-center gap-1.5">
            {!activeIsProtected && (
              <button
                type="button"
                onClick={handleSmartSplitParagraphs}
                disabled={!(active?.content || "").trim()}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "rgba(56, 189, 248, 0.1)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.3)" }}
                title={t("format_paragraphs_title")}
              >
                <AlignJustify className="w-3.5 h-3.5 shrink-0" />
                <span>{t("format_paragraphs")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenRevisions}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer"
              style={{ background: "rgba(245, 158, 11, 0.12)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.3)" }}
              title={t("scratchpad_history_title")}
            >
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>{t("scratchpad_history")}</span>
            </button>
            <button
              type="button"
              onClick={openCompare}
              disabled={tabs.length < 2}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "rgba(99, 102, 241, 0.12)", color: "#a5b4fc", border: "1px solid rgba(99, 102, 241, 0.3)" }}
              title={t("scratchpad_compare_title")}
            >
              <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
              <span>{t("scratchpad_compare")}</span>
            </button>
            <button
              type="button"
              onClick={openRescue}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer"
              style={{ background: "rgba(52, 211, 153, 0.12)", color: "#6ee7b7", border: "1px solid rgba(52, 211, 153, 0.3)" }}
              title={t("scratchpad_rescue_title")}
            >
              <LifeBuoy className="w-3.5 h-3.5 shrink-0" />
              <span>{t("scratchpad_rescue")}</span>
            </button>
          </div>

          <div className="flex-1" />

          {/* ── Rephrase (right side) ── */}
          <div className="flex items-center gap-1.5">
            {(rephraseUndo[activeId]?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={handleUndoRephrase}
                disabled={b.rewrite}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                title={t("scratchpad_rephrase_undo")}
              >
                <Undo2 className="w-3.5 h-3.5 shrink-0" />
                {t("scratchpad_rephrase_undo")}
              </button>
            )}
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as RewriteStyle)}
              className="h-8 rounded-lg px-2.5 text-xs font-medium focus:outline-none cursor-pointer"
              style={{
                background: "var(--bg-input, #18181b)",
                border: "1px solid var(--border, #3f3f46)",
                color: "var(--text, #ffffff)",
              }}
            >
              {REWRITE_STYLES.map((s) => (
                <option
                  key={s}
                  value={s}
                  style={{
                    backgroundColor: "#18181b",
                    color: "#ffffff",
                  }}
                >
                  {t(REWRITE_STYLE_KEYS[s] as Parameters<typeof getTranslation>[1]) || s}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRephrase}
              disabled={b.rewrite || !(active?.content || "").trim()}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--bg-active)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
            >
              {b.rewrite ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 shrink-0" />}
              {b.rewrite ? t("scratchpad_rewriting") : t("scratchpad_rephrase")}
            </button>
          </div>
        </div>

        {statusMsg && (
          <p className="text-xs" style={{ color: "var(--accent-bright)" }}>
            {statusMsg}
          </p>
        )}

        <div
          ref={shellRef}
          className="note-editor-shell"
          style={
            {
              ["--note-font-size" as string]: `${noteFontSize}px`,
            } as React.CSSProperties
          }
        >
          {/* Frame is height-locked to the viewport. Jump FABs pin to its
              top/bottom corners so they stay reachable on very long notes. */}
          <div className="note-editor-frame">
            {tiptap ? (
              <div
                onContextMenu={onContextMenu}
                onKeyDown={onKeyDown}
                onPaste={() => {
                  // Insertion itself is handled by ProseMirror (see
                  // editorProps.handlePaste for plain-text mode) — this only
                  // triggers AI detection after the paste lands.
                  setTimeout(() => { try { analyze(activeId, safeGetHTML(tiptap)); } catch {} }, 80);
                }}
                className="relative w-full"
              >
                <EditorContent editor={tiptap} className="note-editor-wrap" />
                {tiptap && !tiptap.state.selection.empty && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 p-1 rounded-full" style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border-glow)", boxShadow: "0 8px 24px rgba(0,0,0,0.22)" }}>
                    <button type="button" onClick={() => tiptap.chain().focus().toggleBold().run()} className="p-1.5 rounded-full" style={{ background: tiptap.isActive("bold") ? "var(--accent)" : "transparent", color: tiptap.isActive("bold") ? "#fff" : "var(--text-muted)" }} title={t("scratchpad_bold")}><Bold className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => tiptap.chain().focus().toggleItalic().run()} className="p-1.5 rounded-full" style={{ background: tiptap.isActive("italic") ? "var(--accent)" : "transparent", color: tiptap.isActive("italic") ? "#fff" : "var(--text-muted)" }} title={t("scratchpad_italic")}><Italic className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => tiptap.chain().focus().toggleUnderline().run()} className="p-1.5 rounded-full" style={{ background: tiptap.isActive("underline") ? "var(--accent)" : "transparent", color: tiptap.isActive("underline") ? "#fff" : "var(--text-muted)" }} title={t("scratchpad_underline")}><Underline className="w-3.5 h-3.5" /></button>
                    <span className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
                    <button type="button" onClick={() => tiptap.chain().focus().toggleHighlight({ color: highlightColor }).run()} className="p-1.5 rounded-full" style={{ color: "var(--text-dim)" }} title={t("scratchpad_highlight")}><Highlighter className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {slashOpen && (
                  <div className="absolute left-3 bottom-14 z-20 flex flex-col gap-1 p-1.5 rounded-xl shadow-2xl" style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border-glow)", minWidth: 180 }}>
                    <div className="px-2 py-1 text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>{t("slash_commands_hint")}</div>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleHeading({ level: 1 }).run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs flex items-center gap-2" style={{ color: "var(--text)" }}><span className="font-bold">H1</span> {t("slash_heading_1")}</button>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleHeading({ level: 2 }).run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs flex items-center gap-2" style={{ color: "var(--text)" }}><span className="font-bold">H2</span> {t("slash_heading_2")}</button>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleBulletList().run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs" style={{ color: "var(--text)" }}>• {t("slash_bullet_list")}</button>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleBlockquote().run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs" style={{ color: "var(--text)" }}>❝ {t("slash_quote")}</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="note-editor relative z-10 w-full p-4 text-sm" style={{ color: "var(--text-muted)" }}>
                {t("loading_editor")}
              </div>
            )}
            {spellRects.length > 0 && (
              <div
                aria-hidden="true"
                className="spell-rect-layer"
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 15,
                  pointerEvents: "none",
                  overflow: "hidden",
                  borderRadius: "0.75rem",
                }}
              >
                {spellRects.map((r) => (
                  <span
                    key={r.key}
                    className="spell-rect-underline"
                    style={{
                      position: "absolute",
                      top: r.top + r.height - 3,
                      left: r.left,
                      width: r.width,
                      height: 3,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Non-intrusive floating prediction overlay badge (Zero DOM mutations) */}
            {ghostCompletion && enablePredictions && (
              <div
                className="absolute bottom-3 right-4 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95 pointer-events-auto"
                style={{
                  background: "rgba(15, 23, 42, 0.92)",
                  border: "1px solid rgba(99, 102, 241, 0.4)",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
                }}
              >
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-muted">{t("prediction_label")}:</span>
                <span className="font-medium text-white italic">{ghostCompletion}</span>
                <button
                  type="button"
                  onClick={() => {
                    // ProseMirror transaction, not raw DOM insertNode — see
                    // handleApplySuggestion for why that duplicates text and
                    // why the legacy onEditorInput must not run afterwards.
                    const view = tiptap && !tiptap.isDestroyed ? tiptap.view : null;
                    if (view) {
                      try {
                        view.dispatch(view.state.tr.insertText(" " + ghostCompletion));
                        triggerAutocomplete(tiptap.getText());
                      } catch {}
                      setGhostCompletion("");
                    }
                  }}
                  className="ml-1 px-2 py-0.5 rounded font-mono text-[10px] font-bold hover:brightness-125 transition-all cursor-pointer"
                  style={{
                    background: "rgba(99, 102, 241, 0.25)",
                    border: "1px solid rgba(99, 102, 241, 0.5)",
                    color: "var(--accent-bright)",
                  }}
                >
                  Tab ↹ {t("prediction_accept")}
                </button>
                <button
                  type="button"
                  onClick={() => setGhostCompletion("")}
                  className="text-muted hover:text-white text-xs px-1 cursor-pointer"
                  title={t("dismiss_btn")}
                  aria-label={t("dismiss_btn")}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Custom Spelling Context Menu Popup */}
            {contextMenu && (
              <CursorMenu
                x={contextMenu.x}
                y={contextMenu.y}
                className="z-50 rounded-xl shadow-2xl p-2 w-64 space-y-1 text-xs backdrop-blur-md animate-in fade-in zoom-in-95"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-glow)",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
                }}
              >
                <div className="px-2 py-1 font-semibold text-muted border-b border-border flex items-center justify-between">
                  <span>{t("spell_label")}: <strong className="text-white">{contextMenu.word}</strong></span>
                  <button onClick={() => setContextMenu(null)} className="opacity-60 hover:opacity-100" aria-label={t("close_btn")}>✕</button>
                </div>

                {contextMenu.loading ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-muted italic">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-bright" />
                    <span>{t("spell_finding")}</span>
                  </div>
                ) : contextMenu.suggestions.length > 0 ? (
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {contextMenu.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleApplySuggestion(s)}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg hover:text-accent-bright font-medium transition-colors flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3 h-3 text-amber" />
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1 text-muted italic">{t("spell_no_suggestions")}</p>
                )}

                <div className="border-t border-border pt-1 space-y-0.5">
                  <button
                    onClick={() => handleAddToDictionary(contextMenu.word)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-highlight hover:text-emerald font-medium transition-colors flex items-center gap-1.5"
                  >
                    <BookPlus className="w-3.5 h-3.5 text-emerald" />
                    {fill(t("spell_add_to_dict"), { word: contextMenu.word })}
                  </button>

                  <button
                    onClick={() => handleIgnoreWord(contextMenu.word)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-highlight hover:text-muted font-medium transition-colors flex items-center gap-1.5"
                  >
                    <EyeOff className="w-3.5 h-3.5 text-muted" />
                    {fill(t("spell_ignore"), { word: contextMenu.word })}
                  </button>
                </div>
              </CursorMenu>
            )}
            {/* Always-visible corners of the editor frame (not mid-document). */}
            {noteOverflows && (
              <>
                <button
                  type="button"
                  onClick={() => scrollEditor("top")}
                  className={`note-jump-btn note-jump-btn--top p-2 transition-all hover:opacity-100 ${
                    canScrollUp ? "opacity-95" : "opacity-50"
                  }`}
                  style={{
                    background: "var(--bg-surface-solid)",
                    color: "var(--accent-bright)",
                    border: "1px solid var(--border-glow)",
                  }}
                  title={t("scratchpad_go_to_top")}
                  aria-label={t("scratchpad_go_to_top")}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollEditor("bottom")}
                  className={`note-jump-btn note-jump-btn--bottom p-2 transition-all hover:opacity-100 ${
                    canScrollDown ? "opacity-95" : "opacity-50"
                  }`}
                  style={{
                    background: "var(--bg-surface-solid)",
                    color: "var(--accent-bright)",
                    border: "1px solid var(--border-glow)",
                  }}
                  title={t("scratchpad_go_to_bottom")}
                  aria-label={t("scratchpad_go_to_bottom")}
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Pro Status Bar */}
          <div className="editor-status-bar select-none">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <strong className="text-white tabular-nums">{activeWordCount}</strong>
                <span className="opacity-75">{settings?.ui_language === "ar" ? "كلمة" : "words"}</span>
              </span>
              <span className="opacity-30">•</span>
              <span className="flex items-center gap-1">
                <strong className="text-white tabular-nums">{activeCharCount}</strong>
                <span className="opacity-75">{settings?.ui_language === "ar" ? "حرف" : "chars"}</span>
              </span>
              <span className="opacity-30">•</span>
              <span className="flex items-center gap-1">
                <span>~</span>
                <strong className="text-white tabular-nums">{activeReadingTime}</strong>
                <span className="opacity-75">{settings?.ui_language === "ar" ? "دقيقة قراءة" : "min read"}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="opacity-30">•</span>
              <span className="uppercase text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-bg)", color: "var(--accent-bright)" }}>
                {bidiMode === "auto" ? `AUTO (${detectedDir.toUpperCase()})` : bidiMode.toUpperCase()}
              </span>
              <button
                onClick={togglePin}
                title={activeIsPinned ? (t("pin_unpin" as any) || "Unpin note") : (t("pin_pin" as any) || "Pin note")}
                className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-all"
                style={{
                  background: activeIsPinned ? "var(--accent-bg)" : "var(--bg-input)",
                  color: activeIsPinned ? "var(--accent-bright)" : "var(--text-muted)",
                  border: "1px solid " + (activeIsPinned ? "var(--border-glow)" : "var(--border)"),
                }}
              >
                {activeIsPinned ? "📌" : "📍"} {activeIsPinned ? (t("pin_pinned" as any) || "Pinned") : (t("pin_pin" as any) || "Pin")}
              </button>
              <button
                onClick={() => {
                  setProtectConfirmInput("");
                  setProtectError("");
                  setProtectModal({ mode: activeIsProtected ? "off" : "on", tabId: activeId });
                }}
                title={activeIsProtected ? (t("protect_unprotect_title" as any) || "Remove protection") : (t("protect_title" as any) || "Protect this note from edit/delete")}
                className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-all"
                style={{
                  background: activeIsProtected ? "rgba(248,113,113,0.12)" : "var(--bg-input)",
                  color: activeIsProtected ? "#f87171" : "var(--text-muted)",
                  border: "1px solid " + (activeIsProtected ? "rgba(248,113,113,0.4)" : "var(--border)"),
                }}
              >
                {activeIsProtected ? "🔒" : "🛡️"} {activeIsProtected ? (t("protect_protected" as any) || "Protected") : (t("protect_protect" as any) || "Protect")}
              </button>
            </div>
          </div>
        </div>
    </>
  );
}
