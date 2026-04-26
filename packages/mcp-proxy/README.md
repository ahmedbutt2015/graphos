# @graphos-io/mcp-proxy

Trace and guard Model Context Protocol tool calls before they hit an upstream MCP tool implementation.

```bash
npm install @graphos-io/mcp-proxy
```

## Quick start

```ts
import { createMCPProxy } from "@graphos-io/mcp-proxy";

const proxy = createMCPProxy(
  {
    async callTool(call) {
      return {
        content: [{ type: "text", text: `ran ${call.tool}` }],
      };
    },
  },
  {
    denyServers: ["filesystem"],
  }
);

await proxy.callTool({
  sessionId: "demo",
  tool: "search_docs",
  server: "docs",
  args: { query: "LoopGuard" },
});
```

Pass `onTrace` to emit `session.start`, `mcp.call`, `mcp.result`, `mcp.blocked`, and `session.end` events into GraphOS transports or the dashboard.
