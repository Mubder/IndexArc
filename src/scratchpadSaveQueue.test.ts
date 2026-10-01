// @vitest-environment jsdom
// The save queue sanitizes note HTML through DOMPurify before posting, so
// these tests need a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueScratchpadSave,
  drainScratchpadSaves,
  forceSaveScratchpadTab,
  setSyncedScratchpadTabs,
  setScratchpadConflictHandler,
  setScratchpadFailureHandler,
  __resetScratchpadSaveQueueForTests,
} from "./scratchpadSaveQueue";
import type { ScratchTab } from "./types";

const tab = (id: string, content: string): ScratchTab => ({ id, title: `T-${id}`, content });
let conflictsRouted = 0;

// Minimal fetch mock: records posts to the granular content endpoint.
const posts: { url: string; body: any; keepalive: boolean }[] = [];
let failNext = false;

beforeEach(() => {
  __resetScratchpadSaveQueueForTests();
  conflictsRouted = 0;
  setScratchpadConflictHandler(() => { conflictsRouted += 1; });
  posts.length = 0;
  failNext = false;
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) || "{}");
    if (failNext) throw new Error("offline");
    if (String(url).includes("/content")) posts.push({ url: String(url), body, keepalive: init?.keepalive === true });
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scratchpadSaveQueue", () => {
  it("flushes changed tabs after the debounce with the latest content", async () => {
    vi.useFakeTimers();
    enqueueScratchpadSave([tab("a", "one")]);
    enqueueScratchpadSave([tab("a", "two")]); // last-writer-wins
    expect(posts.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts.length).toBe(1);
    expect(posts[0].url).toContain("/api/scratchpad/tabs/a/content");
    expect(posts[0].body.content).toBe("two");
  });

  it("only saves tabs whose content differs from the synced mirror", async () => {
    setSyncedScratchpadTabs([tab("a", "same"), { ...tab("b", "same"), rev: 4 }]);
    enqueueScratchpadSave([tab("a", "same"), tab("b", "same"), tab("c", "new")]);
    await drainScratchpadSaves();
    // "a" unchanged, "b" unchanged, "c" is new → exactly one post
    expect(posts.length).toBe(1);
    expect(posts[0].url).toContain("/tabs/c/content");
  });

  it("sends the base rev from the synced mirror", async () => {
    setSyncedScratchpadTabs([{ ...tab("b", "old"), rev: 7 }]);
    enqueueScratchpadSave([tab("b", "new")]);
    await drainScratchpadSaves();
    expect(posts[0].body.base_rev).toBe(7);
  });

  it("drain() posts immediately without waiting for the debounce", async () => {
    enqueueScratchpadSave([tab("b", "urgent")]);
    await drainScratchpadSaves();
    expect(posts.length).toBe(1);
    expect(posts[0].body.content).toBe("urgent");
  });

  it("re-queues and retries after a failed post", async () => {
    vi.useFakeTimers();
    failNext = true;
    enqueueScratchpadSave([tab("c", "keep-me")]);
    await vi.advanceTimersByTimeAsync(1000); // first attempt fails
    expect(posts.length).toBe(0);
    failNext = false;
    await vi.advanceTimersByTimeAsync(6000); // retry fires
    expect(posts.length).toBe(1);
    expect(posts[0].body.content).toBe("keep-me");
  });

  it("routes 409 conflicts to the handler instead of retrying", async () => {
    const conflicts: any[] = [];
    setScratchpadConflictHandler((serverTab) => conflicts.push(serverTab));
    (globalThis as any).fetch = vi.fn(async () =>
      ({ ok: false, status: 409, json: async () => ({ server_tab: { id: "d", content: "server" } }) }) as any
    );
    enqueueScratchpadSave([tab("d", "mine")]);
    await drainScratchpadSaves();
    expect(conflicts).toEqual([{ id: "d", content: "server" }]);
    expect(posts.length).toBe(0);
  });

  it("adopts the server's rev after a save — no self-conflict on the next save", async () => {
    // Regression: the queue used to keep its stale rev after a successful
    // save while the server bumped its own — every subsequent edit then
    // 409'd ("changed in another window") against the app's own write.
    let serverRev = 1;
    (globalThis as any).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || "{}");
      serverRev += 1;
      const res = { ok: true, status: 200, json: async () => ({ tab: { id: body.id ?? "z", rev: serverRev } }) };
      // Record what base_rev each save carried.
      posts.push({ url: String(_url), body, keepalive: false });
      return res as any;
    });
    setSyncedScratchpadTabs([{ ...tab("z", "v1"), rev: 1 }]);
    enqueueScratchpadSave([tab("z", "v2")]);
    await drainScratchpadSaves();
    expect(posts[0].body.base_rev).toBe(1);
    enqueueScratchpadSave([tab("z", "v3")]);
    await drainScratchpadSaves();
    expect(posts[1].body.base_rev).toBe(2); // adopted from the server's response
    // And no 409 was ever raised.
    expect(conflictsRouted).toBe(0);
  });

  it("reports save failures through the failure handler and clears on recovery", async () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    setScratchpadFailureHandler((failing) => states.push(failing));
    // Server down: first flush throws, the queue flags the failure.
    (globalThis as any).fetch = vi.fn(async () => { throw new Error("offline"); });
    enqueueScratchpadSave([tab("f", "typed-while-down")]);
    await drainScratchpadSaves();
    expect(states).toEqual([true]);
    // Retry succeeds -> failure flag clears.
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || "{}");
      if (String(url).includes("/content")) posts.push({ url: String(url), body, keepalive: init?.keepalive === true });
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    await vi.advanceTimersByTimeAsync(6000); // retry timer fires the pending save
    expect(posts.length).toBe(1);
    expect(states).toEqual([true, false]);
  });

  it("forceSaveScratchpadTab posts with force and no base rev", async () => {
    await forceSaveScratchpadTab(tab("e", "mine-wins"));
    expect(posts.length).toBe(1);
    expect(posts[0].body.force).toBe(true);
    expect(posts[0].body.base_rev).toBeUndefined();
    expect(posts[0].body.content).toBe("mine-wins");
  });

  it("steady-state saves never set keepalive (Chromium's 64 KiB keepalive body cap must not gate large notes)", async () => {
    const big = `<p>${"x".repeat(200_000)}</p>`; // ~200 KB — over the keepalive cap
    enqueueScratchpadSave([tab("big", big)]);
    await drainScratchpadSaves();
    expect(posts.length).toBe(1);
    expect(posts[0].keepalive).toBe(false);
    expect(posts[0].body.content.length).toBeGreaterThan(64 * 1024);
  });

  it("exit-flush (keepalive) retries without keepalive when Chromium rejects the oversized body", async () => {
    const big = `<p>${"y".repeat(200_000)}</p>`;
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      // Emulate Chromium: keepalive bodies > 64 KiB throw TypeError pre-network.
      if (init?.keepalive === true && ((init.body as string) || "").length > 64 * 1024) {
        throw new TypeError("Failed to fetch");
      }
      const body = JSON.parse((init?.body as string) || "{}");
      posts.push({ url: String(url), body, keepalive: init?.keepalive === true });
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    enqueueScratchpadSave([tab("big-exit", big)]);
    await drainScratchpadSaves({ keepalive: true });
    expect(posts.length).toBe(1);
    expect(posts[0].keepalive).toBe(false);
    expect(posts[0].body.content.length).toBeGreaterThan(64 * 1024);
  });

  it("a 409 on one tab no longer starves the other changed tabs in the same flush", async () => {
    // Regression: the flush used to abort on the first refused tab, dropping
    // every later tab's save from the batch (silent data loss).
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || "{}");
      if (String(url).includes("/tabs/a/content")) {
        return { ok: false, status: 409, json: async () => ({ server_tab: { id: "a", content: "server" } }) } as any;
      }
      posts.push({ url: String(url), body, keepalive: init?.keepalive === true });
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    enqueueScratchpadSave([tab("a", "conflicted"), tab("b", "innocent")]);
    await drainScratchpadSaves();
    expect(conflictsRouted).toBe(1); // the 409 was surfaced
    expect(posts.length).toBe(1); // ...but tab b still saved
    expect(posts[0].url).toContain("/tabs/b/content");
  });
});
