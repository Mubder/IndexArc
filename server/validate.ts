// Request-body coercion helpers. Route bodies are untyped JSON; these keep
// bad shapes from reaching store/indexing code that expects strings/arrays
// (e.g. entry.labels.join() on a non-array used to 500 after persist).

export function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter((x) => x.length > 0);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** Validates an AI/base URL: must be http(s) with a hostname. */
export function isHttpUrl(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** fetch() with a hard timeout — never hang the request path. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 60_000
): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

/**
 * Wraps a promise with a timeout race for SDK calls that don't accept
 * AbortSignal (e.g. @google/genai in current versions).
 */
export async function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
