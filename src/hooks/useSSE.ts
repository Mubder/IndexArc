import { useEffect, useRef, useCallback } from "react";
import { fetchSseTicket } from "../apiAuth";

type SSEEvent = "connected" | "vault-changed" | "entries-changed" | "folders-changed" | "settings-changed";

interface SSEMessage {
  event: SSEEvent;
  data: any;
}

export function useSSE(onMessage: (msg: SSEMessage) => void) {
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  // One flag for the hook's lifetime: each reconnect used to get its own
  // `cancelled`, which unmount never set — a reconnect mid-ticket-fetch then
  // opened an EventSource nobody would ever close.
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    // The SSE endpoint is authenticated with a one-time ticket (EventSource
    // cannot send headers). Retry until the server is up / token is available.
    (async () => {
      const ticket = await fetchSseTicket();
      if (unmountedRef.current) return;
      if (!ticket) {
        reconnectRef.current = setTimeout(connect, 3000);
        return;
      }
      if (unmountedRef.current) return;
      const es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
      sourceRef.current = es;

      es.addEventListener("connected", () => {
        // Connection established
      });

      es.addEventListener("vault-changed", (e) => {
        try { onMessageRef.current({ event: "vault-changed", data: JSON.parse(e.data) }); } catch {}
      });
      es.addEventListener("entries-changed", (e) => {
        try { onMessageRef.current({ event: "entries-changed", data: JSON.parse(e.data) }); } catch {}
      });
      es.addEventListener("folders-changed", (e) => {
        try { onMessageRef.current({ event: "folders-changed", data: JSON.parse(e.data) }); } catch {}
      });
      es.addEventListener("settings-changed", (e) => {
        try { onMessageRef.current({ event: "settings-changed", data: JSON.parse(e.data) }); } catch {}
      });

      es.onerror = () => {
        es.close();
        sourceRef.current = null;
        if (!unmountedRef.current) reconnectRef.current = setTimeout(connect, 3000);
      };
    })();
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      sourceRef.current?.close();
    };
  }, [connect]);
}
