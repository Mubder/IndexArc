import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Router } from "express";
import type { PortablePaths } from "../paths.js";
import type { RouteContext, SpellcheckEngines } from "./types.js";

// Spellcheck helpers imported at route-init time (must match server.ts CJS import)
import spellcheckHelpers from "../../shared/spellcheck.cjs";
const {
  findMisspelled,
  loadArabicEngine,
  suggestArabicWord,
  suggestEnglishWord,
  isArabicToken,
  loadUserDictionary,
  addCustomWord,
  loadEnglishEngine,
  initLanguageTool,
  checkArabicWord,
  checkEnglishWord,
  isLatinToken,
} = spellcheckHelpers as any;

// Dictionaries are read-only APP assets: they ship with the bundle, not with
// the vault root. Resolve relative to this module first, with cwd kept as the
// last-resort fallback. The previous process.cwd()-only resolution broke
// packaged/USB launches started from a different working directory (AUD-012).
//
// Dual-environment on purpose: the esbuild CJS bundle makes `import.meta.url`
// EMPTY (it warns at build time), but gives us native `__dirname`; tsx dev
// mode is ESM and has no `__dirname` but a real `import.meta.url`. Try both.
function thisModuleDir(): string | null {
  try {
    if (typeof __dirname === "string" && __dirname) return __dirname; // CJS bundle
  } catch {}
  try {
    return path.dirname(fileURLToPath(new URL(".", import.meta.url))); // ESM (tsx dev)
  } catch {
    return null;
  }
}

function resolveDictDir(): string {
  const moduleDir = thisModuleDir();
  const candidates = [
    process.env.INDEXARC_DICT_DIR,
    moduleDir ? path.resolve(moduleDir, "..", "..", "dictionaries") : null,
    moduleDir ? path.resolve(moduleDir, "..", "dictionaries") : null,
    path.join(process.cwd(), "dictionaries"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, "en")) || fs.existsSync(path.join(c, "ar"))) return c;
    } catch {}
  }
  return candidates[candidates.length - 1] || path.join(process.cwd(), "dictionaries");
}

function loadServerEnDict(dicDir: string): any {
  try {
    const enDir = path.join(dicDir, "en");
    const dicPath = path.join(enDir, "en.dic");
    if (!fs.existsSync(dicPath)) {
      console.log(`[spellcheck-server] English dictionary not found at ${dicPath}`);
      console.log("[spellcheck-server] English spellcheck will rely on LanguageTool");
    }
    const engine = loadEnglishEngine(enDir);
    if (engine && engine.loaded) {
      console.log(`[spellcheck-server] English dictionary loaded (${engine.wordCount} words)`);
    } else if (engine) {
      console.log("[spellcheck-server] English engine loaded but dictionary not ready");
    }
    return engine;
  } catch (e: any) {
    console.log(`[spellcheck-server] English dictionary load failed: ${e && e.message ? e.message : e}`);
    return null;
  }
}

// Lazy, PORTABLE-ROOT-aware engine construction: the user dictionary is user
// data and must live under the vault root's config dir — writing it under
// process.cwd() split "saved" words across roots on packaged launches.
export function createSpellcheckEngines(paths?: PortablePaths): SpellcheckEngines {
  const dictDir = resolveDictDir();
  const arSpell: any = loadArabicEngine(path.join(dictDir, "ar"));
  if (arSpell && arSpell.loaded) {
    console.log(`[spellcheck-server] Arabic dictionary loaded (${arSpell.wordCount} words)`);
  }
  const enSpell: any = loadServerEnDict(dictDir);

  // Prefer the portable root's config dir; fall back to cwd only when no
  // paths are provided (keeps the function usable in isolation).
  const configDir = paths ? paths.configDir : path.join(process.cwd(), "config");
  const userDictPath = path.join(configDir, "user_dict.txt");
  const ignoredDictPath = path.join(configDir, "ignored_words.txt");

  if (fs.existsSync(userDictPath)) {
    loadUserDictionary(userDictPath, arSpell, enSpell);
  }
  if (fs.existsSync(ignoredDictPath)) {
    loadUserDictionary(ignoredDictPath, arSpell, enSpell);
  }

  initLanguageTool().then(() => {
    console.log("[spellcheck-server] LanguageTool initialized");
  }).catch((e: any) => {
    console.log(`[spellcheck-server] LanguageTool init failed: ${e && e.message ? e.message : e}`);
  });

  return {
    arSpell,
    enSpell,
    userDictPath,
    ignoredDictPath,
    findMisspelled,
    suggestArabicWord,
    suggestEnglishWord,
    isArabicToken,
    isLatinToken,
    addCustomWord,
    checkArabicWord,
    checkEnglishWord,
  };
}

export function spellcheckRoutes(ctx: RouteContext) {
  const r = Router();
  const sp = ctx.spellcheck!;

  // Batch endpoints do per-word work (one LT HTTP call or one cspell document
  // each) — cap the request so a single oversized body can't pin the server
  // for minutes (AUD brief).
  const MAX_WORDS = 500;

  // A dictionary line must be a single word: reject newlines (file injection),
  // comment markers and oversized tokens before anything reaches disk.
  const cleanDictWord = (raw: unknown): string => {
    if (typeof raw !== "string") return "";
    const w = raw.trim();
    if (!w || w.length > 64) return "";
    if (/[\r\n]/.test(w) || w.startsWith("#")) return "";
    return w;
  };

  r.post("/spellcheck-words", async (req, res) => {
    const words: string[] = req.body?.words || [];
    if (!Array.isArray(words)) {
      return res.json({ bad: [] });
    }
    if (words.length > MAX_WORDS) {
      return res.status(413).json({ error: `Too many words (max ${MAX_WORDS} per request)` });
    }
    const bad = await sp.findMisspelled(words, sp.arSpell, sp.enSpell);
    res.json({ bad });
  });

  r.post("/spellcheck-suggest", async (req, res) => {
    const word: string = typeof req.body?.word === "string" ? req.body.word.trim() : "";
    if (!word) {
      return res.json({ suggestions: [] });
    }
    if (sp.isArabicToken(word)) {
      const suggestions = await sp.suggestArabicWord(word, sp.arSpell, 8);
      return res.json({ suggestions });
    }
    const suggestions = await sp.suggestEnglishWord(word, sp.enSpell, 6);
    res.json({ suggestions });
  });

  r.post("/spellcheck-add-word", (req, res) => {
    const word = cleanDictWord(req.body?.word);
    if (word) {
      sp.addCustomWord(word, sp.userDictPath, sp.arSpell, sp.enSpell);
    }
    res.json({ ok: !!word });
  });

  r.post("/spellcheck-ignore-word", (req, res) => {
    const word = cleanDictWord(req.body?.word);
    if (word) {
      sp.addCustomWord(word, sp.ignoredDictPath, sp.arSpell, sp.enSpell);
    }
    res.json({ ok: !!word });
  });

  return r;
}
