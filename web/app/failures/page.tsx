"use client";

import { LineChart } from "@/components/charts";
import { RunBar, useRun } from "@/components/run";
import { ServiceStrip, useService } from "@/components/shell";
import { NumberField, Stat, VerdictBanner } from "@/components/ui";
import { check, type FieldDef } from "@/lib/fields";
import { num, pct, seconds } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { FaultIn, FaultResult } from "@/lib/types";

type Settings = { [K in keyof FaultIn]: number | "" } & { tps: number | "" };
const DEFAULTS: Settings = { tps: 45, nodesDown: 1, dbSlowdown: 1, extFailShare: 0, extTimeoutMs: 2000, extSlowdown: 1, durationS: 40 };
const NONE: FaultResult | null = null;

const PRESETS: { id: string; label: string; about: string; set: Partial<Settings> }[] = [
  { id: "node", label: "A node crashes", about: "One node dies; the load balancer moves its traffic to the rest.", set: { nodesDown: 1 } },
  { id: "db", label: "Database slows down", about: "Every query takes three times as long, e.g. a lock or a bad plan.", set: { dbSlowdown: 3 } },
  {
    id: "ext",
    label: "Dependency times out",
    about: "30% of calls to an external service hang for 2 s and fail.",
    set: { extFailShare: 0.3, extTimeoutMs: 2000 },
  },
  { id: "slowext", label: "Dependency is slow", about: "External calls succeed but take four times as long.", set: { extSlowdown: 4 } },
];
const CLEAR: Partial<Settings> = { nodesDown: 0, dbSlowdown: 1, extFailShare: 0, extSlowdown: 1 };

type Key = keyof Settings;
const F: Record<Key, FieldDef> = {
  tps: { label: "Load", unit: "req/s", min: 0, gt: true, max: 1000, hint: "Held constant for the whole run." },
  durationS: { label: "Failure lasts", unit: "s", min: 10, max: 120 },
  nodesDown: { label: "Nodes that crash", min: 0, max: 49, int: true },
  dbSlowdown: { label: "Database slowdown", unit: "×", min: 1, max: 20, step: 0.5, hint: "1 = normal speed." },
  extFailShare: { label: "External calls that fail", unit: "%", min: 0, max: 100, scale: 100 },
  extTimeoutMs: { label: "Hang before failing", unit: "ms", min: 100, max: 30000, int: true, advanced: true },
  extSlowdown: { label: "External call slowdown", unit: "×", min: 1, max: 20, step: 0.5, hint: "1 = normal speed." },
};

