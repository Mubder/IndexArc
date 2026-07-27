/**
 * Arabic spell engine — replacement for Hunspell/nspell on Arabic.
 *
 * Why not Hunspell/Ayaspell via nspell?
 *   - Affix model cannot express Arabic clitics/plurals well → huge false positives
 *   - nspell.suggest() for Arabic is nearly useless (unrelated lookalikes)
 *
 * This engine:
 *   1. Loads the word list from ar.dic into a Set (fast exact lookup)
 *   2. Builds a SymSpell-style single-delete reverse index for suggestions
 *   3. Accepts clitic/plural stacks via morphology against the word set
 *   4. Ranks suggestions by Damerau–Levenshtein distance (near typos win)
 *
 * English continues to use nspell + en-US elsewhere.
 */

"use strict";

const fs = require("fs");

const CLEAN_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640\u064B-\u0652\u0670]/g;

const AR_PREFIXES_LONG = [
  "وبال", "فبال", "وكال", "فكال", "ولل", "فلل",
  "بال", "كال", "وال", "فال", "لل", "ال",
  "وس", "فس", "وب", "فب", "ول", "فل", "وك", "فك",
];
const AR_PREFIXES_SHORT = ["و", "ف", "ب", "ل", "ك", "س"];
const AR_ENCLITICS = [
  "يهما", "يهن", "هما", "كما", "تما", "تهم",
  "كم", "كن", "هم", "هن", "ها", "نا", "ني", "ته", "تي",
  "ك", "ه", "ي", "ت",
];
const AR_ENDINGS = [
  "يات", "تين", "تان", "ون", "ين", "ات", "ان", "ية", "يا", "وا", "تم", "تن", "ة", "ا",
];

const AR_CONFUSABLES = {
  ا: "أإآى", أ: "اإآ", إ: "اأآ", آ: "اأإ",
  ى: "يائ", ي: "ىئ", ئ: "يى",
  ة: "هت", ه: "ة", ت: "ةط",
  س: "صش", ص: "س", ض: "ظد", ظ: "ضط",
  د: "ذض", ذ: "د", ق: "كف", ك: "ق",
  و: "ؤ", ؤ: "و", ج: "حخ", ح: "جهخ", خ: "جح",
  ع: "غ", غ: "ع", ر: "ز", ز: "ر",
};

// High-value modern / legal / UI terms often missing from older Ayaspell dumps.
const AR_EXTRA = new Set([
  "تطبيق", "مستخدم", "مستخدمين", "كلمة", "كلمات", "مرور", "ايميل", "إيميل",
  "إعدادات", "الاعدادات", "الإعدادات", "ملاحظة", "ملاحظات", "تشفير", "خزنة",
  "تعديلات", "تعديل", "تعديلاتك", "حقوقه", "التزاماته", "والتزاماته",
  "تعسفيا", "علنيا", "للفصل", "لإنصافه", "المتأصلة", "المتأصل",
  "السعودية", "المملكة", "العربية", "الإمارات", "الامارات",
]);

function stripDiacritics(s) {
  return s.replace(CLEAN_RE, "");
}

