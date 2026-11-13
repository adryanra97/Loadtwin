"use client";

import { LineChart } from "@/components/charts";
import { Trash } from "@/components/icons";
import { RunBar, useRun } from "@/components/run";
import { TwinStage } from "@/components/twin-stage";
import { ReplayOrLive, ToolIdle } from "@/components/live-playground";
import { breachBands, patternFrames } from "@/lib/replay";
import { ServiceStrip, useService } from "@/components/shell";
import { NumberField, Segmented, Stat, VerdictBanner } from "@/components/ui";
import { DEFAULT_PATTERN, LIMITS, patternSegments } from "@/lib/defaults";
import { check, type FieldDef } from "@/lib/fields";
import { num, pct, seconds } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { PatternIn, PatternKind, PatternResult } from "@/lib/types";

const NONE: PatternResult | null = null;
const KINDS: { value: PatternKind; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "spike", label: "Spike" },
  { value: "ramp", label: "Ramp" },
  { value: "custom", label: "Custom" },
];
const ABOUT: Record<PatternKind, string> = {
  daily: "A business day compressed: quiet at night, busy late morning and evening. Each hour lasts a few simulated seconds.",
  spike: "Steady traffic, a sudden burst (a campaign or a retry storm), then back to normal. Shows how fast the backlog clears.",
  ramp: "Load climbs steadily from start to end, so you can see where things start to break.",
  custom: "Your own sequence of steady stretches.",
};

type PKey = "peakTps" | "baseTps" | "secondsPerHour" | "spikeS" | "durationS";
const F: Record<PKey, FieldDef> = {
  peakTps: { label: "Peak load", unit: "req/s", min: 0, max: 2000 },
  baseTps: { label: "Base load", unit: "req/s", min: 0, max: 2000 },
  secondsPerHour: { label: "Seconds per hour", unit: "s", min: 5, max: 60, hint: "How long each hour of the day is simulated." },
  spikeS: { label: "Spike length", unit: "s", min: 5, max: 300 },
  durationS: { label: "Ramp length", unit: "s", min: 30, max: 1200 },
};
const SEG: Record<string, FieldDef> = {
  durationS: { label: "Seconds", min: 0, gt: true, max: 1200 },
  tps: { label: "req/s", min: 0, max: 2000 },
};
const VISIBLE: Record<PatternKind, (PKey)[]> = {
  daily: ["peakTps", "baseTps", "secondsPerHour"],
  spike: ["baseTps", "peakTps", "spikeS"],
  ramp: ["baseTps", "peakTps", "durationS"],
  custom: [],
};
const LABEL: Record<PatternKind, Partial<Record<PKey, string>>> = {
  daily: { baseTps: "Night-time floor" },
  spike: { peakTps: "Spike load" },
  ramp: { baseTps: "Start load", peakTps: "End load" },
  custom: {},
};

type Draft = { [K in Exclude<keyof PatternIn, "segments">]: PatternIn[K] | "" } & {
  segments: { durationS: number | ""; tps: number | "" }[];
};