export default function FailuresPage() {
  const [svc] = useService();
  const [st, setSt] = usePersistent<Settings>(KEYS.fault, DEFAULTS);
  const [saved, setSaved] = usePersistent<FaultResult | null>(`${KEYS.fault}.result`, NONE);
  const r = useRun<FaultResult>("/fault", saved, setSaved);

  const errs: Record<string, string> = {};
  for (const k of Object.keys(F) as Key[]) {
    const v = st[k];
    const e = check(F[k], typeof v === "number" && F[k].scale ? v * F[k].scale! : v);
    if (e) errs[k] = e;
  }
  if (!errs.nodesDown && Number(st.nodesDown) >= svc.targetSpec.nodes)
    errs.nodesDown = `At most ${svc.targetSpec.nodes - 1}: the target has ${svc.targetSpec.nodes} nodes and one must stay up`;
  const none = !Number(st.nodesDown) && Number(st.dbSlowdown) === 1 && !Number(st.extFailShare) && Number(st.extSlowdown) === 1;
  const blocked = Object.keys(errs).length > 0 || none;
  const total = 20 + (Number(st.durationS) || 0) + 30;
  const estimate = 0.4 + (Number(st.tps) || 0) * total * 0.00025;
  const active = PRESETS.find((p) => Object.entries({ ...CLEAR, ...p.set }).every(([k, v]) => st[k as Key] === v));

  const field = (k: Key) => (
    <NumberField key={k} def={F[k]} value={st[k]} serverError={errs[k] ?? r.fieldErrors[`fault.${k}`] ?? r.fieldErrors[k]} onChange={(v) => setSt({ ...st, [k]: v })} />
  );

  return (
    <div>
      <div className="page-head">
        <h1>Failures</h1>
        <p className="lede">
          Break part of the system on purpose and see whether the service still meets its SLA, how bad it gets, and how fast it
          recovers. The same run is simulated healthy for comparison.
        </p>
      </div>
      <div className="tool">
        <aside className="stack">
          <ServiceStrip />
          <form
            className="card stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!blocked)
                r.run({
                  measuredSpec: svc.measuredSpec,
                  measurement: svc.measurement,
                  targetSpec: svc.targetSpec,
                  sla: svc.sla,
                  database: svc.database,
                  tps: st.tps,
                  fault: {
                    nodesDown: st.nodesDown,
                    dbSlowdown: st.dbSlowdown,
                    extFailShare: st.extFailShare,
                    extTimeoutMs: st.extTimeoutMs,
                    extSlowdown: st.extSlowdown,
                    durationS: st.durationS,
                  },
                });
            }}
          >
            <fieldset className="stack-sm">
              <legend>What breaks</legend>
              <div className="preset-grid" role="group" aria-label="Common failures">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="preset"
                    aria-pressed={active?.id === p.id}
                    onClick={() => setSt({ ...st, ...CLEAR, ...p.set })}
                  >
                    <strong>{p.label}</strong>
                    <span>{p.about}</span>
                  </button>
                ))}
              </div>
              <p className="hint">Pick one, or combine failures below.</p>
            </fieldset>
            <fieldset className="stack">
              <legend>Details</legend>
              <div className="grid-2">
                {field("tps")}
                {field("durationS")}
                {field("nodesDown")}
                {field("dbSlowdown")}
                {field("extFailShare")}
                {field("extSlowdown")}
              </div>
              <details className="more">
                <summary>More settings</summary>
                <div className="grid-2">{field("extTimeoutMs")}</div>
              </details>
              {none && (
                <span className="error" role="alert">
                  Choose at least one failure.
                </span>
              )}
              <p className="hint">
                Timeline: 20 s healthy, {num(Number(st.durationS) || 0)} s with the failure, then 30 s to recover ({seconds(total)} in
                total).
              </p>
            </fieldset>
            <RunBar
              label="Run failure"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={estimate}
              disabled={blocked}
              disabledReason={none ? "Choose a failure first." : "Fix the highlighted fields first."}
              onCancel={r.cancel}
              error={r.error}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSt(DEFAULTS)}>
              Reset to defaults
            </button>
          </form>
        </aside>
        <section id="results" style={{ scrollMarginTop: 120 }} aria-label="Results" aria-busy={r.running} className="stack">
          {r.result ? (
            <Results res={r.result} sla={svc.sla} stale={r.running} />
          ) : r.running ? (
            <div className="stack">
              <div className="skeleton" style={{ height: 110 }} />
              <div className="skeleton" style={{ height: 300 }} />
            </div>
          ) : (
            <div className="card stack-sm empty">
              <h2>No result yet</h2>
              <p className="muted">Pick a failure and run it. “A node crashes” is a good first test of N+1 redundancy.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Results({ res, sla, stale }: { res: FaultResult; sla: { maxP95Ms: number; maxErrorRatePct: number }; stale: boolean }) {
  const band = [{ x0: res.failure.startS, x1: res.failure.endS }];
  const tl = res.timeline;
  const ph = res.phases;
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      <VerdictBanner
        verdict={res.verdict}
        title={res.verdict === "PASS" ? "Survives" : res.verdict === "FAIL" ? "Does not survive" : "Survives, barely"}
        plain={
          res.verdict === "PASS"
            ? "The SLA holds while the failure lasts."
            : res.verdict === "FAIL"
              ? "The SLA breaks while the failure lasts."
              : "The SLA holds on average, but with little margin."
        }
      >
        <ul className="reasons">
          {res.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </VerdictBanner>
      <div className="stats">
        <Stat
          k="p95 during the failure"
          v={ph.during.p95Ms !== null ? `${num(ph.during.p95Ms)} ms` : "—"}
          s={`Healthy: ${ph.healthyDuring.p95Ms !== null ? `${num(ph.healthyDuring.p95Ms)} ms` : "—"}`}
        />
        <Stat k="Errors during the failure" v={pct(ph.during.errorRatePct, 2)} s={`Healthy: ${pct(ph.healthyDuring.errorRatePct, 2)}`} />
        <Stat
          k="Recovery"
          v={res.recoverySeconds !== null ? seconds(res.recoverySeconds) : "—"}
          s={res.recoverySeconds !== null ? "After the failure ends" : "No SLA breach to recover from, or none seen"}
        />
      </div>
      <div className="card stack">
        <div className="card-head">
          <h2>p95 response time</h2>
          <span className="hint">10-second windows; the failure is shaded</span>
        </div>
        <LineChart
          label="p95 over time, with and without the failure"
          yLabel="p95 (ms)"
          xLabel="Second"
          bands={band}
          bandLabel="Failure active"
          bandColor="var(--fault-band)"
          threshold={{ y: sla.maxP95Ms, label: `SLA ${num(sla.maxP95Ms)} ms` }}
          series={[
            { name: "With failure", color: "var(--series-2)", unit: "ms", points: tl.map((w) => ({ x: w.t, y: w.p95Ms })) },
            { name: "Healthy", color: "var(--series-1)", unit: "ms", dashed: true, points: tl.map((w) => ({ x: w.t, y: w.healthy.p95Ms })) },
          ]}
        />
      </div>
      <div className="card stack">
        <h2>Error rate</h2>
        <LineChart
          label="Error rate over time, with and without the failure"
          yLabel="Errors (%)"
          xLabel="Second"
          bands={band}
          bandLabel="Failure active"
          bandColor="var(--fault-band)"
          threshold={{ y: sla.maxErrorRatePct, label: `SLA ${num(sla.maxErrorRatePct, 1)}%` }}
          height={180}
          series={[
            { name: "With failure", color: "var(--series-2)", unit: "%", points: tl.map((w) => ({ x: w.t, y: w.errorRatePct })) },
            { name: "Healthy", color: "var(--series-1)", unit: "%", dashed: true, points: tl.map((w) => ({ x: w.t, y: w.healthy.errorRatePct })) },
          ]}
        />
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>By phase</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Phases table">
          <table>
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Requests</th>
                <th scope="col">p95</th>
                <th scope="col">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Before (healthy)", ph.before],
                  ["During the failure", ph.during],
                  ["After (recovering)", ph.after],
                  ["Same time, no failure", ph.healthyDuring],
                ] as const
              ).map(([label, p]) => (
                <tr key={label}>
                  <th scope="row" className="left" style={{ fontWeight: 500 }}>
                    {label}
                  </th>
                  <td>{num(p.requests)}</td>
                  <td>{p.p95Ms !== null ? `${num(p.p95Ms)} ms` : "—"}</td>
                  <td>{pct(p.errorRatePct, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Requests in flight on a crashed node are lost and count as errors in the phase they arrived in.
        </p>
      </div>
    </div>
  );
}
