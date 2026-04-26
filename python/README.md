# graphos-io

[![PyPI version](https://img.shields.io/pypi/v/graphos-io.svg?color=7cffb0)](https://pypi.org/project/graphos-io/)
[![Python ≥ 3.10](https://img.shields.io/pypi/pyversions/graphos-io.svg?color=7cffb0)](https://pypi.org/project/graphos-io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**GraphOS for Python** — local-first observability and policy guards for [LangGraph](https://langchain-ai.github.io/langgraph/) agents.

Wrap any compiled graph in one line. Catch infinite loops, cap spend, and stream every step into a local dashboard. No SaaS, no signup, no telemetry leaving your machine.

```bash
pip install graphos-io
```

This is the Python sibling of [`@graphos-io/sdk`](https://www.npmjs.com/package/@graphos-io/sdk). Both ship into the same dashboard over the same JSON-over-WebSocket protocol — you can run a Python agent on the left and a TypeScript agent on the right and watch both in one UI.

---

## Quick start

```python
import asyncio

from graphos_io import (
    BudgetGuard,
    LoopGuard,
    MCPGuard,
    PolicyViolationError,
    create_websocket_transport,
    token_cost,
    wrap,
)
from my_agent import build_graph  # your compiled LangGraph

async def main() -> None:
    graph = build_graph()  # langgraph CompiledGraph

    managed = wrap(
        graph,
        project_id="my-agent",
        policies=[
            LoopGuard(mode="node", max_repeats=10),
            MCPGuard(deny_servers=["filesystem"], max_calls_per_tool=5),
            BudgetGuard(usd_limit=2.0, cost=token_cost()),
        ],
        on_trace=create_websocket_transport(),
    )

    try:
        result = await managed.invoke({"messages": [{"role": "user", "content": "Analyze the market."}]})
        print(result)
    except PolicyViolationError as err:
        print(f"halted by {err.policy}: {err.reason}")

asyncio.run(main())
```

`managed.invoke(input)` returns the merged final state. `managed.stream(input)` yields per-step chunks if you need finer control. The wrap defaults to `subgraphs=True` and `stream_mode="updates"` so subgraph steps surface as qualified node names like `response_agent/llm_call`.

---

## Run the dashboard

```bash
npx @graphos-io/dashboard graphos dashboard
# open http://localhost:4000
```

The dashboard is one binary written in TypeScript that listens for trace events on `ws://localhost:4001/graphos`. Whether you point a Python or a TypeScript SDK at it makes no difference — the wire format is identical.

---

## Policies

### `LoopGuard`

```python
LoopGuard(mode="state" | "node", max_repeats=10)
```

- `mode="state"` (default) — halts when a node revisits with identical state. Catches deterministic ping-pong loops where the agent is genuinely stuck.
- `mode="node"` — halts after N visits to a node regardless of state. Use this for real LangGraph agents whose `messages` array grows on every iteration, so "identical state" never actually triggers.
- `key=lambda exec: ...` — optional custom dedup key.

### `BudgetGuard`

```python
BudgetGuard(usd_limit=2.0, cost=lambda exec: ...)
```

Sums `cost(execution)` across every step and halts when cumulative spend exceeds `usd_limit`. Pair with `token_cost()` for the common case.

### `MCPGuard`

```python
MCPGuard(
    allow_servers=[...],
    deny_servers=[...],
    allow_tools=[...],
    deny_tools=[...],
    max_calls_per_session=20,
    max_calls_per_tool=5,
)
```

Inspects MCP-style tool calls in your graph state and halts when a call hits a denied server/tool, falls outside an allow-list, or exceeds the configured per-session / per-tool caps. The wrap also auto-emits `mcp.call` trace events so the dashboard can show every MCP invocation.

### `token_cost()`

```python
from graphos_io import PriceEntry, token_cost

cost = token_cost(
    prices={"my-model": PriceEntry(input=1.0, output=2.0)},  # USD per 1M tokens
    fallback=0.01,                                            # or fallback=PriceEntry(...)
)
```

Drop-in cost extractor that walks `execution.state` for LangChain messages and pulls usage from `usage_metadata` / `response_metadata.usage` / `response_metadata.tokenUsage`. Default price table covers OpenAI (`gpt-4o`, `gpt-4`, `gpt-3.5-turbo`, `o1`) and Anthropic (`claude-3` / `3.5` / `4` family). Substring match handles dated IDs like `claude-3-5-sonnet-20241022`.

---

## Custom policies

Implement the `Policy` protocol:

```python
from graphos_io import Policy, NodeExecution, PolicyContext, PolicyDecision, cont, halt

class FirstStepGate:
    name = "FirstStepGate"

    def observe(self, exec: NodeExecution, ctx: PolicyContext) -> PolicyDecision:
        if exec.step == 0 and exec.node != "validator":
            return halt(self.name, f"expected to start at validator, got {exec.node!r}")
        return cont()

    def reset(self, ctx: PolicyContext) -> None:
        pass
```

---

## Custom transport

`on_trace` accepts any callable matching `(event) -> None | Awaitable[None]`:

```python
async def my_transport(event):
    await my_logger.emit(event.model_dump())

managed = wrap(graph, on_trace=my_transport)
```

The built-in `create_websocket_transport()`:

- Buffers up to 1024 events when the dashboard isn't running, drops oldest on overflow.
- Reconnects with exponential backoff (1s → 30s) when the dashboard restarts.
- Never blocks the wrapped graph — the public API is fire-and-forget.
- Never crashes the wrapped graph — listener exceptions are swallowed and logged.

---

## Security notes

- **Loopback by default.** The transport defaults to `ws://localhost:4001/graphos`. Don't expose the dashboard's WebSocket port to the public internet — trace events contain user prompts and tool args.
- **No untrusted input parsed.** The transport is send-only.
- **No `pickle`, no `eval`, no shell-out** anywhere in the SDK. Serialization is JSON only.
- **Bounded recursion.** State traversal in `token_cost()` and MCPGuard caps depth at 4 to prevent pathological-input DoS.
- **Type-safe wire format.** All trace events are Pydantic v2 models. Field names mirror the TypeScript SDK exactly so the dashboard receives the same shape from both languages.

---

## Compatibility

- **Python ≥ 3.10**
- **LangGraph Python ≥ 0.0.40** (any version exposing an async `astream` on its compiled graph)
- **Pydantic ≥ 2.0**, **websockets ≥ 12.0**

The wrap is duck-typed — it matches anything with an `astream(input, config, **kwargs) -> AsyncIterator[Any]` method, so it works with `langgraph` directly and with any `CompiledGraph`-shaped wrapper you've built.

---

## Links

- Repo: <https://github.com/ahmedbutt2015/graphos>
- TypeScript SDK: [`@graphos-io/sdk`](https://www.npmjs.com/package/@graphos-io/sdk)
- Dashboard: [`@graphos-io/dashboard`](https://www.npmjs.com/package/@graphos-io/dashboard)
- Issues: <https://github.com/ahmedbutt2015/graphos/issues>

## License

MIT — © Ahmed Butt
