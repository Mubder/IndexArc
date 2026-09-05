import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

describe("vault salt/key consistency across instances", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-salt-"));
    paths = ensurePortableLayout(tmpDir);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("unlocks from a fresh instance after setupPassword (salt consistency)", async () => {
    const s1 = new VaultStore(paths);
    s1.saveScratchpad([{ id: "t1", title: "A", content: "x" }]);
    await s1.setupPassword("test-password-123");

    const vaultDisk = JSON.parse(fs.readFileSync(paths.vaultFile, "utf-8"));
    expect(vaultDisk.encrypted).toBe(true);

    const s2 = new VaultStore(paths);
    const ok = await s2.unlock("test-password-123");
    expect(ok).toBe(true);
    expect(s2.getScratchpad()[0]?.content).toContain("x");
  });
});
