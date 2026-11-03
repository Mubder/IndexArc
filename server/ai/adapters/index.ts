import { anthropicAdapter } from "./anthropic.js";
import { geminiAdapter } from "./gemini.js";
import { ollamaAdapter } from "./ollama.js";
import { groqAdapter, localOpenAiAdapter, openaiAdapter, openrouterAdapter } from "./openaiCompatible.js";
import type { ProviderAdapter, ProviderId } from "./types.js";

export type { ActiveProvider, GenerateMode, GenerateRequest, ProviderAdapter, ProviderId } from "./types.js";

/**
 * Every provider, in "auto" preference order (local first). Adding a
 * provider = one adapter file + one line here + its settings fields/UI.
 */
export const ADAPTERS: readonly ProviderAdapter[] = [
  ollamaAdapter,
  geminiAdapter,
  openaiAdapter,
  groqAdapter,
  openrouterAdapter,
  anthropicAdapter,
  localOpenAiAdapter,
];

const BY_ID = new Map<string, ProviderAdapter>(ADAPTERS.map((a) => [a.id, a]));

/** The adapter for a provider id, or undefined (e.g. "heuristic", "auto"). */
export function getAdapter(id: string | undefined | null): ProviderAdapter | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isProviderId(id: string): id is ProviderId {
  return BY_ID.has(id);
}
