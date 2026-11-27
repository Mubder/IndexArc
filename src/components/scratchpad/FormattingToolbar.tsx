import type { Dispatch, RefObject, SetStateAction } from "react";
import type { NoteBidiMode } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import type { Editor } from "@tiptap/react";
import { Languages, AlignLeft, AlignRight, ArrowUp, ArrowDown, Undo, Redo, Bold, Italic, Underline, Palette, Highlighter, Eraser, ClipboardPaste, Heading1, Heading2, List, ListOrdered, Quote } from "lucide-react";
import { TEXT_COLORS, HIGHLIGHT_COLORS } from "./constants";
import { getTranslation } from "../../utils/i18n";

export interface FormattingToolbarProps {
  bidiMode: NoteBidiMode;
  canScrollDown: boolean;
  canScrollUp: boolean;
  detectedDir: "ltr" | "rtl";
  execFormat: (command: string, value?: string | undefined) => void;
  highlightColor: string;
  historyRedo: () => void;
  historyUndo: () => void;
  noteOverflows: boolean;
  pastePlain: boolean;
  scrollEditor: (direction: "top" | "bottom") => void;
  setBidiMode: Dispatch<SetStateAction<NoteBidiMode>>;
  setHighlightColor: Dispatch<SetStateAction<string>>;
  setPastePlain: Dispatch<SetStateAction<boolean>>;
  setShowHighlightPicker: Dispatch<SetStateAction<boolean>>;
  setShowTextColorPicker: Dispatch<SetStateAction<boolean>>;
  setTextColor: Dispatch<SetStateAction<string>>;
  showHighlightPicker: boolean;
  showTextColorPicker: boolean;
  t: (key: keyof TranslationDict) => string;
  textColor: string;
  tiptap: Editor;
  toolbarRef: RefObject<HTMLDivElement | null>;
}

