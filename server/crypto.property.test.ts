import { describe, it, expect } from "vitest";
import fc from "fast-check";
import crypto from "crypto";
import {
  encryptString,
  decryptString,
  envelopePayload,
  kdfWithinBounds,
  kdfFromEnvelope,
  currentKdf,
  KDF_BOUNDS,
  GCM_TAG_BYTES,
} from "./crypto";

// Property tests for the vault's envelope crypto (R4). Each property runs
// against many generated inputs, including empty strings, astral-plane
// Unicode, Arabic and control characters.
const key = () => crypto.randomBytes(32);
const anyText = fc.string({ unit: "binary", maxLength: 2000 });
const RUNS = { numRuns: 200 };

/** Flip one hex nibble at position i (wraps). */
function flipHex(hex: string, i: number): string {
  const at = i % hex.length;
  const c = parseInt(hex[at], 16) ^ 0x1;
  return hex.slice(0, at) + c.toString(16) + hex.slice(at + 1);
}

describe("AES-256-GCM envelope properties", () => {
  it("round-trips any text", () => {
    const k = key();
    fc.assert(
      fc.property(anyText, (text) => {
        const e = encryptString(text, k);
        return decryptString(e.ciphertext, k, e.iv, e.authTag) === text;
      }),
      RUNS
    );
  });

  it("round-trips with AAD, and rejects any other AAD", () => {
    const k = key();
    fc.assert(
      fc.property(anyText, fc.string({ maxLength: 64 }), fc.string({ maxLength: 64 }), (text, aad, other) => {
        const e = encryptString(text, k, aad);
        expect(decryptString(e.ciphertext, k, e.iv, e.authTag, aad)).toBe(text);
        if (other !== aad) expect(() => decryptString(e.ciphertext, k, e.iv, e.authTag, other)).toThrow();
        // Missing AAD on decrypt is a mismatch too (unless it was empty).
        if (aad !== "") expect(() => decryptString(e.ciphertext, k, e.iv, e.authTag)).toThrow();
      }),
      RUNS
    );
  });

  it("detects any single modified nibble in ciphertext, IV or tag", () => {
    const k = key();
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), fc.nat(), fc.constantFrom("ciphertext", "iv", "authTag"), (text, pos, field) => {
        const e = encryptString(text, k);
        const t = { ...e, [field]: flipHex(e[field as keyof typeof e], pos) };
        expect(() => decryptString(t.ciphertext, k, t.iv, t.authTag)).toThrow();
      }),
      RUNS
    );
  });

  it("rejects a wrong key", () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const e = encryptString(text, key());
        expect(() => decryptString(e.ciphertext, key(), e.iv, e.authTag)).toThrow();
      }),
      { numRuns: 50 }
    );
  });

  it("rejects truncated auth tags of every length", () => {
    const k = key();
    const e = encryptString("sk_live_value", k);
    for (let bytes = 0; bytes < GCM_TAG_BYTES; bytes++) {
      expect(() => decryptString(e.ciphertext, k, e.iv, e.authTag.slice(0, bytes * 2))).toThrow();
    }
  });

  it("never reuses an IV and never leaks the plaintext", () => {
    const k = key();
    const ivs = new Set<string>();
    fc.assert(
      fc.property(fc.string({ minLength: 8, maxLength: 200 }), (text) => {
        const e = encryptString(text, k);
        expect(ivs.has(e.iv)).toBe(false);
        ivs.add(e.iv);
        expect(e.ciphertext).not.toContain(Buffer.from(text, "utf8").toString("hex"));
      }),
      RUNS
    );
  });

  it("rejects non-hex or odd-length ciphertext instead of silently truncating", () => {
    const k = key();
    const e = encryptString("abc", k);
    expect(() => decryptString(e.ciphertext + "z", k, e.iv, e.authTag)).toThrow();
    expect(() => decryptString(e.ciphertext + "0", k, e.iv, e.authTag)).toThrow();
  });

  it("envelopes always carry a KDF descriptor within bounds", () => {
    const k = key();
    fc.assert(
      fc.property(anyText, fc.integer({ min: 1, max: 10 }), (text, version) => {
        const env = envelopePayload(text, k, crypto.randomBytes(16).toString("hex"), version);
        expect(env.encrypted).toBe(true);
        expect(kdfWithinBounds(kdfFromEnvelope(env))).toBe(true);
        expect(decryptString(env.ciphertext, k, env.iv, env.authTag)).toBe(text);
      }),
      { numRuns: 50 }
    );
  });
});

describe("KDF parameter bounds", () => {
  it("accepts the current standard", () => {
    expect(kdfWithinBounds(currentKdf())).toBe(true);
  });

  it("accepts exactly the argon2id parameters inside the bounds", () => {
    const b = KDF_BOUNDS.argon2id;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 64 }),
        (memorySize, iterations, parallelism) => {
          const inside =
            memorySize >= b.minMemoryKiB && memorySize <= b.maxMemoryKiB &&
            iterations >= b.minIterations && iterations <= b.maxIterations &&
            parallelism >= b.minParallelism && parallelism <= b.maxParallelism;
          const kdf = { ...currentKdf(), memorySize, iterations, parallelism } as never;
          return kdfWithinBounds(kdf) === inside;
        }
      ),
      { numRuns: 500 }
    );
  });

  it("accepts exactly the pbkdf2 iteration counts inside the bounds", () => {
    const b = KDF_BOUNDS.pbkdf2;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000_000 }), (iterations) => {
        const kdf = { algo: "pbkdf2", iterations, digest: "sha256" } as never;
        return kdfWithinBounds(kdf) === (iterations >= b.minIterations && iterations <= b.maxIterations);
      }),
      { numRuns: 300 }
    );
    expect(kdfWithinBounds({ algo: "pbkdf2", iterations: 200_000, digest: "sha1" } as never)).toBe(false);
  });
});
