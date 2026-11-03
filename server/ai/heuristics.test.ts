import { describe, it, expect } from "vitest";
import { heuristicAnalyze } from "./heuristics.js";

describe("heuristicAnalyze — verbatim preservation", () => {
  it("preserves leading underscore standalone", () => {
    const r = heuristicAnalyze("_mysecret_123");
    expect(r[0]?.value).toBe("_mysecret_123");
  });
  it("preserves double leading underscore", () => {
    const r = heuristicAnalyze("__leading_secret");
    expect(r[0]?.value).toBe("__leading_secret");
  });
  it("preserves http URL verbatim (not split as env)", () => {
    const r = heuristicAnalyze("https://example.com/_path_with_underscore");
    expect(r[0]?.value).toBe("https://example.com/_path_with_underscore");
    expect(r[0]?.type).toBe("url");
  });
  it("preserves env value with leading underscore", () => {
    const r = heuristicAnalyze("TOKEN=_secret_value");
    const v = r.find((c) => c.value === "_secret_value");
    expect(v).toBeDefined();
  });
  it("preserves env URL value with http and underscore", () => {
    const r = heuristicAnalyze("URL=https://example.com/_path");
    expect(r[0]?.value).toBe("https://example.com/_path");
  });
});

describe("heuristicAnalyze — env parsing", () => {
  it("strips surrounding quotes and whitespace from env values", () => {
    const r = heuristicAnalyze(`export API_TOKEN = "abc123def456ghi"  `);
    expect(r.some((c) => c.value === "abc123def456ghi")).toBe(true);
  });
  it("stays linear on a long whitespace run (ReDoS regression)", () => {
    const line = "KEY=a" + " ".repeat(200_000) + "b";
    const t0 = Date.now();
    heuristicAnalyze(line);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
