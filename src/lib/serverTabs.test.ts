import { describe, it, expect } from "vitest";
import { normalizeServerTab } from "./serverTabs";

// Regression guard: the app restart path used to rebuild tabs with only
// {id,title,content}, silently dropping pinned/protected flags and the rev
// token — protection stayed server-side, but the UI lost the state.
describe("normalizeServerTab preserves server-managed fields", () => {
  it("keeps pinned/protected flags, rev, and timestamps", () => {
    const t = normalizeServerTab({
      id: "n1",
      title: "Diary",
      content: "<p>x</p>",
      rev: 7,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-06T00:00:00Z",
      pinned: true,
      pinned_at: 123,
      protected: true,
      protected_at: 456,
    });
    expect(t.id).toBe("n1");
    expect(t.rev).toBe(7);
    expect(t.pinned).toBe(true);
    expect(t.pinned_at).toBe(123);
    expect(t.protected).toBe(true);
    expect(t.protected_at).toBe(456);
    expect(t.created_at).toBe("2026-09-05T00:00:00Z");
    expect(t.updated_at).toBe("2026-09-06T00:00:00Z");
  });

  it("defaults missing fields safely", () => {
    const t = normalizeServerTab({});
    expect(t.id).toBeTruthy();
    expect(t.title).toBe("Scratch");
    expect(t.content).toBe("");
    expect(t.archived).toBe(false);
    expect(t.pinned).toBeUndefined();
    expect(t.protected).toBeUndefined();
  });

  it("never leaves a tab archived", () => {
    expect(normalizeServerTab({ id: "x", archived: true }).archived).toBe(false);
  });
});
