import { describe, it, expect } from "vitest";
import { buildDiagnostics, redactText } from "./diagnostics.js";

const HOME = "C:\\Users\\alice";

describe("diagnostics redaction", () => {
  const secrets = [
    "sk-proj-AbCdEf0123456789AbCdEf0123456789xyz",
    "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    "AKIAIOSFODNN7EXAMPLE",
    "xox" + "b-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
  ];

  it("removes secret-shaped values, e-mails, URL credentials and the home path", () => {
    const text = [
      `Saved entry with value ${secrets[0]}`,
      `token=${secrets[1]}`,
      `aws ${secrets[2]} region us-east-1`,
      `slack ${secrets[3]}`,
      "contact alice@example.com",
      "db postgres://admin:hunter2pass@db.internal:5432/app",
      `root C:\\Users\\alice\\AppData\\Roaming\\IndexArc and C:/Users/alice/.IndexArc`,
      "password: correct-horse",
    ].join("\n");
    const out = redactText(text, HOME);
    for (const s of secrets) expect(out).not.toContain(s);
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("hunter2pass");
    expect(out).not.toContain("correct-horse");
    expect(out.toLowerCase()).not.toContain("alice");
    expect(out).toContain("~\\AppData\\Roaming\\IndexArc");
    expect(out).toContain("region us-east-1");
  });

  it("keeps ordinary diagnostic text readable", () => {
    const text = "Vault server listening on http://127.0.0.1:3131 — 3000 entries, backups: 4, id 3f2a1b4c-1d2e-4f50-8a9b-0c1d2e3f4a5b";
    expect(redactText(text, HOME)).toBe(text);
  });

  it("bundle carries no secret from logs, health or settings", () => {
    const bundle = buildDiagnostics({
      health: { server: { portable_root: "C:\\Users\\alice\\.IndexArc" }, note: `leak ${secrets[0]}` },
      logs: [{ time: "t", type: "ERROR", message: `failed with key ${secrets[1]}` }],
      settings: { gemini_api_key: { configured: true }, ollama_base_url: "http://user:pw-secret-999@host:11434" },
    });
    const json = JSON.stringify(bundle);
    for (const s of secrets) expect(json).not.toContain(s);
    expect(json).not.toContain("pw-secret-999");
    expect(bundle.format).toBe("indexarc-diagnostics");
  });
});

describe("opt-in crash log", () => {
  it("stores redacted records and keeps only the newest 50", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const { recordCrash, readCrashes } = await import("./diagnostics.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-crash-"));
    try {
      for (let i = 0; i < 55; i++) recordCrash(dir, { source: "test", message: `boom ${i} key=ghp_16C7e42F292c6912E7710c838347Ae178B4a`, stack: "at x" });
      const all = readCrashes(dir);
      expect(all).toHaveLength(50);
      expect(all[49].message).toContain("boom 54");
      expect(fs.readFileSync(path.join(dir, "crashes.jsonl"), "utf8")).not.toContain("ghp_16C7e42F292c6912E7710c838347Ae178B4a");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
