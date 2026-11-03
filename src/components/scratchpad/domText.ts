// --- Caret/selection offset helpers -------------------------------------
// We snapshot the editor's selection as a (start, end) character offset
// pair over its textContent. This survives DOM replacement (unlike Range
// objects, which point at detached nodes after innerHTML is reassigned) and
// lets our owned history stack restore the selection on undo/redo.

export function getSelectionOffsets(root: HTMLElement): [number, number] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    return [0, 0];
  }
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return [start, end];
}

export function setSelectionOffsets(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Text | null;
  let counted = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.nodeValue?.length ?? 0;
    if (!startNode && counted + len >= start) {
      startNode = node;
      startOff = Math.min(start - counted, len);
    }
    if (!endNode && counted + len >= end) {
      endNode = node;
      endOff = Math.min(end - counted, len);
    }
    if (startNode && endNode) break;
    counted += len;
  }
  // If end fell past the last text node, clamp to the end of the editor.
  if (!endNode) {
    const last = root.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      endNode = last as Text;
      endOff = last.nodeValue?.length ?? 0;
    } else if (startNode) {
      endNode = startNode;
      endOff = startOff;
    }
  }
  if (!startNode) return; // nothing to select
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode ?? startNode, endNode ? endOff : startOff);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Spellcheck tokenization (shared with server/electron via same rules) ──
// Word = run of Arabic letters, or Latin letters with internal ' / -
export const SPELL_WORD_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g;
export const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
export const LATIN_WORD_RE = /^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$/;
export const CLEAN_TOKEN_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640\u064B-\u0652\u0670]/g;

export function sanitizeToken(token: string): string {
  return token.replace(CLEAN_TOKEN_RE, "");
}

export function isArabicToken(token: string): boolean {
  return ARABIC_RE.test(token) && !/[A-Za-z]/.test(token);
}

export function isLatinToken(token: string): boolean {
  return LATIN_WORD_RE.test(token);
}

export function extractSpellWords(text: string): string[] {
  const words: string[] = [];
  try {
    const segmenter = new Intl.Segmenter(["en", "ar"], { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      const clean = sanitizeToken(segment.segment);
      if (!clean || clean.length <= 1) continue;
      if (isArabicToken(clean) || isLatinToken(clean)) words.push(clean);
    }
  } catch {
    const matches = text.match(SPELL_WORD_RE) || [];
    for (const m of matches) {
      const clean = sanitizeToken(m);
      if (!clean || clean.length <= 1) continue;
      if (isArabicToken(clean) || isLatinToken(clean)) words.push(clean);
    }
  }
  return Array.from(new Set(words));
}

export function getWordAtPoint(root: HTMLElement, x: number, y: number): { word: string; range: Range } | null {
  let range: Range | null = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if ((document as any).caretPositionFromPoint) {
    const pos = (document as any).caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }
  if (!range || !range.startContainer || !root.contains(range.startContainer)) {
    return null;
  }

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.nodeValue || "";
  const offset = range.startOffset;

  let start = offset;
  while (start > 0 && /[\w\u0600-\u06FF\u0750-\u077F''\u2019-]/.test(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && /[\w\u0600-\u06FF\u0750-\u077F''\u2019-]/.test(text[end])) {
    end++;
  }

  const word = text.slice(start, end).trim();
  if (!word || word.length <= 1) return null;

  const wordRange = document.createRange();
  wordRange.setStart(node, start);
  wordRange.setEnd(node, end);

  return { word, range: wordRange };
}

export function measureCaretPos(editor: HTMLElement): { top: number; left: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return null;

  const range = sel.getRangeAt(0);
  const editorBox = editor.getBoundingClientRect();
  const rects = range.getClientRects();

  if (rects && rects.length > 0) {
    const lastRect = rects[rects.length - 1];
    if (lastRect.width >= 0 && lastRect.height >= 0) {
      return {
        top: lastRect.top - editorBox.top,
        left: lastRect.right - editorBox.left,
      };
    }
  }

  try {
    const cl = range.cloneRange();
    const span = document.createElement("span");
    span.appendChild(document.createTextNode("\u200b"));
    cl.insertNode(span);
    const box = span.getBoundingClientRect();
    if (span.parentNode) span.parentNode.removeChild(span);
    return {
      top: box.top - editorBox.top,
      left: box.left - editorBox.left,
    };
  } catch {
    return null;
  }
}

/** First strong character decides a paragraph/note's natural base direction. */
export function detectBaseDir(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Arabic / Hebrew blocks → RTL
    if (
      (code >= 0x0590 && code <= 0x05ff) ||
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0xfb1d && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff)
    ) {
      return "rtl";
    }
    // Latin / common LTR letters
    if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x024f)
    ) {
      return "ltr";
    }
  }
  return "ltr";
}

