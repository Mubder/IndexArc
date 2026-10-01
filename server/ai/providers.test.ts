import { describe, it, expect, afterEach } from "vitest";
import { resolveVerbatimValue, analyzePaste, autoComplete, embedText } from "./providers.js";
import { DEFAULT_SETTINGS } from "../types.js";

describe("resolveVerbatimValue — verbatim paste preservation", () => {
  it("recovers leading underscore stripped by LLM", () => {
    expect(resolveVerbatimValue("mysecret_123", "_mysecret_123")).toBe("_mysecret_123");
  });
  it("recovers double leading underscore", () => {
    expect(resolveVerbatimValue("leading_secret", "__leading_secret")).toBe("__leading_secret");
  });
  it("recovers underscore normalized to space", () => {
    expect(resolveVerbatimValue("my secret middle", "my_secret_middle")).toBe("my_secret_middle");
  });
  it("recovers http prefix stripped", () => {
    expect(resolveVerbatimValue("example.com/_path_with_underscore", "https://example.com/_path_with_underscore")).toBe("https://example.com/_path_with_underscore");
    expect(resolveVerbatimValue("test.com/api_key_123", "http://test.com/api_key_123")).toBe("http://test.com/api_key_123");
  });
  it("preserves already verbatim", () => {
    expect(resolveVerbatimValue("_secret", "_secret")).toBe("_secret");
    expect(resolveVerbatimValue("https://example.com/path", "https://example.com/path")).toBe("https://example.com/path");
  });
  it("handles env value with underscore", () => {
    expect(resolveVerbatimValue("_secret_value", "TOKEN=_secret_value")).toBe("_secret_value");
  });
});

// ── Cloud egress consent gates (regression: analyzePaste/autoComplete were
// ungated — raw pasted secrets left the machine with consent OFF) ──────────
const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/;

describe("cloudEgressAllowed gates", () => {
  const realFetch = globalThis.fetch;
  let fetchedUrls: string[] = [];

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stubFetch = () => {
    fetchedUrls = [];
    (globalThis as any).fetch = async (input: any) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      fetchedUrls.push(url);
      throw new Error(`network blocked by test: ${url}`);
    };
  };
  const cloudCalls = () => fetchedUrls.filter((u) => !LOOPBACK_RE.test(u));

  it("analyzePaste: consent OFF + Gemini key → heuristics only, zero cloud calls", async () => {
    stubFetch();
    const settings = {
      ...DEFAULT_SETTINGS,
      ai_provider: "api" as const,
      gemini_api_key: "test-key",
      ai_cloud_consent: false,
    };
    const res = await analyzePaste("GOCSPX-test-secret-value", settings);
    expect(res.provider_used).toBe("heuristic");
    expect(res.candidates.length).toBeGreaterThan(0); // heuristics still extract it
    expect(cloudCalls()).toEqual([]);
  });

  it("analyzePaste: consent ON → the cloud branch is actually reached", async () => {
    stubFetch();
    const settings = {
      ...DEFAULT_SETTINGS,
      ai_provider: "api" as const,
      gemini_api_key: "test-key",
      ai_cloud_consent: true,
    };
    await analyzePaste("GOCSPX-test-secret-value", settings);
    expect(cloudCalls().length).toBeGreaterThan(0);
  });

  it("autoComplete: consent OFF + Gemini key → null, zero cloud calls", async () => {
    stubFetch();
    const settings = {
      ...DEFAULT_SETTINGS,
      ai_provider: "api" as const,
      gemini_api_key: "test-key",
      ai_cloud_consent: false,
    };
    expect(await autoComplete(settings, "deploy the key", 16)).toBeNull();
    expect(cloudCalls()).toEqual([]);
  });

  it("embedText: heuristic override must not fall back to cloud without consent", async () => {
    stubFetch();
    const settings = {
      ...DEFAULT_SETTINGS,
      ai_provider: "api" as const,
      gemini_api_key: "test-key",
      ai_cloud_consent: false,
    };
    expect(await embedText(settings, "name: prod key", "heuristic")).toBeNull();
    expect(cloudCalls()).toEqual([]);
  });
});
