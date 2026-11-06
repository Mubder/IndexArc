import crypto from "crypto";
import { currentKdf, deriveKeyAsync, generateSalt, kdfFromEnvelope, type KdfParams } from "./crypto.js";
import type { VaultEntry } from "./types.js";
import { envKey, envQuote } from "../shared/apps.js";

export { envKey, envQuote };

// Import / export (R6.2). Parsers turn other tools' exports into IndexArc
// candidates the user reviews before saving; exporters write .env or an
// encrypted IndexArc file (its own passphrase, Argon2id + AES-256-GCM).
//
// IndexArc entries hold ONE value each, so a password-manager login becomes
// a secret entry (the password) with the username / URL kept in its notes,
// plus extra entries for TOTP seeds and custom fields.

export type ImportFormat = "env" | "indexarc" | "bitwarden" | "csv" | "keepass-xml";

export interface ImportCandidate {
  value: string;
  name: string;
  type: string;
  family: VaultEntry["family"];
  labels: string[];
  notes?: string;
  app?: string;
  env?: string;
}

export interface ImportResult {
  format: ImportFormat;
  candidates: ImportCandidate[];
  skipped: Record<string, number>;
}

const EXPORT_AAD = Buffer.from("indexarc:export:v1");
export const EXPORT_MIN_PASSPHRASE = 12;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

// ── Detection ───────────────────────────────────────────────────────────────

export function detectFormat(text: string, filename = ""): ImportFormat {
  const t = text.replace(/^﻿/, "").trimStart();
  const lower = filename.toLowerCase();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      if (j?.format === "indexarc-export") return "indexarc";
      if (Array.isArray(j?.items)) return "bitwarden";
    } catch {}
  }
  if (t.startsWith("<?xml") || t.startsWith("<KeePassFile")) return "keepass-xml";
  if (lower.endsWith(".csv")) return "csv";
  const firstLine = t.split(/\r?\n/, 1)[0] || "";
  if (/,/.test(firstLine) && /(title|name)/i.test(firstLine) && /(password|value)/i.test(firstLine)) return "csv";
  return "env";
}

// ── .env ────────────────────────────────────────────────────────────────────

export function parseEnv(text: string): ImportResult {
  const candidates: ImportCandidate[] = [];
  const skipped: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      skipped["unparsed line"] = (skipped["unparsed line"] || 0) + 1;
      continue;
    }
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
      const dq = v.startsWith('"');
      v = v.slice(1, -1);
      // One pass, so "\\n" stays a backslash + n.
      if (dq) v = v.replace(/\\(.)/g, (_m, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c));
    } else {
      v = v.replace(/\s+#.*$/, "").trim();
    }
    if (!v) {
      skipped["empty value"] = (skipped["empty value"] || 0) + 1;
      continue;
    }
    candidates.push({ value: v, name: m[1], type: envType(m[1]), family: "secret", labels: ["imported", "env"] });
  }
  return { format: "env", candidates, skipped };
}

export function envType(key: string): string {
  const k = key.toLowerCase();
  if (/pass(word)?|pwd/.test(k)) return "password";
  if (/token/.test(k)) return "api token";
  if (/secret/.test(k)) return "secret";
  if (/key/.test(k)) return "api key";
  if (/url|uri|dsn|host/.test(k)) return "connection string";
  return "environment variable";
}

// ── Password-manager logins → candidates ────────────────────────────────────

interface Login {
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totp?: string;
  fields?: Array<{ name: string; value: string }>;
  source: string;
}

function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname || null;
  } catch {
    return null;
  }
}

function fromLogin(l: Login, out: ImportCandidate[], skipped: Record<string, number>): void {
  const title = (l.title || hostOf(l.url) || "Imported item").trim();
  const labels = ["imported", l.source];
  const host = hostOf(l.url);
  if (host) labels.push(host);
  const context = [l.username ? `username: ${l.username}` : "", l.url ? `url: ${l.url}` : ""].filter(Boolean).join("\n");
  const notes = [context, l.notes?.trim() || ""].filter(Boolean).join("\n\n") || undefined;
  let any = false;
  if (l.password) {
    out.push({ value: l.password, name: title, type: "password", family: "secret", labels, notes });
    any = true;
  }
  if (l.totp) {
    out.push({ value: l.totp, name: `${title} TOTP`, type: "totp seed", family: "secret", labels, notes: context || undefined });
    any = true;
  }
  for (const f of l.fields || []) {
    if (!f.value) continue;
    out.push({ value: f.value, name: `${title} ${f.name || "field"}`.trim(), type: "secret", family: "secret", labels, notes: context || undefined });
    any = true;
  }
  if (!any && l.notes?.trim()) {
    out.push({ value: l.notes.trim(), name: title, type: "note", family: "note", labels, notes: context || undefined });
    any = true;
  }
  if (!any) skipped["no secret value"] = (skipped["no secret value"] || 0) + 1;
}

