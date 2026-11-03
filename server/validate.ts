// Request-body coercion helpers. Route bodies are untyped JSON; these keep
// bad shapes from reaching store/indexing code that expects strings/arrays
// (e.g. entry.labels.join() on a non-array used to 500 after persist).

export function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export function asStringArray(v: unknown): string[] {
  // Both paths trim: `[" admin ", ""]` used to keep padded entries while the
  // scalar path produced "admin" — near-duplicate labels defeated exact-match
  // dedupe depending on input shape.
  if (Array.isArray(v)) return v.map((x) => asString(x).trim()).filter((x) => x.length > 0);
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

/** 408/429/5xx and network-level failures are worth one more try; other 4xx are not. */
export function isTransientError(e: any): boolean {
  const status = Number(e?.status ?? e?.code);
  if (Number.isFinite(status) && status > 0) return status === 408 || status === 429 || status >= 500;
  const msg = String(e?.message || "");
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network/i.test(msg);
}

/**
 * Runs an SDK call that accepts an AbortSignal under ONE overall deadline,
 * retrying transient failures with backoff. Unlike a bare withTimeout race,
 * the losing request is actually aborted — no orphaned sockets or tokens
 * spent after the caller gave up.
 */
export async function callWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs: number; label: string; retries?: number; baseDelayMs?: number }
): Promise<T> {
  const { timeoutMs, label, retries = 2, baseDelayMs = 500 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${label} timed out after ${timeoutMs}ms`);
    const ctl = new AbortController();
    try {
      // The race is a backstop in case the SDK ignores the signal.
      return await withTimeout(fn(ctl.signal), remaining, label);
    } catch (e: any) {
      ctl.abort();
      const delay = baseDelayMs * 3 ** attempt;
      const timedOut = /timed out/.test(String(e?.message));
      if (timedOut || attempt >= retries || !isTransientError(e) || Date.now() + delay >= deadline) throw e;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Wraps a promise with a timeout race for SDK calls that don't accept
 * AbortSignal. Prefer callWithRetry when the call takes one.
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
