import { describe, it, expect } from "vitest";
import type { Policy, TraceEvent } from "@graphos-io/core";
import { halt, cont } from "@graphos-io/core";
import { GraphOS, type GraphLike } from "./wrap.js";
import { PolicyViolationError } from "./errors.js";

const makeGraph = (
  chunks: Array<Record<string, unknown>>,
  { throwAt }: { throwAt?: number } = {}
): GraphLike => ({
  async invoke() {
    return undefined;
  },
  async *stream() {
    for (let i = 0; i < chunks.length; i++) {
      if (throwAt === i) throw new Error("boom");
      yield chunks[i]!;
    }
  },
});

describe("GraphOS.wrap onTrace", () => {
  it("emits session.start → step × N → session.end(complete)", async () => {
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(
      makeGraph([{ A: { x: 1 } }, { B: { x: 2 } }]),
      {
        projectId: "demo",
        onTrace: (e) => events.push(e),
      }
    );
    await wrapped.invoke({});

    expect(events.map((e) => e.kind)).toEqual([
      "session.start",
      "step",
      "step",
      "session.end",
    ]);

    const start = events[0] as Extract<TraceEvent, { kind: "session.start" }>;
    expect(start.projectId).toBe("demo");
    expect(start.sessionId).toMatch(/^gos_/);

    const end = events[3] as Extract<TraceEvent, { kind: "session.end" }>;
    expect(end.outcome).toBe("complete");
    expect(end.sessionId).toBe(start.sessionId);
  });

  it("attributes step events to the correct node and step index", async () => {
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(
      makeGraph([{ think: { i: 0 } }, { act: { i: 1 } }, { think: { i: 2 } }]),
      { onTrace: (e) => events.push(e) }
    );
    await wrapped.invoke({});

    const steps = events.filter(
      (e): e is Extract<TraceEvent, { kind: "step" }> => e.kind === "step"
    );
    expect(steps.map((s) => s.node)).toEqual(["think", "act", "think"]);
    expect(steps.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(steps.map((s) => s.state)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
  });

  it("emits mcp.call events when a step contains MCP-style tool calls", async () => {
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(
      makeGraph([
        {
          agent: {
            messages: [
              {
                tool_calls: [
                  { name: "filesystem__read_file", args: { path: "/tmp/demo.txt" } },
                ],
              },
            ],
          },
        },
      ]),
      { onTrace: (e) => events.push(e) }
    );

    await wrapped.invoke({});

    const mcpEvents = events.filter(
      (e): e is Extract<TraceEvent, { kind: "mcp.call" }> => e.kind === "mcp.call"
    );
    expect(mcpEvents).toHaveLength(1);
    expect(mcpEvents[0]).toMatchObject({
      server: "filesystem",
      tool: "read_file",
      source: "graph",
      step: 0,
    });
  });

  it("emits policy.halt → session.end(halted) when a policy halts", async () => {
    const haltAtStep1: Policy = {
      name: "Stopper",
      observe: (e) => (e.step === 1 ? halt("Stopper", "nope") : cont()),
    };
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(makeGraph([{ A: {} }, { B: {} }, { C: {} }]), {
      policies: [haltAtStep1],
      onTrace: (e) => events.push(e),
    });

    await expect(wrapped.invoke({})).rejects.toBeInstanceOf(PolicyViolationError);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      "session.start",
      "step",
      "step",
      "policy.halt",
      "session.end",
    ]);
    const haltEvent = events[3] as Extract<TraceEvent, { kind: "policy.halt" }>;
    expect(haltEvent.policy).toBe("Stopper");
    expect(haltEvent.step).toBe(1);
    const endEvent = events[4] as Extract<TraceEvent, { kind: "session.end" }>;
    expect(endEvent.outcome).toBe("halted");
  });

  it("emits session.end(error) when the underlying graph throws", async () => {
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(
      makeGraph([{ A: {} }, { B: {} }], { throwAt: 1 }),
      { onTrace: (e) => events.push(e) }
    );

    await expect(wrapped.invoke({})).rejects.toThrow("boom");

    const end = events.at(-1) as Extract<TraceEvent, { kind: "session.end" }>;
    expect(end.kind).toBe("session.end");
    expect(end.outcome).toBe("error");
    expect(end.error?.message).toBe("boom");
  });

  it("survives a listener that throws synchronously", async () => {
    const wrapped = GraphOS.wrap(makeGraph([{ A: { x: 1 } }]), {
      onTrace: () => {
        throw new Error("listener blew up");
      },
    });
    await expect(wrapped.invoke({})).resolves.toBeDefined();
  });

  it("survives a listener that rejects asynchronously", async () => {
    const wrapped = GraphOS.wrap(makeGraph([{ A: { x: 1 } }]), {
      onTrace: async () => {
        throw new Error("async listener blew up");
      },
    });
    await expect(wrapped.invoke({})).resolves.toBeDefined();
  });

  it("uses the same sessionId across every event of a single run", async () => {
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(makeGraph([{ A: {} }, { B: {} }]), {
      onTrace: (e) => events.push(e),
    });
    await wrapped.invoke({});
    const ids = new Set(events.map((e) => e.sessionId));
    expect(ids.size).toBe(1);
  });

  it("respects a user-supplied sessionId", async () => {
    const events: TraceEvent[] = [];
    const wrapped = GraphOS.wrap(makeGraph([{ A: {} }]), {
      sessionId: "my-session",
      onTrace: (e) => events.push(e),
    });
    await wrapped.invoke({});
    expect(events[0]?.sessionId).toBe("my-session");
  });
});

describe("GraphOS.wrap invoke()", () => {
  it("returns the merged final state, not the last raw chunk", async () => {
    const wrapped = GraphOS.wrap<{ a?: number; b?: number }, { a: number; b: number }>(
      makeGraph([{ nodeA: { a: 1 } }, { nodeB: { b: 2 } }])
    );
    const result = await wrapped.invoke({});
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("starts from the input as the initial state", async () => {
    const wrapped = GraphOS.wrap<{ start: string }, { start: string; ran: boolean }>(
      makeGraph([{ nodeA: { ran: true } }])
    );
    const result = await wrapped.invoke({ start: "hello" });
    expect(result).toEqual({ start: "hello", ran: true });
  });

  it("concatenates messages across steps (add_messages reducer behavior)", async () => {
    const wrapped = GraphOS.wrap(
      makeGraph([
        { nodeA: { messages: [{ role: "user", content: "hi" }] } },
        { nodeB: { messages: [{ role: "assistant", content: "hello" }] } },
      ])
    );
    const result = await wrapped.invoke({ messages: [] }) as {
      messages: Array<{ role: string }>;
    };
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("appends a single (non-array) message update to messages array", async () => {
    const wrapped = GraphOS.wrap(
      makeGraph([{ nodeA: { messages: { role: "assistant", content: "hi" } } }])
    );
    const result = await wrapped.invoke({ messages: [] }) as {
      messages: Array<{ role: string }>;
    };
    expect(result.messages).toEqual([{ role: "assistant", content: "hi" }]);
  });

  it("later step overwrites scalar keys (last-write-wins)", async () => {
    const wrapped = GraphOS.wrap(
      makeGraph([{ nodeA: { status: "running" } }, { nodeB: { status: "done" } }])
    );
    const result = await wrapped.invoke({}) as { status: string };
    expect(result.status).toBe("done");
  });
});
