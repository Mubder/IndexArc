import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { closeAllRecordDbs, RecordDb } from "./db/recordDb.js";
import { decodeRecoveryCode, encodeRecoveryCode, generateRecoveryKey, openWithRecoveryCode, sealToRecoveryKey } from "./recovery.js";

describe("recovery code format", () => {
  it("round-trips, accepts sloppy input and catches typos", () => {
    const raw = crypto.randomBytes(32);
    const code = encodeRecoveryCode(raw);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(decodeRecoveryCode(code).equals(raw)).toBe(true);
    expect(decodeRecoveryCode(` ${code.toLowerCase().replace(/-/g, " ")} `).equals(raw)).toBe(true);
    const typo = (code[0] === "0" ? "1" : "0") + code.slice(1);
    expect(() => decodeRecoveryCode(typo)).toThrow(/checksum/);
    expect(() => decodeRecoveryCode(code.slice(0, -2))).toThrow(/length/);
  });

  it("seals to the public key; only the matching code opens it", () => {
    const a = generateRecoveryKey();
    const b = generateRecoveryKey();
    const secret = crypto.randomBytes(32);
    const sealed = sealToRecoveryKey(secret, a.publicKey);
    expect(openWithRecoveryCode(sealed, a.code).equals(secret)).toBe(true);
    expect(() => openWithRecoveryCode(sealed, b.code)).toThrow(/does not open/);
    const tampered = { ...sealed, ct: (sealed.ct[0] === "0" ? "1" : "0") + sealed.ct.slice(1) };
    expect(() => openWithRecoveryCode(tampered, a.code)).toThrow(/does not open/);
  });
});

describe("password change and recovery key", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const OLD = "old-password-123456";
  const NEW = "new-password-abcdef";
  const entry = (value: string) => ({
    value,
    type: "api key",
    name: "k",
    raw_fragment: "",
    labels: [] as string[],
    type_aliases: [] as string[],
    status: "saved" as const,
    family: "secret" as const,
  });

  async function seeded() {
    const store = new VaultStore(paths);
    await store.setupPassword(OLD);
    const e = store.createEntry(entry("sk-recover-me"));
    store.saveScratchpad([{ id: "t1", title: "N", content: "<p>note-body</p>" }]);
    return { store, id: e.id };
  }

  async function opens(password: string): Promise<VaultStore | null> {
    closeAllRecordDbs();
    const s = new VaultStore(paths);
    return (await s.unlock(password)) ? s : null;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-recovery-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeAllRecordDbs();
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("changePassword re-keys everything; the old password stops working", async () => {
    const { store, id } = await seeded();
    expect(await store.changePassword("wrong-password-x", NEW)).toBe(false);
    expect(await store.changePassword(OLD, NEW)).toBe(true);
    expect(store.getEntry(id)?.value).toBe("sk-recover-me");
    store.lock();

    expect(await opens(OLD)).toBeNull();
    const s = await opens(NEW);
    expect(s).not.toBeNull();
    expect(s!.getEntry(id)?.value).toBe("sk-recover-me");
    expect(s!.getScratchpad().some((t: any) => String(t.content).includes("note-body"))).toBe(true);
    const db = new RecordDb(paths.vaultDbFile).open();
    expect(db.getMeta("salt")).toBe(JSON.parse(fs.readFileSync(paths.vaultFile, "utf8")).salt);
    expect(db.getMeta("prev_key")).toBeNull();
  });

  it("a crash after the header switch but before the rows are rewritten is repaired at unlock", async () => {
    const { store, id } = await seeded();
    const spy = vi.spyOn(store as any, "writeDbTables").mockImplementationOnce(() => {
      throw new Error("simulated crash");
    });
    await expect(store.changePassword(OLD, NEW)).rejects.toThrow(/simulated crash/);
    expect(spy).toHaveBeenCalled();
    // Rows are still under the old key; prev_key holds it, sealed under the new one.
    closeAllRecordDbs();
    expect(new RecordDb(paths.vaultDbFile).open().getMeta("prev_key")).not.toBeNull();

    const s = await opens(NEW);
    expect(s).not.toBeNull();
    expect(s!.getEntry(id)?.value).toBe("sk-recover-me");
    expect((s as any).db().getMeta("prev_key")).toBeNull();
  });

  it("recovery code resets a forgotten password and keeps all data", async () => {
    const { store, id } = await seeded();
    const code = store.createRecoveryKey();
    expect(store.recoveryStatus()).toMatchObject({ enabled: true, current: true });
    expect(fs.readFileSync(paths.recoveryFile, "utf8")).not.toContain(code);
    store.lock();

    closeAllRecordDbs();
    const locked = new VaultStore(paths);
    await expect(locked.recoverWithCode(generateRecoveryKey().code, NEW)).rejects.toThrow(/does not open/);
    await locked.recoverWithCode(code, NEW);
    expect(locked.isLocked()).toBe(false);
    expect(locked.getEntry(id)?.value).toBe("sk-recover-me");
    // The same recovery code keeps working (resealed to the new key).
    expect(locked.recoveryStatus().current).toBe(true);
    locked.lock();

    expect(await opens(OLD)).toBeNull();
    const s = await opens(NEW);
    expect(s!.getEntry(id)?.value).toBe("sk-recover-me");
    s!.lock();
    closeAllRecordDbs();
    await new VaultStore(paths).recoverWithCode(code, "third-password-zzz");
    expect(await opens("third-password-zzz")).not.toBeNull();
  });

  it("the recovery seal follows a password change; removing the password removes it", async () => {
    const { store } = await seeded();
    const code = store.createRecoveryKey();
    expect(await store.changePassword(OLD, NEW)).toBe(true);
    expect(store.recoveryStatus().current).toBe(true);
    store.lock();
    closeAllRecordDbs();
    await new VaultStore(paths).recoverWithCode(code, "after-change-pw-1");

    const s = await opens("after-change-pw-1");
    expect(await s!.removePassword("after-change-pw-1")).toBe(true);
    expect(fs.existsSync(paths.recoveryFile)).toBe(false);
    expect(s!.recoveryStatus().enabled).toBe(false);
  });

  it("a recovery file from an older key is reported as out of date", async () => {
    const { store } = await seeded();
    store.createRecoveryKey();
    const stale = fs.readFileSync(paths.recoveryFile);
    const code2 = store.createRecoveryKey();
    expect(await store.changePassword(OLD, NEW)).toBe(true);
    fs.writeFileSync(paths.recoveryFile, stale);
    expect(store.recoveryStatus()).toMatchObject({ enabled: true, current: false });
    store.lock();
    closeAllRecordDbs();
    await expect(new VaultStore(paths).recoverWithCode(code2, "x-password-999")).rejects.toThrow(/does not open|out of date/);
  });
});
