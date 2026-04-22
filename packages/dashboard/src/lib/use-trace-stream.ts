"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@graphos/core";
import { emptySession, reduceSession, type SessionView } from "./session-view";

export type { SessionView } from "./session-view";

export interface TraceStream {
  sessions: Map<string, SessionView>;
  latest?: SessionView;
  connected: boolean;
  error?: string;
}

export const useTraceStream = (url = "ws://localhost:4001/graphos"): TraceStream => {
  const [state, setState] = useState<TraceStream>({
    sessions: new Map(),
    connected: false,
  });
  const ref = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(url);
      ref.current = ws;

      ws.addEventListener("open", () => {
        setState((s) => ({ ...s, connected: true, error: undefined }));
      });
      ws.addEventListener("close", () => {
        setState((s) => ({ ...s, connected: false }));
        if (!cancelled) retryTimer = setTimeout(connect, 1000);
      });
      ws.addEventListener("error", () => {
        setState((s) => ({ ...s, error: "connection failed" }));
      });
      ws.addEventListener("message", (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          return;
        }
        if (
          !msg ||
          typeof msg !== "object" ||
          !("kind" in msg) ||
          !("sessionId" in msg) ||
          typeof (msg as { sessionId: unknown }).sessionId !== "string"
        ) {
          return;
        }
        const event = msg as TraceEvent;
        setState((s) => {
          const sessions = new Map(s.sessions);
          const existing = sessions.get(event.sessionId) ?? emptySession(event.sessionId);
          const updated = reduceSession(existing, event);
          sessions.set(event.sessionId, updated);
          let latest = s.latest;
          if (!latest || (updated.startedAt ?? 0) >= (latest.startedAt ?? 0)) {
            latest = updated;
          } else if (latest.sessionId === updated.sessionId) {
            latest = updated;
          }
          return { ...s, sessions, latest };
        });
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [url]);

  return state;
};
