import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueScratchpadSave,
  drainScratchpadSaves,
  __resetScratchpadSaveQueueForTests,
} from "./scratchpadSaveQueue";
import type { ScratchTab } from "./types";

const tab = (id: string, content: string): ScratchTab => ({ id, title: `T-${id}`, content });

// Minimal fetch mock: records JSON payloads posted to /api/scratchpad.
const posts: any[] = [];
let failNext = false;

beforeEach(() => {
  __resetScratchpadSaveQueueForTests();
  posts.length = 0;
  failNext = false;
  (globalThis as any).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (failNext) throw new Error("offline");
    posts.push(JSON.parse((init?.body as string) || "{}"));
    return { ok: true, status: 200 } as Response;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scratchpadSaveQueue", () => {
  it("flushes after the debounce period with the latest snapshot", async () => {
    vi.useFakeTimers();
    enqueueScratchpadSave([tab("a", "one")]);
    enqueueScratchpadSave([tab("a", "two")]); // last-writer-wins
    expect(posts.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts.length).toBe(1);
    expect(posts[0].tabs[0].content).toBe("two");
  });

  it("drain() posts immediately without waiting for the debounce", async () => {
    enqueueScratchpadSave([tab("b", "urgent")]);
    await drainScratchpadSaves();
    expect(posts.length).toBe(1);
    expect(posts[0].tabs[0].id).toBe("b");
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
    expect(posts[0].tabs[0].content).toBe("keep-me");
  });

  it("keeps saves in order across rapid enqueues", async () => {
    enqueueScratchpadSave([tab("d", "v1")]);
    await drainScratchpadSaves();
    enqueueScratchpadSave([tab("d", "v2")]);
    await drainScratchpadSaves();
    expect(posts.map((p) => p.tabs[0].content)).toEqual(["v1", "v2"]);
  });
});
