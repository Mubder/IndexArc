import { Router } from "express";
import { addLog } from "../logs.js";
import { sendSSE } from "./sse.js";
import { throttle, recordFailure, recordSuccess } from "./throttle.js";
import type { RouteContext } from "./types.js";

export function vaultRoutes(ctx: RouteContext) {
  const r = Router();
  const { store, audit } = ctx;

  r.get("/status", (_req, res) => {
    const encrypted = store.isEncryptionEnabled();
    const fresh = store.isFreshVault();
    res.json({
      is_locked: store.isLocked(),
      encryption_enabled: encrypted,
      // Encrypted-by-default: a brand-new vault requires a master password
      // before anything is stored; an existing plaintext vault gets a
      // (recurring, dismissible) migration recommendation instead.
      needs_setup: fresh && !encrypted,
      migration_recommended: !fresh && !encrypted,
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
      audit?.log("vault.unlock", "success");
      sendSSE("vault-changed", { locked: false });
      res.json({ success: true });
    } else {
      recordFailure(req);
      addLog("SECURITY", "Failed unlock attempt");
      audit?.log("vault.unlock", "failure");
      setTimeout(() => {
        res.status(401).json({ error: "Incorrect master password" });
      }, gate.delayMs || 500);
    }
  });

  r.post("/lock", (_req, res) => {
    store.lock();
    addLog("SECURITY", "Vault locked");
    audit?.log("vault.lock", "manual");
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
      audit?.log("vault.encrypt", "password set — storage encrypted");
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
      audit?.log("vault.decrypt", "password removed — storage decrypted");
      sendSSE("vault-changed", { locked: false, encryption_enabled: false });
      res.json({ success: true });
    } else {
      recordFailure(req);
      audit?.log("vault.decrypt", "failure — wrong password");
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
