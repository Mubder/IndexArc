// Client side of the API pairing-token scheme (see server/auth.ts).
//
// installApiAuth() wraps window.fetch once, at startup, so every existing
// fetch("/api/...") call transparently carries the X-IndexArc-Token header.
// The token comes from the Electron preload bridge when available, otherwise
// from GET /api/auth/bootstrap (same-origin + loopback only, per the server's
// Host allowlist). The token lives in module memory only — never in
// localStorage, never in URLs.

const TOKEN_HEADER = "X-IndexArc-Token";

let cachedToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;
const origFetch: typeof window.fetch = window.fetch.bind(window);

export function loadApiToken(force = false): Promise<string | null> {
  if (!force && cachedToken) return Promise.resolve(cachedToken);
  if (!force && tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    try {
      const ea = window.electronAPI;
      if (ea && typeof ea.getApiToken === "function") {
        const t = await ea.getApiToken();
        if (t) {
          cachedToken = t;
          return t;
        }
      }
      const res = await origFetch("/api/auth/bootstrap", { credentials: "same-origin" });
      if (res.ok) {
        const j = (await res.json()) as { token?: string };
        if (j && j.token) {
          cachedToken = j.token;
          return j.token;
        }
      }
    } catch {
      // Server unreachable or not yet up; retried on the next request.
    }
    tokenPromise = null; // allow a clean retry on the next call
    return null;
  })();
  return tokenPromise;
}

// EventSource cannot send headers — exchange the token for a one-time ticket.
export async function fetchSseTicket(): Promise<string | null> {
  const token = await loadApiToken();
  if (!token) return null;
  try {
    const res = await origFetch("/api/sse/ticket", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token },
    });
    if (res.ok) {
      const j = (await res.json()) as { ticket?: string };
      if (j && j.ticket) return j.ticket;
    }
  } catch {
    // fall through
  }
  return null;
}

function isApiUrl(url: string): boolean {
  if (url.startsWith("/api/")) return true;
  if (url.startsWith(`${window.location.origin}/api/`)) return true;
  return false;
}

export function installApiAuth(): void {
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isApiUrl(raw) || raw.includes("/api/auth/bootstrap")) {
      return origFetch(input, init);
    }
    const token = await loadApiToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set(TOKEN_HEADER, token);
    const resp = await origFetch(input, { ...init, headers });
    if (resp.status === 401) {
      // Token rotated (server restarted) — re-acquire once and retry.
      const fresh = await loadApiToken(true);
      if (fresh && fresh !== token) {
        headers.set(TOKEN_HEADER, fresh);
        return origFetch(input, { ...init, headers });
      }
    }
    return resp;
  }) as typeof window.fetch;
}
