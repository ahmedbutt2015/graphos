---
title: "GraphOS v1 — a local-first observability layer for LangGraph.js agents"
description: "Wrap your LangGraph.js compiled graph in one line, halt runaway loops, cap spend, and watch every step in a live dashboard. No SaaS, no signup, no telemetry leaving your machine."
tags: [langchain, ai, typescript, opensource]
canonical_url: https://github.com/ahmedbutt2015/graphos
cover_image:
published: true
---

# GraphOS v1 is out

> **TL;DR** — `@graphos-io/sdk` wraps any LangGraph.js compiled graph in one line. You get loop-detection, a per-session USD cost ceiling, and a local SQLite-backed dashboard with time-travel replay. MIT-licensed, runs entirely on `localhost`. `npm install @graphos-io/sdk` to try.

I built GraphOS because the same three things keep biting me when I move LangGraph agents from a notebook into something real:

1. The agent gets stuck in a loop and silently burns tokens.
2. One bad prompt blows past my OpenAI budget before I notice.
3. When something does go wrong inside a 20-step run, I can't actually *see* what happened — there's no built-in equivalent of Chrome DevTools for an agent.

LangSmith solves the third problem if you're willing to send your traces to a SaaS. I wanted the local-first version, with a couple of guardrails that should have been there from day one. So:

```bash
npm install @graphos-io/sdk
```

## What it does in 30 seconds

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
  const result = await managed.invoke({ messages: [...] });
} catch (err) {
  if (err instanceof PolicyViolationError) {
    console.log(`halted by ${err.policy}: ${err.reason}`);
  }
}
```

That's the entire integration. `GraphOS.wrap()` returns a `{ invoke, stream }` that's a drop-in for what LangGraph already gives you — but every step is now observable and every step is now subject to whatever policies you pass in.

In another terminal:

```bash
npx @graphos-io/dashboard graphos dashboard
```

Open `http://localhost:4000` and you get a live React Flow graph of your nodes lighting up as the agent runs, a time-travel scrubber over the session history, and a per-step detail panel that surfaces the LangChain message, the tool call args, the model used, and the token usage for that step.

## The two policies that ship in v1

### `LoopGuard`

Two modes, both useful:

- `mode: "state"` (default) — halt when a node is revisited with identical state. Catches deterministic ping-pong loops where the agent hits the same stuck point over and over.
- `mode: "node"` — halt after N visits to a node regardless of state. This is the one you want for real LangGraph agents whose `messages` array grows on every iteration, so "identical state" never actually triggers. `maxRepeats: 10` is a reasonable starting point.

I learned mode `"node"` was necessary the hard way. The first benchmark I wrapped — `langchain-ai/agents-from-scratch-ts` — has a ReAct subgraph (`response_agent/llm_call ↔ environment`) that loops cleanly forever in pathological cases. Pure state-equality couldn't catch it because every iteration appended a new `AIMessage` to the state. Counting visits per qualified node name does.

### `BudgetGuard` + `tokenCost()`

`BudgetGuard` is a cumulative-cost ceiling. The interesting piece is `tokenCost()`, which is the cost extractor I wish came with LangChain.js out of the box:

```typescript
new BudgetGuard({ usdLimit: 2.0, cost: tokenCost() });
```

It walks the state for LangChain messages, pulls usage out of `usage_metadata` / `response_metadata.usage` / `tokenUsage` (covers all three shapes I've seen in the wild), looks up the model in a built-in price table for OpenAI and Anthropic, and returns a real USD number. Substring matching handles dated model IDs like `claude-3-5-sonnet-20241022`. For unknown models, you can pass a `fallback` price entry or a flat per-step number.

## Why local-first

The dashboard runs on your machine. Your traces persist to `~/.graphos/traces.db`, a plain SQLite file. There is no account, no API key, no cloud, no telemetry. The SDK exchanges events with the dashboard over `localhost` WebSockets only.

Two practical consequences:

1. You can wrap an agent with proprietary prompts or NDA-bound data without sending a single byte off-machine.
2. Your trace history is just a file. Want to back it up? `cp traces.db elsewhere`. Want to share a session with a colleague? Export it. Want a hundred GB of traces? OK — though by default the dashboard prunes to the most-recent 200 sessions, configurable via `GRAPHOS_RETENTION_SESSIONS`.

This is the LangSmith trade-off inverted. LangSmith is great if you want the convenience of a hosted UI and your team already pays for it. GraphOS is what you reach for when you want zero deployment, zero auth, zero ongoing cost, and full control over the data.

## The dashboard

The thing I'm proudest of in v1 is the per-step detail panel. Clicking any step on the time-travel scrubber gives you:

- The LangChain message at that step, with role-coloring (assistant / user / tool / system).
- The model name (`gpt-4o`, `claude-3-5-sonnet`, etc.).
- Token counts as `input↓ / output↑`.
- Tool calls expanded with pretty-printed JSON args.
- For `policy.halt` events, the policy name, the human reason, and the structured `details` payload (so for `LoopGuard` you see `{ count: 7, mode: "node", node: "..." }`).

It also unwraps LangChain's `{ lc: 1, type: "constructor", id, kwargs }` serialization automatically, which means you don't have to dig through nested objects to see what the agent actually said.

Click a node on the graph to jump the scrubber to that node's most recent visit. Drag the scrubber to walk through any past run step by step. There's no playback "speed" or "frame rate" — just direct manipulation of which step you're inspecting.

## What's *not* in v1 (honest list)

- **MCPGuard / MCP proxy.** Listed in the roadmap, deferred until I'm confident in the shape of the API. I'd rather ship two tight policies than three half-baked ones.
- **Python SDK.** Same monorepo decision applies — TypeScript first, Python later if there's demand.
- **Cloud / multi-tenant mode.** Possibly never. The local-first stance is a feature, not a placeholder.
- **Multi-provider validation.** v1 has been wrapped end-to-end against one OSS LangGraph agent (`agents-from-scratch-ts`). The token-cost extractor has unit-test coverage for OpenAI, Anthropic, and Gemini message shapes, but I haven't run a Gemini-backed agent through the wrap yet. If you do and something breaks, file an issue.

## What I'd love feedback on

- **Real-world LangGraph agents.** If you wrap your agent and something crashes or surfaces wrong, please file an issue with the graph shape. I'm hungry for benchmarks, especially supervisor + sub-agent patterns and graphs with custom state reducers (the default reducer in `invoke()` does last-write-wins + `messages` concat, which works for `add_messages` but not for arbitrary custom reducers).
- **Policy ideas.** I'm open to PRs for new policies. The interface is small — implement `Policy<TState>`, return `cont()` or `halt()` from `observe()`. See `@graphos-io/core` for types.
- **The dashboard UX.** It's deliberately minimal. If there's a panel or visualization that would actually help you debug your agents (vs. being a feature for its own sake), open an issue.

## Try it

```bash
# In your agent's project
npm install @graphos-io/sdk

# In a separate terminal
npx @graphos-io/dashboard graphos dashboard
# open http://localhost:4000
```

GitHub: **https://github.com/ahmedbutt2015/graphos**
npm: **https://www.npmjs.com/package/@graphos-io/sdk**

If you build something with it, I'd love to know.

— Ahmed
