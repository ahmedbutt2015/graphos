import { describe, it, expect } from "vitest";
import type {
  NodeExecution,
  NodeId,
  PolicyContext,
  SessionId,
} from "@graphos/core";
import { LoopGuard } from "./loop-guard.js";

const ctx: PolicyContext = { sessionId: "s1" as SessionId };

const exec = <S>(node: string, state: S, step: number): NodeExecution<S> => ({
  sessionId: ctx.sessionId,
  node: node as NodeId,
  state,
  step,
  timestamp: 0,
});

describe("LoopGuard", () => {
  it("continues when every (node, state) pair is unique", () => {
    const guard = new LoopGuard<{ n: number }>({ maxRepeats: 3 });
    for (let i = 0; i < 10; i++) {
      const d = guard.observe(exec("count", { n: i }, i), ctx);
      expect(d.kind).toBe("continue");
    }
  });

  it("halts when the same (node, state) exceeds maxRepeats", () => {
    const guard = new LoopGuard<{ n: number }>({ maxRepeats: 3 });
    for (let i = 0; i < 3; i++) {
      expect(guard.observe(exec("A", { n: 1 }, i), ctx).kind).toBe("continue");
    }
    const halted = guard.observe(exec("A", { n: 1 }, 3), ctx);
    expect(halted.kind).toBe("halt");
    if (halted.kind === "halt") {
      expect(halted.policy).toBe("LoopGuard");
      expect(halted.reason).toContain("A");
    }
  });

  it("detects A→B→A→B ping-pong when state converges", () => {
    const guard = new LoopGuard<{ done: boolean }>({ maxRepeats: 2 });
    const seq = ["A", "B", "A", "B", "A", "B"];
    const decisions = seq.map((node, i) =>
      guard.observe(exec(node, { done: false }, i), ctx)
    );
    expect(decisions.slice(0, 4).every((d) => d.kind === "continue")).toBe(true);
    const last = decisions[5];
    expect(last?.kind).toBe("halt");
  });

  it("does NOT halt when ping-pong state mutates every visit", () => {
    const guard = new LoopGuard<{ n: number }>({ maxRepeats: 2 });
    const seq: Array<[string, number]> = [
      ["A", 1], ["B", 1], ["A", 2], ["B", 2], ["A", 3], ["B", 3],
    ];
    for (const [i, [node, n]] of seq.entries()) {
      const d = guard.observe(exec(node, { n }, i), ctx);
      expect(d.kind).toBe("continue");
    }
  });

  it("treats object key order as equivalent (canonical JSON)", () => {
    const guard = new LoopGuard<Record<string, number>>({ maxRepeats: 1 });
    expect(guard.observe(exec("A", { a: 1, b: 2 }, 0), ctx).kind).toBe("continue");
    const d = guard.observe(exec("A", { b: 2, a: 1 }, 1), ctx);
    expect(d.kind).toBe("halt");
  });

  it("honors custom key function (node-only matching)", () => {
    const guard = new LoopGuard<{ n: number }>({
      maxRepeats: 2,
      key: (e) => e.node,
    });
    expect(guard.observe(exec("A", { n: 1 }, 0), ctx).kind).toBe("continue");
    expect(guard.observe(exec("A", { n: 2 }, 1), ctx).kind).toBe("continue");
    const d = guard.observe(exec("A", { n: 3 }, 2), ctx);
    expect(d.kind).toBe("halt");
  });

  it("reset() clears history so a new session starts fresh", () => {
    const guard = new LoopGuard<{ n: number }>({ maxRepeats: 1 });
    expect(guard.observe(exec("A", { n: 1 }, 0), ctx).kind).toBe("continue");
    expect(guard.observe(exec("A", { n: 1 }, 1), ctx).kind).toBe("halt");
    guard.reset(ctx);
    expect(guard.observe(exec("A", { n: 1 }, 0), ctx).kind).toBe("continue");
  });
});
