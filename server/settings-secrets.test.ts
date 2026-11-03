import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

// Portable copy opened on a machine whose keychain can't unwrap the settings
// key: the wrapped API keys read back as "" — an unrelated settings save must
// NOT overwrite the on-disk blobs with those empty strings.
describe("settings API keys survive a missing/foreign wrap key", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevKey = process.env.INDEXARC_SETTINGS_KEY;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-settings-"));
    paths = ensurePortableLayout(tmpDir);
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.INDEXARC_SETTINGS_KEY;
    else process.env.INDEXARC_SETTINGS_KEY = prevKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const rawSettings = () => JSON.parse(fs.readFileSync(paths.settingsFile, "utf-8"));

  it("keeps an unreadable wrapped key through an unrelated save", () => {
    const original = crypto.randomBytes(32).toString("base64");
    process.env.INDEXARC_SETTINGS_KEY = original;
    new VaultStore(paths).saveSettings({ openai_api_key: "sk-test-123" });
    const blob = rawSettings().openai_api_key;
    expect(blob.startsWith("enc:v1:")).toBe(true);

    // Same folder, different machine: no wrap key at all.
    delete process.env.INDEXARC_SETTINGS_KEY;
    const elsewhere = new VaultStore(paths);
    expect(elsewhere.getSettings().openai_api_key).toBe("");
    elsewhere.saveSettings({ ui_language: "ar" } as any);
    expect(rawSettings().openai_api_key).toBe(blob);

    // Back on the original machine the key still opens.
    process.env.INDEXARC_SETTINGS_KEY = original;
    expect(new VaultStore(paths).getSettings().openai_api_key).toBe("sk-test-123");
  });

  it("an explicit new value still replaces the unreadable blob", () => {
    process.env.INDEXARC_SETTINGS_KEY = crypto.randomBytes(32).toString("base64");
    new VaultStore(paths).saveSettings({ openai_api_key: "sk-old" });
    delete process.env.INDEXARC_SETTINGS_KEY;
    new VaultStore(paths).saveSettings({ openai_api_key: "sk-new" });
    expect(rawSettings().openai_api_key).toBe("sk-new");
  });
});
