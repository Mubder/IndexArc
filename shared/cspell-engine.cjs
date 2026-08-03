/**
 * Production CSpell Trie Spellcheck Engine.
 * Uses cspell-lib + compressed binary tries (ar.trie.gz + en_US trie + developer terms).
 */

"use strict";

const path = require("path");
const fs = require("fs");

let cspellModule = null;
let cspellConfig = null;
const customUserWords = new Set([
  "checkpointer",
  "hardcoded",
  "hardcode",
  "scratchpad",
  "scratchpads",
  "proofread",
  "proofreader",
  "proofreading",
  "autocompletion",
  "indexarc",
  "repo",
  "repos",
  "github",
  "gitlab",
  "subagent",
  "prompt",
  "prompts",
  "ollama",
  "openai",
  "chatgpt",
  "gemini",
  "anthropic",
  "claude",
  "javascript",
  "typescript",
  "nodejs",
  "powershell",
  "docker",
]);

async function loadCSpellModule() {
  if (!cspellModule) {
    cspellModule = await import("cspell-lib");
  }
  return cspellModule;
}

function findArabicTriePath() {
  const candidates = [
    path.join(__dirname, "..", "dictionaries", "ar_trie", "package", "ar.trie.gz"),
    path.join(process.cwd(), "dictionaries", "ar_trie", "package", "ar.trie.gz"),
    path.join(__dirname, "..", "ar.trie.gz"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function initCSpellEngine() {
  if (cspellConfig) return true;
  try {
    const cspell = await loadCSpellModule();
    const arTriePath = findArabicTriePath();

    const dictDefs = [];
    const dictList = ["en_US", "softwareTerms"];

    if (arTriePath) {
      dictDefs.push({
        name: "arabic-trie",
        path: arTriePath,
      });
      dictList.push("arabic-trie");
      console.log(`[cspell-engine] Arabic trie dictionary found at ${arTriePath}`);
    } else {
      console.log("[cspell-engine] Arabic trie dictionary not found, using default dictionaries");
    }

    cspellConfig = {
      language: "en,ar",
      dictionaryDefinitions: dictDefs,
      dictionaries: dictList,
      userWords: Array.from(customUserWords),
      flagWords: [],
      ignoreWords: [],
    };

    console.log("[cspell-engine] CSpell Trie Engine initialized successfully");
    return true;
  } catch (e) {
    console.log(`[cspell-engine] CSpell initialization failed: ${e && e.message ? e.message : e}`);
    return false;
  }
}

function addCustomWord(word) {
  if (!word || typeof word !== "string") return;
  const clean = word.trim();
  if (clean.length < 2) return;
  customUserWords.add(clean);
  customUserWords.add(clean.toLowerCase());
  if (cspellConfig) {
    cspellConfig.userWords = Array.from(customUserWords);
  }
}

async function isWordCorrect(word, lang = "en,ar") {
  if (!word || typeof word !== "string") return true;
  const clean = word.trim();
  if (clean.length <= 1) return true;
  if (customUserWords.has(clean) || customUserWords.has(clean.toLowerCase())) return true;

  // Numbers, uppercase acronyms, camelCase code symbols
  if (/^\d+$/.test(clean) || /^[A-Z]{2,6}$/.test(clean)) return true;
  if (/[a-z][A-Z]/.test(clean) || /[A-Z]{2,}[a-z]/.test(clean)) return true;

  try {
    const cspell = await loadCSpellModule();
    await initCSpellEngine();

    const doc = cspell.createTextDocument({
      uri: "input.txt",
      content: clean,
      languageId: "plaintext",
    });

    const activeConfig = {
      ...cspellConfig,
      language: lang || "en,ar",
    };

    const res = await cspell.spellCheckDocument(doc, { validate: true }, activeConfig);
    return res.issues.length === 0;
  } catch (e) {
    return true;
  }
}

async function getSuggestions(word, limit = 6, lang = "en,ar") {
  if (!word || typeof word !== "string") return [];
  const clean = word.trim();
  if (clean.length <= 1) return [];

  // Common phonetic Arabic tanween fixes before Trie lookup
  if (/[\u0600-\u06FF]/.test(clean)) {
    if (clean === "شكرن") return ["شكراً", "شكرا", "شكرًا"];
    if (clean === "أهلن" || clean === "اهلن") return ["أهلاً", "أهلا", "أهلًا"];
  }

  try {
    const cspell = await loadCSpellModule();
    await initCSpellEngine();

    const activeConfig = {
      ...cspellConfig,
      language: lang || "en,ar",
    };

    const numSuggestions = typeof limit === "number" && limit > 0 ? limit : 6;
    const res = await cspell.suggestionsForWord(clean, { numSuggestions }, activeConfig);

    const sugs = (res.suggestions || [])
      .map((s) => s.word)
      .filter((w) => w && w.toLowerCase() !== clean.toLowerCase());

    const unique = Array.from(new Set(sugs));
    return unique.slice(0, numSuggestions);
  } catch (e) {
    console.log(`[cspell-engine] Suggestion failed for "${word}": ${e && e.message ? e.message : e}`);
    return [];
  }
}

async function batchFindMisspelled(words, lang = "en,ar") {
  if (!Array.isArray(words) || words.length === 0) return [];
  const bad = [];
  const seen = new Set();

  for (const w of words) {
    if (typeof w !== "string") continue;
    const clean = w.trim();
    if (!clean || clean.length <= 1 || seen.has(clean)) continue;
    seen.add(clean);

    const ok = await isWordCorrect(clean, lang);
    if (!ok) {
      bad.push(clean);
    }
  }

  return bad;
}

module.exports = {
  initCSpellEngine,
  addCustomWord,
  isWordCorrect,
  getSuggestions,
  batchFindMisspelled,
};
