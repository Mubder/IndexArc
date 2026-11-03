import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import express from "express";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { settingsRoutes } from "./routes/settings.js";
import type { RouteContext } from "./routes/types.js";

// R1.5 (R4 route-matrix finding): while locked, a token-holder must not be
// able to flip egress consent or re-point endpoints before the user unlocks.
describe("settings writes while locked", () => {
  let tmpDir: string;
  let store: VaultStore;
  let server: http.Server;
  let baseUrl: string;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-locked-settings-"));
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
    const paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    store.createEntry({ value: "sk", type: "api key", name: "k", raw_fragment: "", labels: [], type_aliases: [], status: "saved", family: "secret" });
    await store.setupPassword("locked-settings-pw");
    store.lock();
    const app = express();
    app.use(express.json());
    app.use("/api", settingsRoutes({ store, paths } as unknown as RouteContext));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("refuses consent and endpoint changes", async () => {
    const res = await post({ ai_cloud_consent: true, ollama_base_url: "http://evil.example:11434" });
    expect(res.status).toBe(423);
    expect(store.getSettings().ai_cloud_consent).toBeFalsy();
    expect(store.getSettings().ollama_base_url).not.toContain("evil");
  });

  it("still allows the lock screen's language and font size", async () => {
    const res = await post({ ui_language: "ar", font_size_en: 16 });
    expect(res.status).toBe(200);
    expect(store.getSettings().ui_language).toBe("ar");
  });
});
