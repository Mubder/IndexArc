// @vitest-environment jsdom
// noteToLines sanitizes through DOMPurify and parses with a detached div,
// so these tests need a DOM.
import { describe, expect, it } from "vitest";
import { buildCompareRows, compareStats, noteToLines } from "./noteDiff";

const kinds = (rows: ReturnType<typeof buildCompareRows>) =>
  rows.map((r) => `${r.left?.kind ?? "-"}|${r.right?.kind ?? "-"}`);

describe("noteToLines", () => {
  it("splits paragraphs and hard breaks into lines", () => {
    expect(noteToLines("<p>one</p><p>two<br>three</p>")).toEqual(["one", "two", "three"]);
  });

  it("converts legacy div storage and strips outer blank lines", () => {
    expect(noteToLines("<div>a</div><div><br></div><div>b</div>")).toEqual(["a", "", "b"]);
  });

  it("decodes entities and keeps interior blank lines", () => {
    expect(noteToLines("<p>a &amp; b</p><p></p><p>c</p>")).toEqual(["a & b", "", "c"]);
  });

  it("returns [] for empty notes", () => {
    expect(noteToLines("")).toEqual([]);
    expect(noteToLines("<p></p>")).toEqual([]);
  });
});

describe("buildCompareRows", () => {
  it("marks all rows equal for identical notes", () => {
    const rows = buildCompareRows(["a", "b"], ["a", "b"]);
    expect(kinds(rows)).toEqual(["equal|equal", "equal|equal"]);
    expect(compareStats(rows)).toEqual({ added: 0, removed: 0, unchanged: 2 });
  });

  it("reports a changed line as a word-level pair", () => {
    const rows = buildCompareRows(["deploy the bot now"], ["deploy the robot now"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.kind).toBe("changed");
    expect(rows[0].right?.kind).toBe("changed");
    // The changed word is isolated: equal prefix/suffix, one delete, one insert.
    const del = rows[0].left?.tokens?.filter((t) => t.type === "delete").map((t) => t.text.trim());
    const add = rows[0].right?.tokens?.filter((t) => t.type === "insert").map((t) => t.text.trim());
    expect(del).toEqual(["bot"]);
    expect(add).toEqual(["robot"]);
  });

  it("reports a purely inserted word with no deletions", () => {
    const rows = buildCompareRows(["deploy the bot now"], ["deploy the chat bot now"]);
    expect(rows[0].left?.kind).toBe("changed");
    const del = rows[0].left?.tokens?.filter((t) => t.type === "delete");
    const add = rows[0].right?.tokens?.filter((t) => t.type === "insert").map((t) => t.text.trim());
    expect(del).toEqual([]);
    expect(add).toEqual(["chat"]);
  });

  it("reports added and removed lines on their own side", () => {
    const rows = buildCompareRows(["keep", "drop"], ["keep", "new1", "new2"]);
    expect(kinds(rows)).toEqual(["equal|equal", "delete|-", "-|insert", "-|insert"]);
    expect(compareStats(rows)).toEqual({ added: 2, removed: 1, unchanged: 1 });
  });

  it("does not pair unrelated lines as a word edit", () => {
    const rows = buildCompareRows(["git push origin main"], ["شتاء دافئ في الشتاء"]);
    // Similarity below the gate: plain delete + insert rows, no fake pairing.
    expect(kinds(rows)).toEqual(["delete|-", "-|insert"]);
  });

  it("diffs Arabic content word by word", () => {
    const rows = buildCompareRows(["الكتاب الأخضر كبير"], ["الكتاب الأزرق كبير"]);
    const del = rows[0].left?.tokens?.filter((t) => t.type === "delete").map((t) => t.text);
    const add = rows[0].right?.tokens?.filter((t) => t.type === "insert").map((t) => t.text);
    expect(del).toEqual(["الأخضر"]);
    expect(add).toEqual(["الأزرق"]);
  });

  it("handles empty notes on either side", () => {
    const rows = buildCompareRows([], ["hello"]);
    expect(kinds(rows)).toEqual(["-|insert"]);
    const rows2 = buildCompareRows(["hello"], []);
    expect(kinds(rows2)).toEqual(["delete|-"]);
  });

  it("keeps line alignment around edits in long notes", () => {
    const a = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const b = [...a.slice(0, 30), "line 30 EDITED", ...a.slice(31)];
    const rows = buildCompareRows(a, b);
    const stats = compareStats(rows);
    expect(stats).toEqual({ added: 1, removed: 1, unchanged: 59 });
    expect(rows).toHaveLength(60);
  });
});
