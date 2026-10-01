import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// Plain CommonJS engine module without type declarations.
const { LanguageToolService } = require("./languagetool.cjs") as {
  LanguageToolService: any;
};

// AUD-015 regression: the old state machine started at mode="none" and
// _ensureAvailable() returned false on the very first call, so
// startLocalServer() (and the public-API fallback) were unreachable and the
// documented PRIMARY spell engine never ran.
describe("LanguageTool availability state machine", () => {
  it("actually ATTEMPTS local startup on first ensure (jar discovery runs)", async () => {
    const svc = new LanguageToolService();
    let jarLookups = 0;
    svc._findJar = () => {
      jarLookups++;
      return null; // no jar shipped in this environment
    };
    const ok = await svc._ensureAvailable();
    expect(ok).toBe(false); // no jar + public API not opted in
    expect(jarLookups).toBe(1); // ...but it TRIED — the attempt path is reachable
    expect(svc.getMode()).toBe("none"); // determined-unavailable, terminal
    expect(svc.getAvailable()).toBe(false);
  });

  it("single-flights concurrent ensure calls (one startup attempt)", async () => {
    const svc = new LanguageToolService();
    let jarLookups = 0;
    svc._findJar = () => {
      jarLookups++;
      return null;
    };
    await Promise.all([svc._ensureAvailable(), svc._ensureAvailable(), svc._ensureAvailable()]);
    expect(jarLookups).toBe(1);
  });

  it("does not retry after determining unavailable", async () => {
    const svc = new LanguageToolService();
    let jarLookups = 0;
    svc._findJar = () => {
      jarLookups++;
      return null;
    };
    await svc._ensureAvailable();
    await svc._ensureAvailable();
    expect(jarLookups).toBe(1); // terminal "none" — no per-keystroke respawns
  });
});
