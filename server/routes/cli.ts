import { Router } from "express";
import { addLog } from "../logs.js";
import { throttle, recordFailure, recordSuccess } from "./throttle.js";
import { createCliToken, listCliTokens, revokeCliToken } from "../cli.js";
import { envKey } from "../porting.js";
import type { VaultEntry } from "../types.js";
import type { RouteContext } from "./types.js";

// CLI access (R6.1). Mounted under /api/cli (in protectedPaths).
//   Token management (/tokens*) — pairing token only (the app's own UI).
//   Reads (/secret, /env)       — pairing token OR a CLI token (see auth.ts).

type Match = { entry: VaultEntry } | { error: string; status: number; candidates?: { id: string; name: string }[] };

/** Resolve a name the way a shell user types it: exact, then case-insensitive, then as an env key. */
export function findSecret(entries: VaultEntry[], name: string): Match {
  const secrets = entries.filter((e) => e.family === "secret");
  const tiers = [
    secrets.filter((e) => e.name === name),
    secrets.filter((e) => e.name.toLowerCase() === name.toLowerCase()),
    secrets.filter((e) => envKey(e.name) === envKey(name)),
  ];
  for (const hits of tiers) {
    if (hits.length === 1) return { entry: hits[0] };
    if (hits.length > 1)
      return {
        status: 409,
        error: `"${name}" matches ${hits.length} secrets; use --id`,
        candidates: hits.map((e) => ({ id: e.id, name: e.name })),
      };
  }
  return { status: 404, error: `No secret named "${name}"` };
}

export function cliRoutes(ctx: RouteContext) {
  const r = Router();
  const { store, audit, paths } = ctx;
  const file = paths.cliTokensFile;
  const who = (req: any) => (req.cliToken ? `token "${req.cliToken.name}"` : "app");

  // ── Token management (pairing token only) ────────────────────────────────
  r.get("/tokens", (req: any, res) => {
    if (req.cliToken) return res.status(403).json({ error: "Forbidden" });
    res.json({ tokens: listCliTokens(file) });
  });

  r.post("/tokens", async (req: any, res) => {
    if (req.cliToken) return res.status(403).json({ error: "Forbidden" });
    const gate = throttle(req, res, { max: 10 });
    if (!gate) return;
    const { name, password } = req.body || {};
    if (store.isEncryptionEnabled()) {
      if (!password || !(await store.verifyMasterPassword(String(password)))) {
        recordFailure(req);
        return setTimeout(() => res.status(401).json({ error: "Incorrect master password" }), gate.delayMs || 500);
      }
    }
    recordSuccess(req);
    const digest = store.cliDigester();
    if (!digest) return res.status(423).json({ error: "Vault is locked" });
    try {
      const out = createCliToken(file, String(name || ""), digest);
      addLog("SECURITY", `CLI token created: "${out.record.name}".`);
      audit?.log("cli.token.create", out.record.name);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Could not create the token" });
    }
  });

  r.post("/tokens/:id/revoke", (req: any, res) => {
    if (req.cliToken) return res.status(403).json({ error: "Forbidden" });
    if (!revokeCliToken(file, String(req.params.id))) return res.status(404).json({ error: "No such token" });
    addLog("SECURITY", "CLI token revoked.");
    audit?.log("cli.token.revoke", String(req.params.id));
    res.json({ ok: true });
  });

  // ── Reads ────────────────────────────────────────────────────────────────
  r.get("/secret", (req: any, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const name = typeof req.query.name === "string" ? req.query.name : "";
    if (!id && !name) return res.status(400).json({ error: "name or id is required" });
    const entries = store.listEntries();
    let entry: VaultEntry | undefined;
    if (id) {
      entry = entries.find((e) => e.id === id && e.family === "secret");
      if (!entry) return res.status(404).json({ error: "No secret with that id" });
    } else {
      const m = findSecret(entries, name);
      if ("error" in m) return res.status(m.status).json({ error: m.error, candidates: m.candidates });
      entry = m.entry;
    }
    audit?.log("cli.read", `${who(req)}: ${entry.name}`);
    res.json({ id: entry.id, name: entry.name, type: entry.type, value: entry.value });
  });

  r.post("/env", (req: any, res) => {
    const { names, label, all } = req.body || {};
    const entries = store.listEntries();
    const env: Record<string, string> = {};
    const missing: string[] = [];
    let picked: VaultEntry[] = [];
    if (Array.isArray(names) && names.length) {
      for (const n of names.map(String)) {
        const m = findSecret(entries, n);
        if ("error" in m) {
          if (m.status === 409) return res.status(409).json({ error: m.error, candidates: m.candidates });
          missing.push(n);
        } else picked.push(m.entry);
      }
    } else if (typeof label === "string" && label) {
      picked = entries.filter((e) => e.family === "secret" && e.labels.includes(label));
    } else if (all === true) {
      picked = entries.filter((e) => e.family === "secret");
    } else {
      return res.status(400).json({ error: "Pass names, a label, or all: true" });
    }
    for (const e of picked) env[envKey(e.name)] = e.value;
    audit?.log("cli.env", `${who(req)}: ${Object.keys(env).length} secrets`);
    res.json({ env, count: Object.keys(env).length, missing });
  });

  return r;
}
