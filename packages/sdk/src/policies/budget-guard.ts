import type {
  NodeExecution,
  Policy,
  PolicyContext,
  PolicyDecision,
} from "@graphos/core";
import { cont, halt } from "@graphos/core";

export interface BudgetGuardOptions<TState = unknown> {
  usdLimit: number;
  cost: (execution: NodeExecution<TState>) => number;
}

export class BudgetGuard<TState = unknown> implements Policy<TState> {
  readonly name = "BudgetGuard";
  private readonly usdLimit: number;
  private readonly costFn: (execution: NodeExecution<TState>) => number;
  private spent = 0;

  constructor(options: BudgetGuardOptions<TState>) {
    if (options.usdLimit <= 0) {
      throw new Error("BudgetGuard: usdLimit must be > 0");
    }
    this.usdLimit = options.usdLimit;
    this.costFn = options.cost;
  }

  observe(
    execution: NodeExecution<TState>,
    _ctx: PolicyContext
  ): PolicyDecision {
    const step = this.costFn(execution);
    if (!Number.isFinite(step) || step < 0) {
      return halt(
        this.name,
        `cost extractor returned invalid value ${step} for node "${execution.node}"`,
        { node: execution.node, step: execution.step, value: step }
      );
    }
    this.spent += step;
    if (this.spent > this.usdLimit) {
      return halt(
        this.name,
        `session cost $${this.spent.toFixed(4)} exceeded limit $${this.usdLimit.toFixed(4)}`,
        {
          node: execution.node,
          step: execution.step,
          spent: this.spent,
          limit: this.usdLimit,
        }
      );
    }
    return cont();
  }

  reset(_ctx: PolicyContext): void {
    this.spent = 0;
  }
}
