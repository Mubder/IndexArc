import { Router } from "express";
import { addLog } from "../logs.js";
import { sendSSE } from "./sse.js";
import type { RouteContext } from "./types.js";

// Shared attempt throttle for password-guessing endpoints (unlock /
// setup-password / remove-password). Max N attempts per rolling window per
// client; on failure the response is additionally delayed (mild online
// brute-force friction on top of async PBKDF2).
const attempts = new Map<string, { count: number; firstAttempt: number; failures: number }>();
const WINDOW_MS = 60_000;

function clientKey(req: any): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function throttle(
  req: any,
  res: any,
  opts: { max: number }
): { delayMs: number } | null {
  const now = Date.now();
  let entry = attempts.get(clientKey(req));
  if (entry && now - entry.firstAttempt > WINDOW_MS) {
    entry = undefined;
  }
  if (!entry) {
    entry = { count: 0, firstAttempt: now, failures: 0 };
    attempts.set(clientKey(req), entry);
  }
  entry.count++;
  if (entry.count > opts.max) {
    res.status(429).json({ error: "Too many attempts. Try again in a minute." });
    return null;
  }
  // Escalating friction per consecutive failure: 0, 500ms, 1000ms ... capped 5s
  const delayMs = Math.min(entry.failures * 500, 5000);
  return { delayMs };
}

function recordFailure(req: any): void {
  const entry = attempts.get(clientKey(req));
  if (entry) entry.failures++;
}

function recordSuccess(req: any): void {
  attempts.delete(clientKey(req));
}

export function vaultRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.get("/status", (_req, res) => {
    res.json({
      is_locked: store.isLocked(),
      encryption_enabled: store.isEncryptionEnabled(),
    });
  });

  r.post("/unlock", async (req, res) => {
    const gate = throttle(req, res, { max: 10 });
    if (!gate) return;

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const ok = await store.unlock(password);
    if (ok) {
      recordSuccess(req);
      addLog("SECURITY", "Vault successfully unlocked");
      sendSSE("vault-changed", { locked: false });
      res.json({ success: true });
    } else {
      recordFailure(req);
      addLog("SECURITY", "Failed unlock attempt");
      setTimeout(() => {
        res.status(401).json({ error: "Incorrect master password" });
      }, gate.delayMs || 500);
    }
  });

  r.post("/lock", (_req, res) => {
    store.lock();
    addLog("SECURITY", "Vault locked");
    sendSSE("vault-changed", { locked: true });
    res.json({ success: true });
  });

  r.post("/setup-password", async (req, res) => {
    // Setting a master password encrypts the whole vault — a hostile or
    // accidental call here is a lockout/ransom attack, so it is throttled.
    const gate = throttle(req, res, { max: 5 });
    if (!gate) return;

    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long" });
    }
    try {
      await store.setupPassword(password);
      recordSuccess(req);
      addLog("SECURITY", "Vault password configured & storage encrypted");
      sendSSE("vault-changed", { locked: false, encryption_enabled: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post("/remove-password", async (req, res) => {
    // Success here writes the vault to disk DECRYPTED, so guessing this
    // endpoint must be as hard as guessing the unlock endpoint.
    const gate = throttle(req, res, { max: 10 });
    if (!gate) return;

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }
    const ok = await store.removePassword(password);
    if (ok) {
      recordSuccess(req);
      addLog("SECURITY", "Vault password removed & storage decrypted");
      sendSSE("vault-changed", { locked: false, encryption_enabled: false });
      res.json({ success: true });
    } else {
      recordFailure(req);
      setTimeout(() => {
        res.status(401).json({ error: "Incorrect master password" });
      }, gate.delayMs || 500);
    }
  });

  return r;
}

/** Middleware: check if vault is unlocked */
export function checkVaultUnlocked(ctx: RouteContext) {
  return (req: any, res: any, next: any) => {
    if (ctx.store.isLocked()) {
      return res.status(423).json({ error: "Vault is locked", is_locked: true });
    }
    next();
  };
}
