// Calls for the Applications page (server/routes/entries.ts, /apps/*).

export type UpsertStatus = "new" | "update" | "same";
export interface UpsertReportItem {
  name: string;
  key: string;
  status: UpsertStatus;
  id?: string;
}
export interface UpsertResult {
  app: string;
  env?: string;
  items: UpsertReportItem[];
  skipped: Record<string, number>;
  created?: number;
  updated?: number;
  unchanged?: number;
}
export interface UpsertItem {
  name: string;
  value: string;
  type?: string;
  notes?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data as T;
}

/** Save keys (or .env `text`) into one application and environment; `dry_run` only reports. */
export const upsertAppKeys = (body: { app: string; env?: string; items?: UpsertItem[]; text?: string; dry_run?: boolean }) =>
  post<UpsertResult>("/api/entries/apps/upsert", body);

/** Move entries into an application and environment; `app: null` takes them out of any. */
export const assignToApp = (ids: string[], app: string | null, env?: string) =>
  post<{ moved: number }>("/api/entries/apps/assign", { ids, app, env: env || null });

export const renameApp = (from: string, to: string) => post<{ renamed: number }>("/api/entries/apps/rename", { from, to });

export async function patchEntry(id: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function saveEntries(candidates: Array<Record<string, unknown>>): Promise<Array<{ id: string }>> {
  const data = await post<{ entries: Array<{ id: string }> }>("/api/entries/save", { candidates });
  return data.entries || [];
}

export async function deleteEntries(ids: string[]): Promise<void> {
  if (ids.length) await post("/api/entries/bulk-delete", { ids });
}

/** Expiry and rotation state, the same rules as server/hygiene.ts. */
export function hygieneBadge(e: { expires_at?: string; rotate_every_days?: number; last_rotated_at?: string; created_at?: string }, now = Date.now()): "expired" | "expiring" | "rotation_due" | null {
  const DAY = 86_400_000;
  if (e.expires_at) {
    const t = Date.parse(e.expires_at);
    if (Number.isFinite(t)) {
      if (t <= now) return "expired";
      if (t - now <= 14 * DAY) return "expiring";
    }
  }
  if (e.rotate_every_days && e.rotate_every_days > 0) {
    const base = Date.parse(e.last_rotated_at || e.created_at || "");
    if (Number.isFinite(base) && base + e.rotate_every_days * DAY <= now) return "rotation_due";
  }
  return null;
}
