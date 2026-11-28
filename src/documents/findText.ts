export interface FindOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface TextMatch {
  index: number;
  length: number;
}

/** Case-insensitive by default, literal by default, overlaps never returned. */
export function findTextMatches(haystack: string, query: string, opts: FindOptions = {}): TextMatch[] {
  const q = query.trim();
  if (!q) return [];
  if (opts.regex) {
    try {
      const re = new RegExp(q, opts.caseSensitive ? "g" : "gi");
      const out: TextMatch[] = [];
      let match: RegExpExecArray | null;
      // A hostile pattern (e.g. `(a*)*`) must not hang the renderer.
      let guard = 0;
      while ((match = re.exec(haystack)) !== null) {
        out.push({ index: match.index, length: match[0].length });
        if (match[0].length === 0) re.lastIndex++;
        if (++guard > 10_000) break;
      }
      return out;
    } catch {
      return [];
    }
  }
  const h = opts.caseSensitive ? haystack : haystack.toLowerCase();
  const needle = opts.caseSensitive ? q : q.toLowerCase();
  const out: TextMatch[] = [];
  let i = 0;
  while (i <= h.length - needle.length) {
    const at = h.indexOf(needle, i);
    if (at < 0) break;
    out.push({ index: at, length: needle.length });
    i = at + Math.max(needle.length, 1);
  }
  return out;
}

/** Index-only view of `findTextMatches`, kept for simple callers. */
export function findMatches(haystack: string, query: string, opts: FindOptions = {}): number[] {
  return findTextMatches(haystack, query, opts).map((m) => m.index);
}

/** The structural bits of a ProseMirror node the mapping needs. */
export interface DocNodeLike {
  isText: boolean;
  isBlock: boolean;
  text?: string | null;
}
export interface DocLike {
  descendants(cb: (node: DocNodeLike, pos: number) => void): void;
}

/**
 * Map the nth text match back to a document position range. Block boundaries
 * are represented as a synthetic -1 entry so matches never span paragraphs.
 * ProseMirror text nodes start at `pos`, so character i is at `pos + i`.
 */
function plainAndPositions(doc: DocLike): { chars: number[]; plain: string } {
  const chars: number[] = [];
  let plain = "";
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) chars.push(pos + i);
      plain += node.text;
    } else if (node.isBlock && plain && !plain.endsWith("\n")) {
      plain += "\n";
      chars.push(-1);
    }
  });
  return { chars, plain };
}

function rangeOf(chars: number[], hit: TextMatch): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (let i = hit.index; i < Math.min(chars.length, hit.index + hit.length); i++) {
    const pos = chars[i];
    if (pos == null || pos < 0) continue;
    if (from < 0) from = pos;
    to = pos + 1;
  }
  return from < 0 || to < 0 ? null : { from, to };
}

export function matchPositions(
  doc: DocLike,
  query: string,
  nth: number,
  opts: FindOptions = {}
): { from: number; to: number; total: number } | null {
  const { chars, plain } = plainAndPositions(doc);
  const hits = findTextMatches(plain, query, opts);
  if (!hits.length) return { from: -1, to: -1, total: 0 };
  const hit = hits[((nth % hits.length) + hits.length) % hits.length];
  if (!hit) return null;
  const range = rangeOf(chars, hit);
  if (!range) return null;
  return { ...range, total: hits.length };
}

/** Every match, mapped to document ranges (used by Replace all in Rich mode). */
export function allMatchPositions(
  doc: DocLike,
  query: string,
  opts: FindOptions = {}
): { from: number; to: number }[] {
  const { chars, plain } = plainAndPositions(doc);
  return findTextMatches(plain, query, opts)
    .map((hit) => rangeOf(chars, hit))
    .filter((r): r is { from: number; to: number } => !!r);
}
