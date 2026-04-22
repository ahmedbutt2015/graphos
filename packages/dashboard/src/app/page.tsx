"use client";

import { useTraceStream } from "@/lib/use-trace-stream";
import { LiveGraph } from "@/components/live-graph";

export default function Home() {
  const { latest, connected, sessions, error } = useTraceStream();

  return (
    <main className="min-h-screen p-8">
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

      {!latest ? (
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
      ) : (
        <section className="space-y-4">
          <div className="flex items-center justify-between text-sm text-muted">
            <div>
              <span className="text-ink font-medium">
                {latest.projectId ?? "session"}
              </span>{" "}
              · <code className="bg-black/40 px-1 rounded">{latest.sessionId}</code>{" "}
              · {latest.stepCount} step{latest.stepCount === 1 ? "" : "s"}
            </div>
            <div>
              {latest.outcome === "halted" ? (
                <span className="text-danger">halted</span>
              ) : latest.outcome === "complete" ? (
                <span className="text-accent">complete</span>
              ) : latest.outcome === "error" ? (
                <span className="text-danger">error</span>
              ) : (
                <span className="text-accent">running…</span>
              )}
            </div>
          </div>

          {latest.haltReason && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              <span className="font-medium">policy halt · </span>
              {latest.haltReason}
            </div>
          )}

          <LiveGraph session={latest} />

          <div className="text-xs text-muted">
            {sessions.size} session{sessions.size === 1 ? "" : "s"} in this
            store
          </div>
        </section>
      )}
    </main>
  );
}
