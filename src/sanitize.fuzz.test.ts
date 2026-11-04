// @vitest-environment jsdom
// Fuzz smoke (R4) for the note HTML sanitizer: generated hostile markup must
// never keep scripts, event handlers or script URLs.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sanitizeNoteHtml, sanitizeNoteHtmlForStorage } from "./sanitize";

const RUNS = Number(process.env.FUZZ_RUNS) || 150;

describe("fuzz: note HTML sanitizer", () => {
  const tag = fc.constantFrom("script", "img", "a", "iframe", "svg", "p", "style", "object", "math", "details");
  const attr = fc.constantFrom("onerror", "onclick", "href", "src", "style", "srcdoc", "xlink:href", "formaction");
  const val = fc.constantFrom("javascript:alert(1)", "data:text/html,x", "x", "jav&#x09;ascript:1", "vbscript:1", "\"><script>1</script>");
  const html = fc
    .array(fc.oneof(fc.tuple(tag, attr, val).map(([t, a, v]) => `<${t} ${a}="${v}">x</${t}>`), fc.string({ maxLength: 40 })), { maxLength: 20 })
    .map((p) => p.join(""));

  it("never lets script, event handlers or javascript: URLs through", () => {
    fc.assert(
      fc.property(html, (input) => {
        for (const out of [sanitizeNoteHtml(input), sanitizeNoteHtmlForStorage(input)].map((o) => String(o).toLowerCase())) {
          expect(out).not.toMatch(/<script|<iframe|<object|<embed|\son\w+\s*=|srcdoc=/);
          // Script URLs matter in URL attributes (inline style text cannot run in Chromium).
          expect(out).not.toMatch(/(?:href|src|action|formaction)\s*=\s*["']?\s*(?:javascript|vbscript|data):/);
        }
      }),
      { numRuns: RUNS }
    );
  });
});
