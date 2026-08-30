import path from "path";
import fs from "fs";
import { Router } from "express";
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

function loadServerEnDict(): any {
  try {
    const dicDir = path.join(process.cwd(), "dictionaries", "en");
    const dicPath = path.join(dicDir, "en.dic");
    if (!fs.existsSync(dicPath)) {
      console.log(`[spellcheck-server] English dictionary not found at ${dicPath}`);
      console.log("[spellcheck-server] English spellcheck will rely on LanguageTool");
    }
    const engine = loadEnglishEngine(dicDir);
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

const serverArSpell: any = loadArabicEngine(path.join(process.cwd(), "dictionaries", "ar"));
if (serverArSpell && serverArSpell.loaded) {
  console.log(`[spellcheck-server] Arabic dictionary loaded (${serverArSpell.wordCount} words)`);
}
const serverEnSpell: any = loadServerEnDict();

const serverUserDictPath = path.join(process.cwd(), "config", "user_dict.txt");
const serverIgnoredDictPath = path.join(process.cwd(), "config", "ignored_words.txt");

if (fs.existsSync(serverUserDictPath)) {
  loadUserDictionary(serverUserDictPath, serverArSpell, serverEnSpell);
}
if (fs.existsSync(serverIgnoredDictPath)) {
  loadUserDictionary(serverIgnoredDictPath, serverArSpell, serverEnSpell);
}

initLanguageTool().then(() => {
  console.log("[spellcheck-server] LanguageTool initialized");
}).catch((e: any) => {
  console.log(`[spellcheck-server] LanguageTool init failed: ${e && e.message ? e.message : e}`);
});

export function createSpellcheckEngines(): SpellcheckEngines {
  return {
    arSpell: serverArSpell,
    enSpell: serverEnSpell,
    userDictPath: serverUserDictPath,
    ignoredDictPath: serverIgnoredDictPath,
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

  r.post("/spellcheck-words", async (req, res) => {
    const words: string[] = req.body?.words || [];
    if (!Array.isArray(words)) {
      return res.json({ bad: [] });
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
    const word: string = typeof req.body?.word === "string" ? req.body.word.trim() : "";
    if (word) {
      sp.addCustomWord(word, sp.userDictPath, sp.arSpell, sp.enSpell);
    }
    res.json({ ok: true });
  });

  r.post("/spellcheck-ignore-word", (req, res) => {
    const word: string = typeof req.body?.word === "string" ? req.body.word.trim() : "";
    if (word) {
      sp.addCustomWord(word, sp.ignoredDictPath, sp.arSpell, sp.enSpell);
    }
    res.json({ ok: true });
  });

  return r;
}
