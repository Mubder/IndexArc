import type { ScratchTab } from "../../types";
import { ensureHtmlParagraphs } from "../../lib/noteHtml";
import { normalizeServerTab } from "../../lib/serverTabs";

export const STORAGE_KEY = "indexarc_scratchpad_tabs";

export function smartFormatParagraphs(content: string): string {
  if (!content || !content.trim()) return "<p></p>";

  // 1. Convert block closers and <br> tags to newlines
  let text = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|article|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, ""); // Strip remaining HTML tags

  // 2. Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 3. Normalize line breaks and spaces
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 4. Intelligently insert breaks for combined single-block text:
  // (a) Split on bullet characters and numbered list items (e.g., " 1. ", " 2) ", " - ", " • ")
  text = text
    .replace(/(\s+)(\d+[\.\)]\s+)/g, "\n\n$2")
    .replace(/(\s+)(\(\d+\)\s+)/g, "\n\n$2")
    .replace(/(\s+)([-*•–—]\s+)/g, "\n\n$2");

  // (b) Split on header/field colons (e.g. " Note: ", " Title: ", " ملاحظة: ")
  text = text
    .replace(/(\s+)([A-Za-z\u0600-\u06FF\s]{2,25}:(?:\s+))/g, "\n\n$2");

  // (c) Split after sentence terminators (. ! ? ؟ ؛ ;) followed by space
  text = text
    .replace(/([\.\!\?؟؛](\s+))/g, "$1\n\n");

  // 5. Build clean HTML <p> tags from the resulting lines
  const paragraphs = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (paragraphs.length === 0) return "<p></p>";

  return paragraphs
    .map((p) => {
      const escaped = p
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p>${escaped}</p>`;
    })
    .join("");
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Legacy plaintext copy of notes from before the server became the only
// durable store. Removed once the server holds the notes, so it doesn't sit
// unencrypted in Chromium's LevelDB indefinitely.
export function dropLegacyLocalTabs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function loadTabs(): ScratchTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed
          .filter((x: any) => !x.archived)
          .map((x: any) => {
            const t = normalizeServerTab(x);
            t.content = ensureHtmlParagraphs(t.content || "");
            return t;
          });
      }
    }
  } catch {}
  return [{ id: uid(), title: "Scratch 1", content: "<p></p>" }];
}
