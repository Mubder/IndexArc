import { useEffect, useRef, useCallback } from "react";

type SSEEvent = "connected" | "vault-changed" | "entries-changed" | "folders-changed" | "settings-changed";

interface SSEMessage {
  event: SSEEvent;
  data: any;
}

export function useSSE(onMessage: (msg: SSEMessage) => void) {
  const sourceRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    const es = new EventSource("/api/events");
    sourceRef.current = es;

    es.addEventListener("connected", () => {
      // Connection established
    });

    es.addEventListener("vault-changed", (e) => {
      onMessageRef.current({ event: "vault-changed", data: JSON.parse(e.data) });
    });

    es.addEventListener("entries-changed", (e) => {
      onMessageRef.current({ event: "entries-changed", data: JSON.parse(e.data) });
    });

    es.addEventListener("folders-changed", (e) => {
      onMessageRef.current({ event: "folders-changed", data: JSON.parse(e.data) });
    });

    es.addEventListener("settings-changed", (e) => {
      onMessageRef.current({ event: "settings-changed", data: JSON.parse(e.data) });
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
    };
  }, [connect]);
}
