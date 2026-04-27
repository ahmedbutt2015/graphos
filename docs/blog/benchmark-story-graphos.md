---
title: "We Wrapped Two Open-Source Agents in GraphOS — and the Second One Caught a Real Bug"
description: "A field report from wrapping a TypeScript LangGraph agent and then a Python one with GraphOS — including the moment the second benchmark caught a bug 60 unit tests missed."
tags: [ai, agents, langgraph, typescript, python, opensource]
canonical_url: https://dev.to/ahmedbutt2015/we-wrapped-an-open-source-agent-in-graphos-and-turned-the-debugging-session-into-a-story-4de4
cover_image: https://raw.githubusercontent.com/ahmedbutt2015/graphos/main/assets/logo-wordmark.svg
published: false
---

<p align="center">
  <img src="https://raw.githubusercontent.com/ahmedbutt2015/graphos/main/assets/logo-wordmark.svg" alt="GraphOS" width="420" />
</p>

# We Wrapped Two Open-Source Agents in GraphOS — and the Second One Caught a Real Bug

> This post is a two-act story.
>
> **Act I.** We took a real TypeScript LangGraph agent we did not write — `langchain-ai/agents-from-scratch-ts` — and wrapped it in GraphOS to see whether observability and policy guards survive contact with somebody else's code.
>
> **Act II.** We then ported the GraphOS SDK to Python and ran the same exercise against a real *Python* LangGraph agent — `langchain-ai/retrieval-agent-template`. The end-to-end run uncovered a bug that 60 unit tests had never exercised. We fixed it, shipped `graphos-io@1.0.1`, and kept going.
>
> The second act is the part that validates the first.

There is a moment every agent project eventually reaches.

The demo works. The graph looks clean. The tools are wired up. The prompt feels smart.

And then one run goes sideways.

Not in a dramatic, movie-scene way. In the real way.

The assistant calls the same tool again. Then again. The state grows. The trace gets noisier. The budget keeps moving in one direction. And the hardest part is not even the cost. It is the feeling that you can no longer see the system clearly.

That is the moment GraphOS was built for.

This post is not just a feature announcement. It is a field report. We took a real open-source project, wrapped it with GraphOS, ran the integration end to end, and used that exercise to answer one question:

> Can an existing LangGraph.js agent — one we did not write — be made easier to observe, safer to run, and easier to explain to other developers?

The short answer is yes.

The better answer is the story below.

<p align="center">
  <video src="https://raw.githubusercontent.com/ahmedbutt2015/graphos/main/assets/hero.mp4" autoplay loop muted playsinline width="900">
    <a href="https://raw.githubusercontent.com/ahmedbutt2015/graphos/main/assets/hero.mp4">▶ Watch GraphOS catch a runaway agent loop (12s)</a>
  </video>
</p>

---

# Act I — TypeScript: `agents-from-scratch-ts`

## Before and after, in one breath

**Before** wrapping the agent in GraphOS:

- Every run was a black box. The first signal that something was wrong was the OpenAI bill or a stuck UI.
- Loops only surfaced as "this got slow" or "this never finished."
- Debugging meant reading log files after the fact and reconstructing a sequence the system had not preserved.

**After** wrapping the agent in GraphOS:

- Every step of the graph was observable in real time.
- A loop was caught at visit 7, not visit 700.
- A budget ceiling halted a misbehaving run before the credit card did.
- Every past session became time-travelable in a local SQLite-backed dashboard, no SaaS in the loop.

Same agent. Same model. Different blast radius.

## The benchmark we chose

Instead of inventing a toy example, we used an existing open-source benchmark:

- `agents-from-scratch-ts`: <https://github.com/langchain-ai/agents-from-scratch-ts>

Inside this repository, that benchmark lives at:

- `benchmarks/agents-from-scratch-ts`

It is a strong test case because it is not a toy. It already contains:

- A working email assistant
- A Human-in-the-Loop flow
- A memory-enabled variant
- Jest-based test suites
- LangGraph wiring that looks like real application code, not a demo built for a tool launch

