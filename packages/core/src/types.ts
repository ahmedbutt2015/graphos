export type SessionId = string & { readonly __brand: "SessionId" };
export type NodeId = string & { readonly __brand: "NodeId" };

export interface NodeExecution<TState = unknown> {
  sessionId: SessionId;
  node: NodeId;
  state: TState;
  step: number;
  timestamp: number;
}

export type PolicyDecision =
  | { kind: "continue" }
  | { kind: "halt"; policy: string; reason: string; details?: unknown };

export interface PolicyContext {
  sessionId: SessionId;
}

export interface Policy<TState = unknown> {
  readonly name: string;
  observe(execution: NodeExecution<TState>, ctx: PolicyContext): PolicyDecision;
  reset?(ctx: PolicyContext): void;
}

export const cont = (): PolicyDecision => ({ kind: "continue" });

export const halt = (
  policy: string,
  reason: string,
  details?: unknown
): PolicyDecision => ({ kind: "halt", policy, reason, details });

export type SessionOutcome = "complete" | "halted" | "error";

export type TraceEvent<TState = unknown> =
  | {
      kind: "session.start";
      sessionId: SessionId;
      projectId?: string;
      timestamp: number;
      input: unknown;
    }
  | {
      kind: "step";
      sessionId: SessionId;
      node: NodeId;
      state: TState;
      step: number;
      timestamp: number;
    }
  | {
      kind: "policy.halt";
      sessionId: SessionId;
      policy: string;
      reason: string;
      details?: unknown;
      step: number;
      timestamp: number;
    }
  | {
      kind: "session.end";
      sessionId: SessionId;
      timestamp: number;
      outcome: SessionOutcome;
      error?: { message: string };
    };

export type TraceListener<TState = unknown> = (
  event: TraceEvent<TState>
) => void | Promise<void>;
