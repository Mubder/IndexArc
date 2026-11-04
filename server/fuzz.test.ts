import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { heuristicAnalyze, expandQueryTerms } from "./ai/heuristics";
import { zipBudgetProblem } from "./services/folderScan";

// Fuzz smoke (R4): random and structured inputs must never crash, hang, or
// produce values that were not in the input. Runs in the normal test suite;
// set FUZZ_RUNS for a longer local soak.
const RUNS = Number(process.env.FUZZ_RUNS) || 150;

// Structured fragments real pastes are made of, mixed with noise.
const fragment = fc.oneof(
  fc.string({ unit: "binary", maxLength: 80 }),
  fc.constantFrom(
    "API_KEY=",
    "export ",
    "password: ",
    "sk-",
    "ghp_",
    "AKIA",
    "postgres://u:p@h:5432/db",
    "docker compose up -d",
    "&&",
    "||",
    ";",
    "\n",
    "\r\n",
    "\t",
    "=====",
    "-----BEGIN PRIVATE KEY-----",
    "كلمة المرور: ",
    "```",
    '"',
    "'",
    "\u0000",
    "‮"
  ),
  fc.stringMatching(/^[A-Za-z0-9_\-]{16,64}$/)
);
const paste = fc.array(fragment, { maxLength: 40 }).map((p) => p.join(""));

describe("fuzz: heuristicAnalyze", () => {
  it("never throws, stays fast, and only returns values found in the paste", () => {
    fc.assert(
      fc.property(paste, (text) => {
        const t0 = performance.now();
        const out = heuristicAnalyze(text);
        const ms = performance.now() - t0;
        expect(Array.isArray(out)).toBe(true);
        expect(ms).toBeLessThan(1000);
        for (const c of out) {
          expect(typeof c.value).toBe("string");
          // Detected values come from the paste (trimmed/unquoted), never invented.
          const v = c.value.trim();
          if (v) expect(text.includes(v) || text.replace(/\s+/g, " ").includes(v.replace(/\s+/g, " "))).toBe(true);
        }
      }),
      { numRuns: RUNS }
    );
  });

  it("handles very long single-character runs in linear-ish time", () => {
    for (const ch of [" ", "=", "-", "a", "&", ";", "\n", "'"]) {
      const t0 = performance.now();
      heuristicAnalyze(ch.repeat(50_000));
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
});

describe("fuzz: expandQueryTerms", () => {
  it("never throws and returns strings", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (q) => {
        const out = expandQueryTerms(q);
        expect(Array.isArray(out)).toBe(true);
        for (const s of out) expect(typeof s).toBe("string");
      }),
      { numRuns: RUNS }
    );
  });
});

describe("fuzz: zip budget check", () => {
  it("never throws on arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        const r = zipBudgetProblem(Buffer.from(bytes));
        expect(r === null || typeof r === "string").toBe(true);
      }),
      { numRuns: RUNS }
    );
  });

  it("never throws on mutated real zip headers", () => {
    // Minimal empty zip (end-of-central-directory record only).
    const eocd = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), fc.nat(21), fc.integer({ min: 0, max: 255 }), (prefix, pos, byte) => {
        const b = Buffer.concat([Buffer.from(prefix), eocd]);
        b[b.length - 22 + pos] = byte;
        const r = zipBudgetProblem(b);
        expect(r === null || typeof r === "string").toBe(true);
      }),
      { numRuns: RUNS }
    );
  });
});
