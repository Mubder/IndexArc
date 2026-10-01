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
    // Bounded and FAIR: reject the NEWCOMER with 503 (EventSource reconnects
    // automatically) instead of evicting the oldest client — the oldest is
    // normally the app's own long-lived shell connection.
    if (clients.size >= MAX_CLIENTS) {
      return res.status(503).json({ error: "Too many SSE clients" });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    clients.add(res);

    // Heartbeat every 30s to keep the connection alive. res.write on a
    // destroyed socket returns false / emits 'error' asynchronously instead
    // of throwing, so ALSO watch close/error and check destroyed before
    // writing — half-open peers must not pin a client slot forever.
    const heartbeat = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        clearInterval(heartbeat);
        clients.delete(res);
        return;
      }
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
        clients.delete(res);
      }
    }, 30000);

    const drop = () => {
      clearInterval(heartbeat);
      clients.delete(res);
    };
    req.on("close", drop);
    res.on("close", drop);
    res.on("error", drop);
  });

  return r;
}
