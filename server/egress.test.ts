import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { ensurePortableLayout } from "./paths.js";
import { VaultStore } from "./store.js";
import { AuditLog } from "./audit.js";
import { FolderWatcherManager } from "./services/folderWatcher.js";
import { createApp } from "./app.js";
import { DEFAULT_SETTINGS, type AppSettings, type VaultEntry } from "./types.js";
import { generateText, embedText, autoComplete, analyzePaste } from "./ai/providers.js";
import { askVault } from "./services/ask.js";
import { indexEntry } from "./services/vault.js";

// R4 egress tests. global fetch is stubbed to capture every outbound request
// (URL + body). The fake answers like the real providers so each AI path runs
// to completion, then we assert WHERE requests went and WHAT they carried:
//   1. consent OFF → nothing leaves loopback, for every cloud provider;
//   2. consent ON + cloud provider → entry `value`/`notes`/raw fragment and
//      note bodies never appear in any outbound body (Ask + embeddings);
//   3. a pinned LOCAL provider never falls through to a cloud URL.

const SECRET_VALUE = "ghp_EGRESSVALUE7c1d9e3f5a7b9c1d3e5f";
const SECRET_NOTE = "EGRESSNOTE-the-recovery-phrase-is-4b6d8f";
const SECRET_TAB = "EGRESSTAB-note-body-0a2c4e6g8i";
const SECRETS = [SECRET_VALUE, SECRET_NOTE, SECRET_TAB];
const QUERY = "github deploy token";

const CLOUD_KEYS: Partial<AppSettings> = {
  gemini_api_key: "test-gemini-key",
  openai_api_key: "test-openai-key",
  groq_api_key: "test-groq-key",
  openrouter_api_key: "test-openrouter-key",
  anthropic_api_key: "test-anthropic-key",
};

interface Captured {
  url: string;
  host: string;
  body: string;
}

// A "remote Ollama" (non-loopback ollama_base_url) that is always online.
const REMOTE_OLLAMA_HOST = "ollama.example.net";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
let captured: Captured[] = [];
let ollamaOnline = false;
let ollamaGenerateWorks = true;

const vec = () => Array.from({ length: 8 }, (_, i) => (i + 1) / 10);
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

async function fakeFetch(input: any, init?: any): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url);
  let body: unknown = init?.body;
  if (body == null && typeof input?.clone === "function") {
    try {
      body = await input.clone().text();
    } catch {
      body = "";
    }
  }
  const bodyStr =
    typeof body === "string" ? body : body instanceof Uint8Array ? Buffer.from(body).toString("utf8") : body ? String(body) : "";
  const u = new URL(url);
  captured.push({ url, host: u.hostname, body: bodyStr });

  if (LOOPBACK.has(u.hostname) || u.hostname === REMOTE_OLLAMA_HOST) {
    if (!ollamaOnline && u.hostname !== REMOTE_OLLAMA_HOST) throw new TypeError("fetch failed: ECONNREFUSED (fake)");
    if (u.pathname === "/api/tags") return json({ models: [{ name: DEFAULT_SETTINGS.ollama_llm_model }, { name: DEFAULT_SETTINGS.ollama_embed_model }] });
    if (u.pathname === "/api/embed") return json({ embeddings: [vec()] });
    if (u.pathname === "/api/embeddings") return json({ embedding: vec() });
    if (u.pathname === "/api/generate") return ollamaGenerateWorks ? json({ response: "local answer text" }) : json({ error: "boom" }, 500);
    if (u.pathname.endsWith("/embeddings")) return json({ data: [{ embedding: vec() }] });
    if (u.pathname.endsWith("/chat/completions")) return json({ choices: [{ message: { content: "local answer text" } }] });
    return json({}, 404);
  }

  // Cloud fakes.
  if (u.hostname === "generativelanguage.googleapis.com") {
    if (u.pathname.includes("embedContent")) return json({ embedding: { values: vec() }, embeddings: [{ values: vec() }] });
    return json({ candidates: [{ content: { role: "model", parts: [{ text: "cloud answer text" }] }, finishReason: "STOP" }] });
  }
  if (u.hostname === "api.anthropic.com") return json({ content: [{ type: "text", text: "cloud answer text" }] });
  if (u.pathname.endsWith("/embeddings")) return json({ data: [{ embedding: vec() }] });
  if (u.pathname.endsWith("/chat/completions")) return json({ choices: [{ message: { content: "cloud answer text" } }] });
  return json({}, 404);
}

const external = () => captured.filter((c) => !LOOPBACK.has(c.host));
const leaks = () =>
  captured.flatMap((c) => SECRETS.filter((s) => c.body.includes(s)).map((s) => `${c.host}${new URL(c.url).pathname} carried ${s}`));

