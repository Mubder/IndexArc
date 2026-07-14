export interface VaultEntry {
  id: string;
  value: string;
  type: string;
  name: string;
  raw_fragment: string;
  labels: string[];
  type_aliases: string[];
  status: "saved" | "needs_name" | "needs_type" | "needs_review";
  family: "secret" | "command" | "note" | "unknown";
  created_at: string;
  updated_at: string;
  notes?: string;
}

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
  needs_type: boolean;
  needs_name: boolean;
  ready: boolean;
  model_notes?: string;
}

export interface SystemStatus {
  portable_root: string;
  ai_provider: string;
  active_provider: string;
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

export interface Settings {
  ai_provider: string;
  ollama_base_url: string;
  ollama_llm_model: string;
  ollama_embed_model: string;
  gemini_api_key: string;
  gemini_llm_model: string;
  gemini_embed_model: string;
  openai_api_key?: string;
  openai_llm_model?: string;
  groq_api_key?: string;
  groq_llm_model?: string;
  openrouter_api_key?: string;
  openrouter_llm_model?: string;
  anthropic_api_key?: string;
  anthropic_llm_model?: string;
  local_openai_base_url?: string;
  local_openai_api_key?: string;
  local_openai_llm_model?: string;
  ui_language: "en" | "ar";
}

export type Tab = "home" | "paste" | "folders" | "library" | "ask" | "settings" | "logs";

export type LibraryFilter = "all" | "secret" | "command" | "note" | "unknown" | "attention";

export interface ScanCandidate extends AnalyzeCandidate {
  source_file?: string;
  source_name?: string;
  decision?: "pending" | "save" | "park" | "discard";
}

export interface FolderScanSession {
  id: string;
  folder_path: string;
  created_at: string;
  status: "review" | "committed" | "discarded";
  watching: boolean;
  brief: string;
  summary: {
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
  };
  processed_files: {
    path: string;
    name: string;
    size: number;
    candidates_found: number;
    ready: number;
    needs_review: number;
  }[];
  skipped_files: { path: string; name: string; reason: string }[];
  candidates: ScanCandidate[];
}

export interface WatchedFolderRow {
  id: string;
  path: string;
  watching: boolean;
  live?: boolean;
  last_scan_at?: string;
}

export interface LogEntry {
  time: string;
  type: string;
  message: string;
}

export type RewriteStyle = "human" | "professional" | "technical" | "concise" | "formal" | "casual";

export interface RewriteRequest {
  text: string;
  style: RewriteStyle;
  language?: "en" | "ar" | "auto";
}

export interface RewriteResult {
  original: string;
  rewritten: string;
  style: RewriteStyle;
  provider_used: string;
}

export interface DuplicateCheck {
  is_duplicate: boolean;
  existing_entry?: VaultEntry;
  match_type: "exact_value" | "similar_name" | "same_source";
}
