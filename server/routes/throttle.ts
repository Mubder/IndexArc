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

function clientKey(req: any): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function throttle(
  req: any,
  res: Response,
  opts: { max: number }
): { delayMs: number } | null {
  const now = Date.now();
  let entry = attempts.get(clientKey(req));
  if (entry && now - entry.firstAttempt > WINDOW_MS) {
    entry = undefined;
  }
  if (!entry) {
    entry = { count: 0, firstAttempt: now, failures: 0 };
    attempts.set(clientKey(req), entry);
  }
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

export function recordSuccess(req: any): void {
  attempts.delete(clientKey(req));
}
