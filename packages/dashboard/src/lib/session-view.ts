import type { TraceEvent } from "@graphos-io/core";

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

export const emptySession = (sessionId: string): SessionView => ({
  sessionId,
  nodes: [],
  transitions: [],
  events: [],
  stepCount: 0,
});

export const reduceSession = (
  prev: SessionView,
  event: TraceEvent
): SessionView => {
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

export const buildSessionView = (
  sessionId: string,
  events: TraceEvent[]
): SessionView => events.reduce(reduceSession, emptySession(sessionId));
