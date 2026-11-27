import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapUnderline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import Placeholder from "@tiptap/extension-placeholder";
import { getTranslation } from "../../utils/i18n";
import { DOMParser } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { safeGetHTML, detectBaseDir } from "./domText";
import { useRef, useEffect } from "react";
import { registerFlushHook, enqueueTabsSnapshot } from "../../lib/flushOnExit";
import { ensureHtmlParagraphs, normalizePastedHtml } from "../../lib/noteHtml";
import { normalizePastedPlain, plainToParagraphHtml, plainToSimpleHtml } from "../../lib/clipboardText";
import { isDefaultNoteTitle } from "../../lib/mergeLoadedTabs";
import { mergeSyncedScratchpadTab } from "../../scratchpadSaveQueue";
import type { EditorView } from "@tiptap/pm/view";
import type { Dispatch, SetStateAction, RefObject } from "react";
import type { ScratchTab, NoteBidiMode, Settings } from "../../types";

export interface UseScratchEditorArgs {
  activeId: string;
  activeIdRef: RefObject<string>;
  bidiMode: NoteBidiMode;
  contentRef: RefObject<Record<string, string>>;
  editorHtmlRef: RefObject<Record<string, string>>;
  editorRef: RefObject<HTMLDivElement | null>;
  lastActiveTabId: RefObject<string>;
  lastNonEmptyContentRef: RefObject<Record<string, string>>;
  lastSnapshotTimeRef: RefObject<Record<string, number>>;
  pastePlainRef: RefObject<boolean>;
  recordSnapshot: (tabId: string, content: string, reason?: string | undefined) => Promise<void>;
  setClearedAlert: Dispatch<SetStateAction<{ tabId: string; content: string; timestamp: number; } | null>>;
  setSlashOpen: Dispatch<SetStateAction<boolean>>;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  settings: Settings | null;
  tabs: ScratchTab[];
  tabsRef: RefObject<ScratchTab[]>;
  titleTouched: RefObject<Record<string, boolean>>;
  serverLoaded: RefObject<boolean>;
}

const titleSaveTimers = new Map<string, number>();

/** Persist a title. `automatic` is the first-line name and must not lock the note. */
function queueTitleSave(id: string, title: string, automatic: boolean): void {
  const prev = titleSaveTimers.get(id);
  if (prev) window.clearTimeout(prev);
  titleSaveTimers.set(
    id,
    window.setTimeout(() => {
      titleSaveTimers.delete(id);
      fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, title_custom: automatic ? false : true }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.tab) mergeSyncedScratchpadTab(data.tab);
        })
        .catch(() => {});
    }, 400)
  );
}

function writeSelectionClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const sel = view.state.selection;
  if (sel.empty) return false;
  const slice = sel.content();
  const text = slice.content.textBetween(0, slice.content.size, "\n", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : ""));
  event.preventDefault();
  event.clipboardData?.setData("text/plain", text);
  event.clipboardData?.setData("text/html", plainToSimpleHtml(text));
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  return true;
}

