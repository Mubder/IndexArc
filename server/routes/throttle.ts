import type { Response } from "express";

// Shared attempt throttle for password-guessing endpoints (unlock /
// remove-password / note-unprotect master-password verification). Max N
// attempts per rolling window per client; on failure the response is
// additionally delayed (mild online brute-force friction on top of the
// memory-hard KDF). One module = one policy — no endpoint may quietly opt
// out, which is how the note-unprotect path previously became an
// unthrottled master-password oracle.
const attempts = new Map<string, { count: number; firstAttempt: number; failures: number }>();
const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

function clientKey(req: any): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function getEntry(key: string, now: number) {
  let entry = attempts.get(key);
  // Consecutive failures outlive the window: only a verified success clears
  // them, so waiting out the minute doesn't reset the escalating delay.
  let carriedFailures = 0;
  if (entry && now - entry.firstAttempt > WINDOW_MS) {
    carriedFailures = entry.failures;
    attempts.delete(key);
    entry = undefined;
  }
  if (!entry) {
    // Hard cap so a bind override exposing many source IPs can't grow the
    // map without bound (stale entries for keys that stop requesting are
    // never otherwise revisited).
    if (attempts.size >= MAX_TRACKED_KEYS) {
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
    entry = { count: 0, firstAttempt: now, failures: carriedFailures };
    attempts.set(key, entry);
  }
  return entry;
}

export function throttle(
  req: any,
  res: Response,
  opts: { max: number }
): { delayMs: number } | null {
  const entry = getEntry(clientKey(req), Date.now());
  entry.count++;
  if (entry.count > opts.max) {
    res.status(429).json({ error: "Too many attempts. Try again in a minute." });
    return null;
  }
  // Escalating friction per consecutive failure: 0, 500ms, 1000ms ... capped 5s
  const delayMs = Math.min(entry.failures * 500, 5000);
  return { delayMs };
}

export function recordFailure(req: any): void {
  const entry = attempts.get(clientKey(req));
  if (entry) entry.failures++;
}

/** Call ONLY after a verified secret (master password). A fixed confirm
 *  word is not a secret — letting it clear the counter turned the shared
 *  throttle into an unlimited master-password oracle. */
export function recordSuccess(req: any): void {
  attempts.delete(clientKey(req));
}