/** Scroll a page container (main) so `el` sits near the top of the viewport. */
export function scrollContainerToReveal(el: HTMLElement) {  const main = el.closest("main") as HTMLElement | null;
  if (main) {
    const mainRect = main.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top - mainRect.top - 12;
    if (Math.abs(delta) > 2) {
      main.scrollBy({ top: delta, behavior: "smooth" });
    }
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export interface SpellRect {
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Measure misspelled words from the LIVE editor DOM using Range#getClientRects().
 * A cloned HTML overlay reflows differently under RTL/BIDI (especially when
 * misspell <span>s get unicode-bidi:isolate), which left red squiggles floating
 * on the empty side of dual-language notes. Positioning from real glyph boxes
 * always tracks the painted text.
 */
export function collectMisspellRects(
  editor: HTMLElement,
  misspelled: Set<string>
): SpellRect[] {
  if (!misspelled.size) return [];
  const editorBox = editor.getBoundingClientRect();
  const out: SpellRect[] = [];
  let keySeq = 0;

  const pushRangeRects = (range: Range) => {
    let list: DOMRectList | DOMRect[];
    try {
      list = range.getClientRects();
    } catch {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.width < 1 || r.height < 1) continue;
      // Skip rects clearly outside the editor (collapsed off-screen fragments)
      if (r.bottom < editorBox.top - 2 || r.top > editorBox.bottom + 2) continue;
      out.push({
        key: `u${keySeq++}`,
        top: r.top - editorBox.top,
        left: r.left - editorBox.left,
        width: r.width,
        height: Math.max(2, r.height),
      });
    }
  };

  const walkText = (node: Text) => {
    const text = node.nodeValue || "";
    if (!text) return;

    type Seg = { start: number; end: number; raw: string };
    const segs: Seg[] = [];
    try {
      const segmenter = new Intl.Segmenter(["en", "ar"], { granularity: "word" });
      for (const s of segmenter.segment(text)) {
        if (!s.isWordLike) continue;
        segs.push({
          start: s.index,
          end: s.index + s.segment.length,
          raw: s.segment,
        });
      }
    } catch {
      for (const m of text.matchAll(new RegExp(SPELL_WORD_RE.source, "g"))) {
        const start = m.index ?? 0;
        segs.push({ start, end: start + m[0].length, raw: m[0] });
      }
    }

    for (const seg of segs) {
      const clean = sanitizeToken(seg.raw);
      if (!clean || clean.length <= 1) continue;
      if (!(isArabicToken(clean) || isLatinToken(clean))) continue;
      if (!misspelled.has(clean)) continue;
      try {
        const range = document.createRange();
        range.setStart(node, seg.start);
        range.setEnd(node, Math.min(seg.end, text.length));
        pushRangeRects(range);
      } catch {
        /* range may fail if node detaches mid-measure */
      }
    }
  };

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    walkText(n as Text);
  }
  return out;
}

/** Safely read HTML from a TipTap editor. Returns "" if the editor is
 *  destroyed/null (e.g. during React StrictMode remount or editor
 *  recreation) — `getHTML()` on a destroyed editor throws internally. */
export function safeGetHTML(editor: any): string {
  try {
    if (!editor || editor.isDestroyed) return "";
    return editor.getHTML();
  } catch {
    return "";
  }
}
