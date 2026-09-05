import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueScratchpadSave,
  drainScratchpadSaves,
  forceSaveScratchpadTab,
  setSyncedScratchpadTabs,
  setScratchpadConflictHandler,
  __resetScratchpadSaveQueueForTests,
} from "./scratchpadSaveQueue";
import type { ScratchTab } from "./types";

const tab = (id: string, content: string): ScratchTab => ({ id, title: `T-${id}`, content });

// Minimal fetch mock: records posts to the granular content endpoint.
const posts: { url: string; body: any }[] = [];
let failNext = false;

beforeEach(() => {
  __resetScratchpadSaveQueueForTests();
  posts.length = 0;
  failNext = false;
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) || "{}");
    if (failNext) throw new Error("offline");
    if (String(url).includes("/content")) posts.push({ url: String(url), body });
    return { ok: true, status: 200 } as Response;
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

  it("forceSaveScratchpadTab posts with force and no base rev", async () => {
    await forceSaveScratchpadTab(tab("e", "mine-wins"));
    expect(posts.length).toBe(1);
    expect(posts[0].body.force).toBe(true);
    expect(posts[0].body.base_rev).toBeUndefined();
    expect(posts[0].body.content).toBe("mine-wins");
  });
});
