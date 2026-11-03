import { describe, it, expect } from "vitest";
import { callWithRetry, isTransientError } from "./validate.js";

const err = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("callWithRetry", () => {
  it("retries transient errors, then succeeds", async () => {
    let calls = 0;
    const out = await callWithRetry(
      async () => {
        calls++;
        if (calls < 3) throw err(503);
        return "ok";
      },
      { timeoutMs: 5000, label: "t", baseDelayMs: 1 }
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a non-transient 4xx", async () => {
    let calls = 0;
    await expect(
      callWithRetry(
        async () => {
          calls++;
          throw err(400);
        },
        { timeoutMs: 5000, label: "t", baseDelayMs: 1 }
      )
    ).rejects.toThrow("HTTP 400");
    expect(calls).toBe(1);
  });

  it("stops after the retry budget", async () => {
    let calls = 0;
    await expect(
      callWithRetry(
        async () => {
          calls++;
          throw err(429);
        },
        { timeoutMs: 5000, label: "t", retries: 2, baseDelayMs: 1 }
      )
    ).rejects.toThrow("HTTP 429");
    expect(calls).toBe(3);
  });

  it("aborts the in-flight call on timeout and does not retry it", async () => {
    let calls = 0;
    let aborted = false;
    await expect(
      callWithRetry(
        (signal) => {
          calls++;
          signal.addEventListener("abort", () => (aborted = true));
          return new Promise<never>(() => {});
        },
        { timeoutMs: 50, label: "Gemini x" }
      )
    ).rejects.toThrow("Gemini x timed out");
    expect(aborted).toBe(true);
    expect(calls).toBe(1);
  });

  it("classifies errors", () => {
    expect(isTransientError(err(429))).toBe(true);
    expect(isTransientError(err(500))).toBe(true);
    expect(isTransientError(err(401))).toBe(false);
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
    expect(isTransientError(new Error("bad schema"))).toBe(false);
  });
});
