"use client";

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import type { TraceEvent } from "@graphos/core";
import { buildSessionView, type SessionView } from "./session-view";

interface State {
  events: TraceEvent[];
  loading: boolean;
  error?: string;
}

export interface HistoricalSession {
  view?: SessionView;
  events: TraceEvent[];
  step: number;
  setStep: Dispatch<SetStateAction<number>>;
  loading: boolean;
  error?: string;
}

export const useHistoricalSession = (
  sessionId: string | undefined
): HistoricalSession => {
  const [state, setState] = useState<State>({ events: [], loading: false });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setState({ events: [], loading: false });
      setStep(0);
      return;
    }
    let cancelled = false;
    setState({ events: [], loading: true });
    (async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/events`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { events: TraceEvent[] } = await res.json();
        if (cancelled) return;
        setState({ events: data.events, loading: false });
        setStep(data.events.length);
      } catch (err) {
        if (cancelled) return;
        setState({
          events: [],
          loading: false,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const view = useMemo(() => {
    if (!sessionId || state.events.length === 0) return undefined;
    return buildSessionView(sessionId, state.events.slice(0, step));
  }, [sessionId, state.events, step]);

  return { view, events: state.events, step, setStep, loading: state.loading, error: state.error };
};
