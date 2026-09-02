import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

describe("Scratchpad Cold Archive Storage", () => {
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

  it("automatically migrates legacy archived tabs to scratchpad_archive.json", () => {
    const initialTabs = [
      { id: "tab1", title: "Active Note 1", content: "<p>Hello</p>", archived: false },
      { id: "tab2", title: "Archived Note 1", content: "<p>Old note</p>", archived: true },
      { id: "tab3", title: "Active Note 2", content: "<p>Working</p>", archived: false },
      { id: "tab4", title: "Archived Note 2", content: "<p>Old note 2</p>", archived: true },
    ];
    fs.writeFileSync(paths.scratchpadFile, JSON.stringify({ version: 1, tabs: initialTabs }));

    const active = store.getScratchpad();
    expect(active.length).toBe(2);
    expect(active.map((t) => t.id)).toEqual(["tab1", "tab3"]);

    const archive = store.getScratchpadArchive();
    expect(archive.length).toBe(2);
    expect(archive.map((t) => t.id)).toEqual(["tab2", "tab4"]);

    const diskActive = JSON.parse(fs.readFileSync(paths.scratchpadFile, "utf-8")).tabs;
    expect(diskActive.length).toBe(2);
    expect(diskActive.every((t: any) => !t.archived)).toBe(true);

    const diskArchive = JSON.parse(fs.readFileSync(paths.scratchpadArchiveFile, "utf-8")).tabs;
    expect(diskArchive.length).toBe(2);
  });

  it("archives an active tab correctly", () => {
    store.saveScratchpad([
      { id: "tab1", title: "Note 1", content: "<p>1</p>" },
      { id: "tab2", title: "Note 2", content: "<p>2</p>" },
    ]);

    const res = store.archiveScratchpadTab("tab1");
    expect(res.success).toBe(true);
    expect(res.activeTabs.length).toBe(1);
    expect(res.activeTabs[0].id).toBe("tab2");
    expect(res.archivedCount).toBe(1);

    expect(store.getScratchpad().length).toBe(1);
    expect(store.getScratchpadArchive().length).toBe(1);
    expect(store.getScratchpadArchive()[0].id).toBe("tab1");
    expect(store.getScratchpadArchive()[0].archived).toBe(true);
  });

  it("restores an archived tab back to active tabs", () => {
    store.saveScratchpad([{ id: "active1", title: "Active", content: "A" }]);
    store.saveScratchpadArchive([{ id: "archived1", title: "Archived", content: "B", archived: true }]);

    const res = store.restoreScratchpadTab("archived1");
    expect(res.success).toBe(true);
    expect(res.activeTabs.length).toBe(2);
    expect(res.activeTabs.some((t) => t.id === "archived1")).toBe(true);
    expect(res.archivedCount).toBe(0);

    expect(store.getScratchpadArchive().length).toBe(0);
    expect(store.getScratchpad().find((t) => t.id === "archived1")?.archived).toBe(false);
  });

  it("deletes an archived tab permanently", () => {
    store.saveScratchpadArchive([
      { id: "archived1", title: "To Keep", content: "1", archived: true },
      { id: "archived2", title: "To Delete", content: "2", archived: true },
    ]);

    const res = store.deleteArchivedScratchpadTab("archived2");
    expect(res.success).toBe(true);
    expect(res.archivedCount).toBe(1);

    const remaining = store.getScratchpadArchive();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe("archived1");
  });
});
