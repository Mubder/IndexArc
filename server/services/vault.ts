import type { VaultStore } from "../store.js";
import type {
  AnalyzeCandidate,
  AppSettings,
  EntryStatus,
  VaultEntry,
} from "../types.js";
import { analyzePaste, embedText, resolveActiveProvider } from "../ai/providers.js";
import { addLog } from "../logs.js";
import { randomUUID } from "crypto";

function statusFromCandidate(c: AnalyzeCandidate): EntryStatus {
  if (c.needs_type && c.needs_name) return "needs_review";
  if (c.needs_type) return "needs_type";
  if (c.needs_name) return "needs_name";
  return "saved";
}

function indexText(entry: VaultEntry): string {
  return [
    entry.name,
    entry.type,
    entry.value,
    entry.labels.join(" "),
    entry.type_aliases.join(" "),
    entry.raw_fragment,
    entry.notes || "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function indexEntry(
  store: VaultStore,
  settings: AppSettings,
  entry: VaultEntry
) {
  const active = await resolveActiveProvider(settings);
  const text = indexText(entry);
  const embedding = await embedText(settings, text, active);
  store.upsertVector({
    id: `entry_${entry.id}`,
    entry_id: entry.id,
    text: text.slice(0, 4000),
    embedding,
    metadata: {
      name: entry.name,
      type: entry.type,
      family: entry.family,
      value_preview: entry.value.slice(0, 12),
    },
  });
}

export async function runAnalyze(store: VaultStore, settings: AppSettings, paste: string) {
  const paste_id = randomUUID();
  const { candidates, provider_used } = await analyzePaste(paste, settings);
  addLog(
    "ANALYZE",
    `Extracted ${candidates.length} candidate(s) via ${provider_used} (paste ${paste_id.slice(0, 8)})`
  );
  return {
    paste_id,
    raw_paste: paste,
    candidates,
    provider_used,
  };
}

export interface SaveCandidateInput {
  value: string;
  type: string;
  name: string;
  raw_fragment?: string;
  labels?: string[];
  type_aliases?: string[];
  family?: VaultEntry["family"];
  notes?: string;
  paste_id?: string;
  source_file?: string;
  /** force into needs_* if incomplete */
  allow_incomplete?: boolean;
}

export async function saveCandidate(
  store: VaultStore,
  settings: AppSettings,
  input: SaveCandidateInput
): Promise<VaultEntry> {
  const type = (input.type || "").trim();
  const name = (input.name || "").trim();
  const family = input.family || (type ? "secret" : "unknown");

  let status: EntryStatus = "saved";
  let finalFamily = family;

  const isSecretLike = family === "secret" || family === "unknown";
  if (isSecretLike) {
    if (!type && !name) status = "needs_review";
    else if (!type) status = "needs_type";
    else if (!name) status = "needs_name";
    if (!type) finalFamily = "unknown";
  } else if (family === "command") {
    status = "saved";
    finalFamily = "command";
  } else {
    status = "saved";
    finalFamily = "note";
  }

  if (!input.allow_incomplete && status !== "saved" && isSecretLike) {
    // still save as incomplete for Unidentified inbox
  }

  // duplicate name warning handled by caller; we allow save
  const entry = store.createEntry({
    value: input.value,
    type: type || "unidentified",
    name: name || "unnamed",
    raw_fragment: input.raw_fragment || input.value,
    paste_id: input.paste_id,
    labels: input.labels || [],
    type_aliases: input.type_aliases || (type ? [type] : []),
    status,
    family: finalFamily,
    notes: input.notes,
    source_file: input.source_file,
  });

  if (status === "saved") {
    await indexEntry(store, settings, entry);
    addLog("VAULT", `Saved "${entry.name}" (${entry.type})`);
  } else {
    addLog(
      "VAULT",
      `Parked incomplete entry → ${status} (${mask(entry.value)})`
    );
  }

  return entry;
}

function mask(v: string) {
  if (v.length <= 6) return "***";
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

export async function clarifyEntry(
  store: VaultStore,
  settings: AppSettings,
  id: string,
  patch: { type?: string; name?: string; notes?: string; labels?: string[] }
): Promise<VaultEntry | null> {
  const existing = store.getEntry(id);
  if (!existing) return null;

  const type = (patch.type ?? existing.type).trim();
  const name = (patch.name ?? existing.name).trim();
  let status: EntryStatus = "saved";
  let family = existing.family;

  if (!type || type === "unidentified") status = "needs_type";
  else if (!name || name === "unnamed") status = "needs_name";
  else status = "saved";

  if (status === "saved" && (family === "unknown" || !family)) {
    family = "secret";
  }

  const aliases = new Set([
    ...existing.type_aliases,
    type,
    type.toLowerCase(),
  ]);

  const updated = store.updateEntry(id, {
    type: type || existing.type,
    name: name || existing.name,
    notes: patch.notes ?? existing.notes,
    labels: patch.labels ?? existing.labels,
    type_aliases: [...aliases],
    status,
    family,
  });

  if (updated && updated.status === "saved") {
    await indexEntry(store, settings, updated);
    addLog("VAULT", `Clarified → saved "${updated.name}" (${updated.type})`);
  }
  return updated;
}

export async function saveMany(
  store: VaultStore,
  settings: AppSettings,
  paste_id: string,
  candidates: SaveCandidateInput[]
): Promise<VaultEntry[]> {
  const out: VaultEntry[] = [];
  for (const c of candidates) {
    out.push(await saveCandidate(store, settings, { ...c, paste_id }));
  }
  return out;
}
