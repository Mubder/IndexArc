import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

describe("Orphaned note revision rescue", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-test-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("lists revision groups whose tab no longer exists, newest first", () => {
    fs.writeFileSync(paths.scratchpadFile, JSON.stringify({ version: 1, tabs: [{ id: "keep", title: "Keeper", content: "<p>x</p>", archived: false }] }));
    store.addNoteRevision({ tabId: "gone-old", title: "Old draft", timestamp: 1000, content: "<p>old</p>" });
    store.addNoteRevision({ tabId: "gone-new", title: "Alibaba email", timestamp: 2000, content: "<p>draft</p>" });
    store.addNoteRevision({ tabId: "keep", title: "Keeper", timestamp: 3000, content: "<p>x</p>" });

    const orphans = store.getOrphanedNoteRevisions();
    expect(orphans.map((o) => o.tabId)).toEqual(["gone-new", "gone-old"]);
    expect(orphans[0].title).toBe("Alibaba email");
    expect(orphans[0].revisionCount).toBe(1);
    // The tab that still exists is NOT listed.
    expect(orphans.find((o) => o.tabId === "keep")).toBeUndefined();
  });

  it("disappears from the list once the note is restored (upsert creates the tab)", () => {
    store.addNoteRevision({ tabId: "lost", title: "Lost", timestamp: 1000, content: "<p>recovered text</p>" });
    expect(store.getOrphanedNoteRevisions()).toHaveLength(1);

    const result = store.updateScratchpadTabContent("lost", "<p>recovered text</p>");
    expect(result.ok).toBe(true);
    expect(store.getOrphanedNoteRevisions()).toHaveLength(0);
    expect(store.getScratchpad().find((t: any) => t.id === "lost")?.content).toBe("<p>recovered text</p>");
  });

  it("keeps the revision history attached after restore", () => {
    store.addNoteRevision({ tabId: "lost", title: "Lost", timestamp: 1000, content: "<p>v1</p>" });
    store.addNoteRevision({ tabId: "lost", title: "Lost", timestamp: 2000, content: "<p>v2</p>" });
    store.updateScratchpadTabContent("lost", "<p>v2</p>");
    const revs = store.getNoteRevisions("lost");
    expect(revs.length).toBeGreaterThan(0);
  });

  it("upsert keeps the client's title for brand-new tabs", () => {
    const r1 = store.updateScratchpadTabContent("fresh", "<p>hi</p>", undefined, false, "My New Note");
    expect(r1.ok).toBe(true);
    expect(r1.tab.title).toBe("My New Note");
    // Existing tabs are NOT renamed by a content save — title only applies on create.
    store.updateScratchpadTabContent("fresh", "<p>hi 2</p>", undefined, false, "Sneaky Rename");
    const t = store.getScratchpad().find((x: any) => x.id === "fresh");
    expect(t.title).toBe("My New Note");
    // The saved tab carries the bumped rev for optimistic concurrency.
    expect(Number(t.rev)).toBeGreaterThan(1);
  });

  it("does NOT list archived notes as orphaned (they still exist in cold storage)", () => {
    fs.writeFileSync(
      paths.scratchpadFile,
      JSON.stringify({ version: 1, tabs: [{ id: "active", title: "A", content: "<p>a</p>", archived: false }] })
    );
    fs.writeFileSync(
      paths.scratchpadArchiveFile,
      JSON.stringify({ tabs: [{ id: "archived", title: "Old", content: "<p>old</p>", archived: true }] })
    );
    store.addNoteRevision({ tabId: "archived", title: "Old", timestamp: 1000, content: "<p>old</p>" });
    store.addNoteRevision({ tabId: "truly-lost", title: "Lost", timestamp: 2000, content: "<p>gone</p>" });

    const orphans = store.getOrphanedNoteRevisions();
    expect(orphans.map((o) => o.tabId)).toEqual(["truly-lost"]);
  });
});