// ── Bitwarden (unencrypted JSON export) ─────────────────────────────────────

export function parseBitwarden(text: string): ImportResult {
  const j = JSON.parse(text.replace(/^﻿/, ""));
  if (j?.encrypted) throw new Error("This is an encrypted Bitwarden export. Export again as JSON (not encrypted).");
  const out: ImportCandidate[] = [];
  const skipped: Record<string, number> = {};
  for (const it of Array.isArray(j?.items) ? j.items : []) {
    const fields = (Array.isArray(it.fields) ? it.fields : []).map((f: any) => ({ name: String(f?.name ?? ""), value: String(f?.value ?? "") }));
    if (it.type === 1 || it.login) {
      const l = it.login || {};
      fromLogin(
        { title: String(it.name ?? ""), username: l.username ?? undefined, password: l.password ?? undefined, url: l.uris?.[0]?.uri ?? undefined, totp: l.totp ?? undefined, notes: it.notes ?? undefined, fields, source: "bitwarden" },
        out,
        skipped
      );
    } else if (it.type === 2) {
      fromLogin({ title: String(it.name ?? ""), notes: it.notes ?? undefined, fields, source: "bitwarden" }, out, skipped);
    } else {
      // Cards and identities are personal data, not developer secrets.
      const kind = it.type === 3 ? "card (not imported)" : it.type === 4 ? "identity (not imported)" : "unsupported item";
      skipped[kind] = (skipped[kind] || 0) + 1;
    }
  }
  return { format: "bitwarden", candidates: out, skipped };
}

// ── CSV (1Password, KeePassXC, Bitwarden CSV, Chrome-style) ─────────────────

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function parseCsv(text: string): ImportResult {
  const rows = parseCsvRows(text);
  const out: ImportCandidate[] = [];
  const skipped: Record<string, number> = {};
  if (rows.length < 2) return { format: "csv", candidates: out, skipped };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iTitle = col("title", "name", "account");
  const iUser = col("username", "login_username", "user name", "login", "email");
  const iPass = col("password", "login_password", "value", "secret");
  const iUrl = col("url", "website", "login_uri", "uri", "web site");
  const iNotes = col("notes", "note", "comments");
  const iTotp = col("otpauth", "totp", "login_totp", "one-time password");
  const iGroup = col("group", "folder", "vault");
  if (iPass < 0 && iNotes < 0) throw new Error("CSV has no password/value or notes column.");
  const source = head.includes("login_uri") ? "bitwarden" : head.includes("otpauth") ? "1password" : head.includes("group") ? "keepass" : "csv";
  for (const r of rows.slice(1)) {
    const at = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const before = out.length;
    fromLogin({ title: at(iTitle), username: at(iUser) || undefined, password: at(iPass) || undefined, url: at(iUrl) || undefined, notes: at(iNotes) || undefined, totp: at(iTotp) || undefined, source }, out, skipped);
    const g = at(iGroup);
    if (g) for (let k = before; k < out.length; k++) out[k].labels.push(g);
  }
  return { format: "csv", candidates: out, skipped };
}

// ── KeePass 2.x XML export ──────────────────────────────────────────────────

function xmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

export function parseKeepassXml(text: string): ImportResult {
  const out: ImportCandidate[] = [];
  const skipped: Record<string, number> = {};
  // Current entries only: <History> holds old versions of each entry.
  const body = text.replace(/<History>[\s\S]*?<\/History>/g, "");
  for (const m of body.matchAll(/<Entry>([\s\S]*?)<\/Entry>/g)) {
    const fields: Record<string, string> = {};
    for (const f of m[1].matchAll(/<String>\s*<Key>([\s\S]*?)<\/Key>\s*<Value(?:\s[^>]*)?>([\s\S]*?)<\/Value>\s*<\/String>/g)) {
      fields[xmlText(f[1]).trim()] = xmlText(f[2]);
    }
    const std = new Set(["Title", "UserName", "Password", "URL", "Notes", "otp", "TOTP Seed"]);
    fromLogin(
      {
        title: fields.Title || "",
        username: fields.UserName || undefined,
        password: fields.Password || undefined,
        url: fields.URL || undefined,
        notes: fields.Notes || undefined,
        totp: fields.otp || fields["TOTP Seed"] || undefined,
        fields: Object.entries(fields)
          .filter(([k, v]) => !std.has(k) && v)
          .map(([name, value]) => ({ name, value })),
        source: "keepass",
      },
      out,
      skipped
    );
  }
  return { format: "keepass-xml", candidates: out, skipped };
}

