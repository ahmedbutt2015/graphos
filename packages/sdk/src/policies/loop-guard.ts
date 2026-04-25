import type {
  NodeExecution,
  Policy,
  PolicyContext,
  PolicyDecision,
} from "@graphos-io/core";
import { cont, halt } from "@graphos-io/core";

export type LoopGuardMode = "state" | "node";

export interface LoopGuardOptions<TState = unknown> {
  maxRepeats?: number;
  mode?: LoopGuardMode;
  key?: (execution: NodeExecution<TState>) => string;
}

const DEFAULT_MAX_REPEATS = 3;

const canonical = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
};

const stateKey = <TState>(exec: NodeExecution<TState>): string =>
  JSON.stringify([exec.node, canonical(exec.state)]);

const nodeKey = <TState>(exec: NodeExecution<TState>): string => exec.node;

export class LoopGuard<TState = unknown> implements Policy<TState> {
  readonly name = "LoopGuard";
  private readonly maxRepeats: number;
  private readonly mode: LoopGuardMode;
  private readonly keyFn: (execution: NodeExecution<TState>) => string;
  private counts = new Map<string, number>();

  constructor(options: LoopGuardOptions<TState> = {}) {
    this.maxRepeats = options.maxRepeats ?? DEFAULT_MAX_REPEATS;
    this.mode = options.mode ?? "state";
    this.keyFn =
      options.key ?? (this.mode === "node" ? nodeKey : stateKey);
  }

  observe(execution: NodeExecution<TState>, _ctx: PolicyContext): PolicyDecision {
    const key = this.keyFn(execution);
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (next > this.maxRepeats) {
      const reason =
        this.mode === "node"
          ? `node "${execution.node}" visited ${next} times (limit ${this.maxRepeats})`
          : `node "${execution.node}" revisited with identical state ${next} times (limit ${this.maxRepeats})`;
      return halt(this.name, reason, {
        node: execution.node,
        count: next,
        step: execution.step,
        mode: this.mode,
      });
    }
    return cont();
  }

  reset(_ctx: PolicyContext): void {
    this.counts = new Map();
  }
}
