import { Router } from "express";
import { addLog } from "../logs.js";
import {
  checkOllama,
  pullOllamaModel,
  resolveActiveProvider,
  generateText,
  warmOllamaLlm,
  warmOllamaEmbed,
  autoComplete,
} from "../ai/providers.js";
import { askVault } from "../services/ask.js";
import type { RouteContext } from "./types.js";

export function aiRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.get("/status", async (_req, res) => {
    const settings = store.getSettings();
    const ollama = await checkOllama(settings.ollama_base_url);
    const active = await resolveActiveProvider(settings);
    const stats = store.stats();
    res.json({
      portable_root: ctx.paths.root,
      ai_provider: settings.ai_provider,
      active_provider: active === "heuristic" ? "heuristic" : active,
      is_ollama_online: ollama.online,
      ollama_models: ollama.models,
      is_gemini_configured: !!settings.gemini_api_key,
      stats: {
        total_saved: stats.total_saved,
        needs_attention: stats.needs_attention,
        total_commands: stats.total_commands,
        total_notes: stats.total_notes,
        total_secrets: stats.total_secrets,
      },
    });
  });

  r.post("/proofread", async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "Text is required" });
    try {
      const settings = store.getSettings();
      const system = "You are an expert bilingual proofreader (Arabic and English). Meticulously correct spelling, grammar, and punctuation errors in the provided text while strictly maintaining markdown formatting, code blocks, technical terms, and original tone. Do not add any conversational filler, explanations, or quotes around the output. Return ONLY the corrected text.";

      const gen = await generateText(settings, text, system);
      if (gen && gen.text && gen.text.trim()) {
        return res.json({ corrected: gen.text.trim(), mode: "ai", provider_used: gen.provider_used });
      }

      // Local Proofread Fallback (CSpell Trie Engine)
      addLog("PROOFREAD", "AI unavailable or returned empty text. Falling back to local CSpell Trie proofreader.");
      const tokens = text.split(/(\s+|[^\w\u0600-\u06FF\u0750-\u077F]+)/);
      let localCorrected = "";
      const sp = ctx.spellcheck;
      for (const token of tokens) {
        if (!token || /^\s+$/.test(token) || token.length <= 1 || /^[^\w\u0600-\u06FF\u0750-\u077F]+$/.test(token)) {
          localCorrected += token;
          continue;
        }
        if (sp?.isArabicToken(token)) {
          if (!sp.checkArabicWord(token, sp.arSpell)) {
            const sugs = await sp.suggestArabicWord(token, sp.arSpell, 1);
            localCorrected += (sugs && sugs[0]) ? sugs[0] : token;
          } else {
            localCorrected += token;
          }
        } else if (sp?.isLatinToken(token)) {
          if (!sp.checkEnglishWord(token, sp.enSpell)) {
            const sugs = await sp.suggestEnglishWord(token, sp.enSpell, 1);
            localCorrected += (sugs && sugs[0]) ? sugs[0] : token;
          } else {
            localCorrected += token;
          }
        } else {
          localCorrected += token;
        }
      }

      res.json({ corrected: localCorrected || text, mode: "local" });
    } catch (e: any) {
      addLog("PROOFREAD", `Failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  r.post("/autocomplete", async (req, res) => {
    const prefix = String(req.body?.prefix ?? "").trim();
    const maxTokens = Number(req.body?.maxTokens) || 64;
    if (!prefix) {
      return res.json({ completion: "", done: true });
    }
    try {
      const settings = store.getSettings();
      const completion = await autoComplete(settings, prefix, maxTokens);
      if (completion) {
        res.json({ completion, done: false });
      } else {
        res.json({ completion: prefix, done: true });
      }
    } catch (e: any) {
      addLog("AUTOCOMPLETE", `Failed: ${e.message}`);
      res.json({ completion: prefix, done: true });
    }
  });

  r.get("/ollama/models", async (_req, res) => {
    const s = store.getSettings();
    const ollama = await checkOllama(s.ollama_base_url);
    res.json(ollama);
  });

  r.post("/ollama/ensure", async (_req, res) => {
    const s = store.getSettings();
    const ollama = await checkOllama(s.ollama_base_url);
    if (!ollama.online) return res.status(503).json({ error: "Ollama is not running" });
    const required = [s.ollama_llm_model, s.ollama_embed_model];
    for (const model of required) {
      const has = ollama.models.some(
        (m) => m === model || m.startsWith(model.split(":")[0])
      );
      if (!has) {
        addLog("OLLAMA", `Pulling model ${model}…`);
        await pullOllamaModel(s, model, (p) => addLog("OLLAMA", p));
      }
    }
    const warmed = await warmOllamaLlm(s);
    const embedWarmed =
      s.ollama_embed_model && s.ollama_embed_model !== s.ollama_llm_model
        ? await warmOllamaEmbed(s)
        : warmed;
    const updated = await checkOllama(s.ollama_base_url);
    res.json({
      status: "success",
      models: updated.models,
      llm_loaded: warmed,
      embed_loaded: embedWarmed,
    });
  });

  r.post("/ollama/warm", async (_req, res) => {
    const s = store.getSettings();
    const ollama = await checkOllama(s.ollama_base_url, true);
    if (!ollama.online) {
      return res
        .status(503)
        .json({ error: "Ollama is not running. Please launch Ollama on your desktop first." });
    }

    if (!ollama.models || ollama.models.length === 0) {
      return res
        .status(400)
        .json({ error: "No installed models found in Ollama. Please run 'ollama pull <model>' first." });
    }

    let targetLlm = s.ollama_llm_model;
    if (!targetLlm || !ollama.models.some((m) => m === targetLlm || m.startsWith(targetLlm) || targetLlm.startsWith(m))) {
      targetLlm = ollama.models[0];
    }

    let targetEmbed = s.ollama_embed_model;
    if (!targetEmbed || !ollama.models.some((m) => m === targetEmbed || m.startsWith(targetEmbed) || targetEmbed.startsWith(m))) {
      targetEmbed = targetLlm;
    }

    const settingsToWarm = { ...s, ollama_llm_model: targetLlm, ollama_embed_model: targetEmbed };
    const ok = await warmOllamaLlm(settingsToWarm);
    const embedOk =
      targetEmbed && targetEmbed !== targetLlm
        ? await warmOllamaEmbed(settingsToWarm)
        : ok;

    if (!ok && !embedOk) {
      return res.status(500).json({
        error: `Could not load Ollama model '${targetLlm}'. Check if Ollama service is responsive.`,
      });
    }

    res.json({
      status: "success",
      model: targetLlm,
      embed_model: targetEmbed,
      embed_loaded: embedOk,
    });
  });

  r.post("/ask", async (req, res) => {
    const query = String(req.body?.query ?? "").trim();
    if (!query) return res.status(400).json({ error: "Query is required" });
    try {
      const result = await askVault(
        store,
        store.getSettings(),
        query,
        Number(req.body?.limit) || 12
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post("/rewrite", async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    const style = String(req.body?.style ?? "professional") as
      | "human"
      | "professional"
      | "technical"
      | "concise"
      | "formal"
      | "casual";
    if (!text) return res.status(400).json({ error: "Text is required" });

    const stylePrompts: Record<string, string> = {
      human: "Rewrite the following text to sound natural, warm, and conversational — like a real person wrote it. Avoid robotic phrasing. Keep the meaning intact but make it flow naturally.",
      professional: "Rewrite the following text in a professional, polished tone suitable for business communication. Be clear, confident, and concise.",
      technical: "Rewrite the following text in a precise technical style. Use exact terminology, be concise, and prioritize clarity over flair.",
      concise: "Rewrite the following text to be as short and clear as possible. Remove all fluff, redundancy, and unnecessary words while keeping the core meaning.",
      formal: "Rewrite the following text in formal, academic-style language. Use proper grammar, avoid contractions, and maintain a serious tone.",
      casual: "Rewrite the following text in a relaxed, casual tone. Use friendly language, contractions, and a conversational feel.",
    };

    const systemPrompt = stylePrompts[style] ?? stylePrompts.professional;

    try {
      const result = await generateText(store.getSettings(), text, systemPrompt);
      if (!result) {
        return res.status(503).json({
          error: "No AI provider available for rewriting. Configure Ollama or Gemini in Settings.",
        });
      }
      res.json({
        original: text,
        rewritten: result.text,
        style,
        provider_used: result.provider_used,
      });
    } catch (e: any) {
      addLog("REWRITE", `Rewrite failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  return r;
}