That makes it the right kind of pressure test for GraphOS. We did not want to ship a wrapper that only works on our own handcrafted demo. We wanted something that survives contact with someone else's architecture, state shape, tool conventions, and tests.

## Why this matters

If you are reading this as a builder, imagine two options:

1. Build a brand-new sample agent designed to make the tool look good.
2. Take someone else's open-source agent and prove the tool against that.

We picked option 2.

That choice changes the tone of the work. Now the question is not "can GraphOS run a demo we wrote?" It becomes "can GraphOS survive contact with someone else's code?"

That is a much better story to tell — and a much better thing to ship.

## What GraphOS adds to a graph

GraphOS is an observability and policy layer for LangGraph.js agents.

At a high level, it gives you three things:

- A wrapper around any compiled graph
- Composable policies (`LoopGuard`, `BudgetGuard`, more)
- A local dashboard that shows what the agent did, step by step, and lets you scrub through past runs

<p align="center">
  <img src="https://raw.githubusercontent.com/ahmedbutt2015/graphos/main/assets/architecture.svg" alt="GraphOS architecture: your code → @graphos-io/sdk → @graphos-io/dashboard, with SQLite persistence" width="900" />
</p>

The integration stays intentionally small:

```ts
import {
  GraphOS,
  LoopGuard,
  BudgetGuard,
  tokenCost,
  createWebSocketTransport,
} from "@graphos-io/sdk";

const managed = GraphOS.wrap(myCompiledGraph, {
  projectId: "my-agent",
  policies: [
    new LoopGuard({ mode: "node", maxRepeats: 10 }),
    new BudgetGuard({ usdLimit: 2.0, cost: tokenCost() }),
  ],
  onTrace: createWebSocketTransport(),
});
```

That is the promise. But promises are cheap.

So we tested it against the benchmark.

## How we brought GraphOS into the benchmark

There are two installation stories worth separating, because people often confuse "how we developed it inside the monorepo" with "how I should use it in my own codebase."

### Story 1: how we integrated it inside this monorepo

Because the benchmark is checked into this repository, the local integration uses the built SDK directly:

```ts
import {
  GraphOS,
  LoopGuard,
  BudgetGuard,
  tokenCost,
  createWebSocketTransport,
  PolicyViolationError,
} from "../../packages/sdk/dist/index.js";
```

That exact integration lives in:

- `benchmarks/agents-from-scratch-ts/graphos-wrap.ts`

This is useful for development because it lets us iterate on GraphOS and immediately retest it against the benchmark without publishing a new package every time.

### Story 2: how you would install it in any outside project

If you are doing this in your own LangGraph.js project, the install is the simple part:

```bash
npm install @graphos-io/sdk
# or
pnpm add @graphos-io/sdk
```

Then replace the local import with the published package import:

```ts
import {
  GraphOS,
  LoopGuard,
  BudgetGuard,
  tokenCost,
  createWebSocketTransport,
  PolicyViolationError,
} from "@graphos-io/sdk";
```

Same code, same wrapper. The only thing that changes is where the SDK comes from.

## The wrapper we added

Here is the part of the benchmark integration that mattered:

```ts
const managed = GraphOS.wrap(graph, {
  projectId: "agents-from-scratch",
  policies: [
    new LoopGuard({ mode: "node", maxRepeats: 6 }),
    new BudgetGuard({
      usdLimit: 0.5,
      cost: tokenCost({ fallback: 0.05 }),
    }),
  ],
  onTrace: createWebSocketTransport(),
});
```

Three details deserve a beat each.

### 1. We used `LoopGuard` in `node` mode

This benchmark is exactly why `node` mode exists.

In many real agents, the state changes every iteration because the `messages` array keeps growing. That means pure state-equality is not enough to detect a loop. The graph may be functionally stuck even though the raw state object is technically different each turn.

So instead of asking:

> "Did we revisit the exact same state?"

we ask:

> "Did we keep revisiting the same node too many times?"

That is the more practical safety rule for agents that keep appending messages as they reason.

