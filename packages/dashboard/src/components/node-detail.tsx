"use client";

import type { TraceEvent } from "@graphos-io/core";

interface Props {
  event?: TraceEvent;
  stepOf?: (event: TraceEvent) => number;
}

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const unwrap = (v: unknown): Record<string, unknown> | undefined => {
  if (!isObject(v)) return undefined;
  if (v["lc"] === 1 && v["type"] === "constructor" && isObject(v["kwargs"])) {
    const kwargs = { ...(v["kwargs"] as Record<string, unknown>) };
    const id = v["id"];
    if (Array.isArray(id) && id.length > 0) {
      const last = id[id.length - 1];
      if (typeof last === "string" && !("_lcType" in kwargs)) {
        kwargs["_lcType"] = last;
      }
    }
    const ak = kwargs["additional_kwargs"];
    if (
      isObject(ak) &&
      Array.isArray(ak["tool_calls"]) &&
      !Array.isArray(kwargs["tool_calls"])
    ) {
      kwargs["tool_calls"] = ak["tool_calls"];
    }
    return kwargs;
  }
  return v;
};

const pickMessages = (state: unknown): Record<string, unknown>[] => {
  if (!isObject(state)) return [];
  const collect = (val: unknown): Record<string, unknown>[] => {
    if (Array.isArray(val)) {
      return val.map(unwrap).filter((m): m is Record<string, unknown> => !!m);
    }
    const single = unwrap(val);
    return single ? [single] : [];
  };
  if ("messages" in state) return collect(state["messages"]);
  for (const val of Object.values(state)) {
    if (isObject(val) && "messages" in val) return collect(val["messages"]);
  }
  return [];
};

const pickRole = (msg: Record<string, unknown>): string => {
  if (typeof msg["role"] === "string") return msg["role"] as string;
  const lcType = msg["_lcType"];
  if (typeof lcType === "string") {
    if (lcType === "AIMessage" || lcType === "AIMessageChunk") return "assistant";
    if (lcType === "HumanMessage") return "user";
    if (lcType === "ToolMessage") return "tool";
    if (lcType === "SystemMessage") return "system";
    return lcType;
  }
  if (typeof msg["type"] === "string") return msg["type"] as string;
  if (Array.isArray(msg["tool_calls"]) && msg["tool_calls"].length > 0) return "assistant";
  return "message";
};

const pickContent = (msg: Record<string, unknown>): string => {
  const c = msg["content"];
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === "string") return part;
        if (isObject(part)) {
          if (typeof part["text"] === "string") return part["text"] as string;
          if (typeof part["content"] === "string") return part["content"] as string;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
};

const pickUsage = (
  msg: Record<string, unknown>
): { input: number; output: number } | undefined => {
  const um = msg["usage_metadata"];
  if (isObject(um)) {
    const input = typeof um["input_tokens"] === "number" ? (um["input_tokens"] as number) : 0;
    const output = typeof um["output_tokens"] === "number" ? (um["output_tokens"] as number) : 0;
    if (input || output) return { input, output };
  }
  const meta = msg["response_metadata"];
  if (isObject(meta)) {
    const u = meta["usage"];
    if (isObject(u)) {
      const input =
        (typeof u["input_tokens"] === "number" ? (u["input_tokens"] as number) : undefined) ??
        (typeof u["prompt_tokens"] === "number" ? (u["prompt_tokens"] as number) : undefined);
      const output =
        (typeof u["output_tokens"] === "number" ? (u["output_tokens"] as number) : undefined) ??
        (typeof u["completion_tokens"] === "number" ? (u["completion_tokens"] as number) : undefined);
      if (input !== undefined || output !== undefined) {
        return { input: input ?? 0, output: output ?? 0 };
      }
    }
    const tu = meta["tokenUsage"];
    if (isObject(tu)) {
      const input =
        typeof tu["promptTokens"] === "number" ? (tu["promptTokens"] as number) : 0;
      const output =
        typeof tu["completionTokens"] === "number"
          ? (tu["completionTokens"] as number)
          : 0;
      if (input || output) return { input, output };
    }
  }
  return undefined;
};

const pickModel = (msg: Record<string, unknown>): string | undefined => {
  const meta = msg["response_metadata"];
  if (isObject(meta)) {
    if (typeof meta["model_name"] === "string") return meta["model_name"] as string;
    if (typeof meta["model"] === "string") return meta["model"] as string;
  }
  return undefined;
};

const pickToolCalls = (
  msg: Record<string, unknown>
): Array<{ name: string; args: unknown }> => {
  const tc = msg["tool_calls"];
  if (!Array.isArray(tc)) return [];
  return tc
    .map((call) => {
      if (!isObject(call)) return null;
      const nameCand =
        typeof call["name"] === "string"
          ? (call["name"] as string)
          : isObject(call["function"]) && typeof call["function"]["name"] === "string"
            ? (call["function"]["name"] as string)
            : undefined;
      if (!nameCand) return null;
      const args =
        call["args"] ??
        (isObject(call["function"]) ? call["function"]["arguments"] : undefined);
      return { name: nameCand, args };
    })
    .filter((x): x is { name: string; args: unknown } => x !== null);
};

const roleColor = (role: string): string => {
  const r = role.toLowerCase();
  if (r.includes("human") || r === "user") return "text-sky-300";
  if (r.includes("ai") || r === "assistant") return "text-emerald-300";
  if (r.includes("tool")) return "text-amber-300";
  if (r.includes("system")) return "text-violet-300";
  return "text-muted";
};

