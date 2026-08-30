import { Router } from "express";
import { addLog } from "../logs.js";
import { sendSSE } from "./sse.js";
import type { RouteContext } from "./types.js";

const unlockAttempts = new Map<string, { count: number; firstAttempt: number }>();
const UNLOCK_MAX_ATTEMPTS = 10;
const UNLOCK_WINDOW_MS = 60_000;

export function vaultRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.get("/status", (_req, res) => {
    res.json({
      is_locked: store.isLocked(),
      encryption_enabled: store.isEncryptionEnabled(),
    });
  });

  r.post("/unlock", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = unlockAttempts.get(ip);
    if (entry && now - entry.firstAttempt > UNLOCK_WINDOW_MS) {
      unlockAttempts.delete(ip);
    }
    const current = unlockAttempts.get(ip);
    if (current && current.count >= UNLOCK_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many unlock attempts. Try again later." });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    if (!entry || now - entry.firstAttempt > UNLOCK_WINDOW_MS) {
      unlockAttempts.set(ip, { count: 1, firstAttempt: now });
    } else {
      entry.count++;
    }

    const ok = store.unlock(password);
    if (ok) {
      unlockAttempts.delete(ip);
      addLog("SECURITY", "Vault successfully unlocked");
      sendSSE("vault-changed", { locked: false });
      res.json({ success: true });
    } else {
      addLog("SECURITY", "Failed unlock attempt");
      setTimeout(() => {
        res.status(401).json({ error: "Incorrect master password" });
      }, 500);
    }
  });

  r.post("/lock", (_req, res) => {
    store.lock();
    addLog("SECURITY", "Vault locked");
    sendSSE("vault-changed", { locked: true });
    res.json({ success: true });
  });

  r.post("/setup-password", (req, res) => {
    const { password } = req.body;
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters long" });
    }
    try {
      store.setupPassword(password);
      addLog("SECURITY", "Vault password configured & storage encrypted");
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post("/remove-password", (req, res) => {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }
    const ok = store.removePassword(password);
    if (ok) {
      addLog("SECURITY", "Vault password removed & storage decrypted");
      res.json({ success: true });
    } else {
      setTimeout(() => {
        res.status(401).json({ error: "Incorrect master password" });
      }, 500);
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
