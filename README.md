# 🚀 GraphOS

**The Service Mesh for AI Agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)

**GraphOS** is an open-source governance and observability layer for [LangGraph](https://langchain-ai.github.io/langgraph/) and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

Think of it as **Istio for Agents**. Just as microservices need a service mesh for routing, security, and observability, AI agents need a dedicated layer to prevent infinite loops, enforce budget guardrails, and provide a control plane for complex state machines.

---

## 🧐 Why GraphOS?

As agents move from demos to production, they become unpredictable.

- **Infinite Loops** — an agent gets stuck between two nodes, burning tokens indefinitely.
- **Shadow Tooling** — agents calling MCP tools they shouldn't have access to.
- **The "Black Box" Problem** — no way to see what happened inside a 20-step execution until it's finished.

GraphOS fixes this by wrapping your graph execution with a policy-driven interceptor.

---

## ✨ Core Pillars

### 1. Policy Enforcement (the "Guard" layer)

Inject logic into your graph without modifying your nodes.

- **LoopGuard** — detect and break deterministic or semantic cycles (`A → B → A`).
- **BudgetGuard** — real-time token tracking. Kill the run if it exceeds your USD limit.
- **MCPGuard** — a firewall for your tools. Only allow specific MCP server calls based on the current graph state.

### 2. Live Observability (the Dashboard)

A local-first, SQLite-backed Next.js dashboard.

- **Live streaming** — watch nodes glow in real-time as the agent traverses the graph.
- **Time-travel debugger** — click any previous state to see the full context, tool outputs, and LLM reasoning.
- **Trace persistence** — every run is saved to a local SQLite DB for post-mortem analysis.

---

## 🛠 Installation

> **Pre-alpha:** packages aren't published to npm yet. For now, clone the monorepo and run the bundled examples.
>
> Once published:
> ```bash
> npm install @graphos/sdk
> ```

---

## 🚀 Quick start

Wrap your existing LangGraph `CompiledGraph` and stream live traces to the dashboard.

```typescript
import {
  GraphOS,
  LoopGuard,
  BudgetGuard,
  createWebSocketTransport,
} from "@graphos/sdk";
import { myLangGraphApp } from "./agent";

const managedApp = GraphOS.wrap(myLangGraphApp, {
  projectId: "my-agent",
  policies: [
    new LoopGuard({ maxRepeats: 3 }),
    new BudgetGuard({ usdLimit: 2.0, cost: (exec) => estimateCost(exec) }),
  ],
  onTrace: createWebSocketTransport(),
});

await managedApp.invoke({
  messages: [{ role: "user", content: "Analyze the market." }],
});
```

If a policy trips, `invoke()` rejects with `PolicyViolationError` carrying the offending policy name, reason, and a structured `details` payload.

---

## 🎬 Run the demos

Two terminals — no extra deps.

```bash
pnpm install
pnpm dev                # terminal 1: Next on :4000 + WS telemetry on :4001
pnpm demo:loop          # terminal 2: LoopGuard halts a stuck A↔B graph
# or
pnpm demo:budget        # terminal 2: BudgetGuard halts a 4-node pipeline at $0.50
```

Open [http://localhost:4000](http://localhost:4000) — nodes glow green as they execute and turn red when a policy halts the run.

---

## 🏗 Architecture: the hybrid sidecar

GraphOS uses a hybrid sidecar pattern:

1. **The SDK** — a lightweight wrapper around the LangGraph runtime. Emits events to the control plane over WebSockets (live) and HTTP (batch).
2. **The Control Plane** — a local server that aggregates traces, enforces cross-run policies, and serves the UI.
3. **The Storage** — a local-first SQLite instance, so your data never leaves your machine.

---

## 📂 Project structure

```text
graphos/
├── packages/
│   ├── core/         # Shared types (Policy, NodeExecution, TraceEvent)
│   ├── sdk/          # GraphOS.wrap(), policies, transports
│   └── dashboard/    # Next.js 15 + React Flow + WS telemetry server
└── examples/
    ├── loop-demo/    # LoopGuard halting a stuck A↔B cycle
    └── budget-demo/  # BudgetGuard halting a 4-node pipeline on $ cap
```

---

## 🗺 Roadmap

- [x] Core interceptor pattern (LangGraph.js)
- [x] LoopGuard implementation
- [x] BudgetGuard implementation
- [x] Real-time WebSocket streaming to dashboard
- [x] Live graph view with active / halted node states
- [x] SQLite persistence for traces
- [x] Session history + switcher in dashboard
- [x] Time-travel debugging (event-stream scrubber)
- [ ] MCPGuard + MCP proxy
- [ ] Python SDK parity

---

## 🤝 Contributing

We're in **pre-alpha**. If you have 7+ years in web architecture or are going deep on AI agents, we'd love your help building the infrastructure layer for the agentic web.

## License

MIT