// The TipTap editor instance, the exit-flush hook, and per-tab content/BIDI sync.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useScratchEditor({ activeId, activeIdRef, bidiMode, contentRef, editorHtmlRef, editorRef, lastActiveTabId, lastNonEmptyContentRef, lastSnapshotTimeRef, pastePlainRef, recordSnapshot, setClearedAlert, setSlashOpen, setTabs, settings, tabs, tabsRef, titleTouched, serverLoaded }: UseScratchEditorArgs) {
  // TipTap industry editor — stable, transactional, BIDI-aware
  const tiptap = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        dropcursor: { width: 2, color: "var(--accent)" },
        // TipTap's transactional undo/redo (Ctrl+Z / Ctrl+Y, toolbar buttons).
        // The legacy custom innerHTML snapshot stack below is dormant.
        undoRedo: {},
      }),
      TiptapUnderline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Typography,
      Placeholder.configure({
        placeholder: () => getTranslation(settings, "scratchpad_placeholder" as any) || "Start writing…",
        showOnlyWhenEditable: true,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "note-editor prose max-w-none",
        spellcheck: "false",
      },
      // Paste is handled here, at the ProseMirror level. The React onPaste on
      // the wrapper runs too late to stop ProseMirror's own insert, which used
      // to duplicate every paste. Returning true means the event is finished.
      handlePaste: (view, event) => {
        const cd = event.clipboardData;
        if (!cd) return false;
        const plain = cd.getData("text/plain") ?? "";
        const html = cd.getData("text/html") ?? "";
        const wantsRich = !pastePlainRef.current && /<(strong|em|b|i|u|h[1-6]|ul|ol|a|code|pre|blockquote)\b/i.test(html);
        event.preventDefault();
        try {
          const div = document.createElement("div");
          if (wantsRich) {
            div.innerHTML = normalizePastedHtml(html);
          } else {
            const text = normalizePastedPlain(plain);
            if (!text) return true;
            div.innerHTML = plainToParagraphHtml(text);
          }
          const slice = DOMParser.fromSchema(view.state.schema).parseSlice(div);
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          // Seal the paste as its own undo step. Otherwise a word changed
          // right after the paste is stored in the same step, and one Ctrl+Z
          // removes both.
          view.dispatch(closeHistory(view.state.tr));
        } catch {}
        return true;
      },
      // Ctrl+C fallback if the DOM handler below does not run. One newline
      // between lines, not the editor's default blank line.
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, "\n", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : "")),
      handleDOMEvents: {
        copy: (view, event) => writeSelectionClipboard(view, event, false),
        cut: (view, event) => writeSelectionClipboard(view, event, true),
      },
    },
    onUpdate: ({ editor, transaction }) => {
      const html = safeGetHTML(editor);
      const id = activeIdRef.current;
      contentRef.current[id] = html;
      editorHtmlRef.current[id] = html;

      const plainText = html.replace(/<[^>]+>/g, "").trim();
      const prevNonEmpty = lastNonEmptyContentRef.current[id] || "";
      const prevTextLength = prevNonEmpty.replace(/<[^>]+>/g, "").trim().length;

      if (plainText.length > 0) {
        lastNonEmptyContentRef.current[id] = html;
        setClearedAlert(null);
        // Periodic auto snapshot (every 25 seconds of active typing)
        const now = Date.now();
        const lastSnap = lastSnapshotTimeRef.current[id] || 0;
        if (now - lastSnap > 25000) {
          lastSnapshotTimeRef.current[id] = now;
          recordSnapshot(id, html, "Auto snapshot");
        }
      } else if (prevTextLength > 30 && plainText.length === 0) {
        // Accidental clear / empty Ctrl+Z detected!
        setClearedAlert({
          tabId: id,
          content: prevNonEmpty,
          timestamp: Date.now(),
        });
      }

      // The save queue has its own quiet period. A second delay here is how
      // the last words existed only in the editor.
      setTabs((prev) => {
        const cur = prev.find((x) => x.id === id);
        if (cur && cur.content === html) return prev;
        return prev.map((x) => (x.id === id ? { ...x, content: html } : x));
      });
      // Auto-title from the first non-empty line. Read it straight off the
      // ProseMirror doc (the old detached-div innerHTML parse re-parsed the
      // WHOLE note on every keystroke) and — critically — return `prev`
      // unchanged when the title already matches: an unconditional new
      // object here turned setEditable's re-emitted "update" into an
      // infinite setTabs → effect → setEditable → update render loop.
      // A note named on the Applications page ("Overview", "Kazma note") keeps
      // its name; only default "Scratch N" names follow the first line.
      // A note the user renamed keeps its name for good: `title_custom` is
      // stored on the note (titleTouched alone lived in this component and
      // was wiped by every remount — a vault lock — after which the next
      // keystroke replaced the user's name with the first line).
      const named = tabsRef.current.find((x) => x.id === id);
      const title = named?.title || "";
      const isDefault = isDefaultNoteTitle(title);
      const keepName = !!named?.app && !isDefault;
      if (!titleTouched.current[id] && !keepName && !named?.title_custom) {
        const autoOf = (doc: typeof editor.state.doc) => {
          let firstBlock = "";
          doc.forEach((node) => {
            if (firstBlock) return;
            const t = node.textContent;
            if (t.trim()) firstBlock = t;
          });
          return firstBlock.trim().slice(0, 40);
        };
        // Follow the first line only while the name is still the default, or
        // still exactly the previous first line. A shorter custom name that
        // happens to be a prefix of the first line is a name, and it stays.
        const prevAuto = autoOf(transaction.before);
        const followsFirstLine = isDefault || !named || title === prevAuto;
        const auto = followsFirstLine ? autoOf(editor.state.doc) : "";
        if (auto && auto !== title) {
          setTabs((prev) => {
            const cur = prev.find((x) => x.id === id);
            // Recheck at write time: a rename can land between the keystroke
            // and this update, and must not be replaced by the first line.
            if (!cur || cur.title_custom || cur.title === auto) return prev;
            if (!isDefaultNoteTitle(cur.title) && cur.title !== prevAuto && cur.title !== title) return prev;
            return prev.map((x) => (x.id === id ? { ...x, title: auto } : x));
          });
          // The server ignores this when the note was already named by hand.
          queueTitleSave(id, auto, true);
        }
      }
      // Slash palette trigger — show when line ends with "/"
      try {
        const { from } = editor.state.selection;
        const textBefore = editor.state.doc.textBetween(Math.max(0, from - 2), from, "\n");
        setSlashOpen(textBefore.endsWith("/"));
      } catch { setSlashOpen(false); }
    },
  });

  // Live mirror of the TipTap instance for the once-registered exit hook.
  const tiptapRef = useRef(tiptap);
  tiptapRef.current = tiptap;

  // Exit-flush: on quit (tray Exit, shutdown, uninstall-before-update) push
  // the LIVE editor content into the save queue synchronously — debounce
  // timers die with the renderer and must never outrank this snapshot. The
  // flush module then drains the queue to the server before the app exits.
  useEffect(() => {
    const flushLive = () => {
      const ed = tiptapRef.current;
      const active = activeIdRef.current;
      if (ed && !ed.isDestroyed) {
        try {
          if ((ed as any)._debouncedSync) {
            window.clearTimeout((ed as any)._debouncedSync);
            (ed as any)._debouncedSync = null;
          }
          const html = safeGetHTML(ed);
          if (html) contentRef.current[active] = html;
        } catch {}
      }
      const live = ed && !ed.isDestroyed ? contentRef.current[active] : null;
      enqueueTabsSnapshot(
        tabsRef.current.map((x) => ({
          ...x,
          content: x.id === active && live != null ? live : (contentRef.current[x.id] ?? x.content),
        }))
      );
    };
    const off = registerFlushHook(flushLive);
    return () => {
      // Unmount (vault lock swaps in the lock screen, page switch): the
      // 280ms editor→tabs debounce dies with this component, so the newest
      // words never reached the save queue — the "last few words lost on
      // lock" bug. Hand the live text over now; the queue holds it through
      // the lock and saves it after unlock. Skipped before the first server
      // load: the placeholder tabs would be saved as a junk note.
      if (serverLoaded.current) {
        try {
          flushLive();
        } catch {}
      }
      off();
    };
  }, []);

  // Keep editorRef in sync with TipTap DOM for spellcheck/scroll
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    const rawContent = contentRef.current[activeId] ?? tabs.find((x) => x.id === activeId)?.content ?? "";
    const html = ensureHtmlParagraphs(rawContent);
    const isTabSwitch = lastActiveTabId.current !== activeId;

    if (isTabSwitch) {
      lastActiveTabId.current = activeId;
      // Tab switched: Set content so Ctrl+Z is strictly scoped to this note
      // Note: clearHistory() was removed — TipTap v3 UndoRedo extension no longer exposes it,
      // and the custom history stack (historyRef) already handles per-tab undo scoping.
      tiptap.commands.setContent(html || "<p></p>", { emitUpdate: false });
      contentRef.current[activeId] = html;
      editorHtmlRef.current[activeId] = html;
      if (html && html !== "<p></p>") {
        lastNonEmptyContentRef.current[activeId] = html;
        recordSnapshot(activeId, html, "Opened snapshot");
      }
    } else if (html !== "<p></p>" && rawContent !== editorHtmlRef.current[activeId]) {
      // EXTERNAL write only (conflict resolution, handoff, first server sync):
      // state holds content the editor never produced. The editor's own html
      // echoed back through tabs must NEVER be re-applied — setContent
      // replaces the whole document and throws the caret to the end of the
      // note (the "cursor always jumps to the last line" bug). emitUpdate
      // stays false so this can't re-fire onUpdate and feed back into tabs.
      tiptap.commands.setContent(html || "<p></p>", { emitUpdate: false });
      contentRef.current[activeId] = html;
      editorHtmlRef.current[activeId] = html;
      lastNonEmptyContentRef.current[activeId] = html;
    }
    // BIDI sync
    const plainForDir = (() => {
      const d = document.createElement("div");
      d.innerHTML = (html || "").replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n</$1>");
      const t = d.textContent || "";
      return t;
    })();
    const dir = bidiMode === "auto" ? detectBaseDir(plainForDir) : bidiMode;
    try {
      if (tiptap.view?.dom) {
        tiptap.view.dom.setAttribute("dir", dir);
        tiptap.view.dom.setAttribute("data-bidi", bidiMode);
        (editorRef as any).current = tiptap.view.dom as unknown as HTMLDivElement;
      }
    } catch {}
  }, [activeId, tiptap, bidiMode, tabs, recordSnapshot]);

  return { tiptap };
}