export default function PatternsPage() {
  const [svc] = useService();
  const [p, setP] = usePersistent<Draft>(KEYS.pattern, DEFAULT_PATTERN as Draft);
  const [saved, setSaved] = usePersistent<PatternResult | null>(`${KEYS.pattern}.result`, NONE);
  const r = useRun<PatternResult>("/pattern", saved, setSaved);

  const kind = p.kind as PatternKind;
  const errs: Record<string, string> = {};
  for (const k of VISIBLE[kind]) {
    const e = check(F[k], p[k]);
    if (e) errs[`pattern.${k}`] = e;
  }
  const segErr = (i: number, k: "durationS" | "tps") => check(SEG[k], p.segments[i][k]);
  if (kind === "custom") {
    if (p.segments.length === 0) errs["pattern.segments"] = "Add at least one stretch.";
    else if (p.segments.some((_, i) => segErr(i, "durationS") || segErr(i, "tps"))) errs["pattern.segments"] = "Fix the outlined values.";
  }
  const valid = Object.keys(errs).length === 0;
  const segs = valid ? patternSegments(p as unknown as PatternIn) : [];
  const total = segs.reduce((a, s) => a + s.durationS, 0);
  const requests = segs.reduce((a, s) => a + s.durationS * s.tps, 0);
  if (valid && total > LIMITS.maxPatternS) errs.size = `The pattern lasts ${seconds(total)}; the limit is ${LIMITS.maxPatternS / 60} minutes.`;
  else if (valid && requests > LIMITS.maxPatternRequests)
    errs.size = `About ${num(requests)} requests; the limit is ${num(LIMITS.maxPatternRequests)}. Lower the load or shorten it.`;
  else if (valid && !segs.some((s) => s.tps > 0)) errs.size = "The pattern has no load. Set a peak above 0.";
  const blocked = Object.keys(errs).length > 0;
  const all = { ...errs, ...r.fieldErrors };

  // Step points for the preview: each segment is flat from its start to its end.
  const preview: { x: number; y: number }[] = [];
  let t = 0;
  for (const s of segs) {
    preview.push({ x: t, y: s.tps });
    t += s.durationS;
    preview.push({ x: t, y: s.tps });
  }

  const submit = () => {
    if (blocked) return;
    r.run({
      measuredSpec: svc.measuredSpec,
      measurement: svc.measurement,
      targetSpec: svc.targetSpec,
      sla: svc.sla,
      database: svc.database,
      pattern: {
        ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === "" ? DEFAULT_PATTERN[k as keyof PatternIn] : v])),
        segments: kind === "custom" ? p.segments : [],
      },
    });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Load patterns</h1>
        <p className="lede">Real traffic is not flat. Run the target setup through a day, a spike or a ramp and see when, and for how long, the SLA breaks.</p>
      </div>
      <div className="tool">
        <aside className="stack">
          <ServiceStrip />
          <form
            className="card stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset className="stack">
              <legend>Pattern</legend>
              <Segmented name="kind" label="Pattern type" value={kind} options={KINDS} onChange={(v) => setP({ ...p, kind: v })} />
              <p className="hint">{ABOUT[kind]}</p>
              {kind !== "custom" ? (
                <div className="grid-2">
                  {VISIBLE[kind].map((k) => (
                    <NumberField
                      key={`${kind}-${k}`}
                      def={{ ...F[k], label: LABEL[kind][k] ?? F[k].label }}
                      value={p[k] as number | ""}
                      serverError={all[`pattern.${k}`]}
                      onChange={(v) => setP({ ...p, [k]: v })}
                    />
                  ))}
                </div>
              ) : (
                <div className="stack-sm">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Stretch</th>
                          <th scope="col">Seconds</th>
                          <th scope="col">req/s</th>
                          <th scope="col">
                            <span className="sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.segments.map((s, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            {(["durationS", "tps"] as const).map((k) => (
                              <td key={k}>
                                <input
                                  type="number"
                                  step="any"
                                  aria-label={`Stretch ${i + 1} ${SEG[k].label}`}
                                  aria-invalid={segErr(i, k) ? true : undefined}
                                  title={segErr(i, k) || undefined}
                                  value={s[k]}
                                  onChange={(e) =>
                                    setP({
                                      ...p,
                                      segments: p.segments.map((x, j) => (j === i ? { ...x, [k]: e.target.value === "" ? "" : Number(e.target.value) } : x)),
                                    })
                                  }
                                />
                              </td>
                            ))}
                            <td>
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label={`Remove stretch ${i + 1}`}
                                onClick={() => setP({ ...p, segments: p.segments.filter((_, j) => j !== i) })}
                              >
                                <Trash size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={p.segments.length >= 48}
                    onClick={() => setP({ ...p, segments: [...p.segments, { durationS: 30, tps: 30 }] })}
                  >
                    Add stretch
                  </button>
                  {all["pattern.segments"] && (
                    <span className="error" role="alert">
                      {all["pattern.segments"]}
                    </span>
                  )}
                </div>
              )}
            </fieldset>

            <div className="stack-sm">
              <span className="label">Preview of the offered load</span>
              {segs.length > 0 ? (
                <LineChart
                  label="Offered load over the pattern"
                  yLabel="req/s"
                  xLabel="Second"
                  height={150}
                  series={[{ name: "Offered load", color: "var(--series-1)", unit: "req/s", points: preview }]}
                />
              ) : (
                <p className="hint">Fill in the fields to see the pattern.</p>
              )}
              {segs.length > 0 && (
                <p className="hint">
                  {seconds(total)} simulated, about {num(requests)} requests.
                </p>
              )}
              {all.size && (
                <span className="error" role="alert">
                  {all.size}
                </span>
              )}
            </div>

            <RunBar
              label="Run pattern"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={0.5 + requests / 9000}
              disabled={blocked}
              disabledReason="Fix the highlighted fields first."
              onCancel={r.cancel}
              error={r.error}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setP(DEFAULT_PATTERN as Draft)}>
              Reset to defaults
            </button>
          </form>
        </aside>
        <section id="results" style={{ scrollMarginTop: 120 }} aria-label="Results" aria-busy={r.running} className="stack">
          {r.result ? (
            <Results res={r.result} sla={svc.sla} stale={r.running} nodes={svc.targetSpec.nodes} />
          ) : (
            <ToolIdle nodes={svc.targetSpec.nodes} startTps={Number(p.baseTps) || undefined} running={r.running} idleText={<>Pick a pattern, check the preview, then run it.</>} />
          )}
        </section>
      </div>
    </div>
  );
}

