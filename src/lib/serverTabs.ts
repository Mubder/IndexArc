import type { ScratchTab } from "../types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Normalize a server (or cached) tab object into ScratchTab while PRESERVING
 * every server-managed field: rev, created_at/updated_at, and the
 * pinned/protected flags.
 *
 * Rebuilding tabs field-by-field (`{ id, title, content }`) silently dropped
 * these after an app restart — protection still held server-side, but the UI
 * lost the flags and the concurrency token.
 */
export function normalizeServerTab(x: any): ScratchTab {
  return {
    ...(x && typeof x === "object" ? x : {}),
    id: x?.id || newId(),
    title: x?.title || "Scratch",
    content: x?.content || "",
    archived: false,
  };
}
