// Note HTML helpers shared by the Scratchpad and any note-rendering surface.
import { sanitizeNoteHtmlForStorage } from "../sanitize";

const BLOCK_TAG_RE = /^(p|div|h[1-6]|ul|ol|li|blockquote|pre|table)$/i;

/** Ensure note content is well-formed block HTML (paragraph per line). */
export function ensureHtmlParagraphs(content: string): string {
  if (!content) return "<p></p>";
  // If it already has block-level HTML tags (<p>, <div>, <h1>-<h6>, <ul>, <ol>, <li>, <blockquote>, <pre>, <table>), preserve structure
  if (/<(p|div|h[1-6]|ul|ol|li|blockquote|pre|table)\b/i.test(content)) {
    // Content coming back from storage (or a handoff) is parsed into the
    // live editor below — it passes the storage-grade sanitizer first so
    // nothing outside the rich-text schema ever reaches an innerHTML sink.
    return normalizeBlockHtml(sanitizeNoteHtmlForStorage(content));
  }
  // Plain text with newlines (\r\n or \n) -> convert to <p> tags
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const html = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<p></p>";
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<p>${escaped}</p>`;
    })
    .join("");
  return html || "<p></p>";
}

/**
 * Normalize block HTML for the editor WITHOUT changing its visual line count.
 *
 * This used to be a blanket `<br> -> </p><p>` string replace. That rewrote
 * the <br> a hard break (Shift+Enter) or an empty paragraph ("<p><br></p>")
 * carries into a paragraph split, so every blank line DOUBLED each time a
 * note went through a load / restore / handoff / AI write, and typed hard
 * breaks vanished — "random new empty lines everywhere, like pressing
 * Enter many times". Now:
 *   - real <p> blocks are kept verbatim (a <br> inside a paragraph is a
 *     hard break); a paragraph holding only a <br> collapses to ONE empty
 *     paragraph instead of splitting in two;
 *   - legacy line storage (top-level <div>…</div> notes from the
 *     pre-TipTap editor) is restructured once: each top-level div becomes
 *     one paragraph per <br>-separated line, and a <br>-only div is a
 *     single blank line.
 */
function normalizeBlockHtml(html: string): string {
  // A paragraph holding only a <br> is one blank line, never two.
  let out = html.replace(/<p[^>]*>(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*<\/p>/gi, "<p></p>");
  if (!/<div\b/i.test(out)) return out;

  const doc = new DOMParser().parseFromString(out, "text/html");
  const parts: string[] = [];

  const wrapInParagraph = (nodes: Node[]): string => {
    const p = doc.createElement("p");
    for (const n of nodes) p.appendChild(n.cloneNode(true));
    return p.outerHTML;
  };

  // Split a legacy <div>'s children on <br> boundaries: each run of inline
  // nodes becomes one paragraph; a <br>-only div is a single blank line.
  const convertDiv = (div: Element) => {
    let line: Node[] = [];
    for (const child of Array.from(div.childNodes)) {
      const el = child.nodeType === 1 ? (child as Element) : null;
      const tag = el ? el.tagName.toLowerCase() : "";
      if (tag === "br") {
        parts.push(wrapInParagraph(line));
        line = [];
      } else if (el && BLOCK_TAG_RE.test(tag)) {
        // A block nested inside legacy storage: close the pending line,
        // then keep the block verbatim (recurse for another div).
        parts.push(wrapInParagraph(line));
        line = [];
        if (tag === "div") convertDiv(el);
        else parts.push(el.outerHTML);
      } else {
        line.push(child);
      }
    }
    // A trailing <br> only terminates the last line — it is not a blank
    // line of its own (the unconditional flush here is what turned
    // "<div><br></div>" into two empty paragraphs).
    if (line.length) parts.push(wrapInParagraph(line));
  };

  let inlineRun: Node[] = [];
  for (const child of Array.from(doc.body.childNodes)) {
    const el = child.nodeType === 1 ? (child as Element) : null;
    const tag = el ? el.tagName.toLowerCase() : "";
    if (el && tag === "div") {
      if (inlineRun.length) {
        parts.push(wrapInParagraph(inlineRun));
        inlineRun = [];
      }
      convertDiv(el);
    } else if (el && BLOCK_TAG_RE.test(tag)) {
      if (inlineRun.length) {
        parts.push(wrapInParagraph(inlineRun));
        inlineRun = [];
      }
      parts.push(el.outerHTML);
    } else if (el || (child.textContent || "").trim()) {
      inlineRun.push(child);
    }
  }
  if (inlineRun.length) parts.push(wrapInParagraph(inlineRun));
  return parts.join("") || "<p></p>";
}

// One detached div reused for html->text (avoids GC thrash on every keystroke)
let htmlToTextDiv: HTMLDivElement | null = null;

/** HTML → plain text, block tags converted to newlines. */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  if (!htmlToTextDiv) htmlToTextDiv = document.createElement("div");
  const d = htmlToTextDiv;
  // Sanitize before the detached-div parse: strips event handlers AND
  // resource-loading elements (img etc.), so extraction can never trigger
  // a network fetch or leave executable attributes behind.
  d.innerHTML = sanitizeNoteHtmlForStorage(html)
    // Shift+Enter is a <br>. It has to become a newline before the block
    // closer does, or the Copy button joins those lines into one.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n</$1>");
  const text = (d.textContent || "").replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  // The last block closer adds one trailing newline. Further trailing
  // newlines are that terminator plus nothing else — drop the terminator
  // so a note that does not end on a blank line copies without one.
  return text.replace(/\n$/g, "");
}

/**
 * Drop the empty paragraph rich-text apps insert between every real paragraph.
 * A mixed document (some lines already touching) keeps its blank lines.
 */
export function normalizePastedHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [...doc.body.children];
  const empty = (el: Element) => !((el.textContent || "").replace(/\u00a0/g, " ").trim());
  const gaps: number[] = [];
  let seen = false;
  let empties = 0;
  for (const el of blocks) {
    if (empty(el)) {
      if (seen) empties++;
    } else {
      if (seen) gaps.push(empties);
      empties = 0;
      seen = true;
    }
  }
  if (!(gaps.length > 0 && gaps.every((g) => g === 1))) return html;
  for (const el of blocks) if (empty(el)) el.remove();
  return doc.body.innerHTML;
}
