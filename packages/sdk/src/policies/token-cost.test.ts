import { describe, it, expect } from "vitest";
import type {
  NodeExecution,
  NodeId,
  PolicyContext,
  SessionId,
} from "@graphos-io/core";
import { tokenCost, DEFAULT_PRICES } from "./token-cost.js";

const ctx: PolicyContext = { sessionId: "s1" as SessionId };

const exec = <S>(node: string, state: S, step = 0): NodeExecution<S> => ({
  sessionId: ctx.sessionId,
  node: node as NodeId,
  state,
  step,
  timestamp: 0,
});

const aiMessage = (
  model: string,
  input: number,
  output: number,
  shape: "usage_metadata" | "response_metadata.usage" | "response_metadata.tokenUsage" = "usage_metadata"
) => {
  if (shape === "usage_metadata") {
    return {
      role: "assistant",
      content: "...",
      usage_metadata: {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
      },
      response_metadata: { model_name: model },
    };
  }
  if (shape === "response_metadata.usage") {
    return {
      role: "assistant",
      content: "...",
      response_metadata: {
        model,
        usage: { input_tokens: input, output_tokens: output },
      },
    };
  }
  return {
    role: "assistant",
    content: "...",
    response_metadata: {
      model_name: model,
      tokenUsage: { promptTokens: input, completionTokens: output },
    },
  };
};

describe("tokenCost", () => {
  it("returns 0 for state with no messages", () => {
    const cost = tokenCost();
    expect(cost(exec("n", { foo: "bar" }))).toBe(0);
  });

  it("prices a single gpt-4o-mini message using default table", () => {
    const cost = tokenCost();
    const state = {
      messages: [aiMessage("gpt-4o-mini", 1000, 500)],
    };
    // 1000 * 0.15 / 1M + 500 * 0.60 / 1M = 0.00015 + 0.0003 = 0.00045
    expect(cost(exec("n", state))).toBeCloseTo(0.00045, 8);
  });

  it("handles response_metadata.usage shape (Anthropic-style)", () => {
    const cost = tokenCost();
    const state = {
      messages: [aiMessage("claude-3-5-sonnet", 2000, 1000, "response_metadata.usage")],
    };
    // 2000 * 3 / 1M + 1000 * 15 / 1M = 0.006 + 0.015 = 0.021
    expect(cost(exec("n", state))).toBeCloseTo(0.021, 6);
  });

  it("handles response_metadata.tokenUsage shape (legacy LangChain.js)", () => {
    const cost = tokenCost();
    const state = {
      messages: [aiMessage("gpt-4o", 500, 200, "response_metadata.tokenUsage")],
    };
    // 500 * 2.5 / 1M + 200 * 10 / 1M = 0.00125 + 0.002 = 0.00325
    expect(cost(exec("n", state))).toBeCloseTo(0.00325, 8);
  });

  it("sums cost across multiple messages in the same update", () => {
    const cost = tokenCost();
    const state = {
      messages: [
        aiMessage("gpt-4o-mini", 1000, 500),
        aiMessage("gpt-4o-mini", 500, 250),
      ],
    };
    expect(cost(exec("n", state))).toBeCloseTo(0.000675, 8);
  });

  it("falls back to flat number when model is unknown", () => {
    const cost = tokenCost({ fallback: 0.01 });
    const state = {
      messages: [aiMessage("some-weird-model-v99", 1000, 500)],
    };
    expect(cost(exec("n", state))).toBe(0.01);
  });

  it("falls back to provided PriceEntry when model is unknown", () => {
    const cost = tokenCost({ fallback: { input: 1, output: 2 } });
    const state = {
      messages: [aiMessage("unknown-model", 1_000_000, 1_000_000)],
    };
    expect(cost(exec("n", state))).toBeCloseTo(3, 6);
  });

  it("falls back to 0 by default when model is unknown", () => {
    const cost = tokenCost();
    const state = {
      messages: [aiMessage("unknown-model", 1000, 500)],
    };
    expect(cost(exec("n", state))).toBe(0);
  });

  it("uses longest-key substring match so 'claude-3-5-sonnet-20241022' maps to claude-3-5-sonnet", () => {
    const cost = tokenCost();
    const state = {
      messages: [aiMessage("claude-3-5-sonnet-20241022", 1000, 500)],
    };
    // should use claude-3-5-sonnet: input 3, output 15
    expect(cost(exec("n", state))).toBeCloseTo(0.0105, 6);
  });

  it("ignores messages without usage (e.g. HumanMessage)", () => {
    const cost = tokenCost();
    const state = {
      messages: [
        { role: "user", content: "hi" },
        aiMessage("gpt-4o-mini", 100, 50),
      ],
    };
    // only the assistant message counts
    expect(cost(exec("n", state))).toBeCloseTo(0.00004500, 8);
  });

  it("finds messages nested inside subgraph state updates", () => {
    const cost = tokenCost();
    const state = {
      response_agent: {
        messages: [aiMessage("gpt-4o-mini", 1000, 500)],
      },
    };
    expect(cost(exec("n", state))).toBeCloseTo(0.00045, 8);
  });

  it("respects a custom price table", () => {
    const cost = tokenCost({
      prices: { "my-model": { input: 1, output: 1 } },
    });
    const state = {
      messages: [
        {
          role: "assistant",
          usage_metadata: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
          response_metadata: { model_name: "my-model" },
        },
      ],
    };
    expect(cost(exec("n", state))).toBeCloseTo(2, 6);
  });

  it("DEFAULT_PRICES is stable export", () => {
    expect(DEFAULT_PRICES["gpt-4o"]).toEqual({ input: 2.5, output: 10 });
  });
});