function Results({
  res,
  sla,
  stale,
  nodes,
}: {
  res: PatternResult;
  sla: { maxP95Ms: number; maxCpuPct: number };
  stale: boolean;
  nodes: number;
}) {
  const frames = patternFrames(res);
  const W = 10;
  const bands: { x0: number; x1: number }[] = [];
  for (const w of res.windows) {
    if (!w.breach) continue;
    const last = bands[bands.length - 1];
    if (last && Math.abs(last.x1 - (w.t - W)) < 1e-6) last.x1 = w.t;
    else bands.push({ x0: w.t - W, x1: w.t });
  }
  const pts = (f: (w: PatternResult["windows"][number]) => number | null) => res.windows.map((w) => ({ x: w.t, y: f(w) }));
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      <VerdictBanner verdict={res.verdict}>
        <ul className="reasons">
          {res.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </VerdictBanner>
      <ReplayOrLive
        startTps={Math.max(...res.windows.map((w) => w.offeredTps))}
        replay={
          <TwinStage
            title="Replay of the pattern"
            nodes={nodes}
            frames={frames}
            slaP95={sla.maxP95Ms}
            slaCpu={sla.maxCpuPct}
            bands={breachBands(frames, 10)}
            caption="Each dot is a request. Node fill is CPU, ticks in front of a node are waiting requests, red dots fail. The values are the simulation's, window by window."
          />
        }
      />
      <div className="stats">
        <Stat k="Time over the SLA" v={seconds(res.breachSeconds)} s={`${pct(res.breachShare * 100)} of the pattern`} />
        <Stat
          k="Worst 10 seconds"
          v={res.worstWindow.p95Ms ? `${num(res.worstWindow.p95Ms)} ms` : "—"}
          s={`p95, ending at ${num(res.worstWindow.t)} s`}
        />
        <Stat
          k="Recovery after the drop"
          v={res.recoverySeconds !== null ? seconds(res.recoverySeconds) : "—"}
          s={res.recoverySeconds !== null ? "Until the SLA holds again" : res.breachSeconds ? "No recovery seen or no drop" : "Nothing to recover from"}
        />
      </div>
      <div className="card stack">
        <div className="card-head">
          <h2>Load: offered and served</h2>
          <span className="hint">10-second windows; shaded where the SLA breaks</span>
        </div>
        <LineChart
          label="Offered and served load per 10-second window"
          yLabel="req/s"
          xLabel="Second"
          bands={bands}
          series={[
            { name: "Offered", color: "var(--series-1)", unit: "req/s", points: pts((w) => w.offeredTps) },
            { name: "Served", color: "var(--series-2)", unit: "req/s", points: pts((w) => w.throughputTps), dashed: true },
          ]}
        />
      </div>
      <div className="card stack">
        <h2>p95 response time</h2>
        <LineChart
          label="p95 response time per 10-second window"
          yLabel="p95 (ms)"
          xLabel="Second"
          bands={bands}
          threshold={{ y: sla.maxP95Ms, label: `SLA ${num(sla.maxP95Ms)} ms` }}
          series={[{ name: "p95", color: "var(--series-1)", unit: "ms", points: pts((w) => w.p95Ms) }]}
          height={200}
        />
      </div>
      <div className="card stack">
        <h2>CPU and worker threads</h2>
        <LineChart
          label="CPU and worker-thread utilization per window"
          yLabel="Utilization (%)"
          xLabel="Second"
          yMax={100}
          bands={bands}
          threshold={{ y: sla.maxCpuPct, label: `CPU limit ${num(sla.maxCpuPct)}%` }}
          series={[
            { name: "CPU", color: "var(--series-1)", unit: "%", points: pts((w) => w.cpuPct) },
            { name: "Worker threads", color: "var(--series-2)", unit: "%", points: pts((w) => w.threadPct) },
          ]}
          height={200}
        />
      </div>
      <details className="card more">
        <summary>All windows as a table</summary>
        <div className="table-wrap" style={{ maxHeight: 360 }} tabIndex={0} role="region" aria-label="Windows table">
          <table>
            <thead>
              <tr>
                <th scope="col">Ends at</th>
                <th scope="col">Offered</th>
                <th scope="col">Served</th>
                <th scope="col">p95</th>
                <th scope="col">Errors</th>
                <th scope="col">CPU</th>
                <th scope="col" className="left">
                  SLA
                </th>
              </tr>
            </thead>
            <tbody>
              {res.windows.map((w) => (
                <tr key={w.t}>
                  <td>{num(w.t)} s</td>
                  <td>{num(w.offeredTps, 1)}</td>
                  <td>{num(w.throughputTps, 1)}</td>
                  <td>{w.p95Ms ? `${num(w.p95Ms)} ms` : "—"}</td>
                  <td>{pct(w.errorRatePct, 2)}</td>
                  <td>{pct(w.cpuPct, 1)}</td>
                  <td className="left">{w.breach ? <span className="badge tone-bad">Breached</span> : <span className="badge tone-good">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
