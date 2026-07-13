import crypto from "crypto";

const ITERATIONS = 100000;
const KEY_LEN = 32;
const DIGEST = "sha256";

export interface EncryptedPayload {
  encrypted: true;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Derives a strong 256-bit AES key from a master password and salt using PBKDF2.
 */
export function deriveKey(password: string, saltHex: string): Buffer {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST);
}

/**
 * Generates a new random salt of specified byte size.
 */
export function generateSalt(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
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