### 2. We set a budget ceiling

`BudgetGuard` lets us cap cumulative spend per session.

```ts
new BudgetGuard({
  usdLimit: 0.5,
  cost: tokenCost({ fallback: 0.05 }),
})
```

`tokenCost()` is a drop-in cost extractor that walks the state for LangChain messages, pulls usage from `usage_metadata` / `response_metadata.usage` / `tokenUsage`, and applies a built-in OpenAI + Anthropic price table. For unknown models you can pass a `fallback` (flat USD per step or a custom price entry).

This is not just observability anymore. The run has a real boundary.

### 3. We streamed telemetry to the local dashboard

This line is small:

```ts
onTrace: createWebSocketTransport()
```

But it changes the experience completely. Instead of waiting for the final output and guessing what happened, you watch the run unfold — node by node — in the GraphOS dashboard.

## The small but clever trick: a mock key path

One of the nicest touches in the integration is that `graphos-wrap.ts` checks whether `OPENAI_API_KEY` starts with `sk-mock`. If it does, it installs a `fetch` interceptor and simulates the OpenAI responses.

Why is that useful?

Because it gives us a reproducible benchmark run that is intentionally shaped to trigger the loop path. In the mock flow:

- The triage step routes the email into the response subgraph
- The agent keeps requesting `schedule_meeting`
- The graph cycles through `llm_call ↔ environment`
- `LoopGuard` halts at visit 7 with a clean policy reason

That is the kind of test harness you want when you are building safety infrastructure. You do not want to rely on "hopefully the model misbehaves today." You want a deterministic failure mode you can use on purpose.

## Reproduce the setup

If you want to walk through this yourself, the full path is short.

### 1. Install the workspace

From the repository root:

```bash
pnpm install
```

### 2. Build the SDK

```bash
pnpm --filter @graphos-io/sdk build
```

### 3. Move into the benchmark

```bash
cd benchmarks/agents-from-scratch-ts
```

### 4. Use the benchmark normally

The upstream benchmark documents its own workflow:

```bash
pnpm agent
```

It expects a `.env` file with your API key if you want real model calls:

```env
OPENAI_API_KEY=your_api_key_here
```

### 5. Run GraphOS alongside it

In another terminal, start the dashboard:

```bash
npx @graphos-io/dashboard graphos dashboard
# open http://localhost:4000
```

Then run the wrapped benchmark entrypoint:

```bash
OPENAI_API_KEY=sk-mock pnpm exec tsx graphos-wrap.ts
```

To run against a real provider instead of the mock path, swap in a real key and keep the same wrapper.

## What we actually verified

This is where the story becomes more than marketing. We did not just wrap the benchmark and eyeball the result.

### GraphOS SDK verification

From the repo root:

```bash
pnpm --filter @graphos-io/sdk test
```

All SDK tests pass. Coverage spans:

- `LoopGuard` — both `state` and `node` modes
- `BudgetGuard` — cumulative cost ceiling
- `tokenCost()` — multiple LangChain message shapes, multiple price-table lookups
- `GraphOS.wrap()` — session lifecycle, error handling, sessionId continuity, listener-throw resilience

### Benchmark verification

From `benchmarks/agents-from-scratch-ts`, the benchmark's own Jest suites still pass:

```bash
pnpm test:base
pnpm test:hitl
pnpm test:memory
```

That matters because it tells us something subtle but important:

GraphOS was developed alongside the benchmark without breaking the benchmark's behavior. We are not telling a story about observability by quietly degrading the agent underneath it.

## What the benchmark actually exercises

This part is worth slowing down for. The benchmark is not one narrow happy path. It exercises:

- Response quality
- Expected tool calls
- Human acceptance flow
- Human edit flow
- Human rejection with feedback
- Memory persistence across later runs

So when we say we used `agents-from-scratch-ts`, we mean we used a compact but meaningful open-source application with real behavioral coverage — not "we ran one prompt once."

---

# Act II — Python: `retrieval-agent-template`

## The premise of the second act

After Act I shipped, the obvious next question was:

