import type {
  NodeExecution,
  NodeId,
  Policy,
  PolicyContext,
  SessionId,
  TraceEvent,
  TraceListener,
} from "@graphos/core";
import { PolicyViolationError } from "./errors.js";

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

      try {
        const streamResult = graph.stream(input, config);
        const iterable = await Promise.resolve(streamResult);

        for await (const chunk of iterable) {
          for (const [node, state] of Object.entries(chunk)) {
            const execution: NodeExecution<TState> = {
              sessionId,
              node: node as NodeId,
              state: state as TState,
              step: step++,
              timestamp: Date.now(),
            };
            lastStep = execution.step;

            emit<TState>(onTrace, {
              kind: "step",
              sessionId,
              node: execution.node,
              state: execution.state,
              step: execution.step,
              timestamp: execution.timestamp,
            });

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
        let last: Record<string, unknown> | undefined;
        for await (const chunk of runStream(input, config)) {
          last = chunk;
        }
        return last as TOutput;
      },
    };
  },
};
