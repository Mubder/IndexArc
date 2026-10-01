import crypto from "crypto";
import { argon2id } from "hash-wasm";

// ---------------------------------------------------------------------------
// KDF — Argon2id, Bitwarden-aligned parameters (64 MiB / t=3 / p=4).
//
// Why Argon2id: memory-hardness means every offline guess costs ~64 MiB of
// RAM, which prices GPU/ASIC brute-force of a stolen vault file out of the
// market. PBKDF2-SHA256 (the previous KDF, 100k iterations) is retained ONLY
// to read and transparently upgrade legacy envelopes — never for new writes.
//
// The parameters are versioned inside every encrypted envelope (`kdf` field),
// so a future parameter bump migrates silently on the next successful unlock.
// ---------------------------------------------------------------------------

export const KDF_ALGO = "argon2id" as const;
export const KDF_PARAMS = {
  parallelism: 4,
  iterations: 3,
  memorySize: 65536, // KiB → 64 MiB
  hashLength: 32,
};

export type KdfParams =
  | { algo: "argon2id"; parallelism: number; iterations: number; memorySize: number }
  | { algo: "pbkdf2"; iterations: number; digest: string };

/** The KDF descriptor written into every NEW envelope. */
export function currentKdf(): KdfParams {
  return { algo: KDF_ALGO, ...KDF_PARAMS };
}

/**
 * Reads the KDF descriptor off a stored envelope. A missing field means a
 * legacy PBKDF2 envelope (100k SHA-256, pre-2.1 vaults). Unknown algorithms
 * or malformed parameters fail CLOSED — parameters are never guessed for a
 * decryption.
 */
export function kdfFromEnvelope(raw: any): KdfParams {
  if (!raw || typeof raw !== "object") throw new Error("missing envelope");
  const kdf = raw.kdf;
  if (!kdf || typeof kdf !== "object") {
    return { algo: "pbkdf2", iterations: 100_000, digest: "sha256" };
  }
  if (
    kdf.algo === "argon2id" &&
    Number.isFinite(kdf.memorySize) &&
    Number.isFinite(kdf.iterations) &&
    Number.isFinite(kdf.parallelism)
  ) {
    return {
      algo: "argon2id",
      memorySize: kdf.memorySize,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
    };
  }
  if (kdf.algo === "pbkdf2" && Number.isFinite(kdf.iterations) && typeof kdf.digest === "string") {
    return { algo: "pbkdf2", iterations: kdf.iterations, digest: kdf.digest };
  }
  throw new Error("unsupported KDF in envelope");
}

/** True when the envelope's KDF is weaker than the current standard. */
export function kdfNeedsUpgrade(kdf: KdfParams): boolean {
  return !(
    kdf.algo === KDF_ALGO &&
    kdf.memorySize === KDF_PARAMS.memorySize &&
    kdf.iterations === KDF_PARAMS.iterations &&
    kdf.parallelism === KDF_PARAMS.parallelism
  );
}

// ── Enforced parameter bounds (RESIDUAL-3) ─────────────────────────────────
// kdfFromEnvelope parses whatever the file says (required to READ legacy
// envelopes), but deriveKeyAsync REFUSES anything outside these bounds: a
// tampered envelope must not silently downgrade derivation to a fast KDF,
// and absurd values must not hang the process for minutes or OOM it.
// Floors are set at (or below) every parameter this app ever WROTE, so all
// legitimate legacy vaults still derive; ceilings are pure DoS guards.
export const KDF_BOUNDS = {
  argon2id: {
    minMemoryKiB: 16_384, // ≥ 16 MiB
    minIterations: 2,
    minParallelism: 1,
    maxMemoryKiB: 524_288, // ≤ 512 MiB
    maxIterations: 64,
    maxParallelism: 16,
  },
  pbkdf2: {
    minIterations: 100_000, // the legacy (pre-2.1) strength — the floor
    maxIterations: 10_000_000,
    digest: "sha256" as const,
  },
};

/** Minimum salt length accepted for derivation (all writers used 16B+). */
export const MIN_SALT_BYTES = 16;

export function kdfWithinBounds(kdf: KdfParams): boolean {
  if (kdf.algo === "argon2id") {
    const b = KDF_BOUNDS.argon2id;
    return (
      kdf.memorySize >= b.minMemoryKiB &&
      kdf.iterations >= b.minIterations &&
      kdf.parallelism >= b.minParallelism &&
      kdf.memorySize <= b.maxMemoryKiB &&
      kdf.iterations <= b.maxIterations &&
      kdf.parallelism <= b.maxParallelism
    );
  }
  const b = KDF_BOUNDS.pbkdf2;
  return (
    kdf.iterations >= b.minIterations &&
    kdf.iterations <= b.maxIterations &&
    kdf.digest === b.digest
  );
}

/**
 * Derives the 256-bit AES key from the master password and salt using the
 * envelope's KDF. Argon2id runs in WASM and is async-only by design — all
 * call sites derive once per unlock and keep the key in memory.
 */
export async function deriveKeyAsync(
  password: string,
  saltHex: string,
  kdf: KdfParams = currentKdf()
): Promise<Buffer> {
  const salt = Buffer.from(saltHex, "hex");
  if (salt.length === 0) throw new Error("empty salt");
  // Fail closed on weakened envelopes (RESIDUAL-3): a 1-byte salt or an
  // envelope-controlled iteration count of 1 used to derive happily.
  if (salt.length < MIN_SALT_BYTES) {
    throw new Error(`salt too short (${salt.length}B < ${MIN_SALT_BYTES}B) — refusing weakened envelope`);
  }
  if (!kdfWithinBounds(kdf)) {
    throw new Error("KDF parameters outside enforced bounds — refusing weakened envelope");
  }
  if (kdf.algo === "argon2id") {
    const hash = await argon2id({
      password,
      salt,
      parallelism: kdf.parallelism,
      iterations: kdf.iterations,
      memorySize: kdf.memorySize,
      hashLength: 32,
      outputType: "binary",
    });
    return Buffer.from(hash);
  }
  const iterations = Math.max(1, Math.floor(kdf.iterations));
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, kdf.digest, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

/**
 * Generates a new random salt of specified byte size.
 */
export function generateSalt(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export interface EncryptedPayload {
  encrypted: true;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Builds a complete versioned encryption envelope for `text`. Every writer
 funnels through this so no envelope can ever miss its KDF descriptor.
 */
export function envelopePayload(
  text: string,
  key: Buffer,
  saltHex: string,
  version: number
): EncryptedPayload & { version: number; kdf: KdfParams } {
  return {
    version,
    encrypted: true as const,
    kdf: currentKdf(),
    salt: saltHex,
    ...encryptString(text, key),
  };
}

/**
 * Encrypts cleartext using AES-256-GCM with the derived key and a new random IV.
 */
export function encryptString(text: string, key: Buffer): { iv: string; authTag: string; ciphertext: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex")
  };
}

/**
 * Decrypts AES-256-GCM ciphertext using the derived key, IV, and authentication tag.
 */
export function decryptString(
  ciphertext: string,
  key: Buffer,
  ivHex: string,
  authTagHex: string
): string {
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const cipherBuffer = Buffer.from(ciphertext, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(cipherBuffer),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
