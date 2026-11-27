// One clipboard rule for the scratchpad, Paste & Analyze, and the document window.
// A line on screen is one line of plain text. A blank line the user made is one
// blank line. Rich-text apps insert an extra empty line between every paragraph;
// that pattern is removed on the way in. A real blank line is kept.

const EXTRA_SPACE = /[\u00a0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000]/g;

export function normalizeNewlines(text: string): string {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isBlank(line: string): boolean {
  return line.replace(EXTRA_SPACE, " ").trim().length === 0;
}

/**
 * Collapse the blank line rich-text apps put between every paragraph.
 * When every gap is exactly one empty line, those gaps are the paragraph
 * separator and are dropped. When the text is already mixed (some lines
 * touch), a single empty line is a blank the user made. Two or more empty
 * lines collapse to one blank line. A fully spaced paste that also contains
 * a wider gap keeps one blank only for that wider gap.
 */
export function normalizePastedPlain(text: string): string {
  const raw = normalizeNewlines(text).replace(/[ \t]+\n/g, "\n").replace(/\n+$/g, "").replace(/^\n+/g, "");
  if (!raw) return "";
  const lines = raw.split("\n");
  const contentAt: number[] = [];
  for (let i = 0; i < lines.length; i++) if (!isBlank(lines[i])) contentAt.push(i);
  if (contentAt.length === 0) return "";

  const gaps: number[] = [];
  for (let i = 1; i < contentAt.length; i++) gaps.push(contentAt[i] - contentAt[i - 1] - 1);
  const fullySpaced = gaps.length > 0 && gaps.every((g) => g === 1);
  const anyAdjacent = gaps.some((g) => g === 0);

  const out: string[] = [];
  for (let i = 0; i < contentAt.length; i++) {
    if (i > 0) {
      const gap = gaps[i - 1];
      const keepBlank = fullySpaced ? false : !anyAdjacent ? gap >= 2 : gap >= 1;
      if (keepBlank) out.push("");
    }
    out.push(lines[contentAt[i]].replace(EXTRA_SPACE, " "));
  }
  return out.join("\n");
}

/** Insert a paste into a plain textarea without the extra paragraph gaps. */
export function insertNormalizedPaste(current: string, start: number, end: number, incoming: string): { value: string; caret: number } {
  const norm = normalizePastedPlain(incoming);
  const a = Math.max(0, Math.min(start, current.length));
  const b = Math.max(a, Math.min(end, current.length));
  const value = current.slice(0, a) + norm + current.slice(b);
  return { value, caret: a + norm.length };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text → one paragraph per line, for the scratchpad editor. */
export function plainToParagraphHtml(text: string): string {
  if (!text) return "";
  return text.split("\n").map((l) => `<p>${l ? escapeHtml(l) : ""}</p>`).join("");
}

/**
 * Plain text → HTML that other apps treat as lines, not as spaced paragraphs.
 * `<div>` / `<br>` instead of `<p>`, so Word does not add its own gap.
 */
export function plainToSimpleHtml(text: string): string {
  if (!text) return "";
  return normalizeNewlines(text)
    .replace(/\n+$/g, "")
    .split("\n")
    .map((l) => `<div>${l ? escapeHtml(l) : "<br>"}</div>`)
    .join("");
}
