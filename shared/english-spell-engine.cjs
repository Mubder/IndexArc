"use strict";

const fs = require("fs");
const path = require("path");
let nspell;
try {
  nspell = require("nspell");
} catch (e) {
  console.log("[en-spell] nspell not available, using fallback engine");
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

class EnglishSpellEngine {
  constructor(dicPath, affPath) {
    this.words = new Set();
    this.deleteIndex = new Map();
    this.loaded = false;
    this.wordCount = 0;
    this.nspellInstance = null;
    if (dicPath) this.load(dicPath, affPath);
  }

  load(dicPath, affPath) {
    let raw;
    try {
      raw = fs.readFileSync(dicPath, "utf8");
    } catch (e) {
      console.log("[en-spell] failed to read dictionary:", e && e.message ? e.message : e);
      return;
    }
    // Handle both CRLF and LF line endings
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    let start = 0;
    if (lines[0] && /^\d+$/.test(lines[0].trim())) start = 1;

    let n = 0;
    const dicWords = [];
    for (let i = start; i < lines.length; i++) {
      let line = lines[i];
      if (!line) continue;
      const slash = line.indexOf("/");
      if (slash >= 0) line = line.slice(0, slash);
      line = line.trim().toLowerCase();
      if (line.length < 2) continue;
      if (!/^[a-z][a-z]*$|^\d+[a-z]*$|^\w+$/.test(line)) continue;
      this._addWord(line);
      dicWords.push(line);
      n++;
    }
    this.wordCount = n;
    this.loaded = true;

    if (nspell && dicWords.length > 0) {
      try {
        const affContent = affPath && fs.existsSync(affPath)
          ? fs.readFileSync(affPath, "utf8")
          : "";
        if (affContent.trim()) {
          this.nspellInstance = nspell({ aff: affContent, dic: dicWords.join("\n") });
          console.log("[en-spell] nspell initialized with Hunspell affix rules");
        } else {
          this.nspellInstance = nspell({ aff: "", dic: dicWords.join("\n") });
          console.log("[en-spell] nspell initialized without affix rules");
        }
      } catch (e) {
        console.log("[en-spell] nspell init failed:", e && e.message ? e.message : e);
        this.nspellInstance = null;
      }
    } else if (nspell) {
      try {
        this.nspellInstance = nspell({ aff: "", dic: dicWords.join("\n") });
        console.log("[en-spell] nspell initialized (basic mode)");
      } catch (e) {
        console.log("[en-spell] nspell basic init failed");
        this.nspellInstance = null;
      }
    }

    console.log("[en-spell] loaded " + n + " words, delete-index keys=" + this.deleteIndex.size);
  }

  _addWord(word) {
    if (this.words.has(word)) return;
    this.words.add(word);

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

  hasExact(word) {
    if (!word) return false;
    return this.words.has(word.toLowerCase());
  }

  add(word) {
    const clean = String(word || "").trim().toLowerCase();
    if (clean.length >= 2) {
      this._addWord(clean);
      if (this.nspellInstance) {
        try {
          this.nspellInstance.add(word);
        } catch (e) {}
      }
    }
  }

  correct(word) {
    const clean = String(word || "").trim().toLowerCase();
    if (!clean || clean.length <= 1) return true;

    if (this.nspellInstance) {
      try {
        return this.nspellInstance.correct(clean);
      } catch (e) {
        console.log("[en-spell] nspell.correct failed for \"" + clean + "\":", e && e.message ? e.message : e);
      }
    }

    return this._fallbackCorrect(clean);
  }

  _fallbackCorrect(clean) {
    if (this.hasExact(clean)) return true;

    if (clean.endsWith("s") && clean.length > 3) {
      if (this.hasExact(clean.slice(0, -1))) return true;
      if (clean.endsWith("es")) {
        if (this.hasExact(clean.slice(0, -2))) return true;
        if (this.hasExact(clean.slice(0, -3))) return true;
      }
    }

    if (clean.endsWith("ed")) {
      const stem1 = clean.slice(0, -2);
      const stem2 = clean.slice(0, -1);
      if (this.hasExact(stem1) || this.hasExact(stem2)) return true;
      if (clean.endsWith("ied")) {
        if (this.hasExact(clean.slice(0, -3) + "y")) return true;
      }
    }

    if (clean.endsWith("ing")) {
      if (this.hasExact(clean.slice(0, -3))) return true;
    }

    if (clean.endsWith("er") && clean.length > 5) {
      if (this.hasExact(clean.slice(0, -2))) return true;
    }

    if (clean.endsWith("ly")) {
      if (this.hasExact(clean.slice(0, -2))) return true;
    }

    if (clean.endsWith("ment") && clean.length > 7) {
      if (this.hasExact(clean.slice(0, -4))) return true;
    }

    if (clean.endsWith("tion") && clean.length > 6) {
      if (this.hasExact(clean.slice(0, -3) + "e")) return true;
    }
    if (clean.endsWith("sion") && clean.length > 6) {
      if (this.hasExact(clean.slice(0, -3))) return true;
    }

    if (clean.endsWith("en") && clean.length > 5) {
      if (this.hasExact(clean.slice(0, -2) + "e")) return true;
    }

    if (clean.endsWith("ive") && clean.length > 5) {
      if (this.hasExact(clean.slice(0, -3))) return true;
    }

    return false;
  }

  suggest(word, limit) {
    const max = typeof limit === "number" && limit > 0 ? limit : 8;
    const original = String(word || "").trim();
    const clean = original.toLowerCase();
    if (!clean || clean.length <= 1) return [];

    if (this.nspellInstance) {
      try {
        const nspellSuggs = this.nspellInstance.suggest(clean) || [];
        if (nspellSuggs.length > 0) {
          const isCapitalized = original[0] === original[0].toUpperCase();
          return nspellSuggs.slice(0, max).map(s =>
            isCapitalized ? s.charAt(0).toUpperCase() + s.slice(1) : s
          );
        }
      } catch (e) {
        console.log("[en-spell] nspell.suggest failed:", e && e.message ? e.message : e);
      }
    }

    const best = new Map();
    const singleDeletes = new Set();
    for (let i = 0; i < clean.length; i++) {
      singleDeletes.add(clean.slice(0, i) + clean.slice(i + 1));
    }

    const isCapitalized = original[0] === original[0].toUpperCase();
    const seenSuggestions = new Set();

    const consider = (cand, bonus) => {
      if (!cand || cand === clean || cand.length < 2) return;
      if (seenSuggestions.has(cand)) return;
      if (!this._suggestionValid(cand)) return;
      const dist = editDistance(clean, cand);
      if (dist > 2) return;
      let score = dist + (typeof bonus === "number" ? bonus : 0);
      if (singleDeletes.has(cand)) score -= 0.85;
      if (this.hasExact(cand)) score -= 0.25;
      score += Math.abs(cand.length - clean.length) * 0.08;
      best.set(cand, score);
      seenSuggestions.add(cand);
    };

    this._generateSymSpellSuggestions(consider, singleDeletes, clean, isCapitalized, best);

    const suggestions = [...best.entries()]
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        const da = Math.abs(a[0].length - clean.length);
        const db = Math.abs(b[0].length - clean.length);
        if (da !== db) return da - db;
        return a[0].localeCompare(b[0]);
      })
      .map(([s]) => isCapitalized ? s.charAt(0).toUpperCase() + s.slice(1) : s)
      .slice(0, max);

    return suggestions;
  }

  _suggestionValid(cand) {
    if (!this._fallbackCorrect(cand)) return false;
    if (this.nspellInstance) {
      try {
        return this.nspellInstance.correct(cand);
      } catch (e) {}
    }
    return true;
  }

  _generateSymSpellSuggestions(consider, singleDeletes, clean, isCapitalized, best) {
    for (const del of singleDeletes) consider(del, -0.1);

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

    for (let i = 0; i < clean.length - 1; i++) {
      const t = clean.slice(0, i) + clean[i + 1] + clean[i] + clean.slice(i + 2);
      consider(t, -2.0);
    }

    if (clean.endsWith("nt")) {
      consider(clean.slice(0, -2) + "n't", -2.0);
    }
    if (clean.endsWith("s")) {
      consider(clean.slice(0, -1) + "'s", -2.0);
    }
    if (clean.endsWith("re")) {
      consider(clean.slice(0, -2) + "'re", -2.0);
    }
    if (clean.endsWith("ve")) {
      consider(clean.slice(0, -2) + "'ve", -2.0);
    }
    if (clean.endsWith("ll")) {
      consider(clean.slice(0, -2) + "'ll", -2.0);
    }

    if (clean.length >= 5 && best.size < 3) {
      for (let i = 0; i < clean.length; i++) {
        const one = clean.slice(0, i) + clean.slice(i + 1);
        for (let j = 0; j < one.length; j++) {
          consider(one.slice(0, j) + one.slice(j + 1), 0.15);
        }
      }
    }
  }

  getDicPath() {
    return this.dicPath;
  }
}

function loadEnglishEngine(dicDir) {
  const dicPath = path.join(dicDir, "en.dic");
  const affPath = path.join(dicDir, "en.aff");

  if (!fs.existsSync(dicPath)) {
    console.log("[en-spell] en.dic not found at", dicPath);
    return null;
  }

  const engine = new EnglishSpellEngine(dicPath, affPath);
  return engine;
}

module.exports = {
  EnglishSpellEngine,
  loadEnglishEngine,
  editDistance,
};