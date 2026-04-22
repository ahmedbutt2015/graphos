export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">GraphOS</h1>
        <p className="text-muted">
          Service mesh for AI agents — waiting for your first session.
        </p>
      </header>

      <section className="rounded-lg border border-white/10 bg-panel p-6">
        <h2 className="text-lg font-medium mb-2">No sessions yet</h2>
        <p className="text-muted text-sm">
          Wrap your LangGraph app with{" "}
          <code className="bg-black/40 px-1 rounded">GraphOS.wrap()</code> and
          point it at <code className="bg-black/40 px-1 rounded">ws://localhost:4000/graphos</code>.
          Traces will stream here in real time.
        </p>
      </section>
    </main>
  );
}
