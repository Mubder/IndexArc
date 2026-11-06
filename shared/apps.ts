// Applications: secrets grouped by application and environment.
//
// An application is not a record of its own: it is the `app` field on vault
// entries, and an environment is the `env` field. An application's notes (and
// an application with no keys yet) are kept as one note entry of type
// APP_NOTE_TYPE with that `app`. Shared by the server and the renderer.

export const APP_NOTE_TYPE = "app_note";
export const DEFAULT_ENVS = ["Production", "Staging", "Development"] as const;
export const APP_NAME_MAX = 200;
export const ENV_NAME_MAX = 64;

export interface AppEntryLike {
  id: string;
  name: string;
  value: string;
  type: string;
  family: string;
  app?: string;
  env?: string;
  updated_at?: string;
  notes?: string;
}

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s || undefined;
}

/** Trimmed, single-spaced application name, or undefined when blank. */
export const normalizeAppName = (v: unknown) => clean(v, APP_NAME_MAX);
/** Trimmed, single-spaced environment name, or undefined when blank. */
export const normalizeEnvName = (v: unknown) => clean(v, ENV_NAME_MAX);

/** Names compare without regard to case or surrounding spaces. */
export function sameName(a: string | undefined, b: string | undefined): boolean {
  return (normalizeAppName(a) ?? "").toLowerCase() === (normalizeAppName(b) ?? "").toLowerCase();
}

/** A .env-style key for a secret name: "Stripe secret key" → STRIPE_SECRET_KEY. */
export function envKey(name: string): string {
  let k = String(name || "SECRET")
    .normalize("NFKD")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!k) k = "SECRET";
  if (/^\d/.test(k)) k = `_${k}`;
  return k;
}

/**
 * The variable name a detected secret was written under, when its source line
 * reads like KEY=value, KEY: value or export KEY=value; otherwise undefined.
 */
export function keyNameFromFragment(fragment: unknown): string | undefined {
  if (typeof fragment !== "string") return undefined;
  const m = /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[:=]/.exec(fragment);
  return m ? m[1] : undefined;
}

/** Quote a value for a .env line when it needs it. */
export function envQuote(v: string): string {
  if (/^[A-Za-z0-9_./:@%+-]*$/.test(v)) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n").replace(/\$/g, "\\$")}"`;
}

export const isAppNote = (e: Pick<AppEntryLike, "family" | "type">) => e.family === "note" && e.type === APP_NOTE_TYPE;
const isKey = (e: Pick<AppEntryLike, "family" | "type">) => !isAppNote(e) && (e.family === "secret" || e.family === "unknown");

/** The key of `app`/`env` that a new secret called `name` would replace, if any. */
export function findAppKey<T extends AppEntryLike>(entries: T[], app: string, env: string | undefined, name: string): T | undefined {
  const k = envKey(name);
  return entries.find((e) => isKey(e) && sameName(e.app, app) && sameName(e.env, env) && envKey(e.name) === k);
}

/** .env text for these keys; later duplicates of a key win, as in a shell. */
export function toDotenv(keys: Array<Pick<AppEntryLike, "name" | "value">>, header?: string): string {
  const out = new Map<string, string>();
  for (const e of keys) if (e.value) out.set(envKey(e.name), e.value);
  const lines = header ? [`# ${header}`] : [];
  for (const [k, v] of out) lines.push(`${k}=${envQuote(v)}`);
  return lines.join("\n") + "\n";
}

export interface AppSummary {
  name: string;
  count: number;
  envs: Array<{ name: string; count: number }>;
  note?: AppEntryLike;
  updated_at: string;
}

/**
 * One summary per application, by name (case-insensitive). Environments are
 * listed in DEFAULT_ENVS order first, then the others alphabetically; keys
 * without an environment are counted under "".
 */
export function summarizeApps<T extends AppEntryLike>(entries: T[]): AppSummary[] {
  const byApp = new Map<string, AppSummary & { envMap: Map<string, { name: string; count: number }> }>();
  for (const e of entries) {
    const app = normalizeAppName(e.app);
    if (!app) continue;
    const id = app.toLowerCase();
    let s = byApp.get(id);
    if (!s) {
      s = { name: app, count: 0, envs: [], updated_at: "", envMap: new Map() };
      byApp.set(id, s);
    }
    if ((e.updated_at || "") > s.updated_at) s.updated_at = e.updated_at || "";
    if (isAppNote(e)) {
      s.note = e;
      continue;
    }
    if (!isKey(e)) continue;
    s.count++;
    const env = normalizeEnvName(e.env) ?? "";
    const ek = env.toLowerCase();
    const slot = s.envMap.get(ek) ?? { name: env, count: 0 };
    slot.count++;
    s.envMap.set(ek, slot);
  }
  const rank = (n: string) => {
    const i = DEFAULT_ENVS.findIndex((d) => d.toLowerCase() === n.toLowerCase());
    return i === -1 ? DEFAULT_ENVS.length : i;
  };
  return [...byApp.values()]
    .map(({ envMap, ...s }) => ({
      ...s,
      envs: [...envMap.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The keys of one application and environment ("" = keys without one). */
export function appKeys<T extends AppEntryLike>(entries: T[], app: string, env: string): T[] {
  return entries
    .filter((e) => isKey(e) && sameName(e.app, app) && (normalizeEnvName(e.env) ?? "").toLowerCase() === env.toLowerCase())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
