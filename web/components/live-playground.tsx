"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, post } from "@/lib/api";
import { num, pct } from "@/lib/format";
import type { FaultResult, Service, Spec, Summary } from "@/lib/types";
import { useService } from "./shell";
import { PendingStage, TwinStage, type StageFrame } from "./twin-stage";
import { Segmented } from "./ui";

const VCPU_STEPS = [1, 2, 4, 8, 16, 32, 64, 128];

type Knobs = {
  tps: number;
  nodes: number;
  vcpu: number;
  threadPool: number;
  crash: boolean;
  slowDb: boolean;
  extTimeout: boolean;
};

type Reading = { cpu: number; thread: number; p95: number; err: number; down: number; dbSlow: number; extFail: number };

function readSimulate(s: Summary): Reading {
  return { cpu: s.cpuPct, thread: s.threadPct, p95: s.p95Ms, err: s.errorRatePct, down: 0, dbSlow: 1, extFail: 0 };
}

function readFault(r: FaultResult, k: Knobs): Reading {
  const during = r.timeline.filter((w) => w.fault);
  const avg = (f: (w: (typeof during)[number]) => number) => (during.length ? during.reduce((a, w) => a + f(w), 0) / during.length : 0);
  return {
    cpu: avg((w) => w.cpuPct),
    thread: avg((w) => w.threadPct),
    p95: r.phases.during.p95Ms ?? 0,
    err: r.phases.during.errorRatePct,
    down: k.crash ? 1 : 0,
    dbSlow: k.slowDb ? 3 : 1,
    extFail: k.extTimeout ? 0.3 : 0,
  };
}

