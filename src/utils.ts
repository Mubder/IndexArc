import { VaultEntry } from "./types";

export function maskValue(v: string) {
  if (!v) return "••••";
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function statusLabel(s: VaultEntry["status"]) {
  switch (s) {
    case "needs_name":
      return "Needs name";
    case "needs_type":
      return "Needs type";
    case "needs_review":
      return "Needs review";
    default:
      return "Saved";
  }
}

/** Parse API JSON safely (avoids "Unexpected token <" when HTML is returned) */
export async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Server returned non-JSON (${res.status}). ${text.slice(0, 80).replace(/\s+/g, " ")}…`
    );
  }
}

export function isArabicText(text?: string): boolean {
  if (!text) return false;
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

export interface DuplicateHit {
  index: number;
  name: string;
  match_type: string;
  existing_name: string;
}

/**
 * Ask the server (POST /api/entries/check-duplicate) which of the given
 * values already exist in the vault. Fail-open: any network/lock error
 * yields [] so saving keeps its old behavior instead of breaking.
 */
export async function findDuplicateHits(
  items: { value?: string; name?: string }[]
): Promise<DuplicateHit[]> {
  const hits: DuplicateHit[] = [];
  await Promise.all(
    items.map(async (item, index) => {
      const value = String(item.value ?? "");
      if (!value.trim()) return;
      try {
        const res = await fetch("/api/entries/check-duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value, name: item.name ?? "" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.is_duplicate) {
          hits.push({
            index,
            name: String(item.name || "unnamed"),
            match_type: String(data.match_type || "exact_value"),
            existing_name: String(data.existing_entry?.name || "?"),
          });
        }
      } catch {
        /* fail open — duplicates are advisory, never blocking on errors */
      }
    })
  );
  return hits.sort((a, b) => a.index - b.index);
}
