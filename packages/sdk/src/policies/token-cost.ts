import type { NodeExecution } from "@graphos/core";

export interface PriceEntry {
  input: number;
  output: number;
}

export interface TokenCostOptions {
  prices?: Record<string, PriceEntry>;
  fallback?: PriceEntry | number;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export const DEFAULT_PRICES: Record<string, PriceEntry> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1-mini": { input: 3, output: 12 },
  "o1-preview": { input: 15, output: 60 },
  o1: { input: 15, output: 60 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-haiku-4": { input: 1, output: 5 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-opus-4": { input: 15, output: 75 },
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const extractUsage = (msg: Record<string, unknown>): TokenUsage | undefined => {
  const direct = msg["usage_metadata"];
  if (isObject(direct)) {
    const input = num(direct["input_tokens"]);
    const output = num(direct["output_tokens"]);
    if (input !== undefined || output !== undefined) {
      return { input: input ?? 0, output: output ?? 0 };
    }
  }

  const meta = msg["response_metadata"];
  if (isObject(meta)) {
    const tokenUsage = meta["tokenUsage"];
    if (isObject(tokenUsage)) {
      const input = num(tokenUsage["promptTokens"]);
      const output = num(tokenUsage["completionTokens"]);
      if (input !== undefined || output !== undefined) {
        return { input: input ?? 0, output: output ?? 0 };
      }
    }
    const usage = meta["usage"];
    if (isObject(usage)) {
      const input =
        num(usage["input_tokens"]) ?? num(usage["prompt_tokens"]);
      const output =
        num(usage["output_tokens"]) ?? num(usage["completion_tokens"]);
      if (input !== undefined || output !== undefined) {
        return { input: input ?? 0, output: output ?? 0 };
      }
    }
  }

  return undefined;
};

const extractModel = (msg: Record<string, unknown>): string | undefined => {
  const meta = msg["response_metadata"];
  if (isObject(meta)) {
    const m =
      (typeof meta["model_name"] === "string" && meta["model_name"]) ||
      (typeof meta["model"] === "string" && meta["model"]);
    if (m) return m as string;
  }
  const lc = msg["lc_kwargs"];
  if (isObject(lc)) {
    const meta2 = lc["response_metadata"];
    if (isObject(meta2)) {
      const m =
        (typeof meta2["model_name"] === "string" && meta2["model_name"]) ||
        (typeof meta2["model"] === "string" && meta2["model"]);
      if (m) return m as string;
    }
  }
  return undefined;
};

const findMessages = (state: unknown): Record<string, unknown>[] => {
  if (!isObject(state) && !Array.isArray(state)) return [];
  const out: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isObject(item) && ("usage_metadata" in item || "response_metadata" in item)) {
          out.push(item);
        }
      }
      return;
    }
    if (!isObject(v)) return;
    if (seen.has(v)) return;
    seen.add(v);
    const messages = v["messages"];
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (isObject(m)) out.push(m);
      }
    }
    for (const key of Object.keys(v)) {
      if (key === "messages") continue;
      walk(v[key], depth + 1);
    }
  };
  walk(state, 0);
  return out;
};

const findPrice = (
  prices: Record<string, PriceEntry>,
  model: string
): PriceEntry | undefined => {
  if (prices[model]) return prices[model];
  let best: { key: string; entry: PriceEntry } | undefined;
  for (const key of Object.keys(prices)) {
    if (model.includes(key)) {
      if (!best || key.length > best.key.length) {
        best = { key, entry: prices[key]! };
      }
    }
  }
  return best?.entry;
};

export const tokenCost = <TState = unknown>(
  opts: TokenCostOptions = {}
): ((execution: NodeExecution<TState>) => number) => {
  const prices = opts.prices ?? DEFAULT_PRICES;
  const fallback = opts.fallback ?? 0;

  const apply = (usage: TokenUsage, price: PriceEntry): number =>
    (usage.input * price.input + usage.output * price.output) / 1_000_000;

  return (execution: NodeExecution<TState>): number => {
    let total = 0;
    for (const msg of findMessages(execution.state)) {
      const usage = extractUsage(msg);
      if (!usage) continue;
      const model = extractModel(msg);
      const price = model ? findPrice(prices, model) : undefined;
      if (price) {
        total += apply(usage, price);
      } else if (typeof fallback === "number") {
        total += fallback;
      } else {
        total += apply(usage, fallback);
      }
    }
    return total;
  };
};
