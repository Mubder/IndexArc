import { z } from "zod";

// Request-body schemas, one per POST/PUT/PATCH route (ASVS 13.2.2), keyed
// "METHOD /path" exactly as written in each router. Fields are optional
// unless a handler cannot work without them; handlers keep their own
// messages for missing values. What the schemas add: the body must be an
// object, and each known field must have the right type and a sane size.
// The JSON parser already caps a whole body at 2 MB.

const s = (max: number) => z.string().max(max);
const opt = <T extends z.ZodType>(t: T) => t.nullish();
const obj = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);
const anyBody = obj({});

const PASSWORD = s(1024);
const ID = s(256);
const TEXT = s(2_000_000);
const NUM = z.number().nullish(); // NaN from the client arrives as null
const strList = (maxItems: number, maxLen = 512) => z.array(s(maxLen)).max(maxItems);
const FAMILY = z.enum(["secret", "command", "note", "unknown"]);
const DECISION = z.enum(["pending", "save", "park", "discard"]);

const candidate = {
  value: opt(TEXT),
  type: opt(s(256)),
  name: opt(s(1024)),
  raw_fragment: opt(TEXT),
  labels: opt(strList(200)),
  type_aliases: opt(strList(200)),
  family: opt(FAMILY),
  notes: opt(TEXT),
  source_file: opt(s(4096)),
  temp_id: opt(ID),
};
const candidates = z.array(obj(candidate));

