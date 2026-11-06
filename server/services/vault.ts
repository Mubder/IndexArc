import type { VaultStore } from "../store.js";
import type {
  AnalyzeCandidate,
  AppSettings,
  EntryStatus,
  VaultEntry,
} from "../types.js";
import { analyzePaste, embedText, embedModelId, resolveActiveProvider, isLocalProvider } from "../ai/providers.js";
import { addLog } from "../logs.js";
import { asString, asStringArray } from "../validate.js";
import { randomUUID } from "crypto";
import { normalizeAppName, normalizeEnvName } from "../../shared/apps.js";

function statusFromCandidate(c: AnalyzeCandidate): EntryStatus {
  if (c.needs_type && c.needs_name) return "needs_review";
  if (c.needs_type) return "needs_type";
  if (c.needs_name) return "needs_name";
  return "saved";
}

const VALID_FAMILIES: readonly VaultEntry["family"][] = ["secret", "command", "note", "unknown"];

/** Whitelist the family — an arbitrary string here corrupts every consumer
 *  that switches on the union (Library filters, stats, AI gating). */
function asFamily(v: unknown, fallback: VaultEntry["family"]): VaultEntry["family"] {
  return VALID_FAMILIES.includes(v as VaultEntry["family"])
    ? (v as VaultEntry["family"])
    : fallback;
}

/**
 * Text used to build an entry's semantic-search embedding.
 *
 * EGRESS RULE (audit H2): the secret VALUE, its raw source fragment, and the
 * free-form notes (where users paste secrets) NEVER enter cloud embedding
 * input — not even with user consent. Local (loopback) providers embed the
 * full context because the text never leaves the machine.
 */
function indexTextFor(entry: VaultEntry, cloudSafe: boolean): string {
  const metadata = [
    entry.name,
    entry.type,
    entry.labels.join(" "),
    entry.type_aliases.join(" "),
  ];
  if (cloudSafe) return metadata.filter(Boolean).join("\n");
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
  const text = indexTextFor(entry, !isLocalProvider(settings, active));
  const embedding = await embedText(settings, text, active);
  // A null embedding means "provider unavailable/consent-blocked" — upserting
  // it would REPLACE a previously working vector, permanently degrading
  // semantic search for this entry until the next successful save. Skip and
  // keep the old vector instead.
  if (!embedding) {
    addLog("AI_EMBED", `No embedding for entry ${entry.id.slice(0, 8)} — keeping existing vector`);
    return;
  }
  store.upsertVector({
    id: `entry_${entry.id}`,
    entry_id: entry.id,
    text: text.slice(0, 4000),
    embedding,
    embed_model: embedModelId(settings, active),
    metadata: {
      name: entry.name,
      type: entry.type,
      family: entry.family,
      value_preview: entry.value.slice(0, 12),
    },
  });
}

let reindexRunning: Promise<number> | null = null;

/**
 * Re-embeds every entry after the embedding model/provider changed — old
 * vectors live in another model's space and would only add noise. Single
 * flight, sequential (one provider call at a time), stops if the vault locks.
 */
export function reindexAllEntries(store: VaultStore, settings: AppSettings): Promise<number> {
  if (reindexRunning) return reindexRunning;
  reindexRunning = (async () => {
    let done = 0;
    try {
      const entries = store.isLocked() ? [] : store.listEntries();
      addLog("AI_EMBED", `Re-indexing ${entries.length} entr${entries.length === 1 ? "y" : "ies"} for ${embedModelId(settings, await resolveActiveProvider(settings))}`);
      for (const entry of entries) {
        if (store.isLocked()) break;
        await indexEntry(store, settings, entry);
        done++;
      }
    } catch (e: any) {
      addLog("AI_EMBED", `Re-index stopped: ${e.message}`);
    } finally {
      reindexRunning = null;
    }
    return done;
  })();
  return reindexRunning;
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
  /** Application and environment (shared/apps.ts). */
  app?: string;
  env?: string;
  /** force into needs_* if incomplete */
  allow_incomplete?: boolean;
}

/** app/env as stored: blank or missing → absent; no environment without an application. */
function appFields(app: unknown, env: unknown): { app?: string; env?: string } {
  const a = normalizeAppName(app);
  if (!a) return {};
  const e = normalizeEnvName(env);
  return e ? { app: a, env: e } : { app: a };
}

