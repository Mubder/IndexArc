"use strict";

const fs = require("fs");

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
  constructor(dicPath) {
    this.words = new Set();
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
      console.log("[en-spell] failed to read dictionary:", e && e.message ? e.message : e);
      return;
    }
    const lines = raw.split(/\r?\n/);
    let start = 0;
    if (lines[0] && /^\d+$/.test(lines[0].trim())) start = 1;

    let n = 0;
    for (let i = start; i < lines.length; i++) {
      let line = lines[i];
      if (!line) continue;
      const slash = line.indexOf("/");
      if (slash >= 0) line = line.slice(0, slash);
      line = line.trim().toLowerCase();
      if (line.length < 2) continue;
      if (!/^[a-z]+(?:['\-][a-z]+)*$/.test(line)) continue;
      this._addWord(line);
      n++;
    }
    this.wordCount = n;
    this.loaded = true;
    console.log(`[en-spell] loaded ${n} words, delete-index keys=${this.deleteIndex.size}`);
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
    if (clean.length >= 2) this._addWord(clean);
  }

  correct(word) {
    const clean = String(word || "").trim().toLowerCase();
    if (!clean || clean.length <= 1) return true;
    
    if (this.hasExact(clean)) return true;
    
    // Very basic English morphology fallbacks if the dic was strictly roots
    if (clean.endsWith('s') && this.hasExact(clean.slice(0, -1))) return true;
    if (clean.endsWith('es') && this.hasExact(clean.slice(0, -2))) return true;
    if (clean.endsWith('ed') && this.hasExact(clean.slice(0, -2))) return true;
    if (clean.endsWith('ed') && this.hasExact(clean.slice(0, -1))) return true;
    if (clean.endsWith('ing') && this.hasExact(clean.slice(0, -3))) return true;
    if (clean.endsWith('ing') && this.hasExact(clean.slice(0, -3) + 'e')) return true;
    
    // 'nt
    if (clean.endsWith("n't")) {
      const stem = clean.slice(0, -3);
      if (stem === "do" || stem === "does" || stem === "did" || stem === "ca" || stem === "wo" || stem === "could" || stem === "should" || stem === "would" || stem === "are" || stem === "is" || stem === "were" || stem === "was" || stem === "have" || stem === "has" || stem === "had") {
        return true;
      }
    }
    
    return false;
  }

  suggest(word, limit) {
    const max = typeof limit === "number" && limit > 0 ? limit : 8;
    const original = String(word || "").trim();
    const clean = original.toLowerCase();
    if (!clean || clean.length <= 1) return [];

    const best = new Map();
    const singleDeletes = new Set();
    for (let i = 0; i < clean.length; i++) {
      singleDeletes.add(clean.slice(0, i) + clean.slice(i + 1));
    }

    const isCapitalized = original[0] === original[0].toUpperCase();

    const consider = (cand, bonus) => {
      if (!cand || cand === clean || cand.length < 2) return;
      if (!this.correct(cand)) return;
      const dist = editDistance(clean, cand);
      if (dist > 2) return;
      let score = dist + (typeof bonus === "number" ? bonus : 0);
      
      if (singleDeletes.has(cand)) score -= 0.85;
      if (this.hasExact(cand)) score -= 0.25;
      score += Math.abs(cand.length - clean.length) * 0.08;
      
      const prev = best.get(cand);
      if (prev === undefined || score < prev) best.set(cand, score);
    };

    // 1) Single deletes of the input
    for (const del of singleDeletes) consider(del, -0.1);

    // 2) SymSpell index
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
      consider(t, -2.0);
    }
    
    // 4) Missing apostrophe logic (dont -> don't)
    if (clean.endsWith("nt")) {
        const withApos = clean.slice(0, -2) + "n't";
        consider(withApos, -2.0);
    }
    if (clean.endsWith("s")) {
        const withApos = clean.slice(0, -1) + "'s";
        consider(withApos, -2.0);
    }
    if (clean.endsWith("re")) {
        const withApos = clean.slice(0, -2) + "'re";
        consider(withApos, -2.0);
    }
    if (clean.endsWith("ve")) {
        const withApos = clean.slice(0, -2) + "'ve";
        consider(withApos, -2.0);
    }
    if (clean.endsWith("ll")) {
        const withApos = clean.slice(0, -2) + "'ll";
        consider(withApos, -2.0);
    }

    // Double delete if sparse
    if (clean.length >= 5 && best.size < 3) {
      for (let i = 0; i < clean.length; i++) {
        const one = clean.slice(0, i) + clean.slice(i + 1);
        for (let j = 0; j < one.length; j++) {
          consider(one.slice(0, j) + one.slice(j + 1), 0.15);
        }
      }
    }

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
}

function loadEnglishEngine(dicDir) {
  const path = require("path");
  const dicPath = path.join(dicDir, "en.dic");
  if (!fs.existsSync(dicPath)) {
    console.log("[en-spell] en.dic not found at", dicPath);
    return null;
  }
  return new EnglishSpellEngine(dicPath);
}

module.exports = {
  EnglishSpellEngine,
  loadEnglishEngine,
  editDistance,
};
