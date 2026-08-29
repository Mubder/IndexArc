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
