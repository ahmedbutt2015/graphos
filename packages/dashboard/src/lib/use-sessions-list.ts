"use client";

import { useCallback, useEffect, useState } from "react";

export interface SessionSummary {
  sessionId: string;
  projectId?: string;
  startedAt: number;
  endedAt?: number;
  outcome?: "complete" | "halted" | "error";
  stepCount: number;
  eventCount: number;
}

interface State {
  sessions: SessionSummary[];
  loading: boolean;
  error?: string;
}

export const useSessionsList = (refreshKey: number = 0) => {
  const [state, setState] = useState<State>({ sessions: [], loading: true });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { sessions: SessionSummary[] } = await res.json();
      setState({ sessions: data.sessions, loading: false });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "fetch failed",
      }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  return { ...state, refresh };
};
