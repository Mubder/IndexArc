import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../types.js";
import { ADAPTERS, getAdapter } from "./adapters/index.js";
import { embedModelId, isLocalProvider, resolveActiveProvider } from "./providers.js";

// R3.3: every provider is an adapter in one registry. These pin the
// registry's behavior that the rest of the app depends on.

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...patch }) as AppSettings;

// Ollama offline: any fetch to it fails.
function ollamaOffline() {
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("provider registry", () => {
  it("has one adapter per provider id, each complete", () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual(
      ["anthropic", "api", "groq", "local", "local_openai", "openai", "openrouter"]
    );
    for (const a of ADAPTERS) {
      expect(getAdapter(a.id)).toBe(a);
      expect(a.label).toBeTruthy();
      expect(typeof a.generate).toBe("function");
      expect(!!a.embed).toBe(!!a.embedModelId);
    }
    expect(getAdapter("heuristic")).toBeUndefined();
  });

  it("embedding model ids are unchanged (stored with every vector)", () => {
    const s = settings({ ollama_embed_model: "nomic-embed-text", gemini_embed_model: "text-embedding-004", local_openai_embed_model: "bge" });
    expect(embedModelId(s, "local")).toBe("local:nomic-embed-text");
    expect(embedModelId(s, "api")).toBe("api:text-embedding-004");
    expect(embedModelId(s, "openai")).toBe("openai:text-embedding-3-small");
    expect(embedModelId(s, "local_openai")).toBe("local_openai:bge");
    expect(embedModelId(settings({ local_openai_llm_model: "qwen", local_openai_embed_model: "" }), "local_openai")).toBe("local_openai:qwen");
    expect(embedModelId(s, "groq")).toBe("groq");
    expect(embedModelId(s, "heuristic")).toBe("heuristic");
  });

  it("locality: only loopback local servers count as local", () => {
    expect(isLocalProvider(settings({ ollama_base_url: "http://127.0.0.1:11434" }), "local")).toBe(true);
    expect(isLocalProvider(settings({ ollama_base_url: "http://gpu-box.lan:11434" }), "local")).toBe(false);
    expect(isLocalProvider(settings({ local_openai_base_url: "http://localhost:1234/v1" }), "local_openai")).toBe(true);
    expect(isLocalProvider(settings({ local_openai_base_url: "https://api.example.com/v1" }), "local_openai")).toBe(false);
    for (const id of ["api", "openai", "groq", "openrouter", "anthropic", "heuristic"]) {
      expect(isLocalProvider(settings(), id)).toBe(false);
    }
  });
});

describe("resolveActiveProvider", () => {
  it("auto: first ready adapter in registry order, never local_openai", async () => {
    ollamaOffline();
    expect(await resolveActiveProvider(settings({ ai_provider: "auto" }))).toBe("heuristic");
    expect(await resolveActiveProvider(settings({ ai_provider: "auto", anthropic_api_key: "k", groq_api_key: "k" }))).toBe("groq");
    expect(await resolveActiveProvider(settings({ ai_provider: "auto", gemini_api_key: "k", openai_api_key: "k" }))).toBe("api");
    expect(await resolveActiveProvider(settings({ ai_provider: "auto", local_openai_base_url: "http://127.0.0.1:1234/v1" }))).toBe("heuristic");
  });

  it("a pinned provider that is not ready means heuristics, not another provider", async () => {
    ollamaOffline();
    expect(await resolveActiveProvider(settings({ ai_provider: "local", gemini_api_key: "k" }))).toBe("heuristic");
    expect(await resolveActiveProvider(settings({ ai_provider: "openai", gemini_api_key: "k" }))).toBe("heuristic");
    expect(await resolveActiveProvider(settings({ ai_provider: "local_openai" }))).toBe("local_openai");
  });

  it("the LLM override wins over ai_provider", async () => {
    ollamaOffline();
    const s = settings({ ai_provider: "api", gemini_api_key: "k", anthropic_api_key: "k" });
    expect(await resolveActiveProvider({ ...s, llm_provider_override: "anthropic" })).toBe("anthropic");
    expect(await resolveActiveProvider({ ...s, llm_provider_override: "heuristic" })).toBe("heuristic");
    expect(await resolveActiveProvider({ ...s, llm_provider_override: "groq" })).toBe("heuristic");
  });
});
