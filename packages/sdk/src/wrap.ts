import type {
  NodeExecution,
  NodeId,
  Policy,
  PolicyContext,
  SessionId,
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

export const GraphOS = {
  wrap<TInput, TOutput, TState = unknown>(
    graph: GraphLike<TInput, TOutput>,
    options: WrapOptions<TState> = {}
  ): WrappedGraph<TInput, TOutput> {
    const policies = options.policies ?? [];

    const runStream = async function* (
      input: TInput,
      config?: unknown
    ): AsyncIterable<Record<string, unknown>> {
      const sessionId = (options.sessionId ?? newSessionId()) as SessionId;
      const ctx: PolicyContext = { sessionId };
      for (const p of policies) p.reset?.(ctx);

      const streamResult = graph.stream(input, config);
      const iterable = await Promise.resolve(streamResult);

      let step = 0;
      for await (const chunk of iterable) {
        for (const [node, state] of Object.entries(chunk)) {
          const execution: NodeExecution<TState> = {
            sessionId,
            node: node as NodeId,
            state: state as TState,
            step: step++,
            timestamp: Date.now(),
          };
          for (const policy of policies) {
            const decision = policy.observe(execution, ctx);
            if (decision.kind === "halt") {
              throw new PolicyViolationError(decision);
            }
          }
        }
        yield chunk;
      }
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
