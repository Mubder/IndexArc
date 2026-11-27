import { describe, expect, it } from "vitest";
import { insertNormalizedPaste, normalizePastedPlain, plainToParagraphHtml, plainToSimpleHtml } from "./clipboardText";

describe("normalizePastedPlain", () => {
  it("collapses the blank line between every point", () => {
    expect(normalizePastedPlain("• first\n\n• second\n\n• third")).toBe("• first\n• second\n• third");
  });

  it("collapses Windows paragraph spacing", () => {
    expect(normalizePastedPlain("one\r\n\r\ntwo\r\n\r\nthree\r\n")).toBe("one\ntwo\nthree");
  });

  it("keeps a real blank line inside mixed text", () => {
    expect(normalizePastedPlain("alpha\nbeta\n\ngamma")).toBe("alpha\nbeta\n\ngamma");
  });

  it("collapses a run of empty lines to one blank line", () => {
    expect(normalizePastedPlain("alpha\n\n\n\nbeta")).toBe("alpha\n\nbeta");
  });

  it("keeps one real blank inside an otherwise double-spaced paste", () => {
    expect(normalizePastedPlain("a\n\nb\n\n\nc\n\nd")).toBe("a\nb\n\nc\nd");
  });

  it("treats a non-breaking-space line as empty", () => {
    expect(normalizePastedPlain("a\n\u00a0\nb\n\u00a0\nc")).toBe("a\nb\nc");
  });

  it("drops a trailing newline so the caret is not left on a new blank line", () => {
    expect(normalizePastedPlain("only line\n")).toBe("only line");
  });
});

describe("insertNormalizedPaste", () => {
  it("replaces the selection with normalized lines", () => {
    const r = insertNormalizedPaste("keep END", 5, 5, "a\n\nb");
    expect(r).toEqual({ value: "keep a\nbEND", caret: 8 });
  });
});

describe("clipboard html", () => {
  it("builds one paragraph per kept line", () => {
    expect(plainToParagraphHtml("a\n\nb")).toBe("<p>a</p><p></p><p>b</p>");
  });

  it("uses divs so a copy is not a spaced paragraph", () => {
    expect(plainToSimpleHtml("a\nb")).toBe("<div>a</div><div>b</div>");
    expect(plainToSimpleHtml("a & b")).toBe("<div>a &amp; b</div>");
  });
});
