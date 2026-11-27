import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { associationPlan } = require("./file-assoc.cjs");

describe("associationPlan", () => {
  it("quotes the executable and keeps the file argument", () => {
    const plan = associationPlan("md", "C:\\Program Files\\IndexArc\\IndexArc.exe");
    expect(plan.exts).toContain(".md");
    expect(plan.id).toBe("IndexArc.md");
    expect(plan.command).toBe("\"C:\\Program Files\\IndexArc\\IndexArc.exe\" \"%1\"");
  });

  it("refuses an unknown kind", () => {
    expect(associationPlan("exe", "C:\\IndexArc.exe")).toBe(null);
  });
});
