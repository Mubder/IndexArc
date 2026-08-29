import { describe, it, expect } from "vitest";
import { resolveVerbatimValue } from "./providers.js";

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
