import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const { classifyDocPath } = require("./doc-files.cjs");

const root = path.resolve("/vault/root");

describe("classifyDocPath", () => {
  it("allows a markdown file outside the vault", () => {
    const r = classifyDocPath(root, path.resolve("/notes/sprint.md"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.editable).toBe(true);
  });

  it("allows json and yaml as editable text", () => {
    const json = classifyDocPath(root, path.resolve("/notes/a.json"));
    const yaml = classifyDocPath(root, path.resolve("/notes/a.yaml"));
    expect(json.ok && json.editable).toBe(true);
    expect(yaml.ok && yaml.editable).toBe(true);
  });

  it("allows pdf, word and spreadsheet files as read-only", () => {
    for (const ext of [".pdf", ".docx", ".xlsx"]) {
      const r = classifyDocPath(root, path.resolve(`/notes/a${ext}`));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.editable).toBe(false);
    }
  });

  it("allows json lines files as editable text", () => {
    const r = classifyDocPath(root, path.resolve("/notes/a.jsonl"));
    expect(r.ok && r.editable).toBe(true);
  });

  it("refuses the vault directory and unknown types", () => {
    expect(classifyDocPath(root, path.join(root, "data", "scratchpad.json")).ok).toBe(false);
    expect(classifyDocPath(root, path.resolve("/notes/a.exe")).ok).toBe(false);
    expect(classifyDocPath(root, "bad\0path").ok).toBe(false);
  });
});
