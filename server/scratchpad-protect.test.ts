import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore, ProtectedTabError } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

describe("note protection (server-enforced)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-protect-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    store.saveScratchpad([
      { id: "note1", title: "Precious", content: "<p>important</p>" },
      { id: "note2", title: "Normal", content: "<p>editable</p>" },
    ]);
    expect(store.setScratchpadTabProtected("note1", true)?.protected).toBe(true);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("blocks single-tab content edits on a protected note", () => {
    const r = store.updateScratchpadTabContent("note1", "<p>hacked</p>", 1);
    expect(r.ok).toBe(false);
    expect(r.protected).toBe(true);
    // force overrides (dedicated unprotect/override flow only)
    const r2 = store.updateScratchpadTabContent("note1", "<p>hacked</p>", 1, true);
    expect(r2.ok).toBe(true);
    store.updateScratchpadTabContent("note1", "<p>important</p>", undefined, true); // restore
  });

  it("blocks whole-array saves that modify or omit a protected note", () => {
    // modify
    expect(() =>
      store.saveScratchpad([
        { id: "note1", title: "Precious", content: "<p>CHANGED</p>" },
        { id: "note2", title: "Normal", content: "<p>editable</p>" },
      ])
    ).toThrow(ProtectedTabError);
    // omit (deletion-by-omission)
    expect(() =>
      store.saveScratchpad([{ id: "note2", title: "Normal", content: "<p>editable</p>" }])
    ).toThrow(ProtectedTabError);
    // identical resave passes
    expect(() =>
      store.saveScratchpad([
        { id: "note1", title: "Precious", content: "<p>important</p>" },
        { id: "note2", title: "Normal", content: "<p>editable</p>" },
      ])
    ).not.toThrow();
  });

  it("blocks delete and archive of a protected note", () => {
    expect(store.deleteScratchpadTab("note1")).toBe("protected");
    const arch = store.archiveScratchpadTab("note1");
    expect(arch.success).toBe(false);
    expect(arch.reason).toBe("protected");
    // unprotected note deletes fine
    expect(store.deleteScratchpadTab("note2")).toBe(true);
  });

  it("blocks rename of a protected note", () => {
    expect(() => store.renameScratchpadTab("note1", "Renamed")).toThrow(ProtectedTabError);
    expect(store.renameScratchpadTab("note2", "Renamed")?.title).toBe("Renamed");
  });

  it("allows unprotect with the UNPROTECT word on an unencrypted vault", async () => {
    // No password set: verifyMasterPassword is always false, UNPROTECT word is the only gate.
    expect(await store.verifyMasterPassword("anything")).toBe(false);
    expect(store.setScratchpadTabProtected("note1", false)?.protected).toBe(false);
  });

  it("unprotect via master password on an encrypted vault", async () => {
    await store.setupPassword("test-password-123");
    // note1 still protected after encryption
    expect(store.getScratchpad().find((t: any) => t.id === "note1")?.protected).toBe(true);

    // wrong password can't verify
    expect(await store.verifyMasterPassword("wrong-password")).toBe(false);
    expect(await store.verifyMasterPassword("test-password-123")).toBe(true);

    const tab = store.setScratchpadTabProtected("note1", false);
    expect(tab?.protected).toBe(false);
  });

  it("pins sort first and flags persist across instances", () => {
    expect(store.setScratchpadTabPinned("note2", true)?.pinned).toBe(true);

    const store2 = new VaultStore(paths);
    const tabs = store2.getScratchpad();
    expect(tabs.find((t: any) => t.id === "note1")?.protected).toBe(true);
    expect(tabs.find((t: any) => t.id === "note2")?.pinned).toBe(true);
  });
});