// ── Encrypted IndexArc export ───────────────────────────────────────────────

const EXPORT_FIELDS = ["value", "type", "name", "raw_fragment", "labels", "type_aliases", "status", "family", "notes", "source_file", "app", "env", "created_at", "updated_at"] as const;

export async function buildEncryptedExport(entries: VaultEntry[], passphrase: string): Promise<string> {
  if (String(passphrase).length < EXPORT_MIN_PASSPHRASE) throw new Error(`Export passphrase must be at least ${EXPORT_MIN_PASSPHRASE} characters.`);
  const payload = {
    exported_at: new Date().toISOString(),
    entries: entries.map((e) => Object.fromEntries(EXPORT_FIELDS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]))),
  };
  const salt = generateSalt();
  const kdf: KdfParams = currentKdf();
  const key = await deriveKeyAsync(passphrase, salt, kdf);
  try {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(EXPORT_AAD);
    const ct = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
    return JSON.stringify(
      { format: "indexarc-export", version: 1, count: entries.length, kdf, salt, iv: iv.toString("hex"), authTag: c.getAuthTag().toString("hex"), ciphertext: ct.toString("base64") },
      null,
      2
    );
  } finally {
    key.fill(0);
  }
}

export async function parseEncryptedExport(text: string, passphrase: string): Promise<ImportResult> {
  const env = JSON.parse(text.replace(/^﻿/, ""));
  if (env?.format !== "indexarc-export" || env.version !== 1) throw new Error("Not an IndexArc export file.");
  if (!passphrase) throw new Error("This export is encrypted: enter its passphrase.");
  const key = await deriveKeyAsync(passphrase, env.salt, kdfFromEnvelope(env));
  let payload: any;
  try {
    const iv = Buffer.from(env.iv, "hex");
    const tag = Buffer.from(env.authTag, "hex");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("malformed");
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    d.setAAD(EXPORT_AAD);
    d.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([d.update(Buffer.from(env.ciphertext, "base64")), d.final()]).toString("utf8"));
  } catch {
    throw new Error("Wrong passphrase, or the export file is damaged.");
  } finally {
    key.fill(0);
  }
  const candidates: ImportCandidate[] = (Array.isArray(payload?.entries) ? payload.entries : [])
    .filter((e: any) => typeof e?.value === "string" && e.value)
    .map((e: any) => ({
      value: e.value,
      name: String(e.name || "Imported"),
      type: String(e.type || "secret"),
      family: (["secret", "command", "note", "unknown"].includes(e.family) ? e.family : "secret") as ImportCandidate["family"],
      labels: Array.isArray(e.labels) ? e.labels.map(String) : [],
      notes: e.notes ? String(e.notes) : undefined,
      app: typeof e.app === "string" && e.app ? e.app : undefined,
      env: typeof e.env === "string" && e.env ? e.env : undefined,
    }));
  return { format: "indexarc", candidates, skipped: {} };
}

// ── .env export ─────────────────────────────────────────────────────────────

export function buildEnvExport(entries: VaultEntry[]): string {
  const used = new Map<string, number>();
  const lines = [`# Exported from IndexArc ${new Date().toISOString()} — PLAINTEXT secrets. Delete this file when done.`];
  for (const e of entries) {
    if (!e.value) continue;
    let k = envKey(e.name);
    const n = used.get(k) || 0;
    used.set(k, n + 1);
    if (n) k = `${k}_${n + 1}`;
    lines.push(`${k}=${envQuote(e.value)}`);
  }
  return lines.join("\n") + "\n";
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function parseImport(text: string, opts: { format?: ImportFormat; filename?: string; passphrase?: string } = {}): Promise<ImportResult> {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw new Error("Import file is too large (max 20 MB).");
  const format = opts.format || detectFormat(text, opts.filename);
  switch (format) {
    case "indexarc":
      return parseEncryptedExport(text, opts.passphrase || "");
    case "bitwarden":
      return parseBitwarden(text);
    case "csv":
      return parseCsv(text);
    case "keepass-xml":
      return parseKeepassXml(text);
    default:
      return parseEnv(text);
  }
}

/** Drop candidates already in the vault (same value and name). */
export function withoutDuplicates(result: ImportResult, existing: VaultEntry[]): ImportResult {
  const seen = new Set(existing.map((e) => `${e.name}\u0000${e.value}`));
  const candidates: ImportCandidate[] = [];
  let dup = 0;
  for (const c of result.candidates) {
    const k = `${c.name}\u0000${c.value}`;
    if (seen.has(k)) dup++;
    else {
      seen.add(k);
      candidates.push(c);
    }
  }
  return { ...result, candidates, skipped: dup ? { ...result.skipped, "already in vault": dup } : result.skipped };
}
