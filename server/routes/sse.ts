import { Router } from "express";
import { issueSseTicket } from "../auth.js";
import type { RouteContext } from "./types.js";

// SSE client management
const clients = new Set<any>();
const MAX_CLIENTS = 50;

export function sendSSE(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.writableEnded) {
      clients.delete(client);
      continue;
    }
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function sseRoutes(_ctx: RouteContext) {
  const r = Router();

  // EventSource cannot send headers, so clients exchange the pairing token for
  // a one-time, 30-second ticket (validated by the auth middleware on
  // /api/events?ticket=...).
  r.post("/sse/ticket", (_req, res) => {
    res.json({ ticket: issueSseTicket() });
  });

  r.get("/events", (req, res) => {
    // Bounded: a leaky local client pool must not grow without limit.
    if (clients.size >= MAX_CLIENTS) {
      const oldest = clients.values().next().value;
      if (oldest) {
        try { oldest.end(); } catch {}
        clients.delete(oldest);
      }
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    clients.add(res);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
        clients.delete(res);
      }
    }, 30000);

    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });

  return r;
}
