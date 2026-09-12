import DOMPurify from "dompurify";

// Single sanitizer config for every note-HTML path: the note viewer
// (raw_fragment pulled from scanned disk files), the archive/revision
// previews, and any AI output that enters a note. Notes are rich text —
// keep formatting tags, drop everything else (scripts, event handlers,
// iframes…). Previews deliberately drop inline styles too.
const ALLOWED_TAGS = [
  "p", "br", "div", "span",
  "h1", "h2", "h3", "h4",
  "strong", "em", "u", "s", "del", "mark", "code", "pre",
  "ul", "ol", "li",
  "blockquote",
  "a",
];

export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS,
    FORBID_ATTR: ["style"],
  });
}

// Storage-grade sanitizer: applied wherever note HTML ENTERS the editor or
// is PERSISTED (save queue, note handoff, plain-text extraction). It keeps
// the Tiptap color/highlight `style` attributes (they are the note's own
// formatting and are not a script vector in Chromium), but everything not on
// the allowlist — event handlers, scripts, foreign elements, javascript:
// URLs — is stripped BEFORE the HTML is stored or parsed. Defense in depth
// on top of render-time sanitization: storage itself stays clean.
const STORAGE_ALLOWED_ATTR = ["style", "href", "title"];

export function sanitizeNoteHtmlForStorage(html: string): string {
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR: STORAGE_ALLOWED_ATTR,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// AI/model output is plain text with newlines. Escape it fully and build real
// paragraphs — model-returned HTML must never be parsed into the note (the
// old `text.replace(/\n/g, "<br>")` both injected raw model HTML and rendered
// literal "<br>" strings when the model echoed tags).
export function textToNoteHtml(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  return lines.map((l) => `<p>${escapeHtml(l) || "<br>"}</p>`).join("");
}