function Stepper({
  label,
  noun,
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  label: string;
  noun: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  return (
    <div className="knob" role="group" aria-label={label}>
      <span className="knob-label">{label}</span>
      <div className="knob-row">
        <button type="button" className="knob-btn" onClick={onDec} disabled={decDisabled} aria-label={`Fewer ${noun}`}>
          −
        </button>
        <output className="knob-value">{value}</output>
        <button type="button" className="knob-btn" onClick={onInc} disabled={incDisabled} aria-label={`More ${noun}`}>
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Live mode: change traffic, nodes, vCPU or threads, or break something, and the twin re-simulates
 * the service right away. Every number shown comes back from the engine for the current knobs.
 */
export function LivePlayground({
  title = "Live mode",
  startTps,
  startSpec,
  height = 240,
  compact = false,
}: {
  title?: string;
  startTps?: number;
  startSpec?: Spec;
  height?: number;
  compact?: boolean;
}) {
  const [svc, saveSvc, hydrated] = useService();
  const base = startSpec ?? svc.targetSpec;
  const start = useMemo<Knobs>(
    () => ({
      tps: Math.max(Math.round(startTps ?? svc.measurement.tps), 1),
      nodes: base.nodes,
      vcpu: base.vcpu,
      threadPool: base.threadPool,
      crash: false,
      slowDb: false,
      extTimeout: false,
    }),
    [startTps, svc.measurement.tps, base.nodes, base.vcpu, base.threadPool],
  );
  const [k, setK] = useState<Knobs>(start);
  const [reading, setReading] = useState<Reading | null>(null);
  const [first, setFirst] = useState<Reading | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const startKey = JSON.stringify(start);
  const lastStart = useRef(startKey);

  useEffect(() => {
    if (lastStart.current !== startKey) {
      lastStart.current = startKey;
      setK(start);
      setFirst(null);
    }
  }, [startKey, start]);

  useEffect(() => {
    if (!hydrated) return;
    const c = new AbortController();
    setState("busy");
    setApplied(false);
    const id = setTimeout(async () => {
      const targetSpec: Spec = { ...base, nodes: k.nodes, vcpu: k.vcpu, threadPool: k.threadPool };
      const common = { measuredSpec: svc.measuredSpec, measurement: svc.measurement, targetSpec, database: svc.database };
      try {
        let r: Reading;
        if (k.crash || k.slowDb || k.extTimeout) {
          const res = await post<FaultResult>(
            "/fault",
            {
              ...common,
              sla: svc.sla,
              tps: Math.min(k.tps, 1000),
              fault: {
                nodesDown: k.crash ? 1 : 0,
                dbSlowdown: k.slowDb ? 3 : 1,
                extFailShare: k.extTimeout ? 0.3 : 0,
                extTimeoutMs: 2000,
                durationS: 30,
              },
            },
            c.signal,
          );
          r = readFault(res, k);
        } else {
          const res = await post<{ results: { summary: Summary }[] }>("/simulate", { ...common, loadsTps: [k.tps] }, c.signal);
          r = readSimulate(res.results[0].summary);
        }
        setReading(r);
        setFirst((f) => f ?? r);
        setState("idle");
        setError("");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setState("error");
        setError(e instanceof ApiError ? e.message : "The engine did not answer.");
      }
    }, 300);
    return () => {
      clearTimeout(id);
      c.abort();
    };
    // base fields are part of startKey; the service objects are stable per save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, hydrated, svc]);

  const set = (patch: Partial<Knobs>) => setK((x) => ({ ...x, ...patch }));
  const vi = VCPU_STEPS.indexOf(k.vcpu);
  const maxTps = Math.max(start.tps * 3, k.tps);
  const frame: StageFrame = {
    t: 0,
    tps: k.tps,
    cpu: reading?.cpu ?? 0,
    thread: reading?.thread ?? 0,
    p95: reading?.p95 ?? 0,
    err: reading?.err ?? 0,
    down: reading?.down ?? 0,
    dbSlow: reading?.dbSlow ?? 1,
    extFail: reading?.extFail ?? 0,
  };
  const frames = [frame];
  const broken =
    reading && (reading.p95 > svc.sla.maxP95Ms || reading.err > svc.sla.maxErrorRatePct || reading.cpu > svc.sla.maxCpuPct);
  const changed = JSON.stringify({ ...k }) !== JSON.stringify(start);
  const specChanged = k.nodes !== base.nodes || k.vcpu !== base.vcpu || k.threadPool !== base.threadPool;

  const delta = (now: number | undefined, then: number | undefined, unit: string, digits = 0) => {
    if (now === undefined || then === undefined || !changed) return null;
    const d = now - then;
    if (Math.abs(d) < (digits ? 0.05 : 0.5)) return null;
    return (
      <span className={`delta ${d > 0 ? "up" : "down"}`}>
        {d > 0 ? "+" : "−"}
        {num(Math.abs(d), digits)}
        {unit}
      </span>
    );
  };

  return (
    <section className={`live ${compact ? "live-compact" : ""}`} aria-label={title}>
      <div className="stage-head">
        <span className="stage-title">{title}</span>
        <span className="row" style={{ gap: 6 }}>
          {state === "busy" ? (
            <span className="badge tone-na stage-busy">Simulating…</span>
          ) : state === "error" ? (
            <span className="badge tone-bad">Engine error</span>
          ) : broken ? (
            <span className="badge tone-bad">SLA broken</span>
          ) : reading ? (
            <span className="badge tone-good">Within SLA</span>
          ) : null}
        </span>
      </div>

      <div className="live-body">
        <TwinStage nodes={Math.min(k.nodes, 40)} frames={frames} maxTps={maxTps} slaP95={svc.sla.maxP95Ms} slaCpu={svc.sla.maxCpuPct} readout={false} height={height} />
        <div className="live-dock" role="toolbar" aria-label="Change the system">
          <div className="knob knob-traffic">
            <span className="knob-label">
              Traffic <strong>{num(k.tps)} req/s</strong>
            </span>
            <div className="knob-row">
              <button type="button" className="knob-btn" aria-label="Less traffic" onClick={() => set({ tps: Math.max(1, Math.round(k.tps * 0.8)) })}>
                −
              </button>
              <input
                type="range"
                min={1}
                max={Math.max(start.tps * 4, 20)}
                value={Math.min(k.tps, Math.max(start.tps * 4, 20))}
                onChange={(e) => set({ tps: Number(e.target.value) })}
                aria-label="Traffic in requests per second"
              />
              <button
                type="button"
                className="knob-btn"
                aria-label="More traffic"
                onClick={() => set({ tps: Math.min(1000, Math.max(k.tps + 1, Math.round(k.tps * 1.25))) })}
              >
                +
              </button>
            </div>
          </div>
          <Stepper
            label="Nodes"
            noun="nodes"
            value={String(k.nodes)}
            onDec={() => set({ nodes: k.nodes - 1, crash: k.nodes - 1 > 1 && k.crash })}
            onInc={() => set({ nodes: k.nodes + 1 })}
            decDisabled={k.nodes <= 1}
            incDisabled={k.nodes >= 40}
          />
          <Stepper
            label="vCPU"
            noun="vCPU"
            value={String(k.vcpu)}
            onDec={() => set({ vcpu: VCPU_STEPS[Math.max(vi - 1, 0)] ?? Math.max(1, k.vcpu - 1) })}
            onInc={() => set({ vcpu: VCPU_STEPS[Math.min(vi + 1, VCPU_STEPS.length - 1)] ?? k.vcpu + 1 })}
            decDisabled={k.vcpu <= 1}
            incDisabled={k.vcpu >= 128}
          />
          <Stepper
            label="Threads"
            noun="threads"
            value={String(k.threadPool)}
            onDec={() => set({ threadPool: Math.max(1, Math.round(k.threadPool / 1.5)) })}
            onInc={() => set({ threadPool: Math.min(2000, Math.round(k.threadPool * 1.5)) })}
            decDisabled={k.threadPool <= 1}
            incDisabled={k.threadPool >= 2000}
          />
          <div className="knob knob-break" role="group" aria-label="Break something">
            <span className="knob-label">Break something</span>
            <div className="knob-toggles">
              <button type="button" className="toggle" aria-pressed={k.crash} disabled={k.nodes <= 1} onClick={() => set({ crash: !k.crash })}>
                Crash a node
              </button>
              <button type="button" className="toggle" aria-pressed={k.slowDb} onClick={() => set({ slowDb: !k.slowDb })}>
                Slow DB ×3
              </button>
              <button type="button" className="toggle" aria-pressed={k.extTimeout} onClick={() => set({ extTimeout: !k.extTimeout })}>
                API timeouts
              </button>
            </div>
          </div>
        </div>
      </div>

      <dl className="stage-readout live-readout" aria-live="polite" aria-busy={state === "busy"}>
        <div>
          <dt>p95</dt>
          <dd>
            {reading ? `${num(reading.p95)} ms` : "—"} {delta(reading?.p95, first?.p95, " ms")}
          </dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>
            {reading ? pct(reading.cpu) : "—"} {delta(reading?.cpu, first?.cpu, " pt")}
          </dd>
        </div>
        <div>
          <dt>Threads</dt>
          <dd>{reading ? pct(reading.thread) : "—"}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>
            {reading ? pct(reading.err, 2) : "—"} {delta(reading?.err, first?.err, " pt", 1)}
          </dd>
        </div>
      </dl>
      {error && <p className="error">{error}</p>}
      <div className="spread">
        <p className="hint" style={{ flex: "1 1 260px" }}>
          {k.crash || k.slowDb || k.extTimeout
            ? "Numbers are for the moment the failure is active, from a SimPy run of this exact setup."
            : "Each change re-runs the SimPy simulation for this exact setup. Deltas compare with where you started."}
        </p>
        <div className="row">
          <button type="button" className="btn btn-sm btn-ghost" disabled={!changed} onClick={() => setK(start)}>
            Reset
          </button>
          {specChanged && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={applied}
              onClick={() => {
                const next: Service = { ...svc, targetSpec: { ...svc.targetSpec, nodes: k.nodes, vcpu: k.vcpu, threadPool: k.threadPool } };
                saveSvc(next);
                setApplied(true);
              }}
            >
              {applied ? "Saved as target" : "Use as target"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** What a tool shows before it has a result: live mode to play with, or the stage while a run is going. */
export function ToolIdle({
  nodes,
  running,
  idleText,
  startTps,
  startSpec,
}: {
  nodes: number;
  running: boolean;
  idleText: React.ReactNode;
  startTps?: number;
  startSpec?: Spec;
}) {
  if (running) return <PendingStage nodes={nodes} running idleText="" />;
  return (
    <div className="card stack">
      <LivePlayground title="Play with your cluster" startTps={startTps} startSpec={startSpec} />
      <p className="muted small live-next">{idleText}</p>
    </div>
  );
}

/** A result card that switches between the replay of the run and live mode. */
export function ReplayOrLive({
  replay,
  startTps,
  startSpec,
}: {
  replay: React.ReactNode;
  startTps?: number;
  startSpec?: Spec;
}) {
  const [mode, setMode] = useState<"replay" | "live">("replay");
  return (
    <div className="card stack-sm">
      <div className="mode-switch">
        <Segmented
          name={`mode-${Math.round((startTps ?? 0) * 10)}`}
          label="Replay or live mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "replay", label: "Replay of this run" },
            { value: "live", label: "Live mode: change it yourself" },
          ]}
        />
      </div>
      {mode === "replay" ? replay : <LivePlayground title="Live mode" startTps={startTps} startSpec={startSpec} />}
    </div>
  );
}
