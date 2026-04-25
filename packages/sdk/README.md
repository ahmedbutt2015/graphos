# @graphos-io/sdk

Wrap any LangGraph.js compiled graph with policy enforcement and live telemetry.

```bash
npm install @graphos-io/sdk
```

## Quick start

```typescript
import {
  GraphOS,
  LoopGuard,
  BudgetGuard,
  tokenCost,
  createWebSocketTransport,
  PolicyViolationError,
} from "@graphos-io/sdk";
import { myCompiledGraph } from "./agent";

const managed = GraphOS.wrap(myCompiledGraph, {
  projectId: "my-agent",
  policies: [
    new LoopGuard({ mode: "node", maxRepeats: 10 }),
    new BudgetGuard({ usdLimit: 2.0, cost: tokenCost() }),
  ],
  onTrace: createWebSocketTransport(),
});

try {
  const result = await managed.invoke(input);
} catch (err) {
  if (err instanceof PolicyViolationError) {
    console.log(`${err.policy}: ${err.reason}`);
  }
}
```

`managed.invoke(input, config?)` runs the graph to completion and returns the merged final state. `managed.stream(input, config?)` yields per-step chunks the same way LangGraph's stream does. The wrap defaults to `{ subgraphs: true }` so subgraph steps surface as qualified node names like `response_agent/llm_call`.

## Policies

### `LoopGuard`

```typescript
new LoopGuard({ mode: "state" | "node", maxRepeats?: number })
```

- `mode: "state"` (default) — counts identical-state revisits to a node. Catches deterministic cycles where the agent ping-pongs between two nodes with no progress.
- `mode: "node"` — counts node visits regardless of state. Use this for real LangGraph agents whose `messages` accumulate every iteration (so "identical state" never happens). `maxRepeats: 10` is a sane starting point.
- `key`: optional `(execution) => string` for custom dedup keys.

### `BudgetGuard`

```typescript
new BudgetGuard({ usdLimit: number, cost: (execution) => number })
```

Sums `cost(execution)` across every step and halts when cumulative spend exceeds `usdLimit`. Pair with `tokenCost()` for the common case.

### `tokenCost()`

```typescript
tokenCost({ prices?, fallback? })
```

A drop-in `cost` function that walks `execution.state` for LangChain messages, extracts usage from `usage_metadata` / `response_metadata.usage` / `response_metadata.tokenUsage`, and applies a per-model price table. Default table covers OpenAI (`gpt-4o`, `gpt-4`, `gpt-3.5-turbo`, `o1`) and Anthropic (`claude-3/3.5/4` family). Substring match handles dated IDs like `claude-3-5-sonnet-20241022`.

```typescript
new BudgetGuard({
  usdLimit: 1,
  cost: tokenCost({ fallback: 0.01 }),  // flat $0.01 per step for unknown models
});
```

For a custom model, pass `{ prices: { "my-model": { input: 1, output: 2 } } }` (USD per 1M tokens).

## Transport

```typescript
createWebSocketTransport({ url?: string, reconnectMs?: number })
```

Default URL is `ws://localhost:4001/graphos`. Pass it as `onTrace` and start the dashboard with `npx @graphos-io/dashboard graphos dashboard`.

You can pass any `(event) => void | Promise<void>` as `onTrace` if you'd rather log events somewhere else.

## License

MIT