> If GraphOS is really a *graph-shape-agnostic* wrapper, the language of the agent should not matter.

So we ported the SDK to Python and published [`graphos-io`](https://pypi.org/project/graphos-io/) with the same surface area as the TypeScript package — `wrap`, `LoopGuard`, `BudgetGuard`, `MCPGuard`, `token_cost`, `create_websocket_transport` — async-first, Pydantic-typed trace events whose field names mirror the TS ones exactly so a single dashboard ingests both languages.

Then we did the same exercise we did in Act I, but in Python: we picked a real open-source LangGraph agent that we did not write, wrapped it in GraphOS, and ran it end to end.

The benchmark this time:

- `langchain-ai/retrieval-agent-template`: <https://github.com/langchain-ai/retrieval-agent-template>

It is a small, real-world conversational retrieval graph: `generate_query` → `retrieve` → `respond`. Three nodes, real LangGraph wiring, real LangChain message types, Pydantic state classes — exactly the kind of code GraphOS is supposed to wrap unmodified.

## The Python wrap is the same shape as the TypeScript one

```python
import asyncio
from graphos_io import (
    wrap, LoopGuard, BudgetGuard, token_cost,
    create_websocket_transport, PolicyViolationError,
)
from retrieval_graph import graph

async def main():
    managed = wrap(
        graph,
        project_id="retrieval-agent-template",
        policies=[
            LoopGuard(mode="node", max_repeats=5),
            BudgetGuard(usd_limit=1.0, cost=token_cost(fallback=0.001)),
        ],
        on_trace=create_websocket_transport(),
    )
    try:
        result = await managed.invoke(
            {"messages": [{"role": "user", "content": "What is GraphOS?"}]},
            config={"configurable": {"user_id": "demo"}},
        )
        print(result)
    except PolicyViolationError as err:
        print(f"halted by {err.policy}: {err.reason}")

asyncio.run(main())
```

Same wrap. Same policies. Same dashboard. Different language.

The end-to-end run worked on the first try. Three trace steps streamed into the running dashboard. The session showed up as `retrieval-agent-template` next to the `agents-from-scratch` sessions from Act I, in the same UI, fed by the same WebSocket protocol.

That alone would have been a clean story.

But we also ran the run *with a deliberately-low BudgetGuard ceiling* — and that is where the second act earned its place.

## The bug the benchmark caught

We pointed a `BudgetGuard` at the run with a ceiling well below the cost of a single LLM call.

The graph completed without halting.

That should not happen.

We sanity-checked the obvious things — the cost extractor was wired, the price table contained `gpt-4o-mini`, the budget threshold was tiny. We added more `print` statements and watched cumulative cost stay flat at `$0.0000` step after step.

Then we read the cost extractor.

`graphos-io@1.0.0`'s `_find_messages` walked the state for LangChain messages with this guard:

```python
def _is_object(v: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(v, dict)

# inside _find_messages:
messages = v.get("messages")
if isinstance(messages, list):
    for m in messages:
        if _is_object(m):
            out.append(m)
```

That is a perfectly reasonable check — for LangChain *JavaScript*. In LangChain.js, an `AIMessage` serializes to a plain object, and `isinstance(m, dict)` would be the right idea translated.

But LangChain *Python* ships its messages as Pydantic `BaseModel` subclasses. An `AIMessage` is not a dict. `isinstance(m, dict)` is `False`. The Pydantic message has no `.get()` method either, so even if we had reached the next step, it would have failed differently.

The result: every real `AIMessage` in the graph's state was silently dropped by `_find_messages`. `token_cost()` saw zero messages. `BudgetGuard` saw `$0.00`. The guard never tripped.

Worse — it never could have tripped on any real Python LangGraph agent. Not a flaky test. A guard that did not work in production.

## Why the unit tests didn't catch it

`graphos-io@1.0.0` shipped with 60 unit tests, including 13 dedicated to `token_cost`. They covered:

- `usage_metadata` shape
- `response_metadata.usage` shape
- `response_metadata.tokenUsage` shape
- Multiple messages, summed
- Fallback prices, dated model IDs, custom price tables
- Subgraph-state extraction

Every one of them passed. Every one of them used **dict-shaped** mock messages.

That is the gap. The unit tests had never exercised the path where `state["messages"]` actually contains a Pydantic `AIMessage` instance — because none of the test fixtures had ever imported `langchain-core`. The TypeScript version of the same extractor didn't have this hidden assumption baked in, so the TS test suite never had to surface it. The bug only existed in the cross-language port, and only surfaced the moment the wrap touched a *real* LangGraph Python state.

This is exactly the kind of failure mode that drives the entire "wrap a real benchmark" thesis. A hand-crafted demo would have used hand-crafted dicts, just like the unit tests, and the bug would still be sitting there.

## The fix

A short helper that mirrors the canonicalizer GraphOS already uses for state hashing:

```python
def _coerce_message(m: Any) -> dict[str, Any] | None:
    """Return ``m`` as a dict if it looks like a LangChain message."""
    if isinstance(m, dict):
        return m
    if hasattr(m, "model_dump"):
        dumped = m.model_dump()
        if isinstance(dumped, dict):
            return dumped
    if hasattr(m, "__dict__"):
        return {k: v for k, v in vars(m).items() if not k.startswith("_")}
    return None
```

Used at both message-collection sites in `_find_messages`. Plain dicts pass through unchanged. Pydantic models go through `model_dump()`. Dataclass-ish objects fall back to `vars()`.

Then a regression test that does what no previous test had done — uses a real `langchain_core.messages.AIMessage`:

```python
def test_handles_langchain_pydantic_aimessage() -> None:
    pytest.importorskip("langchain_core")
    from langchain_core.messages import AIMessage

    msg = AIMessage(content="hello")
    msg.usage_metadata = {
        "input_tokens": 1000,
        "output_tokens": 500,
        "total_tokens": 1500,
    }
    msg.response_metadata = {"model_name": "gpt-4o-mini"}

    cost = token_cost()
    state = {"messages": [msg]}
    assert cost(make_exec("n", state)) == pytest.approx(0.00045, abs=1e-8)
```

61 tests pass. We bumped to `graphos-io@1.0.1` and re-ran the benchmark.

This time, `BudgetGuard` halted at the `respond` node with a clean policy reason:

```
[trace] session.start
[trace] step node=generate_query step=0
[trace] step node=retrieve step=1
[trace] step node=respond step=2
[trace] policy.halt policy=BudgetGuard step=2
[trace] session.end outcome=halted
HALTED: policy=BudgetGuard reason=session cost $X exceeded limit $Y
```

That is what we wanted to see in Act I, and it is what we wanted to see again in Act II — except the Python version had to live through a real bug to get there.

## What this proves about the wider design

Three things worth saying out loud, because they are easy to miss otherwise.

**1. The dashboard didn't change.** Not one line. The Python SDK serializes `StepEvent.state` via Pydantic v2, which recurses into the nested `AIMessage` and produces JSON that the dashboard's per-step renderer already understood — its `pickRole` function reads `message.role` (TypeScript shape) *and* `message.type` (Python shape: `"ai"`, `"human"`, `"system"`); its `pickUsage` reads `usage_metadata` first (Python primary path) and falls back to `response_metadata.usage` and `response_metadata.tokenUsage` (TypeScript shapes). The dashboard was built polyglot-by-default. The test was whether that defensiveness survived contact with a real Python message — and it did.

**2. The cross-language story is real, not aspirational.** The same dashboard renders both languages' sessions side by side. The same protocol ingests them. The `agents-from-scratch` sessions and the `retrieval-agent-template` sessions live in the same `~/.graphos/traces.db` and show up in the same session switcher. There is no Python-specific dashboard build, no separate ingest path.

**3. The benchmark approach earned its keep.** This is the part the TypeScript run could not have proven on its own. A handcrafted Python demo built around dict messages would not have caught this. The unit tests we wrote in good faith did not catch this. The benchmark — a real open-source agent we did not write, with state shapes we did not control — caught it the first time we ran it. That is exactly why this approach exists.

---

# Closing — the lesson behind both acts

## The human lesson

One benchmark is an email assistant. The other is a retrieval agent. Different domains, different languages, different failure modes — and the lesson is the same in both.

Every agent team eventually needs answers to these questions:

- What node did we get stuck in?
- How many times did we visit it?
- What tool calls were made before failure?
- What did the state look like at that moment?
- Was the run expensive because it was useful, or expensive because it was looping?

Without observability, those questions become archaeology.

With GraphOS, they become part of the normal debugging workflow.

## A quick interactive moment

Imagine you are looking at a run and you see the same node lighting up over and over. Which of these do you want next?

1. A bigger console log
2. The final model output only
3. A live graph, a session timeline, and a policy halt reason that says exactly which guard fired and why

That is the difference this project is trying to create. Not more noise. Better visibility.

## Why this story is stronger than a basic product post

The first version of a launch blog usually says:

- Here is what we built
- Here is the API
- Here is why it is useful

That is fine, but it is mostly a claim.

This story is better because it shows:

- The open-source project we used
- The exact link to it
- Where it lives in our repo
- How we installed GraphOS into the workflow
- How we wrapped the graph
- How we tested both the SDK and the benchmark
- What safety behavior we specifically cared about

In other words, this is not just *what GraphOS is*. It is *how GraphOS behaves when it meets a real agent*.

## The files behind this story

If you want to inspect the exact pieces mentioned above, start here.

**Act I — TypeScript:**

- Benchmark wrapper: [`benchmarks/agents-from-scratch-ts/graphos-wrap.ts`](../../benchmarks/agents-from-scratch-ts/graphos-wrap.ts)
- Benchmark package setup: [`benchmarks/agents-from-scratch-ts/package.json`](../../benchmarks/agents-from-scratch-ts/package.json)
- Benchmark tests: [`benchmarks/agents-from-scratch-ts/tests`](../../benchmarks/agents-from-scratch-ts/tests)

**Act II — Python:**

- Benchmark wrapper: [`benchmarks/retrieval-agent-template/graphos_wrap.py`](../../benchmarks/retrieval-agent-template/graphos_wrap.py)
- The fix: [`python/src/graphos_io/policies/token_cost.py`](../../python/src/graphos_io/policies/token_cost.py)
- The regression test: [`python/tests/test_token_cost.py`](../../python/tests/test_token_cost.py)
- Changelog entry: [`CHANGELOG.md`](../../CHANGELOG.md) (`1.2.1 — 2026-04-28`)

**Reference:**

- GraphOS root: [`README.md`](../../README.md)
- Companion launch reference: [`docs/blog/v1-launch.md`](./v1-launch.md)

## Final takeaway

GraphOS becomes much easier to understand when you stop describing it as a package and start describing it as a moment in a developer's day.

An agent starts drifting.

A team needs answers.

A wrapper adds policies.

A dashboard turns hidden execution into something visible.

A benchmark proves the idea against real code.

That is the story. And that is why we used `agents-from-scratch-ts`.

If you want to try the same path yourself:

- TypeScript benchmark: <https://github.com/langchain-ai/agents-from-scratch-ts>
- Python benchmark: <https://github.com/langchain-ai/retrieval-agent-template>
- GraphOS: <https://github.com/ahmedbutt2015/graphos>
- SDK on npm: <https://www.npmjs.com/package/@graphos-io/sdk>
- SDK on PyPI: <https://pypi.org/project/graphos-io/>
- Dashboard on npm: <https://www.npmjs.com/package/@graphos-io/dashboard>

**TypeScript:**

```bash
npm install @graphos-io/sdk
npx @graphos-io/dashboard graphos dashboard
```

**Python:**

```bash
pip install graphos-io
npx @graphos-io/dashboard graphos dashboard
```

Same dashboard either way. Same wrap shape either way.

The next step is simple: wrap your graph in whichever language you actually write in, run your tests, and see what your agent was actually doing when nobody was watching.
