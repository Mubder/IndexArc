import { Router } from "express";
import { addLog } from "../logs.js";
import { sendSSE } from "./sse.js";
import { throttle, recordFailure, recordSuccess } from "./throttle.js";
import type { RouteContext } from "./types.js";
import { checkPassword, passwordProblemMessage } from "../../shared/password-policy.js";

/** 400 body for a new master password that fails the policy, or null if it passes. */
function rejectPassword(pw: unknown) {
  const c = checkPassword(String(pw ?? ""));
  return c.ok ? null : { error: passwordProblemMessage(c.problem!), code: `password_${c.problem}` };
}

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

    if (!store.isEncryptionEnabled()) {
      // Unencrypted vault: nothing to verify — any password "unlocks" it.
      // Audit the truth instead of recording a phony verified unlock.
      audit?.log("vault.unlock", "skipped — vault not encrypted");
      return res.json({ success: true, encryption_enabled: false });
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
    // accidental call here is a lockout/ransom attack, so it is throttled AND
    // requires the interactive ceremony word (same pattern as unprotect's
    // "UNPROTECT"): a script holding only the pairing token must replicate
    // the user-confirmed flow, not just POST a password.
    const gate = throttle(req, res, { max: 5 });
    if (!gate) return;

    const { password, confirm_word } = req.body;
    const bad = rejectPassword(password);
    if (bad) return res.status(400).json(bad);
    if (String(confirm_word ?? "").trim().toUpperCase() !== "ENCRYPT") {
      recordFailure(req);
      return res.status(403).json({ error: "Confirmation failed — type ENCRYPT to encrypt the vault" });
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

  r.post("/change-password", async (req, res) => {
    // Verifies the current password itself, so it works locked or unlocked;
    // throttled like unlock (a success is proof of the password).
    const gate = throttle(req, res, { max: 10 });
    if (!gate) return;
    const { current_password, new_password } = req.body || {};
    if (!current_password) return res.status(400).json({ error: "Current password is required" });
    const bad = rejectPassword(new_password);
    if (bad) return res.status(400).json(bad);
    try {
      const ok = await store.changePassword(String(current_password), String(new_password));
      if (!ok) {
        recordFailure(req);
        audit?.log("vault.rekey", "failure — wrong password");
        return setTimeout(() => res.status(401).json({ error: "Incorrect master password" }), gate.delayMs || 500);
      }
      recordSuccess(req);
      audit?.log("vault.rekey", "master password changed");
      sendSSE("vault-changed", { locked: false });
      res.json({ success: true, recovery: store.recoveryStatus() });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // The /recovery* routes check the lock themselves: the protectedPaths gate
  // in app.ts is mounted after this router, so it never sees them.
  r.get("/recovery", (_req, res) => {
    if (store.isLocked()) return res.status(423).json({ error: "Vault is locked", is_locked: true });
    res.json(store.recoveryStatus());
  });

  r.post("/recovery", async (req, res) => {
    // A recovery code outlives lock and password changes, so minting one
    // needs the master password — not just a token on an unlocked session.
    const gate = throttle(req, res, { max: 10 });
    if (!gate) return;
    if (store.isLocked()) return res.status(423).json({ error: "Vault is locked", is_locked: true });
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "Password is required" });
    if (!(await store.verifyMasterPassword(String(password)))) {
      recordFailure(req);
      return setTimeout(() => res.status(401).json({ error: "Incorrect master password" }), gate.delayMs || 500);
    }
    try {
      recordSuccess(req);
      const code = store.createRecoveryKey();
      audit?.log("vault.recovery", "recovery key created");
      res.json({ code, ...store.recoveryStatus() });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post("/recovery/remove", (_req, res) => {
    if (store.isLocked()) return res.status(423).json({ error: "Vault is locked", is_locked: true });
    store.removeRecoveryKey();
    audit?.log("vault.recovery", "recovery key removed");
    res.json(store.recoveryStatus());
  });

  r.post("/recover", async (req, res) => {
    // Locked-state entry point, like unlock: throttled harder. The code is
    // 256 bits, so this is about noise, not brute force.
    const gate = throttle(req, res, { max: 5 });
    if (!gate) return;
    const { recovery_code, new_password } = req.body || {};
    if (!recovery_code) return res.status(400).json({ error: "Recovery code is required" });
    const bad = rejectPassword(new_password);
    if (bad) return res.status(400).json(bad);
    try {
      await store.recoverWithCode(String(recovery_code), String(new_password));
      recordSuccess(req);
      addLog("SECURITY", "Vault recovered with recovery key");
      audit?.log("vault.recover", "success — password reset with recovery key");
      sendSSE("vault-changed", { locked: false });
      res.json({ success: true });
    } catch (e: any) {
      recordFailure(req);
      audit?.log("vault.recover", "failure");
      setTimeout(() => res.status(401).json({ error: e?.message || "Recovery failed" }), gate.delayMs || 500);
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
