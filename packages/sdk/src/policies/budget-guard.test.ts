import { describe, it, expect } from "vitest";
import type {
  NodeExecution,
  NodeId,
  PolicyContext,
  SessionId,
} from "@graphos-io/core";
import { BudgetGuard } from "./budget-guard.js";

const ctx: PolicyContext = { sessionId: "s1" as SessionId };

const exec = <S>(node: string, state: S, step: number): NodeExecution<S> => ({
  sessionId: ctx.sessionId,
  node: node as NodeId,
  state,
  step,
  timestamp: 0,
});

describe("BudgetGuard", () => {
  it("continues while cumulative cost stays at or below the limit", () => {
    const guard = new BudgetGuard<unknown>({
      usdLimit: 0.1,
      cost: () => 0.02,
    });
    for (let i = 0; i < 5; i++) {
      expect(guard.observe(exec("n", null, i), ctx).kind).toBe("continue");
    }
  });

  it("halts the first step where cumulative cost exceeds the limit", () => {
    const guard = new BudgetGuard<unknown>({
      usdLimit: 0.05,
      cost: () => 0.03,
    });
    expect(guard.observe(exec("n", null, 0), ctx).kind).toBe("continue");
    const d = guard.observe(exec("n", null, 1), ctx);
    expect(d.kind).toBe("halt");
    if (d.kind === "halt") {
      expect(d.policy).toBe("BudgetGuard");
      expect(d.reason).toMatch(/0\.06.*0\.05/);
    }
  });

  it("treats 0-cost steps as free and never halts", () => {
    const guard = new BudgetGuard<unknown>({
      usdLimit: 0.01,
      cost: () => 0,
    });
    for (let i = 0; i < 100; i++) {
      expect(guard.observe(exec("n", null, i), ctx).kind).toBe("continue");
    }
  });

  it("halts on a negative cost extractor result", () => {
    const guard = new BudgetGuard<unknown>({
      usdLimit: 1,
      cost: () => -0.01,
    });
    const d = guard.observe(exec("n", null, 0), ctx);
    expect(d.kind).toBe("halt");
    if (d.kind === "halt") {
      expect(d.reason).toContain("invalid");
    }
  });

  it("halts on NaN cost", () => {
    const guard = new BudgetGuard<unknown>({
      usdLimit: 1,
      cost: () => Number.NaN,
    });
    expect(guard.observe(exec("n", null, 0), ctx).kind).toBe("halt");
  });

  it("throws on construction with non-positive usdLimit", () => {
    expect(() => new BudgetGuard({ usdLimit: 0, cost: () => 0 })).toThrow();
    expect(() => new BudgetGuard({ usdLimit: -1, cost: () => 0 })).toThrow();
  });

  it("reset() clears spent so a new session starts at zero", () => {
    const guard = new BudgetGuard<unknown>({
      usdLimit: 0.05,
      cost: () => 0.03,
    });
    guard.observe(exec("n", null, 0), ctx);
    expect(guard.observe(exec("n", null, 1), ctx).kind).toBe("halt");
    guard.reset(ctx);
    expect(guard.observe(exec("n", null, 0), ctx).kind).toBe("continue");
  });

  it("uses the NodeExecution state via the cost extractor", () => {
    interface S {
      tokens: number;
    }
    const guard = new BudgetGuard<S>({
      usdLimit: 0.01,
      cost: (e) => e.state.tokens * 0.000001,
    });
    expect(guard.observe(exec("n", { tokens: 1000 }, 0), ctx).kind).toBe("continue");
    expect(guard.observe(exec("n", { tokens: 5_000 }, 1), ctx).kind).toBe("continue");
    expect(guard.observe(exec("n", { tokens: 10_000 }, 2), ctx).kind).toBe("halt");
  });
});
