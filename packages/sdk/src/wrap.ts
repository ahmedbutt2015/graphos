import type {
  MCPToolCall,
  NodeExecution,
  NodeId,
  Policy,
  PolicyContext,
  SessionId,
  TraceEvent,
  TraceListener,
} from "@graphos-io/core";
import { PolicyViolationError } from "./errors.js";
import { extractMCPToolCalls } from "./policies/mcp-guard.js";

type StreamResult =
  | AsyncIterable<Record<string, unknown>>
  | Promise<AsyncIterable<Record<string, unknown>>>;

export interface GraphLike<TInput = unknown, TOutput = unknown> {
  invoke(input: TInput, config?: unknown): Promise<TOutput>;
  stream(input: TInput, config?: unknown): StreamResult;
}

export interface WrapOptions<TState = unknown> {
  policies?: Policy<TState>[];
  sessionId?: string;
  projectId?: string;
  onTrace?: TraceListener<TState>;
}

export interface WrappedGraph<TInput, TOutput> {
  invoke(input: TInput, config?: unknown): Promise<TOutput>;
  stream(
    input: TInput,
    config?: unknown
  ): AsyncIterable<Record<string, unknown>>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const mergeState = (
  acc: Record<string, unknown>,
  update: Record<string, unknown>
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...acc };
  for (const [k, v] of Object.entries(update)) {
    const prev = out[k];
    if (k === "messages") {
      const prevArr = Array.isArray(prev) ? prev : [];
      if (Array.isArray(v)) out[k] = [...prevArr, ...v];
      else if (v !== undefined && v !== null) out[k] = [...prevArr, v];
      else out[k] = prevArr;
    } else if (isPlainObject(prev) && isPlainObject(v)) {
      out[k] = mergeState(prev, v);
    } else {
      out[k] = v;
    }
  }
  return out;
};

let sessionCounter = 0;
const newSessionId = (): SessionId =>
  `gos_${Date.now().toString(36)}_${(sessionCounter++).toString(36)}` as SessionId;

const emit = <TState>(
  listener: TraceListener<TState> | undefined,
  event: TraceEvent<TState>
): void => {
  if (!listener) return;
  try {
    const result = listener(event);
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[graphos] onTrace listener rejected:", err);
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[graphos] onTrace listener threw:", err);
  }
};

const emitMcpCalls = <TState>(
  listener: TraceListener<TState> | undefined,
  execution: NodeExecution<TState>,
  calls: MCPToolCall[]
): void => {
  for (const call of calls) {
    emit(listener, {
      kind: "mcp.call",
      sessionId: execution.sessionId,
      timestamp: execution.timestamp,
      step: execution.step,
      server: call.server,
      tool: call.tool,
      args: call.args,
      source: "graph",
    });
  }
};

export const GraphOS = {
  wrap<TInput, TOutput, TState = unknown>(
    graph: GraphLike<TInput, TOutput>,
    options: WrapOptions<TState> = {}
  ): WrappedGraph<TInput, TOutput> {
    const policies = options.policies ?? [];
    const { onTrace, projectId } = options;

    const runStream = async function* (
      input: TInput,
      config?: unknown
    ): AsyncIterable<Record<string, unknown>> {
      const sessionId = (options.sessionId ?? newSessionId()) as SessionId;
      const ctx: PolicyContext = { sessionId };
      for (const p of policies) p.reset?.(ctx);

      emit<TState>(onTrace, {
        kind: "session.start",
        sessionId,
        projectId,
        timestamp: Date.now(),
        input,
      });

      let step = 0;
      let lastStep = 0;

      const baseConfig =
        typeof config === "object" && config !== null
          ? (config as Record<string, unknown>)
          : {};
      const streamConfig =
        baseConfig.subgraphs === undefined
          ? { ...baseConfig, subgraphs: true }
          : baseConfig;

      try {
        const streamResult = graph.stream(input, streamConfig);
        const iterable = await Promise.resolve(streamResult);

        for await (const raw of iterable) {
          let path: readonly string[] = [];
          let chunk: Record<string, unknown>;
          if (
            Array.isArray(raw) &&
            raw.length === 2 &&
            Array.isArray((raw as unknown[])[0])
          ) {
            const tuple = raw as unknown as [string[], Record<string, unknown>];
            path = tuple[0];
            chunk = tuple[1];
          } else {
            chunk = raw as Record<string, unknown>;
          }

          const subgraphPrefix = path
            .map((seg) => seg.split(":")[0])
            .filter((seg): seg is string => !!seg)
            .join("/");

          for (const [node, state] of Object.entries(chunk)) {
            const qualifiedNode = subgraphPrefix
              ? (`${subgraphPrefix}/${node}` as NodeId)
              : (node as NodeId);
            const execution: NodeExecution<TState> = {
              sessionId,
              node: qualifiedNode,
              state: state as TState,
              step: step++,
              timestamp: Date.now(),
            };
            lastStep = execution.step;

            emit<TState>(onTrace, {
              kind: "step",
              sessionId,
              node: qualifiedNode,
              state: execution.state,
              step: execution.step,
              timestamp: execution.timestamp,
            });

            emitMcpCalls(onTrace, execution, extractMCPToolCalls(execution));

            for (const policy of policies) {
              const decision = policy.observe(execution, ctx);
              if (decision.kind === "halt") {
                emit<TState>(onTrace, {
                  kind: "policy.halt",
                  sessionId,
                  policy: decision.policy,
                  reason: decision.reason,
                  details: decision.details,
                  step: execution.step,
                  timestamp: Date.now(),
                });
                emit<TState>(onTrace, {
                  kind: "session.end",
                  sessionId,
                  timestamp: Date.now(),
                  outcome: "halted",
                });
                throw new PolicyViolationError(decision);
              }
            }
          }
          yield chunk;
        }

        emit<TState>(onTrace, {
          kind: "session.end",
          sessionId,
          timestamp: Date.now(),
          outcome: "complete",
        });
      } catch (err) {
        if (!(err instanceof PolicyViolationError)) {
          emit<TState>(onTrace, {
            kind: "session.end",
            sessionId,
            timestamp: Date.now(),
            outcome: "error",
            error: { message: err instanceof Error ? err.message : String(err) },
          });
        }
        throw err;
      }

      void lastStep;
    };

    return {
      stream: runStream,
      async invoke(input: TInput, config?: unknown): Promise<TOutput> {
        let merged: Record<string, unknown> = isPlainObject(input)
          ? { ...(input as Record<string, unknown>) }
          : {};
        for await (const chunk of runStream(input, config)) {
          for (const stateUpdate of Object.values(chunk)) {
            if (isPlainObject(stateUpdate)) {
              merged = mergeState(merged, stateUpdate);
            }
          }
        }
        return merged as TOutput;
      },
    };
  },
};
