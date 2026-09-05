// Note HTML helpers shared by the Scratchpad and any note-rendering surface.

/** Ensure note content is well-formed block HTML (paragraph per line). */
export function ensureHtmlParagraphs(content: string): string {
  if (!content) return "<p></p>";
  // If it already has block-level HTML tags (<p>, <div>, <h1>-<h6>, <ul>, <ol>, <li>, <blockquote>, <pre>), preserve structure
  if (/<(p|div|h[1-6]|ul|ol|li|blockquote|pre|table)\b/i.test(content)) {
    return content.replace(/<br\s*\/?>/gi, "</p><p>");
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

// One detached div reused for html->text (avoids GC thrash on every keystroke)
let htmlToTextDiv: HTMLDivElement | null = null;

/** HTML → plain text, block tags converted to newlines. */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  if (!htmlToTextDiv) htmlToTextDiv = document.createElement("div");
  const d = htmlToTextDiv;
  d.innerHTML = html.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n</$1>");
  const text = d.textContent || d.innerText || "";
  return text.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, " ");
}
