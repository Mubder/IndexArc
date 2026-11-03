import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { zipBudgetProblem, MAX_ZIP_UNCOMPRESSED_BYTES, withTimeout } from "./services/folderScan.js";
import { isWatchedPath, isRegularFileInside } from "./services/folderWatcher.js";
import { checkOllama, embedText, embedModelId } from "./ai/providers.js";
import { DEFAULT_SETTINGS, type AppSettings } from "./types.js";

/** Minimal stored-only zip: one entry per [name, declaredUncompressedSize]. */
function fakeZip(entries: Array<[string, number]>): Buffer {
  const cd: Buffer[] = [];
  for (const [name, size] of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(size, 24);
    h.writeUInt16LE(Buffer.byteLength(name), 28);
    cd.push(h, Buffer.from(name));
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([cdBuf, eocd]);
}

// R1.4 — resource limits and egress routing.
describe("document parser limits", () => {
  it("accepts a normal Office zip and refuses a zip bomb", () => {
    expect(zipBudgetProblem(fakeZip([["word/document.xml", 200_000]]))).toBeNull();
    const bomb = fakeZip([
      ["a.xml", MAX_ZIP_UNCOMPRESSED_BYTES],
      ["b.xml", 1],
    ]);
    expect(zipBudgetProblem(bomb)).toMatch(/zip bomb/);
    expect(zipBudgetProblem(Buffer.from("not a zip at all"))).toMatch(/Not a valid/);
  });

  it("times out a parser that never finishes", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "test parse")).rejects.toThrow(/timed out/);
  });
});

describe("folder watcher path policy", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-watch-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("skips the same directories as the one-shot scan", () => {
    expect(isWatchedPath(dir, path.join(dir, "src", ".env"))).toBe(true);
    expect(isWatchedPath(dir, path.join(dir, "node_modules", "x", ".env"))).toBe(false);
    expect(isWatchedPath(dir, path.join(dir, ".git", "config"))).toBe(false);
    expect(isWatchedPath(dir, path.join(dir, "a", "dist", "out.js"))).toBe(false);
    expect(isWatchedPath(dir, path.join(dir, "..", "elsewhere.txt"))).toBe(false);
  });

  it("does not follow a symlink out of the watched folder", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-outside-"));
    try {
      const secret = path.join(outside, "id_rsa");
      fs.writeFileSync(secret, "PRIVATE");
      const inside = path.join(dir, "notes.txt");
      fs.writeFileSync(inside, "ok");
      expect(isRegularFileInside(dir, inside)).toBe(true);
      const link = path.join(dir, "link.txt");
      try {
        fs.symlinkSync(secret, link, "file");
      } catch {
        return; // no symlink privilege on this Windows account — nothing to test
      }
      expect(isRegularFileInside(dir, link)).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("egress routing", () => {
  const calls: string[] = [];
  const mk = (patch: Partial<AppSettings>): AppSettings => ({ ...DEFAULT_SETTINGS, ...patch }) as AppSettings;

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: any) => {
      calls.push(String(url));
      throw new Error("offline");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never probes a remote Ollama without consent", async () => {
    const r = await checkOllama(mk({ ollama_base_url: "http://ollama.example.net:11434", ai_cloud_consent: false }), true);
    expect(r.online).toBe(false);
    expect(calls).toEqual([]);
  });

  it("a local pin with Ollama offline never falls back to Gemini", async () => {
    const s = mk({ ai_provider: "local", gemini_api_key: "AIza-test", ai_cloud_consent: true });
    expect(await embedText(s, "harmless")).toBeNull();
    expect(calls.filter((u) => !/127\.0\.0\.1|localhost/.test(u))).toEqual([]);
  });

  it("embed_provider_override wins over the caller's LLM provider", async () => {
    const s = mk({ ai_provider: "auto", embed_provider_override: "local", gemini_api_key: "AIza-test", ai_cloud_consent: true });
    await embedText(s, "harmless", "api");
    expect(calls.filter((u) => !/127\.0\.0\.1|localhost/.test(u))).toEqual([]);
    expect(embedModelId(s, "api")).toBe(`local:${s.ollama_embed_model}`);
  });
});

describe("LanguageTool consent", () => {
  const prev = process.env.INDEXARC_LT_PUBLIC;
  afterEach(() => {
    if (prev === undefined) delete process.env.INDEXARC_LT_PUBLIC;
    else process.env.INDEXARC_LT_PUBLIC = prev;
  });

  it("stops using the public API as soon as consent is revoked", async () => {
    const { LanguageToolService } = createRequire(import.meta.url)("../shared/languagetool.cjs");
    const lt = new LanguageToolService();
    lt.mode = "public"; // a session that already chose the public API
    const post = vi.spyOn(lt, "_post").mockResolvedValue({ matches: [] });
    process.env.INDEXARC_LT_PUBLIC = "";
    expect(await lt.check("some private note text", "en-US")).toEqual([]);
    expect(post).not.toHaveBeenCalled();
    expect(lt.getMode()).toBe("none");
  });
});
