import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// CLI access (R6.1). A CLI token is a scoped credential: it reaches only
// /api/cli/secret and /api/cli/env, never the pairing-token API, and only
// while the vault is unlocked.
//
// Tokens are stored as a keyed digest, not a plain hash: with encryption on,
// the digest key is derived from the vault key, so a process that can write
// the data folder still cannot add a token of its own. Consequence: changing
// the master password (a re-key) invalidates every CLI token.

export const CLI_TOKEN_PREFIX = "iax_";
const TOKEN_RE = /^iax_[A-Za-z0-9_-]{43}$/;
const MAX_TOKENS = 20;

export interface CliTokenRecord {
  id: string;
  name: string;
  digest: string;
  created_at: string;
  last_used_at?: string;
}

export interface CliTokenPublic {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string;
}

export type Digester = (token: string) => string;

/** Digest function for a vault key (or plain sha256 when the vault has no password). */
export function cliDigester(vaultKey: Buffer | null): Digester {
  if (!vaultKey) return (t) => crypto.createHash("sha256").update(t).digest("hex");
  const k = Buffer.from(crypto.hkdfSync("sha256", vaultKey, Buffer.alloc(0), "indexarc:cli-token:v1", 32));
  return (t) => crypto.createHmac("sha256", k).update(t).digest("hex");
}

function read(file: string): CliTokenRecord[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(j?.tokens) ? j.tokens.filter((t: any) => t && typeof t.id === "string" && typeof t.digest === "string") : [];
  } catch {
    return [];
  }
}

function write(file: string, tokens: CliTokenRecord[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, tokens }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const toPublic = ({ id, name, created_at, last_used_at }: CliTokenRecord): CliTokenPublic => ({ id, name, created_at, last_used_at });

export function listCliTokens(file: string): CliTokenPublic[] {
  return read(file).map(toPublic);
}

export function createCliToken(file: string, name: string, digest: Digester): { token: string; record: CliTokenPublic } {
  const clean = String(name || "").trim().slice(0, 60) || "CLI";
  const tokens = read(file);
  if (tokens.length >= MAX_TOKENS) throw new Error(`At most ${MAX_TOKENS} CLI tokens; revoke one first.`);
  const token = CLI_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const rec: CliTokenRecord = { id: crypto.randomUUID(), name: clean, digest: digest(token), created_at: new Date().toISOString() };
  write(file, [...tokens, rec]);
  return { token, record: toPublic(rec) };
}

export function revokeCliToken(file: string, id: string): boolean {
  const tokens = read(file);
  const next = tokens.filter((t) => t.id !== id);
  if (next.length === tokens.length) return false;
  write(file, next);
  return true;
}

export function revokeAllCliTokens(file: string) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

/** Constant-time lookup. Returns the matching token record or null. */
export function verifyCliToken(file: string, presented: string, digest: Digester): CliTokenPublic | null {
  if (!TOKEN_RE.test(presented)) return null;
  const d = Buffer.from(digest(presented), "hex");
  let hit: CliTokenRecord | null = null;
  for (const t of read(file)) {
    const s = Buffer.from(t.digest, "hex");
    if (s.length === d.length && crypto.timingSafeEqual(s, d)) hit = t;
  }
  if (!hit) return null;
  // Best effort, at most once a minute per token.
  const now = Date.now();
  if (!hit.last_used_at || now - Date.parse(hit.last_used_at) > 60_000) {
    try {
      write(file, read(file).map((t) => (t.id === hit!.id ? { ...t, last_used_at: new Date(now).toISOString() } : t)));
    } catch {
      /* ignore */
    }
  }
  return toPublic(hit);
}

// ── Runtime file (port discovery) ───────────────────────────────────────────
// Holds no secret: only where the server listens. The CLI still needs a token.

/**
 * Per-user, machine-local state folder shared with bin/indexarc.mjs (keep the
 * two in sync). Never ~/.IndexArc: that can be the app's install folder.
 */
export function cliStateDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "IndexArc", "cli");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "IndexArc", "cli");
  return path.join(process.env.XDG_STATE_HOME || path.join(home, ".local", "state"), "indexarc");
}

export function runtimeFile(): string {
  return process.env.INDEXARC_RUNTIME_FILE || path.join(cliStateDir(), "runtime.json");
}

export function writeRuntimeFile(port: number, host: string) {
  try {
    const f = runtimeFile();
    // Another live server got there first (e.g. the installed app while a
    // dev server starts): leave its entry alone.
    try {
      const cur = JSON.parse(fs.readFileSync(f, "utf8"));
      if (cur?.pid && cur.pid !== process.pid) {
        process.kill(cur.pid, 0);
        return;
      }
    } catch {
      /* missing, unreadable, or its process is gone: take over */
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`, pid: process.pid, started_at: new Date().toISOString() }), { mode: 0o600 });
  } catch {
    /* ignore: the CLI falls back to INDEXARC_URL */
  }
}

export function removeRuntimeFile() {
  try {
    const f = runtimeFile();
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j?.pid === process.pid) fs.rmSync(f, { force: true });
  } catch {
    /* ignore */
  }
}
