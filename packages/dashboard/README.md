# @graphos/dashboard

Local-first live dashboard for LangGraph.js agents wrapped with [`@graphos/sdk`](https://www.npmjs.com/package/@graphos/sdk).

```bash
npx @graphos/dashboard graphos dashboard
```

Or install globally:

```bash
npm install -g @graphos/dashboard
graphos dashboard
```

Open [http://localhost:4000](http://localhost:4000). The dashboard listens for events on `ws://localhost:4001/graphos` — point your SDK transport at that URL (it's the default for `createWebSocketTransport()`).

## What you see

- **Live graph** of nodes the agent has visited, with the active node glowing and any policy-halted node flashing red.
- **Per-step detail panel** — click a step on the timeline (or click a node on the graph in history mode) to see the LangChain messages, tool calls, and per-step token usage.
- **Session switcher** — every run is persisted to SQLite. Pick any past session and replay it step by step with the time-travel scrubber.

## Storage

All events go to `~/.graphos/traces.db` (SQLite). The dashboard prunes to the **200 most-recent sessions** by default; tune via `GRAPHOS_RETENTION_SESSIONS`.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `GRAPHOS_PORT` | `4000` | Dashboard HTTP port |
| `GRAPHOS_WS_PORT` | `4001` | Telemetry WebSocket port |
| `GRAPHOS_DB_PATH` | `~/.graphos/traces.db` | SQLite database path |
| `GRAPHOS_RETENTION_SESSIONS` | `200` | Max sessions kept on disk before oldest are pruned |

## Privacy

GraphOS does not phone home. The SDK and dashboard exchange events on localhost only. Your traces never leave your machine.

## License

MIT
