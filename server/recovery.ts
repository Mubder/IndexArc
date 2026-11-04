import crypto from "crypto";

// Recovery key (R5). At setup the user gets a one-time recovery code: the raw
// X25519 private key, base32-encoded with a checksum. Only the PUBLIC key is
// stored. Whenever the vault key changes, the new key is sealed to that
// public key (ephemeral X25519 + HKDF-SHA256 + AES-256-GCM), so the store can
// keep the sealed copy current without ever holding the private key.
//
// Anyone with the recovery code AND the vault files can open the vault —
// exactly like the master password. It is shown once and never stored.

export const RECOVERY_ALG = "x25519-hkdf-sha256-aes256gcm";
const HKDF_INFO = Buffer.from("indexarc:recovery:v1");
const AAD = Buffer.from("indexarc:recovery:vault-key:v1");
// PKCS#8 DER prefix for a raw 32-byte X25519 private key (RFC 8410).
const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK_BYTES = 3;

export interface SealedKey {
  epk: string; // ephemeral public key, SPKI DER, base64
  iv: string; // hex
  tag: string; // hex
  ct: string; // hex
}

function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const i = CROCKFORD.indexOf(ch);
    if (i < 0) throw new Error("invalid character in recovery code");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

const checksum = (raw: Buffer) => crypto.createHash("sha256").update(raw).digest().subarray(0, CHECK_BYTES);

/** 32 key bytes + 3 checksum bytes → 56 chars → 14 groups of 4. */
export function encodeRecoveryCode(raw: Buffer): string {
  const s = base32(Buffer.concat([raw, checksum(raw)]));
  return s.match(/.{1,4}/g)!.join("-");
}

/** Lenient input: case, spaces, dashes; Crockford O→0, I/L→1. */
export function decodeRecoveryCode(code: string): Buffer {
  const norm = String(code || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (norm.length !== 56) throw new Error("recovery code has the wrong length");
  const all = unbase32(norm);
  const raw = all.subarray(0, 32);
  if (!crypto.timingSafeEqual(all.subarray(32, 32 + CHECK_BYTES), checksum(raw))) {
    throw new Error("recovery code checksum does not match (typo?)");
  }
  return Buffer.from(raw);
}

/** New key pair: the code (show once) and the public key (store). */
export function generateRecoveryKey(): { code: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const raw = Buffer.from(der.subarray(der.length - 32));
  const code = encodeRecoveryCode(raw);
  der.fill(0);
  raw.fill(0);
  return { code, publicKey: (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64") };
}

function wrapKey(shared: Buffer, epk: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", shared, epk, HKDF_INFO, 32));
}

/** Seal `secret` so only the holder of the recovery code can open it. */
export function sealToRecoveryKey(secret: Buffer, publicKeyB64: string): SealedKey {
  const recipient = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  const eph = crypto.generateKeyPairSync("x25519");
  const epk = eph.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const k = wrapKey(shared, epk);
  try {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", k, iv);
    c.setAAD(AAD);
    const ct = Buffer.concat([c.update(secret), c.final()]);
    return { epk: epk.toString("base64"), iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), ct: ct.toString("hex") };
  } finally {
    shared.fill(0);
    k.fill(0);
  }
}

/** Open a sealed key with the recovery code. Throws on a wrong code. */
export function openWithRecoveryCode(sealed: SealedKey, code: string): Buffer {
  const raw = decodeRecoveryCode(code);
  const der = Buffer.concat([PKCS8_X25519_PREFIX, raw]);
  raw.fill(0);
  let shared: Buffer | null = null;
  let k: Buffer | null = null;
  try {
    const priv = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const epk = Buffer.from(sealed.epk, "base64");
    shared = crypto.diffieHellman({ privateKey: priv, publicKey: crypto.createPublicKey({ key: epk, format: "der", type: "spki" }) });
    k = wrapKey(shared, epk);
    const iv = Buffer.from(sealed.iv, "hex");
    const tag = Buffer.from(sealed.tag, "hex");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("malformed sealed key");
    const d = crypto.createDecipheriv("aes-256-gcm", k, iv, { authTagLength: 16 });
    d.setAAD(AAD);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(sealed.ct, "hex")), d.final()]);
  } catch {
    throw new Error("Recovery code does not open this vault");
  } finally {
    der.fill(0);
    shared?.fill(0);
    k?.fill(0);
  }
}