const mk = (patch: Partial<AppSettings>): AppSettings => ({ ...DEFAULT_SETTINGS, ...CLOUD_KEYS, auto_lock_minutes: 0, ...patch });

// checkOllama() caches its answer for 10 s in module state (keyed by nothing,
// not even the URL). Each test advances a Date.now offset past that window so
// the first AI call in the test re-probes under the test's own settings.
const realNow = Date.now.bind(Date);
let clockOffset = 0;

function setOllama(online: boolean, generateWorks = true) {
  ollamaOnline = online;
  ollamaGenerateWorks = generateWorks;
  clockOffset += 11_000;
  captured = [];
}

describe("R4 egress", () => {
  let tmpDir: string;
  let store: VaultStore;
  let watchers: FolderWatcherManager;
  let server: http.Server;
  let port = 0;
  let token = "";
  let entry: VaultEntry;

  function call(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: urlPath,
          headers: {
            "X-IndexArc-Token": token,
            ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** Every AI path we can drive, with the given settings both passed directly and persisted for the routes. */
  async function driveAll(s: AppSettings) {
    store.saveSettings(s);
    await generateText(s, "rewrite this harmless sentence", "system");
    await embedText(s, "harmless query text");
    await autoComplete(s, "harmless prefix text", 16);
    await analyzePaste("HARMLESS_FLAG=true", s);
    await askVault(store, s, QUERY, 12);
    await indexEntry(store, s, entry);
    await call("POST", "/api/ask", { query: QUERY });
    await call("POST", "/api/rewrite", { text: "harmless text" });
    await call("POST", "/api/autocomplete", { prefix: "harmless prefix" });
    await call("POST", "/api/proofread", { text: "harmless text" });
    await call("POST", "/api/analyze", { content: "HARMLESS_FLAG=true" });
    await call("POST", "/api/entries/save", {
      value: SECRET_VALUE,
      type: "github token",
      name: "github deploy token (route)",
      raw_fragment: `GITHUB_TOKEN=${SECRET_VALUE}`,
      notes: SECRET_NOTE,
      family: "secret",
    });
  }

  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-egress-"));
    const paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    watchers = new FolderWatcherManager(store, () => store.getSettings());
    const { app } = createApp({ paths, store, audit: new AuditLog(paths), watchers });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    token = String(process.env.INDEXARC_API_TOKEN || "");

    entry = store.createEntry({
      value: SECRET_VALUE,
      type: "github token",
      name: QUERY,
      raw_fragment: `GITHUB_TOKEN=${SECRET_VALUE}`,
      labels: ["deploy"],
      type_aliases: ["github token"],
      status: "saved",
      family: "secret",
      notes: SECRET_NOTE,
    });
    expect(store.updateScratchpadTabContent("egress-tab", SECRET_TAB, undefined, false, QUERY).ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    watchers?.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    setOllama(false);
  });

  const CLOUD_PROVIDERS = ["api", "openai", "groq", "openrouter", "anthropic"] as const;

  describe("consent OFF → nothing leaves loopback", () => {
    for (const p of CLOUD_PROVIDERS) {
      it(`ai_provider=${p}`, async () => {
        await driveAll(mk({ ai_provider: p, ai_cloud_consent: false }));
        expect(external().map((c) => c.url)).toEqual([]);
      }, 60_000);
      it(`llm_provider_override=${p}`, async () => {
        await driveAll(mk({ ai_provider: "auto", llm_provider_override: p, ai_cloud_consent: false }));
        expect(external().map((c) => c.url)).toEqual([]);
      }, 60_000);
    }

    it("ai_provider=auto with every cloud key configured", async () => {
      await driveAll(mk({ ai_provider: "auto", ai_cloud_consent: false }));
      expect(external().map((c) => c.url)).toEqual([]);
    }, 60_000);

    it("local_openai pointed at a non-loopback host", async () => {
      await driveAll(mk({ ai_provider: "local_openai", local_openai_base_url: "https://lmstudio.example.net/v1", ai_cloud_consent: false }));
      expect(external().map((c) => c.url)).toEqual([]);
    }, 60_000);

    it("embed_provider_override=openai", async () => {
      await driveAll(mk({ ai_provider: "auto", embed_provider_override: "openai", ai_cloud_consent: false }));
      expect(external().map((c) => c.url)).toEqual([]);
    }, 60_000);

    it("non-loopback ollama_base_url: no vault-bearing request leaves", async () => {
      await driveAll(mk({ ai_provider: "local", ollama_base_url: `http://${REMOTE_OLLAMA_HOST}:11434`, ai_cloud_consent: false }));
      // Not even a probe goes out (asserted below); certainly nothing with a body.
      expect(external().filter((c) => c.body).map((c) => c.url)).toEqual([]);
    }, 60_000);

    // Regression (R4 finding, fixed in R1.4): checkOllama() used to probe a
    // non-loopback ollama_base_url while consent was OFF.
    it("non-loopback ollama_base_url: not even an availability probe leaves", async () => {
      await driveAll(mk({ ai_provider: "local", ollama_base_url: `http://${REMOTE_OLLAMA_HOST}:11434`, ai_cloud_consent: false }));
      expect(external().map((c) => c.url)).toEqual([]);
    }, 60_000);
  });

  describe("consent ON + cloud provider → values/notes never in outbound bodies (Ask + embeddings)", () => {
    const cases: [string, Partial<AppSettings>][] = [
      ...CLOUD_PROVIDERS.map((p) => [`ai_provider=${p}`, { ai_provider: p }] as [string, Partial<AppSettings>]),
      ["local_openai@remote", { ai_provider: "local_openai", local_openai_base_url: "https://lmstudio.example.net/v1" }],
      ["ollama@remote (online)", { ai_provider: "local", ollama_base_url: `http://${REMOTE_OLLAMA_HOST}:11434` }],
    ];
    for (const [label, patch] of cases) {
      it(label, async () => {
        const s = mk({ ...patch, ai_cloud_consent: true });
        store.saveSettings(s);
        await askVault(store, s, QUERY, 12);
        await indexEntry(store, s, entry);
        await call("POST", "/api/ask", { query: QUERY });
        await call("POST", "/api/entries/save", {
          value: SECRET_VALUE,
          type: "github token",
          name: `${QUERY} (route)`,
          raw_fragment: `GITHUB_TOKEN=${SECRET_VALUE}`,
          notes: SECRET_NOTE,
          family: "secret",
        });
        // The path really was exercised against an off-device host.
        expect(external().filter((c) => c.body).length, `no cloud call captured for ${label}`).toBeGreaterThan(0);
        expect(leaks()).toEqual([]);
      }, 60_000);
    }
  });

  describe("a pinned LOCAL provider never falls through to a cloud URL (consent ON, every cloud key set)", () => {
    const pins: [string, Partial<AppSettings>][] = [
      ["ai_provider=local", { ai_provider: "local" }],
      ["llm_provider_override=local", { ai_provider: "auto", llm_provider_override: "local" }],
      ["ai_provider=local_openai (loopback)", { ai_provider: "local_openai", local_openai_base_url: "http://127.0.0.1:1234/v1" }],
    ];
    const states: [string, boolean, boolean][] = [
      ["Ollama offline", false, true],
      ["Ollama online, generate failing", true, false],
    ];
    for (const [pinLabel, pin] of pins) {
      for (const [stateLabel, online, works] of states) {
        it(`${pinLabel} / ${stateLabel}: generateText, autocomplete, analyze, Ask`, async () => {
          setOllama(online, works);
          const s = mk({ ...pin, ai_cloud_consent: true });
          store.saveSettings(s);
          await generateText(s, "harmless", "system");
          await autoComplete(s, "harmless prefix", 16);
          await analyzePaste("HARMLESS_FLAG=true", s);
          await askVault(store, s, QUERY, 12);
          await call("POST", "/api/ask", { query: QUERY });
          await call("POST", "/api/rewrite", { text: "harmless" });
          expect(external().map((c) => c.url)).toEqual([]);
        }, 60_000);
      }
    }

    // Online Ollama: embeddings stay local.
    for (const [pinLabel, pin] of pins) {
      it(`${pinLabel} / Ollama online: embeddings stay local`, async () => {
        setOllama(true, true);
        const s = mk({ ...pin, ai_cloud_consent: true });
        await embedText(s, "harmless");
        await indexEntry(store, s, entry);
        expect(external().map((c) => c.url)).toEqual([]);
      }, 60_000);
    }

    // Regression (R4 finding, fixed in R1.4): with a provider pinned to
    // "local" and Ollama offline, embedText() used to fall back to Gemini.
    for (const [pinLabel, pin] of pins.slice(0, 2)) {
      it(`${pinLabel} / Ollama offline: embeddings never fall back to Gemini`, async () => {
        const s = mk({ ...pin, ai_cloud_consent: true });
        await embedText(s, "harmless");
        await indexEntry(store, s, entry);
        expect(external().map((c) => c.url)).toEqual([]);
      }, 60_000);
    }

    // Regression (R4 finding, fixed in R1.4): the caller's LLM provider used to
    // override settings.embed_provider_override, so embeddings pinned to local
    // still went to the cloud LLM's provider.
    it("embed_provider_override=local is honored by indexEntry/Ask", async () => {
      const s = mk({ ai_provider: "auto", embed_provider_override: "local", ai_cloud_consent: true });
      await indexEntry(store, s, entry);
      await askVault(store, s, QUERY, 12);
      const embedCalls = external().filter((c) => /embed/i.test(c.url));
      expect(embedCalls.map((c) => c.url)).toEqual([]);
    }, 60_000);
  });
});