export const BODIES = {
  app: {
    "POST /api/analyze": obj({ paste: opt(TEXT), content: opt(TEXT) }),
  },
  vault: {
    "POST /unlock": obj({ password: opt(PASSWORD) }),
    "POST /lock": anyBody,
    "POST /setup-password": obj({ password: opt(PASSWORD), confirm_word: opt(s(256)) }),
    "POST /remove-password": obj({ password: opt(PASSWORD) }),
    "POST /change-password": obj({ current_password: opt(PASSWORD), new_password: opt(PASSWORD) }),
    "POST /recovery": obj({ password: opt(PASSWORD) }),
    "POST /recovery/remove": anyBody,
    "POST /recover": obj({ recovery_code: opt(s(512)), new_password: opt(PASSWORD) }),
  },
  entries: {
    "POST /save": obj({ ...candidate, paste_id: opt(ID), candidates: opt(candidates), items: opt(candidates) }),
    "POST /park": obj({ ...candidate, paste_id: opt(ID), candidates: opt(candidates) }),
    "PATCH /:id/hygiene": obj({
      expires_at: z.union([s(64), z.number(), z.null()]).optional(),
      rotate_every_days: z.union([z.number(), s(16), z.null()]).optional(),
    }),
    "PATCH /:id": obj({
      type: opt(s(256)),
      name: opt(s(1024)),
      notes: opt(TEXT),
      labels: opt(strList(200)),
      family: opt(FAMILY),
      value: opt(TEXT),
    }),
    "POST /bulk-delete": obj({ ids: opt(z.array(ID).max(100_000)) }),
    "POST /check-duplicate": obj({ value: opt(TEXT), name: opt(s(1024)) }),
  },
  cli: {
    "POST /tokens": obj({ name: opt(s(200)), password: opt(PASSWORD) }),
    "POST /tokens/:id/revoke": anyBody,
    "POST /env": obj({ names: opt(strList(10_000, 256)), label: opt(s(200)), all: opt(z.boolean()) }),
  },
  porting: {
    "POST /import/preview": obj({ content: opt(TEXT), filename: opt(s(1024)), format: opt(s(64)), passphrase: opt(PASSWORD) }),
    "POST /export": obj({ format: opt(s(64)), password: opt(PASSWORD), passphrase: opt(PASSWORD), ids: opt(z.array(ID).max(100_000)) }),
  },
  settings: {
    "POST /settings": obj({
      ai_provider: opt(s(64)),
      ollama_base_url: opt(s(2048)),
      ollama_llm_model: opt(s(512)),
      ollama_embed_model: opt(s(512)),
      gemini_api_key: opt(s(4096)),
      gemini_llm_model: opt(s(512)),
      gemini_embed_model: opt(s(512)),
      openai_api_key: opt(s(4096)),
      openai_llm_model: opt(s(512)),
      groq_api_key: opt(s(4096)),
      groq_llm_model: opt(s(512)),
      openrouter_api_key: opt(s(4096)),
      openrouter_llm_model: opt(s(512)),
      anthropic_api_key: opt(s(4096)),
      anthropic_llm_model: opt(s(512)),
      local_openai_base_url: opt(s(2048)),
      local_openai_api_key: opt(s(4096)),
      local_openai_llm_model: opt(s(512)),
      local_openai_embed_model: opt(s(512)),
      ui_language: opt(z.enum(["en", "ar"])),
      font_size_en: NUM,
      font_size_ar: NUM,
      enable_live_spellcheck: opt(z.boolean()),
      enable_ai_proofreader: opt(z.boolean()),
      auto_lock_minutes: NUM,
      lock_on_minimize: opt(z.boolean()),
      clipboard_clear_seconds: NUM,
      update_check_on_start: opt(z.boolean()),
      crash_reports_enabled: opt(z.boolean()),
      ai_cloud_consent: opt(z.boolean()),
      languagetool_enabled: opt(z.boolean()),
      llm_provider_override: opt(s(64)),
      embed_provider_override: opt(s(64)),
    }),
  },
  folders: {
    "POST /scan": obj({ path: opt(s(4096)), use_ai: opt(z.boolean()), watch: opt(z.boolean()) }),
    "PATCH /sessions/:id/candidates": obj({
      ...candidate,
      decision: opt(DECISION),
      candidates: opt(z.array(obj({ ...candidate, decision: opt(DECISION) }))),
    }),
    "POST /sessions/:id/apply": anyBody,
    "POST /sessions/:id/discard": anyBody,
  },
  misc: {
    "POST /diagnostics/crash": obj({ message: opt(TEXT), stack: opt(TEXT) }),
    "POST /emergency/create": anyBody,
    "POST /emergency/restore": obj({ name: opt(s(512)) }),
    "POST /scratchpad/tabs/:id/revisions": obj({
      id: opt(ID),
      timestamp: NUM,
      title: opt(s(10_000)),
      content: opt(TEXT),
      charCount: NUM,
      wordCount: NUM,
      reason: opt(s(256)),
    }),
    "POST /scratchpad/tabs/:id/content": obj({ content: opt(TEXT), base_rev: NUM, title: opt(s(10_000)) }),
    "POST /scratchpad/tabs/:id/meta": obj({ title: opt(s(10_000)) }),
    "POST /scratchpad/tabs/:id/protect": obj({ protected: opt(z.boolean()), confirm_word: opt(s(256)), password: opt(PASSWORD) }),
    "POST /scratchpad/tabs/:id/pin": obj({ pinned: opt(z.boolean()) }),
    "PUT /scratchpad/order": obj({ ids: opt(z.array(ID).max(100_000)) }),
    "POST /scratchpad": obj({
      tabs: opt(z.array(obj({ id: opt(ID) }))),
      force: opt(z.boolean()),
      base_revs: opt(z.record(z.string(), z.number().nullable())),
    }),
    "POST /scratchpad/archive-tab": obj({ tabId: opt(ID), tab: opt(obj({ id: opt(ID) })) }),
    "POST /scratchpad/restore-tab": obj({ tabId: opt(ID) }),
    "POST /scratchpad/delete-archived": obj({ tabId: opt(ID) }),
  },
  ai: {
    "POST /proofread": obj({ text: opt(TEXT), tab_id: opt(ID) }),
    "POST /autocomplete": obj({ prefix: opt(TEXT), maxTokens: NUM, tab_id: opt(ID) }),
    "POST /ollama/ensure": anyBody,
    "POST /ollama/warm": anyBody,
    "POST /ask": obj({ query: opt(s(100_000)), limit: NUM }),
    "POST /rewrite": obj({ text: opt(TEXT), style: opt(s(64)), tab_id: opt(ID) }),
  },
  spellcheck: {
    "POST /spellcheck-words": obj({ words: opt(strList(50_000, 256)) }),
    "POST /spellcheck-suggest": obj({ word: opt(s(256)) }),
    "POST /spellcheck-add-word": obj({ word: opt(s(256)) }),
    "POST /spellcheck-ignore-word": obj({ word: opt(s(256)) }),
  },
  sse: {
    "POST /sse/ticket": anyBody,
  },
} as const;
