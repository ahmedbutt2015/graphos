import type {
  MCPToolCall,
  MCPToolResult,
  SessionOutcome,
  SessionId,
  TraceEvent,
  TraceListener,
} from "@graphos-io/core";

export interface MCPProxyRequest extends MCPToolCall {
  sessionId?: string;
  projectId?: string;
}

export interface MCPProxyUpstream {
  callTool(call: MCPToolCall): Promise<MCPToolResult>;
  listTools?(): Promise<unknown>;
}

export interface MCPProxyOptions {
  sessionId?: string;
  projectId?: string;
  onTrace?: TraceListener;
  allowServers?: string[];
  denyServers?: string[];
  allowTools?: string[];
  denyTools?: string[];
  maxCallsPerSession?: number;
  maxCallsPerTool?: number;
  redactArgs?: (args: unknown, call: MCPToolCall) => unknown;
  redactResult?: (result: MCPToolResult, call: MCPToolCall) => MCPToolResult;
  autoEndSessions?: boolean;
}

export class MCPProxyBlockedError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "MCPProxyBlockedError";
    this.details = details;
  }
}

interface SessionState {
  started: boolean;
  totalCalls: number;
  toolCounts: Map<string, number>;
  projectId?: string;
}

const isPromise = (value: unknown): value is Promise<void> =>
  !!value && typeof (value as Promise<void>).then === "function";

const emit = (
  listener: TraceListener | undefined,
  event: TraceEvent
): void => {
  if (!listener) return;
  try {
    const result = listener(event);
    if (isPromise(result)) {
      result.catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[graphos:mcp-proxy] onTrace listener rejected:", err);
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[graphos:mcp-proxy] onTrace listener threw:", err);
  }
};

let sessionCounter = 0;
const newSessionId = (): SessionId =>
  `mcp_${Date.now().toString(36)}_${(sessionCounter++).toString(36)}` as SessionId;

const includes = (list: string[] | undefined, value: string | undefined): boolean =>
  !!value && !!list?.some((entry) => entry === value);

const endSessionEvent = (
  sessionId: SessionId,
  outcome: SessionOutcome,
  error?: string
): TraceEvent => ({
  kind: "session.end",
  sessionId,
  timestamp: Date.now(),
  outcome,
  error: error ? { message: error } : undefined,
});

export interface MCPProxy {
  callTool(request: MCPProxyRequest): Promise<MCPToolResult>;
  listTools(): Promise<unknown>;
  endSession(sessionId: string, outcome?: SessionOutcome, error?: string): void;
}

export const createMCPProxy = (
  upstream: MCPProxyUpstream,
  options: MCPProxyOptions = {}
): MCPProxy => {
  const sessions = new Map<string, SessionState>();

  const ensureSession = (sessionId: SessionId, projectId?: string): SessionState => {
    const existing = sessions.get(sessionId);
    if (existing) {
      if (projectId && !existing.projectId) existing.projectId = projectId;
      return existing;
    }
    const created: SessionState = {
      started: false,
      totalCalls: 0,
      toolCounts: new Map(),
      projectId,
    };
    sessions.set(sessionId, created);
    return created;
  };

  const startIfNeeded = (sessionId: SessionId, state: SessionState): void => {
    if (state.started) return;
    state.started = true;
    emit(options.onTrace, {
      kind: "session.start",
      sessionId,
      projectId: state.projectId ?? options.projectId,
      timestamp: Date.now(),
      input: { transport: "mcp-proxy" },
    });
  };

  const maybeBlock = (
    sessionId: SessionId,
    state: SessionState,
    call: MCPToolCall
  ): string | undefined => {
    if (includes(options.denyServers, call.server)) {
      return `server "${call.server}" is denied`;
    }
    if (options.allowServers?.length && !includes(options.allowServers, call.server)) {
      return `server "${call.server ?? "unknown"}" is not in the allow-list`;
    }
    if (includes(options.denyTools, call.tool)) {
      return `tool "${call.tool}" is denied`;
    }
    if (options.allowTools?.length && !includes(options.allowTools, call.tool)) {
      return `tool "${call.tool}" is not in the allow-list`;
    }

    state.totalCalls += 1;
    if (
      options.maxCallsPerSession !== undefined &&
      state.totalCalls > options.maxCallsPerSession
    ) {
      return `MCP call count ${state.totalCalls} exceeded session limit ${options.maxCallsPerSession}`;
    }

    const key = `${call.server ?? "unknown"}::${call.tool}`;
    const next = (state.toolCounts.get(key) ?? 0) + 1;
    state.toolCounts.set(key, next);
    if (options.maxCallsPerTool !== undefined && next > options.maxCallsPerTool) {
      return `tool "${call.tool}" exceeded per-tool limit ${options.maxCallsPerTool}`;
    }

    void sessionId;
    return undefined;
  };

  return {
    async callTool(request: MCPProxyRequest): Promise<MCPToolResult> {
      const sessionId = (request.sessionId ?? options.sessionId ?? newSessionId()) as SessionId;
      const state = ensureSession(sessionId, request.projectId ?? options.projectId);
      startIfNeeded(sessionId, state);

      const call: MCPToolCall = {
        server: request.server,
        tool: request.tool,
        args: request.args,
      };
      const redactedArgs = options.redactArgs?.(call.args, call) ?? call.args;

      emit(options.onTrace, {
        kind: "mcp.call",
        sessionId,
        timestamp: Date.now(),
        server: call.server,
        tool: call.tool,
        args: redactedArgs,
        source: "proxy",
      });

      const blockedReason = maybeBlock(sessionId, state, call);
      if (blockedReason) {
        const details = { server: call.server, tool: call.tool };
        emit(options.onTrace, {
          kind: "mcp.blocked",
          sessionId,
          timestamp: Date.now(),
          server: call.server,
          tool: call.tool,
          reason: blockedReason,
          details,
          source: "proxy",
        });
        emit(options.onTrace, {
          kind: "policy.halt",
          sessionId,
          timestamp: Date.now(),
          policy: "MCPGuard",
          reason: blockedReason,
          details,
          step: state.totalCalls - 1,
        });
        if (options.autoEndSessions ?? true) {
          emit(options.onTrace, endSessionEvent(sessionId, "halted"));
          sessions.delete(sessionId);
        }
        throw new MCPProxyBlockedError(blockedReason, details);
      }

      try {
        const result = await upstream.callTool(call);
        const redactedResult = options.redactResult?.(result, call) ?? result;
        emit(options.onTrace, {
          kind: "mcp.result",
          sessionId,
          timestamp: Date.now(),
          server: call.server,
          tool: call.tool,
          result: redactedResult,
          source: "proxy",
        });
        if (!request.sessionId && (options.autoEndSessions ?? true)) {
          emit(options.onTrace, endSessionEvent(sessionId, "complete"));
          sessions.delete(sessionId);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit(options.onTrace, endSessionEvent(sessionId, "error", message));
        sessions.delete(sessionId);
        throw err;
      }
    },

    async listTools(): Promise<unknown> {
      return upstream.listTools ? upstream.listTools() : [];
    },

    endSession(sessionId: string, outcome: SessionOutcome = "complete", error?: string): void {
      emit(options.onTrace, endSessionEvent(sessionId as SessionId, outcome, error));
      sessions.delete(sessionId);
    },
  };
};
