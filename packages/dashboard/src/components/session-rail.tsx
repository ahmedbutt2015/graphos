"use client";

import type { SessionSummary } from "@/lib/use-sessions-list";

const formatAgo = (ts: number) => {
  const delta = Date.now() - ts;
  if (delta < 60_000) return `${Math.max(1, Math.floor(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
};

const outcomeBadge = (outcome: SessionSummary["outcome"]) => {
  if (outcome === "halted") return <span className="text-danger">halted</span>;
  if (outcome === "complete") return <span className="text-accent">complete</span>;
  if (outcome === "error") return <span className="text-danger">error</span>;
  return <span className="text-accent">running…</span>;
};

interface Props {
  sessions: SessionSummary[];
  loading: boolean;
  error?: string;
  selectedId?: string;
  onSelect: (sessionId: string | undefined) => void;
  onRefresh: () => void;
}

export const SessionRail = ({
  sessions,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: Props) => {
  return (
    <aside className="w-72 shrink-0 border-r border-white/10 bg-panel/40">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-medium">Sessions</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            className={`text-xs px-2 py-1 rounded border ${
              selectedId === undefined
                ? "border-accent/60 text-accent"
                : "border-white/10 text-muted hover:text-ink"
            }`}
          >
            Live
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs text-muted hover:text-ink"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-danger">Failed: {error}</div>
      )}

      {loading && sessions.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted">Loading…</div>
      )}

      {!loading && sessions.length === 0 && !error && (
        <div className="px-4 py-3 text-xs text-muted">
          No sessions yet. Run a demo to populate.
        </div>
      )}

      <ul className="overflow-y-auto max-h-[calc(100vh-60px)]">
        {sessions.map((s) => {
          const active = s.sessionId === selectedId;
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                onClick={() => onSelect(s.sessionId)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors ${
                  active
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-ink">
                    {s.projectId ?? "unknown"}
                  </span>
                  {outcomeBadge(s.outcome)}
                </div>
                <div className="mt-1 text-[11px] text-muted truncate">
                  {s.sessionId}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                  <span>
                    {s.stepCount} step{s.stepCount === 1 ? "" : "s"} ·{" "}
                    {s.eventCount} event{s.eventCount === 1 ? "" : "s"}
                  </span>
                  <span>{formatAgo(s.startedAt)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
