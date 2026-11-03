import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";
import ts from "typescript";

// R4 regex timing guard (ReDoS). Collects EVERY regular-expression literal
// (plus any `new RegExp("literal")`) from the files below by parsing their
// source with the TypeScript compiler, constructs each one and runs it
// against ~50k-char adversarial inputs. Any single .test() call slower than
// BUDGET_MS fails. A pattern that backtracks catastrophically would hang the
// test thread, so the timing runs in a worker with a watchdog.

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [path.join(here, "heuristics.ts"), path.join(here, "..", "services", "folderScan.ts")];
const BUDGET_MS = 100;
const BIG = 50_000;
const SMALL = 5_000;
// A pattern taking this long on the 5k input is already super-linear enough
// to blow the budget at 50k (quadratic: x100) — skip the 50k run to keep the
// suite fast, and report it. (Re-measured once to absorb a GC/JIT hiccup.)
const SMALL_ABORT_MS = 5;
const WATCHDOG_MS = 5_000;

interface Pattern {
  file: string;
  line: number;
  source: string;
  flags: string;
  text: string;
}

function collect(file: string): Pattern[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Pattern[] = [];
  const rel = path.relative(path.join(here, "..", ".."), file).replace(/\\/g, "/");
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const text = n.getText(sf);
      const slash = text.lastIndexOf("/");
      out.push({ file: rel, line: lineOf(n), source: text.slice(1, slash), flags: text.slice(slash + 1), text });
    } else if (
      (ts.isNewExpression(n) || ts.isCallExpression(n)) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "RegExp" &&
      n.arguments?.length
    ) {
      const [a, f] = n.arguments;
      if (ts.isStringLiteralLike(a)) {
        const flags = f && ts.isStringLiteralLike(f) ? f.text : "";
        out.push({ file: rel, line: lineOf(n), source: a.text, flags, text: `new RegExp(${a.getText(sf)})` });
      } else {
        // Dynamic pattern — cannot be enumerated statically. Surface it.
        out.push({ file: rel, line: lineOf(n), source: "", flags: "", text: `DYNAMIC ${n.getText(sf).slice(0, 80)}` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Adversarial input generators: (n) → string of ~n chars. */
const rep = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const ADVERSARIAL: [string, (n: number) => string][] = [
  ["spaces", (n) => rep(" ", n)],
  ["spaces+x", (n) => rep(" ", n - 1) + "x"],
  ["tabs/spaces", (n) => rep(" \t", n)],
  ["newlines", (n) => rep("\n", n)],
  ["crlf", (n) => rep("\r\n", n)],
  ["blank lines w/ spaces", (n) => rep("  \n", n)],
  ["a=a=a=", (n) => rep("a=", n)],
  ["a=a=a= + !", (n) => rep("a=", n - 1) + "!"],
  ["KEY=KEY=", (n) => rep("KEY_A=", n)],
  ["export X=", (n) => rep("export X=", n)],
  ["equals", (n) => rep("=", n)],
  ["colons", (n) => rep(":", n)],
  ["a: a: ", (n) => rep("a: ", n)],
  ["dashes", (n) => rep("-", n)],
  ["underscores", (n) => rep("_", n)],
  ["dots", (n) => rep(".", n)],
  ["slashes", (n) => rep("/", n)],
  ["dquotes", (n) => rep('"', n)],
  ["squotes", (n) => rep("'", n)],
  ['"a"=', (n) => rep('"a"=', n)],
  ['unterminated "', (n) => '"' + rep("a", n - 1)],
  ["backticks", (n) => rep("`", n)],
  ["a*n", (n) => rep("a", n)],
  ["a*n+!", (n) => rep("a", n - 1) + "!"],
  ["A1 alnum", (n) => rep("A1", n)],
  ["hex", (n) => rep("deadbeef", n)],
  ["base64ish", (n) => rep("Ab9+/=", n)],
  ["digits", (n) => rep("0", n)],
  ["digits+x", (n) => rep("1", n - 1) + "x"],
  ["word space", (n) => rep("a ", n)],
  ["word newline", (n) => rep("ab\n", n)],
  ["arabic", (n) => rep("ب", n)],
  ["arabic words", (n) => rep("كلمة ", n)],
  ["url-ish", (n) => "https://" + rep("a.", n - 8)],
  ["url path", (n) => "https://x.io/" + rep("a/", n - 13)],
  ["email-ish", (n) => rep("a@", n)],
  ["braces", (n) => rep("{", n)],
  ["parens", (n) => rep("(", n)],
  ["brackets", (n) => rep("[", n)],
  ["hash", (n) => rep("#", n)],
  ["dollar paren", (n) => rep("$(", n)],
  ["pipes", (n) => rep("|", n)],
  ["commas", (n) => rep(",", n)],
  ["mixed sep", (n) => rep(" =: -_./\"'", n)],
  ["token-ish", (n) => rep("sk-", n)],
  ["ghp_", (n) => "ghp_" + rep("A", n - 4)],
  ["Bearer", (n) => "Bearer " + rep(" ", n - 7)],
];

const WORKER_SRC = `
const { parentPort, workerData } = require("worker_threads");
const { patterns, inputs, start, budget, smallAbort } = workerData;
for (let i = start; i < patterns.length; i++) {
  parentPort.postMessage({ type: "begin", i });
  const p = patterns[i];
  let re;
  try { re = new RegExp(p.source, p.flags); } catch (e) {
    parentPort.postMessage({ type: "done", i, error: String(e && e.message || e) });
    continue;
  }
  let worstMs = 0, worstInput = "", slow = false;
  for (const inp of inputs) {
    parentPort.postMessage({ type: "tick" });
    re.lastIndex = 0;
    let t = performance.now();
    re.test(inp.small);
    let ms = performance.now() - t;
    if (ms > smallAbort) {
      re.lastIndex = 0;
      t = performance.now();
      re.test(inp.small);
      ms = Math.min(ms, performance.now() - t);
    }
    if (ms > smallAbort) {
      slow = true;
      if (ms > worstMs) { worstMs = ms; worstInput = inp.name + " @" + inp.small.length; }
      continue;
    }
    re.lastIndex = 0;
    t = performance.now();
    re.test(inp.big);
    ms = performance.now() - t;
    if (ms > worstMs) { worstMs = ms; worstInput = inp.name + " @" + inp.big.length; }
    if (ms > budget) slow = true;
  }
  parentPort.postMessage({ type: "done", i, worstMs, worstInput, slow });
}
parentPort.postMessage({ type: "end" });
`;

interface Result {
  pattern: Pattern;
  worstMs: number;
  worstInput: string;
  slow: boolean;
  error?: string;
}

function runAll(patterns: Pattern[]): Promise<Result[]> {
  const inputs = ADVERSARIAL.map(([name, gen]) => ({ name, small: gen(SMALL), big: gen(BIG) }));
  const results: Result[] = [];
  return new Promise((resolve, reject) => {
    const spawn = (start: number) => {
      if (start >= patterns.length) return resolve(results);
      let current = start;
      const w = new Worker(WORKER_SRC, {
        eval: true,
        workerData: { patterns, inputs, start, budget: BUDGET_MS, smallAbort: SMALL_ABORT_MS },
      });
      let timer: NodeJS.Timeout;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          // One .test() call ran past the watchdog — catastrophic
          // backtracking. Record and continue after it.
          results.push({ pattern: patterns[current], worstMs: Infinity, worstInput: `hung > ${WATCHDOG_MS} ms`, slow: true });
          void w.terminate();
          spawn(current + 1);
        }, WATCHDOG_MS);
      };
      arm();
      w.on("message", (m: any) => {
        arm();
        if (m.type === "begin") current = m.i;
        else if (m.type === "done") {
          results.push({ pattern: patterns[m.i], worstMs: m.worstMs ?? 0, worstInput: m.worstInput ?? "", slow: !!m.slow, error: m.error });
        } else if (m.type === "end") {
          clearTimeout(timer);
          void w.terminate();
          resolve(results);
        }
      });
      w.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    };
    spawn(0);
  });
}

// Patterns that are KNOWN to blow the budget today. Each is a real
// ReDoS-class (quadratic) bug — a leading `\s*` retried from every start
// position of a long whitespace run. They are listed here and asserted as
// it.fails below instead of being fixed in this verification change (the
// files belong to the AI/heuristics work). Key = the literal as written in
// source, so line drift does not matter. When one is fixed, its it.fails
// starts failing: delete the row.
const KNOWN_SLOW: Record<string, string> = {
  // heuristics.ts isCommand(): t.split(...) for chained shell commands —
  // ~2.2 s on a 50k run of spaces (reachable: the guard only needs one " && ").
  [String.raw`/\s*(?:&&|\|\||;)\s*/`]: "quadratic on long whitespace runs (~2.2 s @ 50k spaces)",
  // heuristics.ts stripSectionRule(): decorative-rule stripper on title lines —
  // ~1.9 s on a 50k run of interior spaces.
  [String.raw`/\s*[=\-_*]{3,}\s*/g`]: "quadratic on long whitespace runs (~1.9 s @ 50k spaces)",
};

const id = (p: Pattern) => `${p.file}:${p.line}`;

describe("R4 regex timing guard (ReDoS)", () => {
  let patterns: Pattern[] = [];
  let results: Result[] = [];

  beforeAll(async () => {
    patterns = FILES.flatMap(collect);
    results = await runAll(patterns.filter((p) => p.source));
  }, 600_000);

  it("finds the regex literals in both files", () => {
    expect(patterns.filter((p) => p.file.endsWith("heuristics.ts")).length).toBeGreaterThan(20);
    expect(patterns.filter((p) => p.file.endsWith("folderScan.ts")).length).toBeGreaterThan(3);
    expect(results.length).toBe(patterns.filter((p) => p.source).length);
  });

  it("no dynamic (non-enumerable) RegExp construction in the guarded files", () => {
    expect(patterns.filter((p) => !p.source).map((p) => `${id(p)} ${p.text}`)).toEqual([]);
  });

  it("every pattern compiles", () => {
    expect(results.filter((r) => r.error).map((r) => `${id(r.pattern)} ${r.pattern.text}: ${r.error}`)).toEqual([]);
  });

  it(`no single .test() over ${BUDGET_MS} ms on ~${BIG / 1000}k-char adversarial input`, () => {
    const slow = results
      .filter((r) => r.slow && !(r.pattern.text in KNOWN_SLOW))
      .map((r) => `${id(r.pattern)} ${r.pattern.text} — ${Number.isFinite(r.worstMs) ? r.worstMs.toFixed(1) + " ms" : "hung"} on ${r.worstInput}`);
    expect(slow).toEqual([]);
  });

  it("every KNOWN_SLOW pattern still exists in source (else drop the row)", () => {
    const texts = new Set(patterns.map((p) => p.text));
    expect(Object.keys(KNOWN_SLOW).filter((t) => !texts.has(t))).toEqual([]);
  });

  for (const [text, why] of Object.entries(KNOWN_SLOW)) {
    it.fails(`${text} stays under budget (KNOWN BUG: ${why})`, () => {
      const hits = results.filter((x) => x.pattern.text === text);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((h) => `${id(h.pattern)} slow=${h.slow}`).filter((x) => x.endsWith("true"))).toEqual([]);
    });
  }
});
