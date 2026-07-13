/** Freeform type string — not a closed enum */
export type EntryStatus =
  | "saved"
  | "needs_name"
  | "needs_type"
  | "needs_review";

export interface VaultEntry {
  id: string;
  /** The important extracted value */
  value: string;
  /** Freeform type e.g. "telegram user id", "Hermes profile id" */
  type: string;
  /** Required for secrets/tokens/ids — always named when saved */
  name: string;
  /** Original fragment from paste */
  raw_fragment: string;
  /** Full original paste session id for grouping multi-extract */
  paste_id?: string;
  labels: string[];
  /** Normalized aliases for bilingual / fuzzy type match */
  type_aliases: string[];
  status: EntryStatus;
  /** note | command | secret — coarse family for UI */
  family: "secret" | "command" | "note" | "unknown";
  created_at: string;
  updated_at: string;
  notes?: string;
  /** Origin file when extracted from folder scan */
  source_file?: string;
}

export interface VectorChunk {
  id: string;
  entry_id: string;
  text: string;
  embedding: number[] | null;
  metadata: {
    name: string;
    type: string;
    family: string;
    value_preview: string;
  };
}

export type AIProviderMode =
  | "auto"
  | "local"
  | "api"
  | "openai"
  | "groq"
  | "openrouter"
  | "anthropic"
  | "local_openai";

export interface AppSettings {
  ai_provider: AIProviderMode;
  ollama_base_url: string;
  ollama_llm_model: string;
  ollama_embed_model: string;
  gemini_api_key: string;
  gemini_llm_model: string;
  gemini_embed_model: string;
  openai_api_key: string;
  openai_llm_model: string;
  groq_api_key: string;
  groq_llm_model: string;
  openrouter_api_key: string;
  openrouter_llm_model: string;
  anthropic_api_key: string;
  anthropic_llm_model: string;
  local_openai_base_url: string;
  local_openai_api_key: string;
  local_openai_llm_model: string;
  ui_language: "en" | "ar" | "both";
  bind_host: string;
  port: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: "auto",
  ollama_base_url: "http://127.0.0.1:11434",
  ollama_llm_model: "qwen2.5:0.5b",
  ollama_embed_model: "nomic-embed-text",
  gemini_api_key: "",
  gemini_llm_model: "gemini-2.0-flash",
  gemini_embed_model: "text-embedding-004",
  openai_api_key: "",
  openai_llm_model: "gpt-4o-mini",
  groq_api_key: "",
  groq_llm_model: "llama-3.3-70b-versatile",
  openrouter_api_key: "",
  openrouter_llm_model: "meta-llama/llama-3.3-70b-instruct",
  anthropic_api_key: "",
  anthropic_llm_model: "claude-3-5-haiku-latest",
  local_openai_base_url: "http://127.0.0.1:1234/v1",
  local_openai_api_key: "",
  local_openai_llm_model: "meta-llama-3-8b-instruct",
  ui_language: "both",
  bind_host: "127.0.0.1",
  port: 3000,
};

export interface AnalyzeCandidate {
  temp_id: string;
  value: string;
  type: string;
  name: string;
  raw_fragment: string;
  labels: string[];
  type_aliases: string[];
  family: "secret" | "command" | "note" | "unknown";
  confidence: number;
  /** Why it needs user input */
  needs_type: boolean;
  needs_name: boolean;
  ready: boolean;
  model_notes?: string;
  /** Absolute path of source file when from folder scan */
  source_file?: string;
  source_name?: string;
  /** User decision in a scan review session */
  decision?: "pending" | "save" | "park" | "discard";
}

export interface SkippedFile {
  path: string;
  name: string;
  reason: string;
}

export interface ProcessedFile {
  path: string;
  name: string;
  size: number;
  candidates_found: number;
  ready: number;
  needs_review: number;
}

export interface FolderScanSummary {
  folder_path: string;
  files_found: number;
  files_processed: number;
  files_skipped: number;
  candidates_total: number;
  candidates_ready: number;
  candidates_needs_review: number;
  candidates_discarded: number;
  provider_used: string;
  duration_ms: number;
}

export interface FolderScanSession {
  id: string;
  folder_path: string;
  created_at: string;
  updated_at: string;
  status: "review" | "committed" | "discarded";
  watching: boolean;
  summary: FolderScanSummary;
  processed_files: ProcessedFile[];
  skipped_files: SkippedFile[];
  candidates: AnalyzeCandidate[];
  brief: string;
}

export interface WatchedFolder {
  id: string;
  path: string;
  watching: boolean;
  last_scan_id?: string;
  last_scan_at?: string;
  created_at: string;
}

export interface AnalyzeResult {
  paste_id: string;
  raw_paste: string;
  candidates: AnalyzeCandidate[];
  provider_used: string;
}

export interface AskResultItem {
  entry: VaultEntry;
  score: number;
  match_reason: string;
}

export interface SystemStatus {
  portable_root: string;
  ai_provider: AIProviderMode;
  active_provider: "local" | "api" | "heuristic" | "none";
  is_ollama_online: boolean;
  ollama_models: string[];
  is_gemini_configured: boolean;
  stats: {
    total_saved: number;
    needs_attention: number;
    total_commands: number;
    total_notes: number;
    total_secrets: number;
  };
}
