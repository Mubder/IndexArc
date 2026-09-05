import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// One random token per server process. Every /api request must present it as
// the X-IndexArc-Token header (with the narrow exemptions below). This is what
// stops a malicious web page from talking to the vault API:
//   • DNS rebinding → blocked by the Host allowlist (a rebound page sends the
//     attacker's hostname, never 127.0.0.1/localhost).
//   • Forged cross-site form POST / fetch → the attacker's page can never read
//     the token cross-origin, and cross-site Sec-Fetch-Site requests are
//     rejected outright.
// The token reaches the renderer through the Electron preload bridge, or via
// GET /api/auth/bootstrap for plain-browser use (same-origin + loopback only).
const token = crypto.randomBytes(32).toString("hex");

// Exported for the embedded Electron main process (same Node process) to hand
// to the renderer through IPC.
(process.env as Record<string, string | undefined>).INDEXARC_API_TOKEN = token;

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

// One-time, short-lived tickets for EventSource, which cannot send headers.
const sseTickets = new Map<string, number>();
const TICKET_TTL_MS = 30_000;

export function issueSseTicket(): string {
  const t = crypto.randomBytes(16).toString("hex");
  sseTickets.set(t, Date.now() + TICKET_TTL_MS);
  return t;
}

function consumeSseTicket(t: unknown): boolean {
  if (typeof t !== "string" || !t) return false;
  const exp = sseTickets.get(t);
  sseTickets.delete(t); // one-time use
  return exp !== undefined && exp > Date.now();
}

export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 1) Host allowlist — applies to everything under /api.
  const host = String(req.headers.host || "").trim();
  if (!LOCAL_HOST_RE.test(host)) {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }

  // 2) No browser ever has a legitimate cross-site reason to call this API.
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site") {
    res.status(403).json({ error: "Cross-site requests are forbidden" });
    return;
  }

  // 3) Health probe (used by the Electron shell before the window loads).
  if (req.path === "/ping") {
    next();
    return;
  }

  // 4) Token bootstrap for plain-browser clients. Only same-origin/non-browser
  //    callers may read it (Host is already validated above).
  if (req.path === "/auth/bootstrap") {
    const sfs = req.headers["sec-fetch-site"];
    if (typeof sfs === "string" && sfs !== "same-origin" && sfs !== "same-site" && sfs !== "none") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json({ token });
    return;
  }

  // 5) SSE with a valid one-time ticket (EventSource cannot send headers).
  if (req.path === "/events" && consumeSseTicket(req.query.ticket)) {
    next();
    return;
  }

  // 6) Everything else requires the pairing token.
  if (req.header("x-indexarc-token") !== token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
