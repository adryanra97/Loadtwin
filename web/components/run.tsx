"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, post } from "@/lib/api";
import { Notice } from "./ui";

export type RunState<T> = {
  running: boolean;
  elapsed: number;
  error: ApiError | null;
  result: T | null;
};

/**
 * Runs one simulation request at a time with cancel, an elapsed timer and an estimate, and keeps
 * field-level errors from the API so the form can highlight them.
 */
export function useRun<T>(path: string, initial: T | null, onResult?: (r: T) => void) {
  const [state, setState] = useState<RunState<T>>({ running: false, elapsed: 0, error: null, result: initial });
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initial && !state.result) setState((s) => ({ ...s, result: initial }));
    // only when the persisted result arrives after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const run = useCallback(
    async (body: unknown) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const t0 = performance.now();
      setState((s) => ({ ...s, running: true, elapsed: 0, error: null }));
      stop();
      timer.current = setInterval(() => setState((s) => ({ ...s, elapsed: (performance.now() - t0) / 1000 })), 200);
      try {
        const r = await post<T>(path, body, c.signal);
        setState({ running: false, elapsed: 0, error: null, result: r });
        onResult?.(r);
        // On a single-column layout the result is below the form: bring it into view.
        if (window.matchMedia("(max-width: 960px)").matches)
          requestAnimationFrame(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } catch (e) {
        if ((e as Error).name === "AbortError") setState((s) => ({ ...s, running: false }));
        else setState((s) => ({ ...s, running: false, error: e instanceof ApiError ? e : new ApiError(String(e), 0) }));
      } finally {
        stop();
      }
    },
    [path, onResult],
  );

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    stop();
    setState((s) => ({ ...s, running: false }));
  }, []);

  const clear = useCallback(() => setState((s) => ({ ...s, result: null, error: null })), []);

  useEffect(() => () => ctrl.current?.abort(), []);
  return { ...state, run, cancel, clear, fieldErrors: state.error?.fields ?? {} };
}

/** Primary action with estimate, progress, cancel and a live status message. */
export function RunBar({
  label,
  running,
  elapsed,
  estimateS,
  disabled,
  disabledReason,
  onCancel,
  error,
}: {
  label: string;
  running: boolean;
  elapsed: number;
  estimateS: number;
  disabled?: boolean;
  disabledReason?: string;
  onCancel: () => void;
  error: ApiError | null;
}) {
  const share = Math.min(elapsed / Math.max(estimateS, 0.5), 0.95);
  return (
    <div className="stack-sm run-bar">
      {running ? (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled aria-disabled>
            Simulating… {elapsed.toFixed(0)} s
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="submit" className="btn btn-primary btn-block" disabled={disabled}>
          {label}
        </button>
      )}
      {running && (
        <div className="progress" aria-hidden>
          <span style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <p className="hint" aria-live="polite">
        {running
          ? elapsed > estimateS * 1.5
            ? "Taking longer than usual. You can keep waiting or cancel."
            : `Running the SimPy simulation. Usually about ${Math.max(1, Math.round(estimateS))} s.`
          : disabled && disabledReason
            ? disabledReason
            : `Estimated time: about ${Math.max(1, Math.round(estimateS))} s.`}
      </p>
      {error && (
        <Notice tone="bad" title={error.status === 422 ? "Some values need attention" : "The run did not finish"}>
          {error.message}
        </Notice>
      )}
    </div>
  );
}
