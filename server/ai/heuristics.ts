import { randomUUID } from "crypto";
import type { AnalyzeCandidate } from "../types.js";

/** Unix + common PowerShell / tooling command lines */
const COMMAND_RE =
  /^\s*(sudo\s+)?(rm|cp|mv|mkdir|chmod|chown|curl|wget|git|docker|npm|npx|pip|python|node|ssh|scp|rsync|systemctl|brew|apt|yum|export|source|cd|ls|cat|echo|kill|pkill|killall|find|grep|sed|awk|tar|unzip|heroku|kubectl|helm|wsl|ollama|nano|vim|code|Invoke-RestMethod|Invoke-WebRequest|Get-Process|Stop-Process|Start-Process|New-Item|Set-Item|Remove-Item|Get-Content|Set-Content|Write-Host|Get-ChildItem|Select-Object|Where-Object|ForEach-Object|foreach)\b/i;

/** CLI tools that need a subcommand (avoid "Hermes Windows" title matching as command) */
const CLI_WITH_SUBCOMMAND_RE =
  /^\s*(hermes|ollama)\s+[a-z][\w-]*/i;

/** Paths / script invocations that act as commands (.\foo.ps1, C:\…\app.exe …). Not bare /slash chat commands. */
const COMMANDISH_RE =
  /^\s*(\.\\|\.\/|\/(usr|bin|etc|home|opt|var|tmp|mnt|root)\b|[A-Za-z]:\\|[A-Za-z]:\/).+/i;

