import { describe, expect, it } from "vitest";
import { findMatches, findTextMatches, matchPositions, type DocNodeLike } from "./findText";

describe("findMatches", () => {
  it("finds every case-insensitive hit", () => {
    expect(findMatches("Alpha beta ALPHA", "alpha")).toEqual([0, 11]);
  });

  it("returns nothing for a blank query", () => {
    expect(findMatches("hello", "  ")).toEqual([]);
  });
});

/** Minimal stand-in for a ProseMirror doc: text nodes at known positions. */
function docWith(...nodes: { pos: number; text: string }[]) {
  return {
    descendants(cb: (node: DocNodeLike, pos: number) => void) {
      for (const n of nodes) {
        // ProseMirror visits a block node before its text child.
        cb({ isText: false, isBlock: true }, n.pos - 1);
        cb({ isText: true, isBlock: false, text: n.text }, n.pos);
      }
    },
  };
}

describe("find options", () => {
  it("matches case-sensitively when asked", () => {
    expect(findTextMatches("Alpha alpha", "alpha", { caseSensitive: true })).toEqual([{ index: 6, length: 5 }]);
    expect(findTextMatches("Alpha alpha", "alpha")).toEqual([{ index: 0, length: 5 }, { index: 6, length: 5 }]);
  });

  it("supports regular expressions with variable match lengths", () => {
    expect(findTextMatches("a1 bb22 c333", "\\d+", { regex: true })).toEqual([
      { index: 1, length: 1 }, { index: 5, length: 2 }, { index: 9, length: 3 },
    ]);
    expect(findTextMatches("A a", "a", { regex: true, caseSensitive: true })).toEqual([{ index: 2, length: 1 }]);
  });

  it("returns nothing for an invalid pattern instead of throwing", () => {
    expect(findTextMatches("abc", "[", { regex: true })).toEqual([]);
  });
});

describe("matchPositions", () => {
  it("maps a match to the correct document range (no off-by-one)", () => {
    // Text node starts at position 1: a=1, b=2, c=3, space=4, d=5, e=6, f=7.
    expect(matchPositions(docWith({ pos: 1, text: "abc def" }), "def", 0)).toEqual({ from: 5, to: 8, total: 1 });
  });

  it("reports the total and wraps nth", () => {
    const doc = docWith({ pos: 1, text: "alpha beta ALPHA" });
    expect(matchPositions(doc, "alpha", 0)).toEqual({ from: 1, to: 6, total: 2 });
    expect(matchPositions(doc, "alpha", 1)).toEqual({ from: 12, to: 17, total: 2 });
    expect(matchPositions(doc, "alpha", 2)).toEqual({ from: 1, to: 6, total: 2 });
    expect(matchPositions(doc, "missing", 0)).toEqual({ from: -1, to: -1, total: 0 });
  });

  it("does not match across block boundaries", () => {
    expect(matchPositions(docWith({ pos: 1, text: "ab" }, { pos: 5, text: "cd" }), "abcd", 0)).toEqual({ from: -1, to: -1, total: 0 });
    expect(matchPositions(docWith({ pos: 1, text: "ab" }, { pos: 5, text: "cd" }), "cd", 0)).toEqual({ from: 5, to: 7, total: 1 });
  });
});
