import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { findUsages, hygienePatch, hygieneState, hygieneSummary } from "./hygiene.js";
import type { VaultEntry } from "./types.js";

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const DAY = 86_400_000;
const e = (id: string, extra: Partial<VaultEntry> = {}): VaultEntry => ({
  id,
  value: "v",
  type: "api key",
  name: id,
  raw_fragment: "",
  labels: [],
  type_aliases: [],
  status: "saved",
  family: "secret",
  created_at: new Date(NOW - 100 * DAY).toISOString(),
  updated_at: new Date(NOW - 100 * DAY).toISOString(),
  ...extra,
});

describe("hygiene state", () => {
  it("expired / expiring / rotation due / ok", () => {
    expect(hygieneState(e("a", { expires_at: new Date(NOW - DAY).toISOString() }), NOW).state).toBe("expired");
    expect(hygieneState(e("b", { expires_at: new Date(NOW + 3 * DAY).toISOString() }), NOW).state).toBe("expiring");
    expect(hygieneState(e("c", { expires_at: new Date(NOW + 60 * DAY).toISOString() }), NOW).state).toBe("ok");
    expect(hygieneState(e("d", { rotate_every_days: 90 }), NOW).state).toBe("rotation_due");
    expect(hygieneState(e("f", { rotate_every_days: 90, last_rotated_at: new Date(NOW - 10 * DAY).toISOString() }), NOW).state).toBe("ok");
    expect(hygieneState(e("g"), NOW).state).toBe("ok");
  });

  it("summary sorts by urgency and counts", () => {
    const s = hygieneSummary(
      [
        e("exp", { expires_at: new Date(NOW + 2 * DAY).toISOString() }),
        e("rot", { rotate_every_days: 30 }),
        e("dead", { expires_at: new Date(NOW - 2 * DAY).toISOString() }),
        e("fine"),
      ],
      NOW
    );
    expect(s.items.map((i) => i.id)).toEqual(["dead", "rot", "exp"]);
    expect(s.counts).toEqual({ expired: 1, expiring: 1, rotation_due: 1 });
    expect(s.tracked).toBe(3);
  });

  it("validates patches", () => {
    expect(hygienePatch({ expires_at: "2027-01-31" })).toEqual({ expires_at: "2027-01-31T00:00:00.000Z" });
    expect(hygienePatch({ expires_at: null, rotate_every_days: 0 })).toEqual({ expires_at: undefined, rotate_every_days: undefined });
    expect(hygienePatch({ rotated: true }, NOW)).toEqual({ last_rotated_at: new Date(NOW).toISOString() });
    expect(() => hygienePatch({ expires_at: "soon" })).toThrow(/date/);
    expect(() => hygienePatch({ rotate_every_days: 99999 })).toThrow(/1–3650/);
  });
});

describe("where used", () => {
  it("finds the value with line numbers, skips binaries and ignored folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-usage-"));
    try {
      const secret = "sk-usage-test-1234567890";
      fs.mkdirSync(path.join(root, "src"));
      fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "config.ts"), `const a = 1;\nconst key = "${secret}";\n`);
      fs.writeFileSync(path.join(root, ".env"), `KEY=${secret}\nOTHER=${secret}\n`);
      fs.writeFileSync(path.join(root, "node_modules", "x", "i.js"), secret);
      fs.writeFileSync(path.join(root, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret)]));
      const r = findUsages(secret, [root]);
      const rel = r.usages.map((u) => [path.relative(root, u.file).replace(/\\/g, "/"), u.line]).sort();
      expect(rel).toEqual([
        [".env", 1],
        [".env", 2],
        ["src/config.ts", 2],
      ]);
      expect(r.truncated).toBe(false);
      expect(findUsages(secret, [root], { maxHits: 1 }).truncated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
