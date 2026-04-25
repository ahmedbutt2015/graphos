# GraphOS — notes for Claude

## What this project is
Open-source "service mesh for AI agents" wrapping LangGraph. Local-first observability + policy enforcement, with a live Next.js dashboard. Positioning: OSS alternative to LangSmith.

## Locked v1 decisions
- **TS only.** No Python SDK in v1.
- **MVP = SDK wrapper + Dashboard.** No MCP gateway in v1 (deferred).
- **Hybrid architecture:** in-process SDK + separate dashboard process (`npx graphos dashboard`). SDK → Dashboard over WebSockets (live) + HTTP (batch).
- **Storage:** SQLite. Enables time-travel debugger.
- **Monorepo:** pnpm workspace. `packages/core` (shared types), `packages/sdk` (wrap + policies), `packages/dashboard` (Next.js + React Flow), `examples/`.
- **Day-1 deliverable:** LoopGuard — detect repeated LangGraph checkpoint state and halt via `__interrupt__`.

## Planned policies
- `LoopGuard { maxRepeats }` — same state observed N times
- `BudgetGuard { limit }` — per-session cost ceiling (USD)
- `MCPGuard { allowedTools }` — tool-call allowlist

## LangGraph hook points
User knows these deeply — don't explain, just use:
- `StateGraph.stream()` events for live telemetry
- `Checkpointer` for state snapshots (loop detection reads these)
- `Configurable` fields to thread the GraphOS session id through the graph
- `__interrupt__` signal to halt when a policy trips

## Workflow rules (hard)
- **Small, frequent commits.** Each logical unit = its own commit.
- **Push to `main` after each commit.** No branches, no PRs.
- **NO `Co-Authored-By: Claude` trailer.** Ever. Author stays Ahmed Butt alone.
- Remote: `git@github.com:ahmedbutt2015/graphos.git`.

## Conventions
- TypeScript strict mode, `noUncheckedIndexedAccess` on.
- Test with `vitest`.
- Public package names: `@graphos-io/core`, `@graphos-io/sdk`, `@graphos-io/dashboard`.
- Target Node >= 20.
- Use `NodeNext` module resolution.

## Style
- No comments unless the *why* is non-obvious.
- Prefer editing existing files over creating new ones.
- No speculative abstractions — build for the next concrete use case.
- Keep dashboard UX oriented around the "15-second viral demo": graph visibly catches a loop.

## Out of scope for v1
- Python SDK
- MCP gateway / tool-call proxy
- Auth / multi-tenant dashboard
- Cloud-hosted mode
