"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@graphos/core";

export interface SessionView {
  sessionId: string;
  projectId?: string;
  startedAt?: number;
  endedAt?: number;
  outcome?: "complete" | "halted" | "error";
  error?: string;
  nodes: string[];
  transitions: Array<[string, string]>;
  activeNode?: string;
  haltedNode?: string;
  haltReason?: string;
  events: TraceEvent[];
  stepCount: number;
}

const emptySession = (sessionId: string): SessionView => ({
  sessionId,
  nodes: [],
  transitions: [],
  events: [],
  stepCount: 0,
});

const reduce = (prev: SessionView, event: TraceEvent): SessionView => {
  const next: SessionView = { ...prev, events: [...prev.events, event] };
  switch (event.kind) {
    case "session.start":
      next.startedAt = event.timestamp;
      next.projectId = event.projectId;
      break;
    case "step": {
      const last = prev.activeNode;
      next.activeNode = event.node;
      next.stepCount = prev.stepCount + 1;
      if (!prev.nodes.includes(event.node)) {
        next.nodes = [...prev.nodes, event.node];
      }
      if (last && last !== event.node) {
        const edgeKey: [string, string] = [last, event.node];
        const exists = prev.transitions.some(
          ([a, b]) => a === edgeKey[0] && b === edgeKey[1]
        );
        if (!exists) next.transitions = [...prev.transitions, edgeKey];
      }
      break;
    }
    case "policy.halt":
      next.haltedNode = prev.activeNode;
      next.haltReason = `${event.policy}: ${event.reason}`;
      break;
    case "session.end":
      next.endedAt = event.timestamp;
      next.outcome = event.outcome;
      next.error = event.error?.message;
      break;
  }
  return next;
};

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
          const updated = reduce(existing, event);
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
