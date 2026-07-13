import type { VaultStore } from "../store.js";
import type { AppSettings, AskResultItem, VaultEntry } from "../types.js";
import { expandQueryTerms } from "../ai/heuristics.js";
import { cosineSimilarity, embedText, resolveActiveProvider } from "../ai/providers.js";
import { addLog } from "../logs.js";

function maskValue(v: string): string {
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if needle appears as a whole token/word in haystack (not a tiny substring). */
function hasToken(haystack: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n || n.length < 2) return false;
  const h = haystack.toLowerCase();
  if (h === n) return true;
  // multi-word: allow contiguous phrase
  if (n.includes(" ")) return h.includes(n);
  // single token: word boundary (also treat _ - . / as separators)
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(n)}(?:[^a-z0-9]|$)`, "i");
  return re.test(h);
}

function scoreEntry(
  entry: VaultEntry,
  query: string,
  terms: string[]
): { score: number; reason: string; keywordHits: number } {
  const q = query.toLowerCase().trim();
  const name = entry.name.toLowerCase();
  const type = entry.type.toLowerCase();
  const labels = entry.labels.map((l) => l.toLowerCase()).join(" ");
  const aliases = entry.type_aliases.map((a) => a.toLowerCase()).join(" ");
  const value = entry.value.toLowerCase();
  const raw = (entry.raw_fragment || "").toLowerCase();
  const source = (entry.source_file || "").toLowerCase();
  const typeBlob = `${type} ${aliases} ${labels}`;
  const searchable = `${name} ${typeBlob} ${value} ${raw} ${source}`;

  let score = 0;
  let keywordHits = 0;
  const reasons: string[] = [];

  // Quoted name — strongest for multi-bot lookups
  const quoted = query.match(/["'«»](.+?)["'«»]/);
  if (quoted) {
    const qn = quoted[1].toLowerCase();
    if (name === qn || hasToken(name, qn) || (qn.length >= 3 && name.includes(qn))) {
      score += 1.4;
      keywordHits += 3;
      reasons.push("quoted name");
    } else {
      score -= 1.0;
    }
  } else if (name.length >= 2) {
    // Name contains query as a token — never match short substrings inside longer tokens
    // (e.g. "see" must not hit "DEEPSEEK", and query must not reverse-match short names)
    if (name === q || hasToken(name, q) || (q.length >= 5 && name.includes(q))) {
      score += 1.15;
      keywordHits += 2;
      reasons.push("name");
    }
  }

  // Full-query text hit in value / labels / source / raw
  if (q.length >= 3 && (hasToken(searchable, q) || (q.length >= 5 && searchable.includes(q)))) {
    score += 0.55;
    keywordHits += 1;
    reasons.push("text");
  }

  // Value-specific
  if (value === q) {
    score += 0.7;
    keywordHits += 2;
    reasons.push("exact value");
  } else if (q.length >= 4 && (hasToken(value, q) || (q.length >= 5 && value.includes(q)))) {
    score += 0.5;
    keywordHits += 1;
    reasons.push("value");
  }

  // Expanded terms (twitter→x, etc.) — token hits only; no bare substring for short terms
  let termHits = 0;
  for (const t of terms) {
    if (!t || t.length < 3) continue;
    if (t === q) continue; // already counted as full query
    const loose = t.length >= 5;
    if (
      hasToken(name, t) ||
      hasToken(type, t) ||
      hasToken(aliases, t) ||
      hasToken(labels, t) ||
      hasToken(value, t) ||
      hasToken(raw, t) ||
      hasToken(source, t) ||
      (loose &&
        (name.includes(t) ||
          type.includes(t) ||
          labels.includes(t) ||
          value.includes(t) ||
          source.includes(t)))
    ) {
      termHits++;
    }
  }
  if (termHits) {
    score += Math.min(0.75, termHits * 0.22);
    keywordHits += termHits;
    reasons.push(`terms×${termHits}`);
  }

  // Intent: telegram user id (not bot token)
  const wantsTelegramUser =
    /(telegram\s*(user\s*)?id|allowed.?users|معرف\s*(ال)?تيليجرام|معرف\s*تلغرام|tg\s*id)/i.test(query) &&
    !/(bot|بوت)/i.test(query);
  if (wantsTelegramUser) {
    if (/telegram.*user|user.*id|telegram id|معرف/.test(typeBlob) || /telegram user id|telegram id/.test(type)) {
      score += 0.9;
      keywordHits += 1;
      reasons.push("telegram id type");
    }
    if (/bot token|bot_token/.test(type) || entry.family === "command") {
      score -= 0.5;
    }
    if (/^\d{5,15}$/.test(entry.value) && /telegram|user|id|allowed/.test(typeBlob + name)) {
      score += 0.4;
      keywordHits += 1;
    }
  }

  // Intent: bot token
  const wantsBotToken = /(bot.*token|token.*bot|توكن.*بوت|بوت.*توكن)/i.test(query);
  if (wantsBotToken) {
    if (/bot token|telegram bot/.test(type)) {
      score += 0.85;
      keywordHits += 1;
      reasons.push("bot token type");
    }
  }

  // Family intent only when the query is ABOUT that family — not free boosts
  if (/(^|\s)(command|أمر|امر)(\s|$)/i.test(query) && entry.family === "command") {
    score += 0.2;
    reasons.push("command intent");
  }
  if (/(^|\s)(note|ملاحظة)(\s|$)/i.test(query) && entry.family === "note") {
    score += 0.2;
  }
  if (/(token|key|secret|توكن|مفتاح)/i.test(query) && (entry.family === "secret" || entry.family === "unknown")) {
    // mild boost only if we already have a keyword signal
    if (keywordHits > 0) score += 0.12;
  }

  if (entry.status !== "saved") score -= 0.15;
  else if (keywordHits > 0) score += 0.05;

  return {
    score: Math.max(0, Math.min(score, 3)),
    reason: reasons.join(", ") || "weak",
    keywordHits,
  };
}

export async function askVault(
  store: VaultStore,
  settings: AppSettings,
  query: string,
  limit = 10
): Promise<{ results: AskResultItem[]; provider_used: string; mode: string }> {
  const q = query.trim();
  if (!q) return { results: [], provider_used: "none", mode: "empty" };

  const terms = expandQueryTerms(q);
  const entries = store.listEntries();
  const scored: (AskResultItem & { keywordHits: number; semantic: number })[] = entries.map(
    (entry) => {
      const { score, reason, keywordHits } = scoreEntry(entry, q, terms);
      return { entry, score, match_reason: reason, keywordHits, semantic: 0 };
    }
  );

  // Vector boost — only re-ranks keyword hits or very strong pure semantic matches
  let provider_used = "keyword";
  const active = await resolveActiveProvider(settings);
  const SEMANTIC_FLOOR = 0.42; // ignore weak cosine noise
  const SEMANTIC_STRONG = 0.58; // pure-semantic allowed only above this

  if (active !== "heuristic") {
    try {
      const qEmb = await embedText(settings, q, active);
      if (qEmb) {
        provider_used = active === "local" ? "ollama+keyword" : "gemini+keyword";
        const vectors = store.allVectors();
        const byEntry = new Map(vectors.map((v) => [v.entry_id, v]));
        for (const item of scored) {
          const vec = byEntry.get(item.entry.id);
          if (!vec?.embedding?.length) continue;
          const sim = cosineSimilarity(qEmb, vec.embedding);
          item.semantic = sim;
          if (sim < SEMANTIC_FLOOR) continue;

          if (item.keywordHits > 0) {
            // Re-rank among relevant hits
            item.score += sim * 0.45;
            item.match_reason = item.match_reason
              ? `${item.match_reason}, semantic`
              : "semantic";
          } else if (sim >= SEMANTIC_STRONG) {
            // Strong semantic only — still capped so keyword wins
            item.score += (sim - SEMANTIC_STRONG) * 0.8 + 0.2;
            item.match_reason = "semantic-strong";
          }
          // else: weak semantic with no keywords → ignore (this was the unrelated spam)
        }
      }
    } catch (e: any) {
      addLog("ASK", `embedding boost skipped: ${e.message}`);
    }
  }

  const results = scored
    .filter((r) => {
      // Must have keyword evidence OR a strong pure-semantic match
      if (r.keywordHits > 0 && r.score >= 0.25) return true;
      if (r.keywordHits === 0 && r.semantic >= SEMANTIC_STRONG && r.score >= 0.2) return true;
      return false;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, score, match_reason }) => ({ entry, score, match_reason }));

  addLog("ASK", `Query processed → ${results.length} hit(s) via ${provider_used}`);
  return { results, provider_used, mode: "hybrid" };
}

export { maskValue };