const ENV_LINE_RE =
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*["']?(.+?)["']?\s*$/;
/** KEY "value" or KEY 'value' without equals */
const ENV_SPACED_RE =
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+["']([^"']+)["']\s*$/;

const TELEGRAM_BOT_TOKEN_RE = /^\d{8,12}:[A-Za-z0-9_-]{30,}$/;
const GITHUB_TOKEN_RE = /^(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{20,}$/;
const AWS_KEY_RE = /^AKIA[0-9A-Z]{16}$/;
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Expanded high-entropy pattern: alphanumeric + common secret chars (dots, dashes, underscores, slashes) */
const HIGH_ENTROPY_RE = /^[A-Za-z0-9+\/_\-=\.]{20,}$/;
/** Google OAuth client IDs */
const GOOGLE_CLIENT_ID_RE =
  /^\d{6,20}-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
/** Google API keys */
const GOOGLE_API_KEY_RE = /^AIza[0-9A-Za-z\-_]{20,}$/;
/** Google OAuth client secrets */
const GOOGLE_OAUTH_SECRET_RE = /^GOCSPX-[A-Za-z0-9_-]{10,}$/;
/** Google API keys (alternative prefix like AQ.) */
const GOOGLE_API_KEY_ALT_RE = /^AQ\.[A-Za-z0-9_-]{20,}$/;
/** Standalone URLs */
const URL_RE = /^https?:\/\/[^\s]+$/i;

/** Decorative section rules / pure punctuation — never extract as notes */
const NOISE_LINE_RE = /^[\s=\-_*~#|>.·•]{3,}$/;
/** Line is mostly separator chars mixed with a short title ("Hermes Windows ====") */
const TITLE_WITH_RULE_RE = /^(.{1,60}?)\s*[=\-_*]{4,}\s*$/;

/** Max chars for a leftover note; larger dumps are scrap, not vault notes */
const MAX_NOTE_CHARS = 280;
/** If paste is longer than this and we only have a whole-file note, skip it */
const MAX_WHOLE_FILE_NOTE_CHARS = 400;
/** Cap short leftover labels so cheatsheets don't flood the vault with notes */
const MAX_LEFTOVER_NOTES = 8;

function looksHighEntropy(s: string): boolean {
  if (s.length < 20) return false;
  if (/\s/.test(s)) return false;
  // pure punctuation / section rules are not secrets
  if (/^[=\-_*~#.\/+]+$/.test(s)) return false;
  if (!HIGH_ENTROPY_RE.test(s)) return false;
  // require at least some alphanumeric variety (not "========" or "----…")
  const alnum = (s.match(/[A-Za-z0-9]/g) || []).length;
  if (alnum < 12) return false;
  return true;
}

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (NOISE_LINE_RE.test(t)) return true;
  // pure markdown horizontal rule / underline
  if (/^[-*_]{3,}$/.test(t)) return true;
  return false;
}

function isCommandLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // section titles like "Hermes Windows =====" are not commands
  if (TITLE_WITH_RULE_RE.test(t) || isNoiseLine(t)) return false;
  if (ENV_LINE_RE.test(t) || ENV_SPACED_RE.test(t)) return false;
  if (CLI_WITH_SUBCOMMAND_RE.test(t)) return true;
  if (COMMAND_RE.test(t)) return true;
  if (COMMANDISH_RE.test(t) && t.length < 500) return true;
  // chained shell: foo && bar (when first segment is a known command)
  if (/\s(&&|\|\||;)\s/.test(t) && COMMAND_RE.test(t.split(/\s*(?:&&|\|\||;)\s*/)[0] || "")) {
    return true;
  }
  return false;
}

function isNoiseEnvValue(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (isNoiseLine(v)) return true;
  if (/^[=\-_*~#.]+$/.test(v)) return true;
  return false;
}

function classifyStandaloneSecret(value: string): {
  type: string;
  aliases: string[];
  family: AnalyzeCandidate["family"];
  needs_type: boolean;
  needs_name: boolean;
  confidence: number;
  model_notes?: string;
} | null {
  const v = value.trim();
  if (!v || /\s/.test(v) || isNoiseLine(v)) return null;

  if (GOOGLE_CLIENT_ID_RE.test(v)) {
    return {
      type: "google oauth client id",
      aliases: [
        "google client id",
        "oauth client id",
        "googleusercontent",
        "client id",
      ],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.92,
    };
  }
  if (GOOGLE_API_KEY_RE.test(v)) {
    return {
      type: "google api key",
      aliases: ["google api key", "gemini api key", "ai studio key", "AIza"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.9,
    };
  }
  if (GOOGLE_OAUTH_SECRET_RE.test(v)) {
    return {
      type: "google oauth client secret",
      aliases: ["google client secret", "oauth client secret", "GOCSPX"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.9,
    };
  }
  if (GOOGLE_API_KEY_ALT_RE.test(v)) {
    return {
      type: "google api key",
      aliases: ["google api key", "gemini api key", "AQ key"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.88,
    };
  }
  if (URL_RE.test(v)) {
    return {
      type: "url",
      aliases: ["url", "link", "رابط"],
      family: "note",
      needs_type: false,
      needs_name: false,
      confidence: 0.8,
    };
  }
  if (TELEGRAM_BOT_TOKEN_RE.test(v)) {
    return {
      type: "telegram bot token",
      aliases: ["telegram bot token", "bot token", "توكن بوت"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.88,
    };
  }
  if (GITHUB_TOKEN_RE.test(v)) {
    return {
      type: "github token",
      aliases: ["github token", "gh token"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.85,
    };
  }
  if (JWT_RE.test(v)) {
    return {
      type: "jwt token",
      aliases: ["jwt", "access token"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.85,
    };
  }
  if (AWS_KEY_RE.test(v)) {
    return {
      type: "aws access key",
      aliases: ["aws key"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.85,
    };
  }
  if (v.startsWith("sk-") && v.length >= 20) {
    return {
      type: "openai api key",
      aliases: ["openai key", "مفتاح openai"],
      family: "secret",
      needs_type: false,
      needs_name: true,
      confidence: 0.85,
    };
  }
  if (looksHighEntropy(v) && v.length >= 24) {
    return {
      type: "",
      aliases: [],
      family: "unknown",
      needs_type: true,
      needs_name: true,
      confidence: 0.4,
      model_notes: "High-entropy string — unidentified secret",
    };
  }
  return null;
}

/** Section banners like "Hermes Windows =====" — document structure, never vault notes */
function isSectionBanner(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (TITLE_WITH_RULE_RE.test(t)) return true;
  // title glued to a long rule without clean separation, or name still carrying ===
  if (/[=\-_*]{4,}/.test(t) && t.replace(/[=\-_*\s]/g, "").length <= 60) return true;
  return false;
}

/** Strip decorative rules from a title; empty if nothing useful remains */
function stripSectionRule(line: string): string {
  return line
    .trim()
    .replace(/\s*[=\-_*]{3,}\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Short human label/title — not a code dump or separator */
function isUsefulNoteLine(line: string): boolean {
  const t = line.trim();
  if (!t || isNoiseLine(t) || isSectionBanner(t)) return false;
  if (t.length > MAX_NOTE_CHARS) return false;
  if (isCommandLine(t)) return false;
  if (ENV_LINE_RE.test(t) || ENV_SPACED_RE.test(t)) return false;
  if (classifyStandaloneSecret(t)) return false;
  const titleOnly = stripSectionRule(t);
  if (!titleOnly || isNoiseLine(titleOnly)) return false;
  // ignore pure numeric crumbs
  if (/^\d+$/.test(titleOnly)) return false;
  // prefer labels / short prose, not dense code
  if (/[{}<>;`\\]/.test(titleOnly) && titleOnly.length > 40) return false;
  return titleOnly.length >= 2 && titleOnly.length <= 80;
}

function noteTitle(line: string): string {
  const t = line.trim();
  const m = t.match(TITLE_WITH_RULE_RE);
  if (m) return m[1].trim().slice(0, 48);
  return stripSectionRule(t).slice(0, 48) || t.slice(0, 48);
}

function nameFromEnvKey(key: string): string {
  // TELEGRAM_BOT_TOKEN_BALFARIS_1 → balfaris_1-ish name
  const parts = key.toLowerCase().split("_").filter(Boolean);
  const noise = new Set([
    "api",
    "key",
    "token",
    "secret",
    "access",
    "private",
    "public",
    "auth",
    "password",
    "pass",
    "client",
    "id",
    "user",
    "users",
    "allowed",
    "telegram",
    "bot",
    "openai",
    "gemini",
    "aws",
    "github",
    "stripe",
    "live",
    "test",
    "prod",
    "dev",
  ]);
  const meaningful = parts.filter((p) => !noise.has(p) && !/^\d+$/.test(p));
  if (meaningful.length) return meaningful.join("_");
  // fallback shorter key
  return parts.slice(-2).join("_") || key.toLowerCase();
}

function typeFromEnvKey(key: string, value: string): { type: string; aliases: string[]; family: AnalyzeCandidate["family"]; needs_type: boolean } {
  const k = key.toLowerCase();
  const aliases: string[] = [key, k, key.replace(/_/g, " ")];

  if (k.includes("telegram") && (k.includes("user") || k.includes("allowed") || k.includes("chat"))) {
    return {
      type: "telegram user id",
      aliases: [...aliases, "telegram id", "tg id", "معرف تيليجرام", "telegram_user_id"],
      family: "secret",
      needs_type: false,
    };
  }
  if ((k.includes("telegram") && k.includes("token")) || (TELEGRAM_BOT_TOKEN_RE.test(value) && k.includes("bot"))) {
    return {
      type: "telegram bot token",
      aliases: [...aliases, "bot token", "telegram token", "توكن بوت", "توكن التيليجرام"],
      family: "secret",
      needs_type: false,
    };
  }
  if (TELEGRAM_BOT_TOKEN_RE.test(value)) {
    return {
      type: "telegram bot token",
      aliases: [...aliases, "bot token", "telegram token", "توكن بوت"],
      family: "secret",
      needs_type: false,
    };
  }
  if (k.includes("openai") || value.startsWith("sk-")) {
    return {
      type: "openai api key",
      aliases: [...aliases, "openai key", "مفتاح openai"],
      family: "secret",
      needs_type: false,
    };
  }
  if (GITHUB_TOKEN_RE.test(value) || k.includes("github")) {
    return {
      type: "github token",
      aliases: [...aliases, "gh token", "github pat"],
      family: "secret",
      needs_type: false,
    };
  }
  if (AWS_KEY_RE.test(value) || k.includes("aws")) {
    return {
      type: "aws access key",
      aliases: [...aliases, "aws key"],
      family: "secret",
      needs_type: false,
    };
  }
  if (JWT_RE.test(value) || k.includes("jwt")) {
    return {
      type: "jwt token",
      aliases: [...aliases, "jwt", "access token"],
      family: "secret",
      needs_type: false,
    };
  }
  if (k.includes("api") && k.includes("key")) {
    return {
      type: "api key",
      aliases: [...aliases, "api key", "مفتاح api"],
      family: "secret",
      needs_type: false,
    };
  }
  if (k.includes("token") || k.includes("secret") || k.includes("password") || k.includes("key")) {
    return {
      type: key.toLowerCase().replace(/_/g, " "),
      aliases,
      family: "secret",
      needs_type: false,
    };
  }
  // numeric id-ish
  if (/^\d{5,}$/.test(value.trim())) {
    return {
      type: key.toLowerCase().replace(/_/g, " "),
      aliases,
      family: "secret",
      needs_type: false,
    };
  }
  if (looksHighEntropy(value.trim())) {
    return {
      type: "",
      aliases,
      family: "unknown",
      needs_type: true,
    };
  }
  return {
    type: "config value",
    aliases,
    family: "note",
    needs_type: false,
  };
}

function candidateBase(
  partial: Omit<AnalyzeCandidate, "temp_id" | "ready" | "needs_name" | "needs_type" | "confidence"> & {
    needs_type?: boolean;
    needs_name?: boolean;
    confidence?: number;
  }
): AnalyzeCandidate {
  const family = partial.family;
  let needs_type = partial.needs_type ?? false;
  let needs_name = partial.needs_name ?? false;
  let name = (partial.name || "").trim();
  let type = (partial.type || "").trim();

  if (family === "secret" || family === "unknown") {
    if (!type) needs_type = true;
    if (!name) needs_name = true;
  } else {
    // notes/commands: auto name if missing
    if (!name) {
      name =
        family === "command"
          ? "command"
          : type || "note";
      needs_name = false;
    }
    if (!type) {
      type = family === "command" ? "shell command" : "note";
      needs_type = false;
    }
  }

  const ready = !needs_type && !needs_name;
  return {
    temp_id: randomUUID(),
    value: partial.value,
    type,
    name,
    raw_fragment: partial.raw_fragment,
    labels: partial.labels || [],
    type_aliases: partial.type_aliases || [],
    family: needs_type ? "unknown" : family,
    confidence: partial.confidence ?? 0.7,
    needs_type,
    needs_name,
    ready,
    model_notes: partial.model_notes,
  };
}

function pushCommand(candidates: AnalyzeCandidate[], line: string): void {
  candidates.push(
    candidateBase({
      value: line,
      type: "shell command",
      name: line.slice(0, 40),
      raw_fragment: line,
      labels: ["command"],
      type_aliases: ["command", "shell", "أمر", "cmd"],
      family: "command",
      confidence: 0.9,
    })
  );
}

/** Human title line usable as the name for the next secret (not code / not a key itself) */
function isTitleLabelLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 2 || t.length > 80) return false;
  if (isNoiseLine(t) || isSectionBanner(t) || isCommandLine(t)) return false;
  if (ENV_LINE_RE.test(t) || ENV_SPACED_RE.test(t)) return false;
  if (classifyStandaloneSecret(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  // Prefer prose / product names over code-ish lines
  if (/[{}`\\;]|<=|=>/.test(t)) return false;
  return true;
}

/**
 * Pair "Antigravity Kazma Build" + client-id line → one secret with that name.
 * Also fills needs_name secrets from the immediately preceding title line.
 */
function applyTitleNamePairing(
  lines: string[],
  candidates: AnalyzeCandidate[]
): AnalyzeCandidate[] {
  const trimmed = lines.map((l) => l.trim());
  return candidates.map((c) => {
    if (c.family !== "secret" && c.family !== "unknown") return c;
    if (c.name && !c.needs_name && c.name !== "unnamed") return c;

    const idx = trimmed.findIndex(
      (l) => l === c.value || l === c.raw_fragment || l.includes(c.value)
    );
    if (idx <= 0) return c;

    // walk up past empty/noise for a title
    let prev = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (!trimmed[i] || isNoiseLine(trimmed[i])) continue;
      prev = trimmed[i];
      break;
    }
    if (!prev || !isTitleLabelLine(prev)) return c;

    return candidateBase({
      value: c.value,
      type: c.type,
      name: prev.slice(0, 64),
      raw_fragment: c.raw_fragment || `${prev}\n${c.value}`,
      labels: [...new Set([...(c.labels || []), "titled"])],
      type_aliases: c.type_aliases,
      family: c.family === "unknown" && c.type ? "secret" : c.family,
      needs_type: c.needs_type,
      needs_name: false,
      confidence: Math.max(c.confidence, 0.9),
      model_notes: c.model_notes,
    });
  });
}

function pushNote(candidates: AnalyzeCandidate[], text: string, nameHint?: string): void {
  // Never store section banners ("Hermes Windows =====") as notes
  if (isSectionBanner(text) || isSectionBanner(nameHint || "")) return;
  const value = stripSectionRule(text);
  if (!value || value.length > MAX_NOTE_CHARS) return;
  if (isNoiseLine(value) || isSectionBanner(value)) return;
  if (/[=\-_*]{3,}/.test(value)) return;
  const name = stripSectionRule(nameHint || value).slice(0, 48);
  if (!name || /[=\-_*]{3,}/.test(name)) return;
  candidates.push(
    candidateBase({
      value,
      type: "note",
      name,
      raw_fragment: value,
      labels: ["note"],
      type_aliases: ["note", "ملاحظة"],
      family: "note",
      confidence: 0.7,
    })
  );
}

/** Deterministic multi-extract without LLM */
export function heuristicAnalyze(paste: string): AnalyzeCandidate[] {
  const text = paste.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const candidates: AnalyzeCandidate[] = [];
  const lines = text.split("\n");

  // Multi-line: .env / config / mixed block / command cheatsheet
  let envHits = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("//") || isNoiseLine(t)) continue;
    if (ENV_LINE_RE.test(t) || ENV_SPACED_RE.test(t)) envHits++;
  }

  if (envHits >= 1 || lines.length > 1) {
    const matchedLines = new Set<string>();

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      if (isNoiseLine(t)) {
        matchedLines.add(t); // consume separators so they never become notes
        continue;
      }

      // command line inside block
      if (isCommandLine(t)) {
        pushCommand(candidates, t);
        matchedLines.add(t);
        continue;
      }

      const m = t.match(ENV_LINE_RE) || t.match(ENV_SPACED_RE);
      if (m) {
        const key = m[1];
        const value = m[2].trim();
        // "Title =======" / "Hermes Windows =====" are section banners — skip entirely
        if (isNoiseEnvValue(value) || isSectionBanner(t) || TITLE_WITH_RULE_RE.test(t)) {
          matchedLines.add(t);
          continue;
        }
        const typed = typeFromEnvKey(key, value);
        const name = nameFromEnvKey(key);
        const needsName =
          typed.family === "secret" || typed.family === "unknown"
            ? !name || name.length < 2
            : false;
        candidates.push(
          candidateBase({
            value,
            type: typed.type,
            name,
            raw_fragment: t,
            labels: [key],
            type_aliases: typed.aliases,
            family: typed.family,
            needs_type: typed.needs_type,
            needs_name: needsName || typed.family === "unknown",
            confidence: typed.needs_type ? 0.4 : 0.85,
          })
        );
        matchedLines.add(t);
        continue;
      }

      // section banners ("Hermes Windows =====") — never notes, never secrets
      if (isSectionBanner(t)) {
        matchedLines.add(t);
        continue;
      }

      // known tokens / high-entropy on their own line (multi-line pastes used to miss these)
      const secret = classifyStandaloneSecret(t);
      if (secret) {
        candidates.push(
          candidateBase({
            value: t,
            type: secret.type,
            name: "",
            raw_fragment: t,
            labels: [],
            type_aliases: secret.aliases,
            family: secret.family,
            needs_type: secret.needs_type,
            needs_name: secret.needs_name,
            confidence: secret.confidence,
            model_notes: secret.model_notes,
          })
        );
        matchedLines.add(t);
        continue;
      }
    }

    if (candidates.length) {
      // Pair preceding title lines as names (Antigravity Kazma Build + client id)
      const paired = applyTitleNamePairing(lines, candidates);

      // Cheatsheets (commands/secrets already found): do not invent leftover labels/notes
      // like "Hermes Windows" / "Telegram" / "Bot Token:" — those are document chrome.
      const hasPayload = paired.some(
        (c) => c.family === "command" || c.family === "secret" || c.family === "unknown"
      );
      if (!hasPayload) {
        const seenNotes = new Set<string>(
          paired.filter((c) => c.family === "note").map((c) => c.name.toLowerCase())
        );
        let leftoverNotes = 0;
        for (const line of lines) {
          if (leftoverNotes >= MAX_LEFTOVER_NOTES) break;
          const t = line.trim();
          if (!t || matchedLines.has(t) || t.startsWith("#") || t.startsWith("//")) continue;
          if (isSectionBanner(t) || !isUsefulNoteLine(t)) continue;
          // title already used as a secret name — don't also save as a note
          if (paired.some((c) => c.name.toLowerCase() === noteTitle(t).toLowerCase())) continue;
          const title = noteTitle(t);
          const key = title.toLowerCase();
          if (seenNotes.has(key)) continue;
          seenNotes.add(key);
          pushNote(paired, title, title);
          leftoverNotes++;
        }
      }
      return dedupe(paired);
    }
  }

  // Single-line or free paste
  const single = text.trim();

  // Quoted env style: TELEGRAM_ALLOWED_USERS "1804015016"
  const spaced = single.match(
    /^([A-Za-z_][A-Za-z0-9_]*)\s+["']([^"']+)["']\s*$/
  );
  if (spaced) {
    const key = spaced[1];
    const value = spaced[2];
    const typed = typeFromEnvKey(key, value);
    return [
      candidateBase({
        value,
        type: typed.type,
        name: nameFromEnvKey(key),
        raw_fragment: single,
        labels: [key],
        type_aliases: typed.aliases,
        family: typed.family,
        needs_type: typed.needs_type,
        confidence: 0.9,
      }),
    ];
  }

  if (isCommandLine(single) || single.startsWith("rm ") || single.includes(" && ")) {
    return [
      candidateBase({
        value: single,
        type: "shell command",
        name: single.split(/\s+/).slice(0, 4).join(" ").slice(0, 48),
        raw_fragment: single,
        labels: ["command"],
        type_aliases: ["command", "shell", "أمر"],
        family: "command",
        confidence: 0.92,
      }),
    ];
  }

  // Multi-line that didn't hit envHits path with empty candidates, or single-line secret
  // Explicit title + secret(s) pass (covers blank-line separated pastes)
  {
    const nonEmpty = lines.map((l) => l.trim()).filter((l) => l && !isNoiseLine(l));
    const titled: AnalyzeCandidate[] = [];
    for (let i = 0; i < nonEmpty.length; i++) {
      const t = nonEmpty[i];
      const secret = classifyStandaloneSecret(t);
      if (!secret) continue;
      let name = "";
      if (i > 0 && isTitleLabelLine(nonEmpty[i - 1])) {
        name = nonEmpty[i - 1].slice(0, 64);
      }
      titled.push(
        candidateBase({
          value: t,
          type: secret.type,
          name,
          raw_fragment: name ? `${name}\n${t}` : t,
          labels: name ? ["titled"] : [],
          type_aliases: secret.aliases,
          family: secret.family,
          needs_type: secret.needs_type,
          needs_name: !name,
          confidence: secret.confidence,
          model_notes: secret.model_notes,
        })
      );
    }
    if (titled.length) return dedupe(titled);
  }

  const loneSecret = classifyStandaloneSecret(single);
  if (loneSecret) {
    return [
      candidateBase({
        value: single,
        type: loneSecret.type,
        name: "",
        raw_fragment: single,
        labels: [],
        type_aliases: loneSecret.aliases,
        family: loneSecret.family,
        needs_type: loneSecret.needs_type,
        needs_name: loneSecret.needs_name,
        confidence: loneSecret.confidence,
        model_notes: loneSecret.model_notes,
      }),
    ];
  }

  // Real notes only: short prose. Never index section banners or whole-file dumps.
  if (isNoiseLine(single) || isSectionBanner(single)) return [];

  if (lines.length > 1) {
    // Multi-line with nothing extractable: one compact note only if the whole paste is small prose
    // Never glue a secret-looking line into a note dump
    const anySecretLine = lines.some((l) => classifyStandaloneSecret(l.trim()));
    if (anySecretLine) return [];
    if (single.length <= MAX_WHOLE_FILE_NOTE_CHARS && !/[\\{}<>;`]{2,}/.test(single)) {
      const first =
        lines.map((l) => l.trim()).find((l) => l && !isNoiseLine(l)) || "note";
      const title = noteTitle(first);
      return [
        candidateBase({
          value: single.slice(0, MAX_NOTE_CHARS),
          type: "note",
          name: title.slice(0, 48),
          raw_fragment: single.slice(0, MAX_NOTE_CHARS),
          labels: ["note"],
          type_aliases: ["note", "ملاحظة", "text"],
          family: "note",
          confidence: 0.7,
        }),
      ];
    }
    // Large unstructured dump with no secrets/commands — skip (not a vault entry)
    return [];
  }

  // short plain text
  if (single.length > MAX_NOTE_CHARS) return [];
  return [
    candidateBase({
      value: single,
      type: "note",
      name: noteTitle(single).slice(0, 40),
      raw_fragment: single,
      labels: ["note"],
      type_aliases: ["note", "ملاحظة"],
      family: "note",
      confidence: 0.7,
    }),
  ];
}

function dedupe(list: AnalyzeCandidate[]): AnalyzeCandidate[] {
  const seen = new Set<string>();
  const out: AnalyzeCandidate[] = [];
  for (const c of list) {
    // Never keep whole-file / separator / section-banner dumps as notes
    if (c.family === "note") {
      const v = (c.value || "").trim();
      const n = (c.name || "").trim();
      if (!v || v.length > MAX_NOTE_CHARS) continue;
      if (isNoiseLine(v) || isSectionBanner(v) || isSectionBanner(n)) continue;
      if (/[=\-_*]{3,}/.test(v) || /[=\-_*]{3,}/.test(n)) continue;
      if (/^[=\-_*~#.\s]+$/.test(v)) continue;
    }
    const k = `${c.value}::${c.raw_fragment}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Bilingual keyword expansion for ask */
export function expandQueryTerms(query: string): string[] {
  const q = query.toLowerCase().trim();
  const terms = new Set<string>(q.split(/[\s?؟،,]+/).filter((t) => t.length > 1));

  const pairs: [RegExp, string[]][] = [
    [/telegram|تيليجرام|تلغرام|tg\b/i, ["telegram", "تيليجرام", "tg"]],
    [/bot|بوت/i, ["bot", "بوت"]],
    [/token|توكن|رمز/i, ["token", "توكن"]],
    [/id|معرف|آيدي|ايدي/i, ["id", "معرف"]],
    [/key|مفتاح|كي/i, ["key", "مفتاح", "api key"]],
    [/command|أمر|امر|cmd/i, ["command", "shell", "أمر"]],
    [/note|ملاحظة|ملاحظه/i, ["note", "ملاحظة"]],
    [/password|كلمة السر|باسورد/i, ["password", "secret"]],
    [/openai|chatgpt/i, ["openai"]],
    [/github|غيت/i, ["github"]],
    [/twitter|\bx\b|tweet|تويتر/i, ["twitter", "x-twitter", "tweet", "bearer"]],
    [/deepseek/i, ["deepseek", "deep seek"]],
    [/hermes/i, ["hermes"]],
  ];

  for (const [re, extras] of pairs) {
    if (re.test(query)) extras.forEach((e) => terms.add(e.toLowerCase()));
  }
  return [...terms];
}
