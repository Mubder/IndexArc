import type { VaultStore } from "../store.js";
import type { AppSettings, AskResultItem, VaultEntry } from "../types.js";
import { expandQueryTerms } from "../ai/heuristics.js";
import { cosineSimilarity, embedText, resolveActiveProvider, generateText } from "../ai/providers.js";
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

/**
 * Partial key / token fragment lookups (e.g. "P29T" inside a long access token).
 * Alphanumeric-ish, no spaces — not everyday English words.
 */
function isKeyFragmentQuery(q: string): boolean {
  const t = q.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (/\s/.test(t)) return false;
  // must look like a code fragment (has digit or mixed case or long)
  if (!/^[A-Za-z0-9_\-+/=.:]+$/.test(t)) return false;
  if (t.length >= 4) return true;
  // length 3: require a digit so "the"/"api" don't flood value substring matches
  return /\d/.test(t);
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
  const keyFrag = isKeyFragmentQuery(query);

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

  // Full-query text hit in labels / source (token-ish)
  if (q.length >= 3 && (hasToken(searchable, q) || (q.length >= 5 && searchable.includes(q)))) {
    score += 0.55;
    keywordHits += 1;
    reasons.push("text");
  }

  // Value / raw: support partial key search (P29T inside long token)
  if (value === q || raw === q) {
    score += 0.9;
    keywordHits += 2;
    reasons.push("exact value");
  } else if (value.includes(q) || raw.includes(q)) {
    if (hasToken(value, q) || hasToken(raw, q)) {
      score += 0.7;
      keywordHits += 2;
      reasons.push("value");
    } else if (keyFrag || q.length >= 4) {
      // substring inside a secret string — this is how people find keys by a known fragment
      score += keyFrag ? 1.1 : 0.65;
      keywordHits += 2;
      reasons.push("value fragment");
    }
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
): Promise<{ results: AskResultItem[]; answer?: string; provider_used: string; mode: string }> {
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

  // --- Scratchpad tabs (open + archived) ---
  // Each tab is treated as a synthetic vault entry so the same scoring/semantic
  // pipeline applies. Archived tabs are still searchable; the reason notes it.
  try {
    const tabs = store.getScratchpad() as Array<{
      id?: string;
      title?: string;
      content?: string;
      archived?: boolean;
    }>;
    for (const tab of tabs) {
      const content = tab.content || "";
      if (!content.trim()) continue;
      const now = new Date().toISOString();
      const synth: VaultEntry = {
        id: `scratchpad:${tab.id || content.slice(0, 16)}`,
        value: content,
        type: "scratchpad note",
        name: tab.title || "Scratch",
        raw_fragment: content,
        labels: ["scratchpad"],
        type_aliases: [],
        status: "saved",
        family: "note",
        created_at: now,
        updated_at: now,
        notes: tab.archived ? "archived" : "open",
        source_file: "scratchpad",
      };
      const { score, reason, keywordHits } = scoreEntry(synth, q, terms);
      if (score <= 0 && keywordHits === 0) continue;
      scored.push({
        entry: synth,
        score: score * 0.85, // slight demotion vs real vault entries
        match_reason: (reason ? `${reason}, ` : "") + "scratchpad" + (tab.archived ? " (archived)" : ""),
        keywordHits: keywordHits + 1, // ensure it passes the keyword floor
        semantic: 0,
      });
    }
  } catch {
    /* scratchpad not available — skip */
  }

  // Vector boost — only re-ranks keyword hits or very strong pure semantic matches
  let provider_used = "keyword";
  const active = await resolveActiveProvider(settings);
  const SEMANTIC_FLOOR = 0.42; // ignore weak cosine noise
  const SEMANTIC_STRONG = 0.58; // pure-semantic allowed only above this

  if (active !== "heuristic") {
    try {
      const qEmb = await embedText(settings, q, active);
      if (qEmb) {
        if (active === "local") {
          provider_used = "ollama+keyword";
        } else if (active === "api") {
          provider_used = "gemini+keyword";
        } else {
          provider_used = `${active}+keyword`;
        }
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

  let answer: string | undefined = undefined;
  if (active !== "heuristic" && results.length > 0) {
    try {
      const topMatches = results.slice(0, 5);
      const matchesContext = topMatches
        .map(
          (r, index) =>
            `[Entry #${index + 1}]
Name: ${r.entry.name}
Type: ${r.entry.type}
Family: ${r.entry.family}
Value: ${r.entry.value.slice(0, 400)}${r.entry.value.length > 400 ? "…" : ""}
Labels: ${(r.entry.labels || []).join(", ")}
Notes: ${r.entry.notes || ""}`
        )
        .join("\n\n");

      const systemInstruction = `You are IndexArc, a secure bilingual (English/Arabic) personal vault assistant. Your goal is to answer the user's question directly, accurately, and concisely using only the retrieved entries from their secure vault.

Guidelines:
- Answer in the language of the user's query (English or Arabic), or provide a bilingual response if appropriate.
- Directly answer the question. If they ask for a specific secret, token, or command, display it clearly, preferably inside a code block or prominent formatting so they can find or copy it instantly.
- Be extremely brief and professional. Do not hallucinate or make up secrets. If the provided entries do not contain the answer, say so clearly.`;

      const userPrompt = `User Query: "${q}"

Matching Vault Entries:
${matchesContext}`;

      const genResult = await generateText(settings, userPrompt, systemInstruction);
      if (genResult) {
        answer = genResult.text;
        provider_used = `${provider_used} + generateText via ${genResult.provider_used}`;
      }
    } catch (e: any) {
      addLog("ASK", `Conversational answer generation failed: ${e.message}`);
    }
  }

  addLog("ASK", `Query processed → ${results.length} hit(s) via ${provider_used}`);
  return { results, answer, provider_used, mode: "hybrid" };
}

export { maskValue };
