import type {
  MCPToolCall,
  NodeExecution,
  Policy,
  PolicyContext,
  PolicyDecision,
} from "@graphos-io/core";
import { cont, halt } from "@graphos-io/core";

export interface MCPGuardOptions<TState = unknown> {
  allowServers?: string[];
  denyServers?: string[];
  allowTools?: string[];
  denyTools?: string[];
  maxCallsPerSession?: number;
  maxCallsPerTool?: number;
  extractCalls?: (execution: NodeExecution<TState>) => MCPToolCall[];
}

const canonical = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseQualifiedToolName = (
  raw: string
): { server?: string; tool: string } => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("mcp__")) {
    const parts = trimmed.split("__").filter(Boolean);
    if (parts.length >= 3) {
      return { server: parts[1], tool: parts.slice(2).join("__") };
    }
  }

  for (const delimiter of ["__", "/", ":"] as const) {
    const idx = trimmed.indexOf(delimiter);
    if (idx > 0 && idx < trimmed.length - delimiter.length) {
      return {
        server: trimmed.slice(0, idx),
        tool: trimmed.slice(idx + delimiter.length),
      };
    }
  }

  return { tool: trimmed };
};

const normalizeToolCall = (value: unknown): MCPToolCall | undefined => {
  if (!isObject(value)) return undefined;

  const fn = isObject(value.function) ? value.function : undefined;
  const meta = isObject(value.metadata) ? value.metadata : undefined;
  const mcp = isObject(value.mcp) ? value.mcp : undefined;

  const rawName =
    (typeof value.name === "string" ? value.name : undefined) ??
    (typeof fn?.name === "string" ? fn.name : undefined);
  if (!rawName) return undefined;

  const parsed = parseQualifiedToolName(rawName);
  const server =
    (typeof value.server === "string" ? value.server : undefined) ??
    (typeof meta?.server === "string" ? meta.server : undefined) ??
    (typeof mcp?.server === "string" ? mcp.server : undefined) ??
    parsed.server;

  const tool =
    (typeof value.tool === "string" ? value.tool : undefined) ?? parsed.tool;

  const args =
    value.args ??
    value.arguments ??
    fn?.arguments ??
    (isObject(value.input) ? value.input : value.input);

  if (!tool) return undefined;
  if (!server && !parsed.server && !mcp && !meta?.mcp) return undefined;

  return { server, tool, args };
};

const collectLastMessagePayloads = (state: unknown): unknown[] => {
  const seen = new WeakSet<object>();
  const payloads: unknown[] = [];

  const walk = (value: unknown): void => {
    if (!isObject(value) && !Array.isArray(value)) return;
    if (isObject(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      if ("messages" in value) {
        const messages = value.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          payloads.push(messages[messages.length - 1]);
        } else if (messages !== undefined) {
          payloads.push(messages);
        }
      }
      for (const child of Object.values(value)) walk(child);
      return;
    }
    for (const child of value) walk(child);
  };

  walk(state);
  return payloads;
};

export const extractMCPToolCalls = <TState>(
  execution: NodeExecution<TState>
): MCPToolCall[] => {
  const payloads = collectLastMessagePayloads(execution.state);
  const calls: MCPToolCall[] = [];

  for (const payload of payloads) {
    const obj = isObject(payload) ? payload : undefined;
    if (!obj) continue;
    const rawCalls = Array.isArray(obj.tool_calls)
      ? obj.tool_calls
      : isObject(obj.additional_kwargs) && Array.isArray(obj.additional_kwargs.tool_calls)
        ? obj.additional_kwargs.tool_calls
        : [];

    for (const rawCall of rawCalls) {
      const call = normalizeToolCall(rawCall);
      if (call) calls.push(call);
    }
  }

  return calls;
};

const includes = (list: string[] | undefined, value: string | undefined): boolean =>
  !!value && !!list?.some((entry) => entry === value);

export class MCPGuard<TState = unknown> implements Policy<TState> {
  readonly name = "MCPGuard";
  private readonly allowServers?: string[];
  private readonly denyServers?: string[];
  private readonly allowTools?: string[];
  private readonly denyTools?: string[];
  private readonly maxCallsPerSession?: number;
  private readonly maxCallsPerTool?: number;
  private readonly extractCalls: (execution: NodeExecution<TState>) => MCPToolCall[];
  private readonly seenCalls = new Set<string>();
  private totalCalls = 0;
  private toolCounts = new Map<string, number>();

  constructor(options: MCPGuardOptions<TState> = {}) {
    this.allowServers = options.allowServers;
    this.denyServers = options.denyServers;
    this.allowTools = options.allowTools;
    this.denyTools = options.denyTools;
    this.maxCallsPerSession = options.maxCallsPerSession;
    this.maxCallsPerTool = options.maxCallsPerTool;
    this.extractCalls = options.extractCalls ?? extractMCPToolCalls;
  }

  observe(execution: NodeExecution<TState>, _ctx: PolicyContext): PolicyDecision {
    const calls = this.extractCalls(execution);

    for (const call of calls) {
      const fingerprint = canonical([
        execution.step,
        call.server ?? "",
        call.tool,
        call.args ?? null,
      ]);
      if (this.seenCalls.has(fingerprint)) continue;
      this.seenCalls.add(fingerprint);

      if (includes(this.denyServers, call.server)) {
        return halt(this.name, `server "${call.server}" is denied`, {
          node: execution.node,
          step: execution.step,
          server: call.server,
          tool: call.tool,
        });
      }

      if (this.allowServers?.length && !includes(this.allowServers, call.server)) {
        return halt(
          this.name,
          `server "${call.server ?? "unknown"}" is not in the allow-list`,
          {
            node: execution.node,
            step: execution.step,
            server: call.server,
            tool: call.tool,
          }
        );
      }

      if (includes(this.denyTools, call.tool)) {
        return halt(this.name, `tool "${call.tool}" is denied`, {
          node: execution.node,
          step: execution.step,
          server: call.server,
          tool: call.tool,
        });
      }

      if (this.allowTools?.length && !includes(this.allowTools, call.tool)) {
        return halt(
          this.name,
          `tool "${call.tool}" is not in the allow-list`,
          {
            node: execution.node,
            step: execution.step,
            server: call.server,
            tool: call.tool,
          }
        );
      }

      this.totalCalls += 1;
      if (
        this.maxCallsPerSession !== undefined &&
        this.totalCalls > this.maxCallsPerSession
      ) {
        return halt(
          this.name,
          `MCP call count ${this.totalCalls} exceeded session limit ${this.maxCallsPerSession}`,
          {
            node: execution.node,
            step: execution.step,
            server: call.server,
            tool: call.tool,
            count: this.totalCalls,
            limit: this.maxCallsPerSession,
          }
        );
      }

      const key = `${call.server ?? "unknown"}::${call.tool}`;
      const next = (this.toolCounts.get(key) ?? 0) + 1;
      this.toolCounts.set(key, next);
      if (this.maxCallsPerTool !== undefined && next > this.maxCallsPerTool) {
        return halt(
          this.name,
          `tool "${call.tool}" exceeded per-tool limit ${this.maxCallsPerTool}`,
          {
            node: execution.node,
            step: execution.step,
            server: call.server,
            tool: call.tool,
            count: next,
            limit: this.maxCallsPerTool,
          }
        );
      }
    }

    return cont();
  }

  reset(_ctx: PolicyContext): void {
    this.seenCalls.clear();
    this.totalCalls = 0;
    this.toolCounts = new Map();
  }
}
