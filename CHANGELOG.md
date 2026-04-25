# Changelog

## 1.0.0 — 2026-04-25

First public release. Three packages: `@graphos-io/core`, `@graphos-io/sdk`, `@graphos-io/dashboard`.

### SDK
- `GraphOS.wrap(graph, options)` — wrap any LangGraph.js compiled graph with policies + telemetry. Streams with `subgraphs: true` by default and unpacks tuple chunks so subgraph steps surface as qualified node names (e.g. `response_agent/llm_call`).
- `invoke()` returns the merged final state (last-write-wins, with `messages` concat for the `add_messages` reducer) — not the last raw chunk.
- `LoopGuard` with two modes:
  - `"state"` (default) — halt on identical-state revisits.
  - `"node"` — halt on N visits to a node regardless of state. Catches loops in real LangGraph agents whose `messages` accumulate every iteration.
- `BudgetGuard` — cumulative-cost ceiling.
- `tokenCost()` — drop-in cost extractor that reads `usage_metadata` / `response_metadata.usage` / `tokenUsage` off LangChain messages and applies a per-model price table (OpenAI + Anthropic). Substring match handles dated model IDs.
- `createWebSocketTransport()` — pass as `onTrace` to stream events to a local dashboard.
- `PolicyViolationError` — typed throw when a policy halts.

### Dashboard
- `graphos dashboard` CLI (`npx @graphos-io/dashboard graphos dashboard`).
- Live React Flow graph with node-state highlighting (active / halted / focused).
- Time-travel scrubber over historical sessions.
- Per-step detail panel: LangChain messages with role, content, tool calls, model, and token usage. Renders policy halt details (reason + structured payload) and session start/end payloads.
- SQLite persistence at `~/.graphos/traces.db` with bounded retention (default: 200 most-recent sessions, configurable via `GRAPHOS_RETENTION_SESSIONS`).
- Session switcher rail.

### Validated against
- `langchain-ai/agents-from-scratch-ts` — triage + ReAct subgraph pattern. LoopGuard (`mode: "node"`) halts on the response-agent llm_call loop; BudgetGuard halts cleanly with `tokenCost()` extracting real usage off mock OpenAI responses.
