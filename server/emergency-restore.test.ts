import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

// Regression test for "restored but still nothing in vault":
// restoreEmergencySnapshot used to write files to disk without clearing the
// store's in-memory caches, so the SAME running server kept serving the
// pre-restore (empty) state until a full restart.
describe("emergency restore serves fresh data without restart", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;
  let snapshotsBefore: Set<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-restore-test-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    // Snapshots also fan out to shared machine locations (APPDATA / home) —
    // remember what existed so the test can remove only what it created.
    snapshotsBefore = new Set(store.listEmergencySnapshots().map((s) => s.name));
  });

  afterEach(() => {
    try {
      const fresh = store
        .listEmergencySnapshots()
        .filter((s) => !snapshotsBefore.has(s.name));
      for (const s of fresh) {
        for (const dir of s.locations) {
          try {
            fs.unlinkSync(path.join(dir, s.name));
          } catch {}
        }
      }
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("serves restored entries from the same store instance (no restart)", () => {
    const created = store.createEntry({
      value: "s3cret",
      type: "api key",
      name: "testkey",
      raw_fragment: "",
      labels: [],
      type_aliases: [],
      status: "saved",
      family: "secret",
    });
    expect(store.listEntries().length).toBe(1);

    const snap = store.createEmergencySnapshot(50);
    expect(snap).toBeTruthy();

    expect(store.deleteEntry(created.id)).toBe(true);
    expect(store.listEntries().length).toBe(0);

    expect(store.restoreEmergencySnapshot(snap as string)).toBe(true);

    // Same instance, no restart, no manual cache clear — must show the entry.
    const after = store.listEntries();
    expect(after.length).toBe(1);
    expect(after[0].name).toBe("testkey");
    expect(store.stats().total).toBe(1);
  });

  it("flags snapshots by content so empty ones are identifiable", () => {
    // Snapshot WITH vault data.
    store.createEntry({
      value: "s3cret",
      type: "api key",
      name: "testkey",
      raw_fragment: "",
      labels: [],
      type_aliases: [],
      status: "saved",
      family: "secret",
    });
    const withData = store.createEmergencySnapshot(50);
    expect(withData).toBeTruthy();

    const listed = store.listEmergencySnapshots().find((s) => s.name === withData);
    expect(listed).toBeDefined();
    expect(listed?.has_vault).toBe(true);
  });

  // Reinstall data-loss regression: machine-level snapshots (the %APPDATA%
  // copies that survive an install-folder wipe) used to be written only at
  // startup. A tray-resident app made changes for days with no new snapshot,
  // so restoring after a reinstall silently dropped them.
  it("fans a fresh snapshot out after writes (debounced)", () => {
    vi.useFakeTimers();
    try {
      store.createEntry({
        value: "s3cret",
        type: "api key",
        name: "fresh-key",
        raw_fragment: "",
        labels: [],
        type_aliases: [],
        status: "saved",
        family: "secret",
      });

      // Debounce pending — nothing new written yet.
      vi.advanceTimersByTime(9_999);
      expect(
        store.listEmergencySnapshots().filter((s) => !snapshotsBefore.has(s.name)).length
      ).toBe(0);

      // Debounce elapsed — the write reached the machine-level locations.
      vi.advanceTimersByTime(1);
      const fresh = store.listEmergencySnapshots().filter((s) => !snapshotsBefore.has(s.name));
      expect(fresh.length).toBeGreaterThan(0);
      expect(fresh[0].has_vault).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushEmergencySnapshot writes immediately (quit-time freshness)", () => {
    store.createEntry({
      value: "s3cret",
      type: "api key",
      name: "quit-key",
      raw_fragment: "",
      labels: [],
      type_aliases: [],
      status: "saved",
      family: "secret",
    });
    store.flushEmergencySnapshot();
    const fresh = store.listEmergencySnapshots().filter((s) => !snapshotsBefore.has(s.name));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh[0].has_vault).toBe(true);

    // Flush also cancels the pending debounce — no double write later.
    store.flushEmergencySnapshot();
    const names = store
      .listEmergencySnapshots()
      .filter((s) => !snapshotsBefore.has(s.name))
      .map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // AUD-003 regression: archived notes and revision history are user data —
  // a snapshot that omits them "survives" a reinstall while silently losing
  // every archived note. They must round-trip through snapshot + restore.
  it("snapshots and restores the archive and note revisions too", () => {
    fs.writeFileSync(
      paths.scratchpadFile,
      JSON.stringify({ version: 2, tabs: [{ id: "live", title: "Live", content: "<p>l</p>" }] })
    );
    fs.writeFileSync(
      paths.scratchpadArchiveFile,
      JSON.stringify({ version: 1, tabs: [{ id: "cold", title: "Cold", content: "<p>c</p>", archived: true }] })
    );
    store.addNoteRevision({ tabId: "live", title: "Live", timestamp: 1234, content: "<p>v1</p>" });

    const snap = store.createEmergencySnapshot(50);
    expect(snap).toBeTruthy();
    expect(store.listEmergencySnapshots().find((s) => s.name === snap)?.has_notes).toBe(true);

    // Simulate the reinstall wipe: everything under data/ is gone.
    fs.unlinkSync(paths.scratchpadFile);
    fs.unlinkSync(paths.scratchpadArchiveFile);
    fs.unlinkSync(paths.noteRevisionsFile);

    expect(store.restoreEmergencySnapshot(snap as string)).toBe(true);
    expect(store.getScratchpadArchive().map((t: any) => t.id)).toEqual(["cold"]);
    expect(store.getNoteRevisions("live").length).toBe(1);

    // Timestamped backups carry the companions as well.
    store.createEntry({
      value: "s3cret",
      type: "api key",
      name: "backup-key",
      raw_fragment: "",
      labels: [],
      type_aliases: [],
      status: "saved",
      family: "secret",
    });
    store.backupVault(10);
    const stampFiles = fs.readdirSync(paths.backupsDir);
    expect(stampFiles.some((f) => f.startsWith("notes-archive-"))).toBe(true);
    expect(stampFiles.some((f) => f.startsWith("note-revisions-"))).toBe(true);
  });
});
