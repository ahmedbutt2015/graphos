import { describe, expect, it, vi } from "vitest";
import type { TraceEvent } from "@graphos-io/core";
import { MCPProxyBlockedError, createMCPProxy } from "./index.js";

describe("createMCPProxy", () => {
  it("emits session, call, result, and end events for one-off calls", async () => {
    const events: TraceEvent[] = [];
    const proxy = createMCPProxy(
      {
        async callTool(call) {
          return { content: [{ type: "text", text: `ran ${call.tool}` }] };
        },
      },
      {
        projectId: "demo",
        onTrace: (event) => events.push(event),
      }
    );

    await proxy.callTool({
      server: "docs",
      tool: "search_docs",
      args: { query: "LoopGuard" },
    });

    expect(events.map((event) => event.kind)).toEqual([
      "session.start",
      "mcp.call",
      "mcp.result",
      "session.end",
    ]);
    expect(events[1]).toMatchObject({
      kind: "mcp.call",
      server: "docs",
      tool: "search_docs",
      source: "proxy",
    });
  });

  it("blocks denied tools before they reach the upstream handler", async () => {
    const upstream = vi.fn(async () => ({ content: [] }));
    const events: TraceEvent[] = [];
    const proxy = createMCPProxy(
      {
        callTool: upstream,
      },
      {
        denyServers: ["filesystem"],
        onTrace: (event) => events.push(event),
      }
    );

    await expect(
      proxy.callTool({
        sessionId: "sess_1",
        server: "filesystem",
        tool: "read_file",
        args: { path: "/tmp/demo.txt" },
      })
    ).rejects.toBeInstanceOf(MCPProxyBlockedError);

    expect(upstream).not.toHaveBeenCalled();
    expect(events.map((event) => event.kind)).toEqual([
      "session.start",
      "mcp.call",
      "mcp.blocked",
      "policy.halt",
      "session.end",
    ]);
  });

  it("tracks per-session limits across multiple calls", async () => {
    const proxy = createMCPProxy(
      {
        async callTool(call) {
          return { content: [{ type: "text", text: call.tool }] };
        },
      },
      {
        maxCallsPerTool: 1,
        autoEndSessions: false,
      }
    );

    await proxy.callTool({
      sessionId: "sess_2",
      server: "docs",
      tool: "search_docs",
      args: { query: "a" },
    });

    await expect(
      proxy.callTool({
        sessionId: "sess_2",
        server: "docs",
        tool: "search_docs",
        args: { query: "b" },
      })
    ).rejects.toBeInstanceOf(MCPProxyBlockedError);
  });
});