const prettyArgs = (args: unknown): string => {
  if (typeof args === "string") {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

const StateKeys = ({ state }: { state: unknown }) => {
  if (!isObject(state)) return null;
  const keys = Object.keys(state);
  if (keys.length === 0) return null;
  return (
    <div className="text-[11px] text-muted/70">
      <span className="uppercase tracking-wide">state keys</span>{" "}
      <span className="font-mono text-muted">{keys.join(", ")}</span>
    </div>
  );
};

const MessageCard = ({ msg }: { msg: Record<string, unknown> }) => {
  const role = pickRole(msg);
  const content = pickContent(msg);
  const usage = pickUsage(msg);
  const model = pickModel(msg);
  const toolCalls = pickToolCalls(msg);

  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-2.5 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`font-medium ${roleColor(role)}`}>{role}</span>
        <div className="flex items-center gap-2 text-[10px] text-muted">
          {model && <span className="font-mono">{model}</span>}
          {usage && (
            <span className="tabular-nums">
              {usage.input}↓ / {usage.output}↑
            </span>
          )}
        </div>
      </div>

      {content && (
        <div className="whitespace-pre-wrap break-words text-ink/90 leading-relaxed">
          {content}
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="space-y-1">
          {toolCalls.map((tc, i) => (
            <div key={i} className="rounded bg-black/40 p-2 border border-white/5">
              <div className="text-amber-300 font-mono text-[11px]">{tc.name}</div>
              <pre className="mt-1 text-[10px] text-muted overflow-x-auto whitespace-pre-wrap break-words">
                {prettyArgs(tc.args)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const StepDetail = ({
  ev,
  stepIndex,
}: {
  ev: Extract<TraceEvent, { kind: "step" }>;
  stepIndex?: number;
}) => {
  const messages = pickMessages(ev.state);
  return (
    <div className="space-y-3">
      <Header
        title={ev.node}
        subtitle={
          <>
            step {stepIndex ?? ev.step} · {fmtTime(ev.timestamp)}
          </>
        }
        tone="step"
      />
      {messages.length > 0 ? (
        <div className="space-y-2">
          <Label>messages</Label>
          {messages.map((m, i) => (
            <MessageCard key={i} msg={m} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-white/10 bg-black/30 p-3 text-xs text-muted">
          No message updates at this step.
        </div>
      )}
      <StateKeys state={ev.state} />
    </div>
  );
};

const PolicyHaltDetail = ({
  ev,
}: {
  ev: Extract<TraceEvent, { kind: "policy.halt" }>;
}) => (
  <div className="space-y-3">
    <Header
      title={ev.policy}
      subtitle={<>halted at step {ev.step} · {fmtTime(ev.timestamp)}</>}
      tone="halt"
    />
    <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-ink/90">
      {ev.reason}
    </div>
    {ev.details !== undefined && (
      <>
        <Label>details</Label>
        <pre className="rounded-md bg-black/40 border border-white/5 p-2.5 text-[10px] text-muted overflow-x-auto whitespace-pre-wrap break-words">
          {JSON.stringify(ev.details, null, 2)}
        </pre>
      </>
    )}
  </div>
);

const SessionStartDetail = ({
  ev,
}: {
  ev: Extract<TraceEvent, { kind: "session.start" }>;
}) => (
  <div className="space-y-3">
    <Header
      title="session.start"
      subtitle={<>{fmtTime(ev.timestamp)}{ev.projectId ? ` · ${ev.projectId}` : ""}</>}
      tone="session"
    />
    <Label>input</Label>
    <pre className="rounded-md bg-black/40 border border-white/5 p-2.5 text-[10px] text-muted overflow-x-auto whitespace-pre-wrap break-words">
      {JSON.stringify(ev.input, null, 2)}
    </pre>
  </div>
);

const SessionEndDetail = ({
  ev,
}: {
  ev: Extract<TraceEvent, { kind: "session.end" }>;
}) => (
  <div className="space-y-3">
    <Header
      title="session.end"
      subtitle={<>{ev.outcome} · {fmtTime(ev.timestamp)}</>}
      tone={ev.outcome === "error" || ev.outcome === "halted" ? "halt" : "session"}
    />
    {ev.error && (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
        {ev.error.message}
      </div>
    )}
  </div>
);

type Tone = "step" | "halt" | "session";

const toneAccent: Record<Tone, string> = {
  step: "text-emerald-300",
  halt: "text-danger",
  session: "text-accent",
};

const Header = ({
  title,
  subtitle,
  tone,
}: {
  title: string;
  subtitle: React.ReactNode;
  tone: Tone;
}) => (
  <div className="border-b border-white/10 pb-2">
    <div className={`text-sm font-semibold ${toneAccent[tone]} break-all`}>{title}</div>
    <div className="text-[11px] text-muted mt-0.5">{subtitle}</div>
  </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] uppercase tracking-wider text-muted/70">{children}</div>
);

export const NodeDetail = ({ event }: Props) => (
  <aside className="rounded-lg border border-white/10 bg-panel p-4 h-full overflow-y-auto">
    {!event ? (
      <div className="text-xs text-muted">
        Select a step or click a graph node to inspect it.
      </div>
    ) : event.kind === "step" ? (
      <StepDetail ev={event} />
    ) : event.kind === "policy.halt" ? (
      <PolicyHaltDetail ev={event} />
    ) : event.kind === "session.start" ? (
      <SessionStartDetail ev={event} />
    ) : (
      <SessionEndDetail ev={event} />
    )}
  </aside>
);
