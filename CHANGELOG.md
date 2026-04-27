# Changelog

## 1.2.1 — 2026-04-28

### Fixed
- **`graphos-io@1.0.1`** — `token_cost()` now recognizes LangChain Python's Pydantic message classes (`AIMessage`, `HumanMessage`, …), not just plain dicts. In `1.0.0`, `_find_messages` rejected anything that wasn't a `dict`, so a real LangGraph Python agent's `state["messages"]` (which contains `AIMessage` instances) was silently skipped — `BudgetGuard` always saw `$0.00` and never halted. Coercion now matches `_canonical.py`: dict → as-is, Pydantic → `model_dump()`, dataclass-ish → `vars()`. Found while wrapping `langchain-ai/retrieval-agent-template` end-to-end as a Python-side benchmark; regression test added with a real `langchain-core` `AIMessage`.

## 1.2.0 — 2026-04-27

### Added
- **`graphos-io@1.0.0`** on PyPI — Python SDK at full feature parity with the TypeScript one. Async-first (`await managed.invoke(...)`, `async for chunk in managed.stream(...)`).
  - `wrap()` for any compiled LangGraph (Python). Defaults to `subgraphs=True` and `stream_mode="updates"` to match the TS wrap.
  - `LoopGuard` (state + node modes), `BudgetGuard`, `MCPGuard`, `extract_mcp_tool_calls`, `token_cost`.
  - `create_websocket_transport` — ships into the same dashboard the TS SDK does. Bounded queue (drops oldest on overflow), exponential-backoff reconnect (1s → 30s), fire-and-forget API, never crashes the wrapped graph.
  - Pydantic v2 models for all trace events. Field names mirror the TS SDK exactly so the dashboard receives the same shape from both languages.
  - Strictly typed (`mypy --strict` clean), security-linted with `ruff` (bandit rules enabled), 60 unit tests including real-WebSocket reconnect-and-flush coverage.
- Root README: Python install + quick-start tab next to TS, packages table now shows language column, roadmap flips Python SDK parity to ✅.

### Notes
- Same monorepo, same versioning cadence, same CHANGELOG. The Python wheel is built from `python/` with hatchling and ships standalone — Python users do not need Node installed unless they want the dashboard.

## 1.1.0 — 2026-04-26

### Added
- **`MCPGuard`** policy — allow/deny MCP servers and tools, plus per-session and per-tool call caps. Parses qualified tool names (`mcp__server__tool`, `server/tool`, `server:tool`).
- **`@graphos-io/mcp-proxy@1.0.0`** — new package. `createMCPProxy(upstream, options)` wraps an MCP tool implementation, applies the same allow/deny + call-cap rules before the upstream call, supports arg/result redaction, and emits the same trace events as the SDK.
- New `TraceEvent` kinds: `mcp.call`, `mcp.result`, `mcp.blocked` (with `source: "graph" | "proxy"`).
- New core types: `MCPToolCall`, `MCPToolResult`.
- `extractMCPToolCalls(execution)` helper exported from `@graphos-io/sdk`.

### Changed
- `GraphOS.wrap()` now auto-emits `mcp.call` events for any step containing MCP-style tool calls, regardless of whether `MCPGuard` is in the policies list. Lets the dashboard surface MCP activity without opting in.

### Dashboard
- New detail panels for `mcp.call`, `mcp.result`, `mcp.blocked` events showing server, tool, args, and result.
- Scrubber timeline now highlights MCP events with distinct colors (amber for call/result, red for blocked).
- Visual assets: wordmark logo, architecture SVG, and a 12-second hero demo video are embedded in the README and docs.

### Docs
- Long-form launch post at `docs/blog/benchmark-story-graphos.md` covering the GraphOS-vs-`agents-from-scratch-ts` integration end to end.

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
