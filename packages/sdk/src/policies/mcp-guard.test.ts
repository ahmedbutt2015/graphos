import { describe, expect, it } from "vitest";
import type { NodeExecution, PolicyContext } from "@graphos-io/core";
import { MCPGuard, extractMCPToolCalls } from "./mcp-guard.js";

const ctx: PolicyContext = { sessionId: "sess_1" as never };

const exec = (step: number, state: unknown): NodeExecution<unknown> => ({
  sessionId: "sess_1" as never,
  node: "agent" as never,
  state,
  step,
  timestamp: Date.now(),
});

describe("extractMCPToolCalls", () => {
  it("extracts server and tool from qualified tool names", () => {
    const calls = extractMCPToolCalls(
      exec(0, {
        messages: [
          {
            tool_calls: [
              {
                name: "filesystem__read_file",
                args: { path: "/tmp/demo.txt" },
              },
            ],
          },
        ],
      })
    );

    expect(calls).toEqual([
      {
        server: "filesystem",
        tool: "read_file",
        args: { path: "/tmp/demo.txt" },
      },
    ]);
  });

  it("extracts server from explicit MCP metadata", () => {
    const calls = extractMCPToolCalls(
      exec(0, {
        nested: {
          messages: [
            {
              tool_calls: [
                {
                  function: { name: "read_file", arguments: "{\"path\":\"/tmp/a\"}" },
                  mcp: { server: "filesystem" },
                },
              ],
            },
          ],
        },
      })
    );

    expect(calls).toEqual([
      {
        server: "filesystem",
        tool: "read_file",
        args: "{\"path\":\"/tmp/a\"}",
      },
    ]);
  });
});

describe("MCPGuard", () => {
  it("halts when a denied server is called", () => {
    const guard = new MCPGuard({
      denyServers: ["filesystem"],
    });

    const decision = guard.observe(
      exec(0, {
        messages: [{ tool_calls: [{ name: "filesystem__read_file", args: {} }] }],
      }),
      ctx
    );

    expect(decision.kind).toBe("halt");
    if (decision.kind === "halt") {
      expect(decision.policy).toBe("MCPGuard");
      expect(decision.reason).toContain('server "filesystem"');
    }
  });

  it("halts when a tool exceeds the per-tool limit", () => {
    const guard = new MCPGuard({
      maxCallsPerTool: 1,
    });

    const first = guard.observe(
      exec(0, {
        messages: [{ tool_calls: [{ name: "filesystem__read_file", args: { path: "a" } }] }],
      }),
      ctx
    );
    const second = guard.observe(
      exec(1, {
        messages: [{ tool_calls: [{ name: "filesystem__read_file", args: { path: "b" } }] }],
      }),
      ctx
    );

    expect(first.kind).toBe("continue");
    expect(second.kind).toBe("halt");
  });

  it("halts when a call is outside the allow-list", () => {
    const guard = new MCPGuard({
      allowTools: ["search_docs"],
    });

    const decision = guard.observe(
      exec(0, {
        messages: [{ tool_calls: [{ name: "filesystem__read_file", args: {} }] }],
      }),
      ctx
    );

    expect(decision.kind).toBe("halt");
    if (decision.kind === "halt") {
      expect(decision.reason).toContain('tool "read_file"');
    }
  });

  it("resets its counters between sessions", () => {
    const guard = new MCPGuard({
      maxCallsPerSession: 1,
    });

    const first = guard.observe(
      exec(0, {
        messages: [{ tool_calls: [{ name: "filesystem__read_file", args: { path: "a" } }] }],
      }),
      ctx
    );
    guard.reset?.(ctx);
    const second = guard.observe(
      exec(0, {
        messages: [{ tool_calls: [{ name: "filesystem__read_file", args: { path: "b" } }] }],
      }),
      ctx
    );

    expect(first.kind).toBe("continue");
    expect(second.kind).toBe("continue");
  });
});