export async function saveCandidate(
  store: VaultStore,
  settings: AppSettings,
  input: SaveCandidateInput
): Promise<VaultEntry> {
  // Coerce untrusted body shapes first (labels as string/object used to
  // crash indexEntry with .join is not a function AFTER the entry persisted).
  const value = asString(input.value);
  const type = asString(input.type).trim();
  const name = asString(input.name).trim();
  const labels = asStringArray(input.labels);
  const aliasesIn = asStringArray(input.type_aliases);
  const family = input.family || (type ? "secret" : "unknown");

  let status: EntryStatus = "saved";
  let finalFamily = family;

  const isSecretLike = family === "secret" || family === "unknown";
  if (isSecretLike) {
    // Single source of status derivation (statusFromCandidate) — the inline
    // copy here used to drift from it.
    status = statusFromCandidate({
      needs_type: !type,
      needs_name: !name,
    } as AnalyzeCandidate);
    if (!type) finalFamily = "unknown";
  } else if (family === "command") {
    status = "saved";
    finalFamily = "command";
  } else {
    status = "saved";
    finalFamily = "note";
  }

  if (!input.allow_incomplete && status !== "saved" && isSecretLike) {
    // Incomplete secrets are parked into the Unidentified inbox instead of
    // being rejected — the user reviews them there (see status above).
  }

  // duplicate name warning handled by caller; we allow save
  const entry = store.createEntry({
    value,
    type: type || "unidentified",
    name: name || "unnamed",
    raw_fragment: asString(input.raw_fragment) || value,
    paste_id: input.paste_id === undefined ? undefined : asString(input.paste_id),
    labels,
    type_aliases: aliasesIn.length ? aliasesIn : type ? [type] : [],
    status,
    family: finalFamily,
    notes: input.notes === undefined ? undefined : asString(input.notes),
    source_file: input.source_file === undefined ? undefined : asString(input.source_file),
    ...appFields(input.app, input.env),
  });

  if (status === "saved") {
    // The entry is already durable — an embedding/provider failure must not
    // turn the save into a client-visible 500 (retries would duplicate it).
    try {
      await indexEntry(store, settings, entry);
    } catch (e: any) {
      addLog("AI_EMBED", `Indexing failed for entry ${entry.id.slice(0, 8)} (saved, searchable by text): ${e?.message || e}`);
    }
    // Logs never carry entry names or values — names are frequently the
    // secret's own description ("Prod AWS root key") and masked fragments
    // leak prefix+suffix characters (audit M2). Reference by id only.
    addLog("VAULT", `Saved entry ${entry.id.slice(0, 8)} (${entry.type})`);
  } else {
    addLog("VAULT", `Parked incomplete entry ${entry.id.slice(0, 8)} → ${status}`);
  }

  return entry;
}

export async function clarifyEntry(
  store: VaultStore,
  settings: AppSettings,
  id: string,
  patch: {
    type?: string;
    name?: string;
    notes?: string;
    labels?: string[];
    family?: VaultEntry["family"];
    value?: string;
    /** null clears; undefined keeps. */
    app?: string | null;
    env?: string | null;
  }
): Promise<VaultEntry | null> {
  const existing = store.getEntry(id);
  if (!existing) return null;

  const type = asString(patch.type ?? existing.type).trim();
  const name = asString(patch.name ?? existing.name).trim();
  let status: EntryStatus;
  // Whitelist the family (AUD-020): a raw body value here flows into every
  // consumer that switches on the union.
  let family = asFamily(patch.family ?? existing.family, (existing.family || "unknown") as VaultEntry["family"]);
  const labels = asStringArray(patch.labels ?? existing.labels);

  const isSecretLike = family === "secret" || family === "unknown";
  if (isSecretLike) {
    if (!type || type === "unidentified") status = "needs_type";
    else if (!name || name === "unnamed") status = "needs_name";
    else status = "saved";

    // A fully-classified "unknown" entry is promoted to secret (original
    // behavior, preserved).
    if (status === "saved" && family === "unknown") {
      family = "secret";
    }
  } else {
    // notes and commands do not require a type; treat as complete
    status = "saved";
  }

  const aliases = new Set([
    ...existing.type_aliases,
    type,
    type.toLowerCase(),
  ]);

  // Preserve value verbatim — whatever pasted is what is saved (including leading _ , http, special chars)
  const verbatimValue = patch.value !== undefined ? asString(patch.value) : existing.value;
  const app = appFields(
    patch.app === undefined ? existing.app : patch.app,
    patch.env === undefined ? existing.env : patch.env
  );

  const updated = store.updateEntry(id, {
    value: verbatimValue,
    type: type || existing.type,
    name: name || existing.name,
    notes: patch.notes === undefined ? existing.notes : asString(patch.notes),
    labels,
    type_aliases: [...aliases],
    status,
    family,
    app: app.app,
    env: app.env,
  });

  if (updated && updated.status === "saved") {
    // Same rule as saveCandidate: the update is durable — indexing failures
    // are logged, not surfaced as a 500 that implies nothing was saved.
    try {
      await indexEntry(store, settings, updated);
    } catch (e: any) {
      addLog("AI_EMBED", `Indexing failed for entry ${updated.id.slice(0, 8)} after clarify: ${e?.message || e}`);
    }
    // Redaction rule (audit M2 / AUD-020): log by id, never by name — names
    // are frequently the secret's own description.
    addLog("VAULT", `Clarified entry ${updated.id.slice(0, 8)} (${updated.type})`);
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
