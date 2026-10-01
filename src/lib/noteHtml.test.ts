// @vitest-environment jsdom
// ensureHtmlParagraphs sanitizes through DOMPurify and parses legacy <div>
// storage with DOMParser, so these tests need a DOM.
import { afterAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ensureHtmlParagraphs } from "./noteHtml";
import { textToNoteHtml, sanitizeNoteHtmlForStorage } from "../sanitize";

const blankLines = (html: string) => (html.match(/<p><\/p>/g) || []).length;

describe("ensureHtmlParagraphs never multiplies blank lines", () => {
  it("keeps hard breaks inside paragraphs (Shift+Enter is not Enter)", () => {
    const html = "<p>line one<br>line two</p>";
    expect(ensureHtmlParagraphs(html)).toBe(html);
  });

  it("collapses a <br>-only paragraph to ONE empty paragraph, not two", () => {
    expect(ensureHtmlParagraphs("<p>a</p><p><br></p><p>b</p>")).toBe(
      "<p>a</p><p></p><p>b</p>"
    );
  });

  it("is stable across repeated load/save round trips", () => {
    // The old blanket `<br> -> </p><p>` replace doubled blank lines on every
    // pass; a note reloaded N times ended up with 2^N blank lines.
    let html = "<p>a</p><p></p><p></p><p>b</p>";
    for (let i = 0; i < 6; i++) html = ensureHtmlParagraphs(html);
    expect(blankLines(html)).toBe(2);
  });

  it("converts legacy <div> line storage without doubling blank lines", () => {
    expect(ensureHtmlParagraphs("<div>A</div><div><br></div><div>B</div>")).toBe(
      "<p>A</p><p></p><p>B</p>"
    );
    expect(ensureHtmlParagraphs("<div>a<br>b</div>")).toBe("<p>a</p><p>b</p>");
    // A div with a single <br> is one blank line — the old replace produced
    // broken markup (`<div></p><p></div>`) that parsed as TWO blank lines.
    expect(blankLines(ensureHtmlParagraphs("<div>a</div><div><br></div><div>b</div>"))).toBe(1);
  });

  it("keeps formatting inside legacy div lines", () => {
    expect(ensureHtmlParagraphs("<div>a<br><strong>b</strong></div>")).toBe(
      "<p>a</p><p><strong>b</strong></p>"
    );
  });

  it("keeps non-div blocks verbatim", () => {
    const html = "<h1>Title</h1><ul><li>one</li><li>two</li></ul>";
    expect(ensureHtmlParagraphs(html)).toBe(html);
  });

  it("converts plain-text lines to paragraphs (blank line = one empty p)", () => {
    expect(ensureHtmlParagraphs("a\n\nb")).toBe("<p>a</p><p></p><p>b</p>");
  });

  it("sanitizes hostile markup on the way in", () => {
    const out = ensureHtmlParagraphs("<p onclick=\"x()\">a</p><img src=x onerror=alert(1)>");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("<img");
  });
});

describe("textToNoteHtml blank lines", () => {
  it("emits one empty paragraph per blank line (no <br> carriers)", () => {
    expect(textToNoteHtml("a\n\nb")).toBe("<p>a</p><p></p><p>b</p>");
  });

  it("escapes model HTML instead of parsing it", () => {
    expect(textToNoteHtml("<script>x</script>")).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>");
  });
});

describe("full load → editor → save → load round trip", () => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: "",
  });
  afterAll(() => editor.destroy());

  // Mirrors the app: load applies ensureHtmlParagraphs before setContent;
  // the save queue posts sanitizeNoteHtmlForStorage(getHTML()).
  const roundTrip = (html: string): string => {
    editor.commands.setContent(ensureHtmlParagraphs(html), { emitUpdate: false });
    return sanitizeNoteHtmlForStorage(editor.getHTML());
  };

  it("never grows blank lines, for div-legacy, hard-break, and AI-insert content", () => {
    const cases = [
      "<div>A</div><div><br></div><div>B</div>", // legacy line storage
      "<p>one<br><br>two</p>", // typed hard breaks (Shift+Enter blank line)
      textToNoteHtml("a\n\nb"), // AI insert
      "<p>keep<br>break</p>", // inline hard break
    ];
    for (const start of cases) {
      const before = blankLines(roundTrip(start));
      let html = start;
      for (let i = 0; i < 6; i++) html = roundTrip(html);
      expect(blankLines(html)).toBe(before);
      expect(html).not.toContain("<div");
    }
  });

  it("converges to stable output (idempotent after the first pass)", () => {
    let html = roundTrip("<div>A</div><div><br></div><div>B</div>");
    for (let i = 0; i < 5; i++) {
      const next = roundTrip(html);
      expect(next).toBe(html);
      html = next;
    }
  });


});
