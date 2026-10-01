// Note comparison for the Scratchpad "compare two notes" view.
// Dependency-free (LCS diff) on purpose: comparing notes must never send
// content anywhere — same privacy posture as the rest of the app.
import { sanitizeNoteHtmlForStorage } from "../sanitize";

export interface DiffToken {
  type: "equal" | "delete" | "insert";
  text: string;
}

export interface CompareSide {
  text: string;
  kind: "equal" | "delete" | "insert" | "changed";
  /** Word-level highlight for "changed" rows (equal + own-side tokens). */
  tokens?: DiffToken[];
}

export interface CompareRow {
  left: CompareSide | null;
  right: CompareSide | null;
}

export interface CompareStats {
  added: number;
  removed: number;
  unchanged: number;
}

// One detached div reused for html->lines (same technique as htmlToPlainText).
let toLinesDiv: HTMLDivElement | null = null;

/** Note HTML → plain-text lines (blocks and <br> each end a line). */
export function noteToLines(html: string): string[] {
  if (!html) return [];
  if (!toLinesDiv) toLinesDiv = document.createElement("div");
  const d = toLinesDiv;
  d.innerHTML = sanitizeNoteHtmlForStorage(html)
    // A block holding only a <br> is ONE empty line (the <br> is a
    // render placeholder, like TipTap's trailing break) — drop it before
    // block-closes become newlines or the blank line counts twice.
    .replace(/(<(p|div|h[1-6]|li|blockquote|pre)[^>]*>)(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*<\/\2>/gi, "$1</$2>")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n</$1>");
  const text = (d.textContent || "").replace(/\u00a0/g, " ");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

type SeqOp = { type: "equal" | "delete" | "insert"; ai: number; bi: number };

// Above this, the O(n·m) LCS table would allocate >64MB — fall back to a
// coarse full-replace for the (already prefix/suffix-trimmed) middle. Only
// pathological paste-bombs ever hit it.
const LCS_CELL_LIMIT = 16_000_000;

/**
 * Longest-common-subsequence diff over two sequences of strings.
 * Common prefix/suffix are trimmed first, which collapses the typical
 * "one paragraph edited in a long note" case to a tiny middle.
 */
function diffSequences(a: string[], b: string[]): SeqOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: SeqOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "equal", ai: i, bi: i });

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= LCS_CELL_LIMIT) {
    // DP lengths, then walk forward through it to emit ops.
    const w = m + 1;
    const dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a[start + i] === b[start + j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ type: "equal", ai: start + i, bi: start + j });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        ops.push({ type: "delete", ai: start + i, bi: -1 });
        i++;
      } else {
        ops.push({ type: "insert", ai: -1, bi: start + j });
        j++;
      }
    }
    while (i < n) ops.push({ type: "delete", ai: start + i++, bi: -1 });
    while (j < m) ops.push({ type: "insert", ai: -1, bi: start + j++ });
  } else {
    for (let i = 0; i < n; i++) ops.push({ type: "delete", ai: start + i, bi: -1 });
    for (let j = 0; j < m; j++) ops.push({ type: "insert", ai: -1, bi: start + j });
  }

  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ type: "equal", ai: endA + k, bi: endB + k });
  }
  return ops;
}

const WORD_TOKEN_RE = /[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]+/gu;

function tokenizeWords(line: string): string[] {
  return line.match(WORD_TOKEN_RE) || [];
}

/** Word-level diff of two lines, adjacent same-type tokens merged. */
function diffWords(aLine: string, bLine: string): DiffToken[] {
  const a = tokenizeWords(aLine);
  const b = tokenizeWords(bLine);
  const ops = diffSequences(a, b);
  const out: DiffToken[] = [];
  for (const op of ops) {
    const text = op.type === "insert" ? b[op.bi] : a[op.ai];
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += text;
    else out.push({ type: op.type, text });
  }
  return out;
}

/** Cheap similarity gate: share of tokens the two lines have in common. */
function lineSimilarity(aLine: string, bLine: string): number {
  const a = tokenizeWords(aLine).filter((t) => t.trim());
  const b = tokenizeWords(bLine).filter((t) => t.trim());
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) || 0) + 1);
  let common = 0;
  for (const t of b) {
    const c = counts.get(t) || 0;
    if (c > 0) {
      counts.set(t, c - 1);
      common++;
    }
  }
  return common / Math.max(a.length, b.length);
}

/**
 * Build aligned side-by-side rows. Deleted/inserted line runs are zipped
 * pairwise; a pair whose lines are similar enough is marked "changed" and
 * gets a word-level token diff, otherwise each line stays a plain
 * delete/insert row (pairing unrelated lines would read as a false edit).
 */
export function buildCompareRows(aLines: string[], bLines: string[]): CompareRow[] {
  const ops = diffSequences(aLines, bLines);
  const rows: CompareRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      rows.push({
        left: { text: aLines[ops[i].ai], kind: "equal" },
        right: { text: bLines[ops[i].bi], kind: "equal" },
      });
      i++;
      continue;
    }
    const dels: number[] = [];
    const ins: number[] = [];
    while (i < ops.length && ops[i].type === "delete") dels.push(ops[i++].ai);
    while (i < ops.length && ops[i].type === "insert") ins.push(ops[i++].bi);
    const pairs = Math.min(dels.length, ins.length);
    for (let k = 0; k < pairs; k++) {
      const ta = aLines[dels[k]];
      const tb = bLines[ins[k]];
      if (lineSimilarity(ta, tb) >= 0.3) {
        const tokens = diffWords(ta, tb);
        rows.push({
          left: { text: ta, kind: "changed", tokens: tokens.filter((t) => t.type !== "insert") },
          right: { text: tb, kind: "changed", tokens: tokens.filter((t) => t.type !== "delete") },
        });
      } else {
        rows.push({ left: { text: ta, kind: "delete" }, right: null });
        rows.push({ left: null, right: { text: tb, kind: "insert" } });
      }
    }
    for (let k = pairs; k < dels.length; k++) {
      rows.push({ left: { text: aLines[dels[k]], kind: "delete" }, right: null });
    }
    for (let k = pairs; k < ins.length; k++) {
      rows.push({ left: null, right: { text: bLines[ins[k]], kind: "insert" } });
    }
  }
  return rows;
}

export function compareStats(rows: CompareRow[]): CompareStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const r of rows) {
    if (r.left?.kind === "equal" && r.right?.kind === "equal") unchanged++;
    if (r.left && r.left.kind !== "equal") removed++;
    if (r.right && r.right.kind !== "equal") added++;
  }
  return { added, removed, unchanged };
}
