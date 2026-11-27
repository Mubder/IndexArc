/** Indexes of `query` inside `haystack`, case-insensitive. Overlaps are not returned. */
export function findMatches(haystack: string, query: string): number[] {
  const q = query.trim();
  if (!q) return [];
  const h = haystack.toLowerCase();
  const needle = q.toLowerCase();
  const out: number[] = [];
  let i = 0;
  while (i <= h.length - needle.length) {
    const at = h.indexOf(needle, i);
    if (at < 0) break;
    out.push(at);
    i = at + Math.max(needle.length, 1);
  }
  return out;
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
export function matchPositions(
  doc: DocLike,
  query: string,
  nth: number
): { from: number; to: number; total: number } | null {
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
  const hits = findMatches(plain, query);
  if (!hits.length) return { from: -1, to: -1, total: 0 };
  const at = hits[((nth % hits.length) + hits.length) % hits.length];
  if (at == null) return null;
  let from = -1;
  let to = -1;
  const len = query.trim().length;
  for (let i = at; i < at + len; i++) {
    const pos = chars[i];
    if (pos == null || pos < 0) continue;
    if (from < 0) from = pos;
    to = pos + 1;
  }
  if (from < 0 || to < 0) return null;
  return { from, to, total: hits.length };
}