export function FormattingToolbar({ bidiMode, canScrollDown, canScrollUp, detectedDir, execFormat, highlightColor, historyRedo, historyUndo, noteOverflows, pastePlain, scrollEditor, setBidiMode, setHighlightColor, setPastePlain, setShowHighlightPicker, setShowTextColorPicker, setTextColor, showHighlightPicker, showTextColorPicker, t, textColor, tiptap, toolbarRef }: FormattingToolbarProps) {
  return (
    <>
        {/* Formatting toolbar — unified pill */}
        <div
          ref={toolbarRef}
          onMouseDown={(e) => e.preventDefault()}
          className="scratchpad-toolbar"
        >
          {/* Dual-language BIDI */}
          <div
            className="scratchpad-toolbar-group"
            title={t("scratchpad_bidi_hint")}
          >
            {(
              [
                { mode: "auto" as const, icon: Languages, labelKey: "scratchpad_bidi_auto" as const },
                { mode: "ltr" as const, icon: AlignLeft, labelKey: "scratchpad_bidi_ltr" as const },
                { mode: "rtl" as const, icon: AlignRight, labelKey: "scratchpad_bidi_rtl" as const },
              ]
            ).map(({ mode, icon: Icon, labelKey }) => {
              const activeBidi = bidiMode === mode;
              const title =
                mode === "auto"
                  ? `${t(labelKey)} (${detectedDir.toUpperCase()})`
                  : t(labelKey);
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBidiMode(mode)}
                  className="p-1.5 transition-all"
                  style={{
                    color: activeBidi ? "var(--accent-bright)" : "var(--text-dim)",
                    background: activeBidi ? "var(--accent-bg)" : "transparent",
                  }}
                  title={title}
                  aria-label={title}
                  aria-pressed={activeBidi}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Jump top/bottom — always in the toolbar so long notes never hide them */}
          <button
            type="button"
            onClick={() => scrollEditor("top")}
            disabled={!noteOverflows && !canScrollUp}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_go_to_top")}
            aria-label={t("scratchpad_go_to_top")}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => scrollEditor("bottom")}
            disabled={!noteOverflows && !canScrollDown}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_go_to_bottom")}
            aria-label={t("scratchpad_go_to_bottom")}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Undo / Redo */}
          <button
            type="button"
            onClick={historyUndo}
            disabled={(() => { try { return !tiptap?.can?.().undo?.(); } catch { return true; } })()}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_undo")}
          >
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={historyRedo}
            disabled={(() => { try { return !tiptap?.can?.().redo?.(); } catch { return true; } })()}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_redo")}
          >
            <Redo className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          <button type="button" onClick={() => tiptap?.chain().focus().toggleHeading({ level: 1 }).run()} className="px-1.5 py-1 rounded-lg text-[11px] font-semibold" style={{ color: tiptap?.isActive("heading", { level: 1 }) ? "var(--accent-bright)" : "var(--text-dim)", background: tiptap?.isActive("heading", { level: 1 }) ? "var(--accent-bg)" : "transparent" }} title="H1"><Heading1 className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => tiptap?.chain().focus().toggleHeading({ level: 2 }).run()} className="px-1.5 py-1 rounded-lg text-[11px] font-semibold" style={{ color: tiptap?.isActive("heading", { level: 2 }) ? "var(--accent-bright)" : "var(--text-dim)", background: tiptap?.isActive("heading", { level: 2 }) ? "var(--accent-bg)" : "transparent" }} title="H2"><Heading2 className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => tiptap?.chain().focus().toggleBulletList().run()} className="p-1.5 rounded-lg" style={{ color: tiptap?.isActive("bulletList") ? "var(--accent-bright)" : "var(--text-dim)", background: tiptap?.isActive("bulletList") ? "var(--accent-bg)" : "transparent" }} title={t("slash_bullet_list")}><List className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => tiptap?.chain().focus().toggleOrderedList().run()} className="p-1.5 rounded-lg" style={{ color: tiptap?.isActive("orderedList") ? "var(--accent-bright)" : "var(--text-dim)", background: tiptap?.isActive("orderedList") ? "var(--accent-bg)" : "transparent" }} title="1."><ListOrdered className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => tiptap?.chain().focus().toggleBlockquote().run()} className="p-1.5 rounded-lg" style={{ color: tiptap?.isActive("blockquote") ? "var(--accent-bright)" : "var(--text-dim)", background: tiptap?.isActive("blockquote") ? "var(--accent-bg)" : "transparent" }} title={t("slash_quote")}><Quote className="w-3.5 h-3.5" /></button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Bold / Italic / Underline */}
          <button
            type="button"
            onClick={() => execFormat("bold")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_bold")}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => execFormat("italic")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_italic")}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => execFormat("underline")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_underline")}
          >
            <Underline className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Text color */}
          <div className="relative">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => execFormat("foreColor", textColor)}
                
                className="p-1.5 rounded-l-lg transition-all hover:opacity-100 opacity-70"
                style={{ color: "var(--text-dim)" }}
                title={t("scratchpad_text_color")}
              >
                <Palette className="w-3.5 h-3.5" />
                <span
                  className="absolute bottom-0.5 left-2 w-2 h-0.5 rounded-full"
                  style={{ background: textColor }}
                />
              </button>
              <button
                type="button"
                onClick={() => { setShowTextColorPicker((s) => !s); setShowHighlightPicker(false); }}
                
                className="px-0.5 py-1.5 rounded-r-lg transition-all hover:opacity-100 opacity-70 text-[8px]"
                style={{ color: "var(--text-dim)" }}
              >
                ▾
              </button>
            </div>
            {showTextColorPicker && (
              <div
                className="absolute top-full left-0 mt-1 flex gap-1 p-1.5 rounded-lg z-50"
                style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => { setTextColor(c.hex); execFormat("foreColor", c.hex); }}
                    
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{
                      background: c.hex,
                      borderColor: textColor === c.hex ? "var(--accent-bright)" : "transparent",
                    }}
                    title={t(c.key as Parameters<typeof getTranslation>[1])}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Highlight color */}
          <div className="relative">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => execFormat("hiliteColor", highlightColor)}
                
                className="p-1.5 rounded-l-lg transition-all hover:opacity-100 opacity-70"
                style={{ color: "var(--text-dim)" }}
                title={t("scratchpad_highlight")}
              >
                <Highlighter className="w-3.5 h-3.5" />
                <span
                  className="absolute bottom-0.5 left-2 w-2 h-0.5 rounded-full"
                  style={{ background: highlightColor }}
                />
              </button>
              <button
                type="button"
                onClick={() => { setShowHighlightPicker((s) => !s); setShowTextColorPicker(false); }}
                
                className="px-0.5 py-1.5 rounded-r-lg transition-all hover:opacity-100 opacity-70 text-[8px]"
                style={{ color: "var(--text-dim)" }}
              >
                ▾
              </button>
            </div>
            {showHighlightPicker && (
              <div
                className="absolute top-full left-0 mt-1 flex gap-1 p-1.5 rounded-lg z-50"
                style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => { setHighlightColor(c.hex); execFormat("hiliteColor", c.hex); }}
                    
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{
                      background: c.hex,
                      borderColor: highlightColor === c.hex ? "var(--accent-bright)" : "transparent",
                    }}
                    title={t(c.key as Parameters<typeof getTranslation>[1])}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Clear formatting */}
          <button
            type="button"
            onClick={() => execFormat("removeFormat")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_clear_format")}
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Paste mode toggle */}
          <button
            type="button"
            onClick={() => setPastePlain((v) => !v)}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{
              color: pastePlain ? "var(--accent-bright)" : "var(--text-dim)",
              background: pastePlain ? "var(--accent-bg)" : "transparent",
              border: pastePlain ? "1px solid var(--border-glow)" : "1px solid transparent",
            }}
            title={pastePlain ? t("paste_plain_on") : t("paste_plain_off")}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
          </button>
        </div>
    </>
  );
}
