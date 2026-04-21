# GraphOS

**Service mesh for AI agents.** Observability, policy enforcement, and live visualization for [LangGraph](https://langchain-ai.github.io/langgraph/) — open source, local-first, SQLite-backed.

> Status: pre-alpha. Building in public.

## What it does

Wrap your LangGraph app, get:

- **LoopGuard** — halt agents stuck in `A → B → A → B` cycles
- **BudgetGuard** — cut off runs that exceed a token-cost ceiling
- **MCPGuard** — allowlist which MCP tools an agent may call
- **Live dashboard** — watch nodes glow as they execute, time-travel through checkpoints

## Quick start

```ts
import { GraphOS, LoopGuard } from "@graphos/sdk";

const managed = GraphOS.wrap(app, {
  policies: [new LoopGuard({ maxRepeats: 3 })],
});

await managed.invoke({ input: "..." });
```

```sh
npx graphos dashboard   # opens live graph UI at http://localhost:4000
```

## Repo layout

```
packages/
  core/        shared TypeScript types (Trace, NodeState, Policy)
  sdk/         GraphOS.wrap() and built-in policies
  dashboard/   Next.js + React Flow live UI (coming)
examples/      copy-paste LangGraph demos
```

## License

MIT
