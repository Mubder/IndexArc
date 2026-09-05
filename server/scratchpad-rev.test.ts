import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

describe("scratchpad optimistic concurrency (rev + conflicts)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-rev-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("detects a stale save that would clobber newer server content", () => {
    store.saveScratchpad([{ id: "t1", title: "A", content: "server v1" }]);
    store.saveScratchpad([{ id: "t1", title: "A", content: "server v2" }]);
    // Client edited from v1 while the server moved to v2.
    const conflicts = store.findScratchpadConflicts(
      [{ id: "t1", title: "A", content: "client edit", rev: 1 }],
      { t1: 1 }
    );
    expect(conflicts).toEqual([{ id: "t1", base_rev: 1, server_rev: 2 }]);
  });

  it("does not conflict when base rev is current or content is identical", () => {
    store.saveScratchpad([{ id: "t1", title: "A", content: "v1" }]);
    store.saveScratchpad([{ id: "t1", title: "A", content: "v2" }]);

    expect(store.findScratchpadConflicts([{ id: "t1", content: "v3", rev: 2 }], { t1: 2 })).toEqual([]);
    // identical content is never a conflict (idempotent resave)
    expect(store.findScratchpadConflicts([{ id: "t1", content: "v2", rev: 1 }], { t1: 1 })).toEqual([]);
  });

  it("ignores brand-new tabs and untracked tabs", () => {
    store.saveScratchpad([{ id: "t1", title: "A", content: "v1" }]);
    expect(store.findScratchpadConflicts([{ id: "new", content: "n", rev: 1 }], { new: 1 })).toEqual([]);
    expect(store.findScratchpadConflicts([{ id: "t1", content: "zzz" }], {})).toEqual([]);
  });

  it("rev survives a round-trip through disk (new store instance)", () => {
    store.saveScratchpad([{ id: "t1", title: "A", content: "one" }]);
    store.saveScratchpad([{ id: "t1", title: "A", content: "two" }]);
    const store2 = new VaultStore(paths);
    expect(store2.getScratchpad()[0].rev).toBe(2);
  });
});