function normalizeAlefYeh(s) {
  return s
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function variants(word) {
  const out = new Set([word]);
  out.add(normalizeAlefYeh(word));
  out.add(word.replace(/ة/g, "ه"));
  out.add(word.replace(/ه$/g, "ة"));
  out.add(word.replace(/ى/g, "ي"));
  out.add(word.replace(/ي/g, "ى"));
  out.add(word.replace(/[أإآ]/g, "ا"));
  if (word.endsWith("ائ")) out.add(word.slice(0, -2) + "اء");
  if (word.endsWith("اء")) out.add(word.slice(0, -2) + "ائ");
  return out;
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  if (Math.abs(m - n) > 4) return Math.abs(m - n) + 4;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

class ArabicSpellEngine {
  /**
   * @param {string} dicPath path to ar.dic (Hunspell word list — affix flags ignored)
   */
  constructor(dicPath) {
    /** @type {Set<string>} */
    this.words = new Set(AR_EXTRA);
    /** @type {Map<string, string[]>} delete-form → dictionary words (SymSpell index) */
    this.deleteIndex = new Map();
    this.loaded = false;
    this.wordCount = 0;
    if (dicPath) this.load(dicPath);
  }

  load(dicPath) {
    let raw;
    try {
      raw = fs.readFileSync(dicPath, "utf8");
    } catch (e) {
      console.log("[ar-spell] failed to read dictionary:", e && e.message ? e.message : e);
      return;
    }
    const lines = raw.split(/\r?\n/);
    // First line is often a count
    let start = 0;
    if (lines[0] && /^\d+$/.test(lines[0].trim())) start = 1;

    let n = 0;
    for (let i = start; i < lines.length; i++) {
      let line = lines[i];
      if (!line) continue;
      // Hunspell: word/flags or word
      const slash = line.indexOf("/");
      if (slash >= 0) line = line.slice(0, slash);
      line = stripDiacritics(line.trim());
      if (line.length < 2) continue;
      // Skip non-Arabic noise
      if (!/[\u0600-\u06FF]/.test(line)) continue;
      this._addWord(line);
      n++;
    }
    this.wordCount = n;
    this.loaded = true;
    console.log(`[ar-spell] loaded ${n} words, delete-index keys=${this.deleteIndex.size}`);
  }

  _addWord(word) {
    if (this.words.has(word)) return;
    this.words.add(word);
    // Also index common orthographic normalization so lookups match typed forms
    const norm = normalizeAlefYeh(word);
    if (norm !== word) this.words.add(norm);

    // SymSpell single-delete index (words of reasonable length only)
    if (word.length >= 3 && word.length <= 14) {
      for (let i = 0; i < word.length; i++) {
        const del = word.slice(0, i) + word.slice(i + 1);
        let arr = this.deleteIndex.get(del);
        if (!arr) {
          arr = [];
          this.deleteIndex.set(del, arr);
        }
        if (arr.length < 16) arr.push(word);
      }
    }
  }

  /** Exact dictionary hit (incl. orthographic variants). */
  hasExact(word) {
    if (!word) return false;
    if (this.words.has(word) || AR_EXTRA.has(word)) return true;
    for (const v of variants(word)) {
      if (this.words.has(v) || AR_EXTRA.has(v)) return true;
    }
    return false;
  }

  add(word) {
    const clean = stripDiacritics(String(word || "").trim());
    if (clean.length >= 2) this._addWord(clean);
  }

  _morphKnown(word) {
    return this.hasExact(word);
  }

  _expand(cur, queue, seen) {
    for (const p of AR_PREFIXES_LONG) {
      if (cur.startsWith(p) && cur.length - p.length >= 2) {
        const rest = cur.slice(p.length);
        if (!seen.has(rest)) {
          seen.add(rest);
          queue.push(rest);
        }
      }
    }
    for (const s of AR_ENCLITICS) {
      if (!cur.endsWith(s)) continue;
      const minLen = s.length === 1 ? 3 : 2;
      if (cur.length - s.length >= minLen) {
        const rest = cur.slice(0, cur.length - s.length);
        if (!seen.has(rest)) {
          seen.add(rest);
          queue.push(rest);
        }
      }
    }
    for (const s of AR_ENDINGS) {
      if (!cur.endsWith(s)) continue;
      if (cur.length - s.length >= 2) {
        const rest = cur.slice(0, cur.length - s.length);
        if (!seen.has(rest)) {
          seen.add(rest);
          queue.push(rest);
        }
      }
    }
  }

  _coreCorrect(clean) {
    if (this._morphKnown(clean)) return true;
    const seen = new Set([clean]);
    const queue = [];
    this._expand(clean, queue, seen);
    let steps = 0;
    while (queue.length && steps < 80) {
      const cur = queue.shift();
      steps++;
      if (this._morphKnown(cur)) return true;
      this._expand(cur, queue, seen);
    }
    return false;
  }

  /**
   * @returns {boolean} true if word is accepted as correctly spelled
   */
  correct(word) {
    const clean = stripDiacritics(String(word || "").trim());
    if (!clean || clean.length <= 1) return true;
    if (this._coreCorrect(clean)) return true;
    for (const p of AR_PREFIXES_SHORT) {
      if (clean.startsWith(p) && clean.length - p.length >= 3) {
        if (this._coreCorrect(clean.slice(p.length))) return true;
      }
    }
    return false;
  }

  /**
   * High-quality near-miss suggestions (SymSpell + edit distance ranking).
   * @returns {string[]}
   */
  suggest(word, limit) {
    const max = typeof limit === "number" && limit > 0 ? limit : 8;
    const clean = stripDiacritics(String(word || "").trim());
    if (!clean || clean.length <= 1) return [];

    /** @type {Map<string, number>} */
    const best = new Map();
    /** Forms reachable by deleting exactly one character from the typo */
    const singleDeletes = new Set();
    for (let i = 0; i < clean.length; i++) {
      singleDeletes.add(clean.slice(0, i) + clean.slice(i + 1));
    }

    const consider = (cand, bonus) => {
      if (!cand || cand === clean || cand.length < 2) return;
      if (!this.correct(cand)) return;
      const dist = editDistance(clean, cand);
      // Hard cap: never show far-away lookalikes
      if (dist > 2) return;
      let score = dist + (typeof bonus === "number" ? bonus : 0);
      // Strong boost: candidate IS the typo with one char removed
      // (extra keystroke — the most common real-user typo)
      if (singleDeletes.has(cand)) score -= 0.85;
      // Exact dictionary form beats pure morph recovery slightly
      if (this.hasExact(cand)) score -= 0.25;
      // Prefer forms whose pronoun-stripped stem is a known verb/noun
      for (const suf of ["كما", "هما", "ها", "هم", "هن", "كم", "كن", "نا", "ك", "ه", "ي"]) {
        if (cand.length - suf.length >= 3 && cand.endsWith(suf)) {
          const stem = cand.slice(0, cand.length - suf.length);
          if (this.hasExact(stem) || this.correct(stem)) {
            score -= 0.45;
            break;
          }
        }
      }
      // Prefer similar length
      score += Math.abs(cand.length - clean.length) * 0.08;
      const prev = best.get(cand);
      if (prev === undefined || score < prev) best.set(cand, score);
    };

    // 1) Single deletes of the input (extra letter) — highest priority path
    for (const del of singleDeletes) {
      consider(del, -0.1);
    }

    // 2) SymSpell index: dict words that share a single-delete with input
    //    Only keep distance ≤ 1 to avoid "تندرسك"-style noise.
    const fromIndex = this.deleteIndex.get(clean);
    if (fromIndex) {
      for (const w of fromIndex) {
        if (editDistance(clean, w) <= 1) consider(w, 0);
      }
    }
    for (const del of singleDeletes) {
      const hits = this.deleteIndex.get(del);
      if (!hits) continue;
      for (const w of hits) {
        if (editDistance(clean, w) <= 1) consider(w, 0.05);
      }
    }

    // 3) Adjacent transposition
    for (let i = 0; i < clean.length - 1; i++) {
      const t = clean.slice(0, i) + clean[i + 1] + clean[i] + clean.slice(i + 2);
      consider(t, 0);
    }

    // 4) Confusable substitutions
    for (let i = 0; i < clean.length; i++) {
      const alts = AR_CONFUSABLES[clean[i]] || "";
      for (const a of alts) {
        consider(clean.slice(0, i) + a + clean.slice(i + 1), 0);
      }
    }

    // 5) Strip enclitic → fix stem → re-attach
    //    تنظرسك → strip ك → تنظرس → delete س → تنظر → +ك → تنظرك
    for (const s of AR_ENCLITICS) {
      if (!clean.endsWith(s) || clean.length - s.length < 3) continue;
      const stem = clean.slice(0, clean.length - s.length);
      if (this.correct(stem)) {
        consider(stem, 0.1);
        consider(stem + s, -0.2);
      }
      for (let i = 0; i < stem.length; i++) {
        const s2 = stem.slice(0, i) + stem.slice(i + 1);
        if (this.correct(s2)) {
          consider(s2, 0.05);
          // Re-attached form is usually what the user meant
          consider(s2 + s, -0.55);
        }
      }
    }

    // 6) Orthographic variants
    for (const v of variants(clean)) consider(v, 0);

    // 7) Double-delete only if still sparse
    if (clean.length >= 5 && best.size < 3) {
      for (let i = 0; i < clean.length; i++) {
        const one = clean.slice(0, i) + clean.slice(i + 1);
        for (let j = 0; j < one.length; j++) {
          consider(one.slice(0, j) + one.slice(j + 1), 0.15);
        }
      }
    }

    return [...best.entries()]
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        const da = Math.abs(a[0].length - clean.length);
        const db = Math.abs(b[0].length - clean.length);
        if (da !== db) return da - db;
        return a[0].localeCompare(b[0], "ar");
      })
      .map(([s]) => s)
      .slice(0, max);
  }
}

/**
 * Load engine from dictionaries/ar/ar.dic (aff file not required).
 * @param {string} dicDir directory containing ar.dic
 */
function loadArabicEngine(dicDir) {
  const path = require("path");
  const dicPath = path.join(dicDir, "ar.dic");
  if (!fs.existsSync(dicPath)) {
    console.log("[ar-spell] ar.dic not found at", dicPath);
    return null;
  }
  return new ArabicSpellEngine(dicPath);
}

module.exports = {
  ArabicSpellEngine,
  loadArabicEngine,
  stripDiacritics,
  editDistance,
};
