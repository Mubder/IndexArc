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
