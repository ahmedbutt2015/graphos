"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@graphos-io/core";

interface Props {
  events: TraceEvent[];
  step: number;
  setStep: Dispatch<SetStateAction<number>>;
}

const KIND_COLOR: Record<string, string> = {
  "session.start": "bg-accent",
  step: "bg-muted",
  "policy.halt": "bg-danger",
  "session.end": "bg-accent",
};

export const Scrubber = ({ events, step, setStep }: Props) => {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = events.length;
  const atEnd = step >= total;
  const atStart = step <= 0;

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setStep((prev) => Math.min(prev + 1, total));
    }, 400);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, total, setStep]);

  useEffect(() => {
    if (playing && step >= total) setPlaying(false);
  }, [playing, step, total]);

  const togglePlay = () => {
    if (playing) {
      stop();
      return;
    }
    if (atEnd) setStep(0);
    setPlaying(true);
  };

  const current = step > 0 ? events[step - 1] : undefined;

  return (
    <div className="rounded-lg border border-white/10 bg-panel p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            stop();
            setStep(0);
          }}
          disabled={atStart}
          className="text-xs px-2 py-1 rounded border border-white/10 text-muted hover:text-ink disabled:opacity-30"
          title="Jump to start"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            setStep(Math.max(0, step - 1));
          }}
          disabled={atStart}
          className="text-xs px-2 py-1 rounded border border-white/10 text-muted hover:text-ink disabled:opacity-30"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={togglePlay}
          className="text-xs px-3 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10"
        >
          {playing ? "⏸ Pause" : atEnd ? "↻ Replay" : "▶ Play"}
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            setStep(Math.min(total, step + 1));
          }}
          disabled={atEnd}
          className="text-xs px-2 py-1 rounded border border-white/10 text-muted hover:text-ink disabled:opacity-30"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            setStep(total);
          }}
          disabled={atEnd}
          className="text-xs px-2 py-1 rounded border border-white/10 text-muted hover:text-ink disabled:opacity-30"
          title="Jump to end"
        >
          ⏭
        </button>
        <div className="text-xs text-muted ml-2 tabular-nums">
          {step} / {total}
        </div>
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={total}
          value={step}
          onChange={(e) => {
            stop();
            setStep(Number(e.target.value));
          }}
          className="w-full accent-accent"
        />
        <div className="mt-1 flex gap-0.5">
          {events.map((ev, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-sm ${
                i < step ? KIND_COLOR[ev.kind] ?? "bg-muted" : "bg-white/5"
              }`}
              title={`${ev.kind}${"node" in ev ? ` · ${ev.node}` : ""}`}
            />
          ))}
        </div>
      </div>

      {current && (
        <div className="mt-3 text-xs text-muted">
          <span className="font-medium text-ink">{current.kind}</span>
          {"node" in current && current.node && (
            <> · node <code className="bg-black/40 px-1 rounded">{current.node}</code></>
          )}
          {"policy" in current && current.policy && (
            <> · policy <code className="bg-black/40 px-1 rounded">{current.policy}</code></>
          )}
          {"reason" in current && current.reason && (
            <> · {String(current.reason)}</>
          )}
        </div>
      )}
    </div>
  );
};
