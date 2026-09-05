import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

describe("Scratchpad at-rest encryption", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-enc-test-"));
    paths = ensurePortableLayout(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("keeps scratchpad plaintext when no password is set", () => {
    const store = new VaultStore(paths);
    store.saveScratchpad([{ id: "t1", title: "A", content: "<p>hello</p>" }]);
    const disk = fs.readFileSync(paths.scratchpadFile, "utf-8");
    expect(disk).toContain("hello");
    expect(JSON.parse(disk).encrypted).toBeUndefined();
  });

  it("encrypts scratchpad, archive and revisions on setupPassword", async () => {
    const store = new VaultStore(paths);
    store.saveScratchpad([{ id: "t1", title: "Secret Note", content: "<p>topsecret</p>" }]);
    store.saveScratchpadArchive([{ id: "a1", title: "Archived", content: "<p>cold</p>", archived: true }]);
    store.addNoteRevision({ id: "r1", tabId: "t1", timestamp: Date.now(), title: "Secret Note", content: "<p>older</p>", charCount: 5, wordCount: 1 });

    await store.setupPassword("long-master-pw");

    const scratchDisk = fs.readFileSync(paths.scratchpadFile, "utf-8");
    const archiveDisk = fs.readFileSync(paths.scratchpadArchiveFile, "utf-8");
    const revDisk = fs.readFileSync(paths.noteRevisionsFile, "utf-8");

    for (const [name, disk] of [
      ["scratchpad", scratchDisk],
      ["archive", archiveDisk],
      ["revisions", revDisk],
    ] as const) {
      const parsed = JSON.parse(disk);
      expect(parsed.encrypted, `${name} envelope flag`).toBe(true);
      expect(parsed.salt, `${name} salt`).toBeTruthy();
      expect(disk.includes("topsecret"), `${name} leaks plaintext`).toBe(false);
      expect(disk.includes("cold"), `${name} leaks plaintext`).toBe(false);
      expect(disk.includes("older"), `${name} leaks plaintext`).toBe(false);
    }

    // Same instance (unlocked) still sees the content
    expect(store.getScratchpad()[0].content).toContain("topsecret");
  });

  it("hides content while locked and restores it after unlock", async () => {
    const store = new VaultStore(paths);
    store.saveScratchpad([{ id: "t1", title: "A", content: "<p>visible-later</p>" }]);
    await store.setupPassword("long-master-pw");

    store.lock();
    expect(store.getScratchpad()).toEqual([]);

    const store2 = new VaultStore(paths); // fresh instance = locked
    expect(store2.isLocked()).toBe(true);
    expect(store2.getScratchpad()).toEqual([]);

    const ok = await store2.unlock("long-master-pw");
    expect(ok).toBe(true);
    const tabs = store2.getScratchpad();
    expect(tabs.length).toBe(1);
    expect(tabs[0].content).toContain("visible-later");
  });

  it("decrypts companion files when the password is removed", async () => {
    const store = new VaultStore(paths);
    store.saveScratchpad([{ id: "t1", title: "A", content: "<p>plain-again</p>" }]);
    store.addNoteRevision({ id: "r1", tabId: "t1", timestamp: Date.now(), title: "A", content: "<p>rev</p>", charCount: 3, wordCount: 1 });
    await store.setupPassword("long-master-pw");
    expect(fs.readFileSync(paths.scratchpadFile, "utf-8")).not.toContain("plain-again");

    const removed = await store.removePassword("long-master-pw");
    expect(removed).toBe(true);

    const scratchDisk = fs.readFileSync(paths.scratchpadFile, "utf-8");
    expect(JSON.parse(scratchDisk).encrypted).toBeUndefined();
    expect(scratchDisk).toContain("plain-again");
    expect(JSON.parse(fs.readFileSync(paths.noteRevisionsFile, "utf-8")).revisions.t1.length).toBe(1);
  });

  it("keeps v2 metadata (rev/created_at/updated_at) server-managed across saves", () => {
    const store = new VaultStore(paths);
    store.saveScratchpad([{ id: "t1", title: "A", content: "one" }]);
    const first = store.getScratchpad()[0];
    expect(first.rev).toBe(1);
    expect(first.created_at).toBeTruthy();

    store.saveScratchpad([{ id: "t1", title: "A", content: "two" }]);
    const second = store.getScratchpad()[0];
    expect(second.rev).toBe(2);
    expect(second.updated_at >= first.updated_at).toBe(true);

    // unchanged resave keeps rev stable
    store.saveScratchpad([{ id: "t1", title: "A", content: "two" }]);
    expect(store.getScratchpad()[0].rev).toBe(2);
  });
});
