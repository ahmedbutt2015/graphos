"use client";

import { useEffect, useMemo, useState } from "react";
import type { TraceEvent } from "@graphos-io/core";
import { useTraceStream } from "@/lib/use-trace-stream";
import { useSessionsList } from "@/lib/use-sessions-list";
import { useHistoricalSession } from "@/lib/use-historical-session";
import { LiveGraph } from "@/components/live-graph";
import { SessionRail } from "@/components/session-rail";
import { Scrubber } from "@/components/scrubber";
import { NodeDetail } from "@/components/node-detail";

const isNodeEvent = (
  ev: TraceEvent
): ev is Extract<TraceEvent, { kind: "step" }> => ev.kind === "step";

export default function Home() {
  const { latest, connected, sessions, error } = useTraceStream();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const sessionsList = useSessionsList(refreshKey);
  const history = useHistoricalSession(selectedId);

  useEffect(() => {
    if (!latest) return;
    setRefreshKey((k) => k + 1);
  }, [latest?.sessionId, latest?.outcome]);

  const view = selectedId ? history.view : latest;
  const mode: "live" | "history" = selectedId ? "history" : "live";

  const focusedEvent: TraceEvent | undefined = useMemo(() => {
    if (mode === "history") {
      if (history.step <= 0) return undefined;
      return history.events[history.step - 1];
    }
    if (!latest?.events?.length) return undefined;
    for (let i = latest.events.length - 1; i >= 0; i--) {
      const ev = latest.events[i];
      if (ev && (ev.kind === "step" || ev.kind === "policy.halt")) return ev;
    }
    return latest.events[latest.events.length - 1];
  }, [mode, history.step, history.events, latest]);

  const focusedNode =
    focusedEvent && "node" in focusedEvent ? focusedEvent.node : undefined;

  const handleNodeClick = (node: string) => {
    if (mode !== "history") return;
    for (let i = history.events.length - 1; i >= 0; i--) {
      const ev = history.events[i];
      if (ev && isNodeEvent(ev) && ev.node === node) {
        history.setStep(i + 1);
        return;
      }
    }
  };

  return (
    <div className="flex min-h-screen">
      <SessionRail
        sessions={sessionsList.sessions}
        loading={sessionsList.loading}
        error={sessionsList.error}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />

      <main className="flex-1 p-8 overflow-x-hidden">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">GraphOS</h1>
            <p className="text-muted">
              Service mesh for AI agents — live LangGraph telemetry.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? "bg-accent" : "bg-danger"
              }`}
            />
            <span className="text-muted">
              {connected ? "connected" : error ?? "connecting…"}
            </span>
          </div>
        </header>

        {mode === "history" && history.loading && (
          <section className="rounded-lg border border-white/10 bg-panel p-6">
            <p className="text-muted text-sm">Loading session…</p>
          </section>
        )}

        {mode === "history" && !history.loading && history.error && (
          <section className="rounded-lg border border-danger/40 bg-danger/10 p-6 text-sm">
            Failed to load session: {history.error}
          </section>
        )}

        {!view && mode === "live" && (
          <section className="rounded-lg border border-white/10 bg-panel p-6">
            <h2 className="text-lg font-medium mb-2">Waiting for a session</h2>
            <p className="text-muted text-sm">
              Wrap your LangGraph app with{" "}
              <code className="bg-black/40 px-1 rounded">GraphOS.wrap()</code> and
              pass{" "}
              <code className="bg-black/40 px-1 rounded">
                onTrace: createWebSocketTransport()
              </code>
              . Events will stream in and render here in real time.
            </p>
          </section>
        )}

        {view && (
          <section className="space-y-4">
            <div className="flex items-center justify-between text-sm text-muted">
              <div>
                <span className="text-ink font-medium">
                  {view.projectId ?? "session"}
                </span>{" "}
                · <code className="bg-black/40 px-1 rounded">{view.sessionId}</code>{" "}
                · {view.stepCount} step{view.stepCount === 1 ? "" : "s"}
                {mode === "history" && (
                  <span className="ml-2 text-[11px] uppercase tracking-wide text-accent/70">
                    replay
                  </span>
                )}
              </div>
              <div>
                {view.outcome === "halted" ? (
                  <span className="text-danger">halted</span>
                ) : view.outcome === "complete" ? (
                  <span className="text-accent">complete</span>
                ) : view.outcome === "error" ? (
                  <span className="text-danger">error</span>
                ) : (
                  <span className="text-accent">running…</span>
                )}
              </div>
            </div>

            {view.haltReason && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
                <span className="font-medium">policy halt · </span>
                {view.haltReason}
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
              <div className="space-y-4 min-w-0">
                <LiveGraph
                  session={view}
                  focusedNode={focusedNode}
                  onNodeClick={mode === "history" ? handleNodeClick : undefined}
                />

                {mode === "history" && history.events.length > 0 && (
                  <Scrubber
                    events={history.events}
                    step={history.step}
                    setStep={history.setStep}
                  />
                )}

                {mode === "live" && (
                  <div className="text-xs text-muted">
                    {sessions.size} session{sessions.size === 1 ? "" : "s"} in this
                    store
                  </div>
                )}
              </div>

              <div className="min-w-0 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)]">
                <NodeDetail event={focusedEvent} />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
