"use client";

import Link from "next/link";
import { useMemo } from "react";
import { BarList, LineChart, RunSpread } from "@/components/charts";
import { useRun, RunBar } from "@/components/run";
import { ServiceStrip, useService } from "@/components/shell";
import { NumberField, Notice, Stat, VerdictBadge, VerdictBanner } from "@/components/ui";
import { LIMITS } from "@/lib/defaults";
import { check, type FieldDef } from "@/lib/fields";
import { num, pct, resourceName } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { EvaluateResult } from "@/lib/types";

type Settings = { normalTps: number | ""; peakTps: number | ""; stress: string; monteCarlo: boolean; runs: number };
const DEFAULTS: Settings = { normalTps: 8, peakTps: 45, stress: "1.5, 2", monteCarlo: true, runs: 20 };
const NONE: EvaluateResult | null = null;

const F: Record<string, FieldDef> = {
  normalTps: { label: "Normal load", unit: "req/s", min: 0, gt: true, max: 2000, hint: "A typical busy hour." },
  peakTps: { label: "Peak load", unit: "req/s", min: 0, gt: true, max: 2000, hint: "The verdict is decided here." },
};

function parseStress(s: string): number[] | null {
  if (!s.trim()) return [];
  const xs = s.split(/[,\s]+/).filter(Boolean).map(Number);
  return xs.every((x) => Number.isFinite(x) && x > 1 && x <= 10) && xs.length <= 4 ? xs : null;
}

const SCENARIO_NAME: Record<string, string> = { normal: "Normal", peak: "Peak" };

export default function EvaluatePage() {
  const [svc] = useService();
  const [st, setSt] = usePersistent<Settings>(KEYS.evaluate, DEFAULTS);
  const [saved, setSaved] = usePersistent<EvaluateResult | null>(`${KEYS.evaluate}.result`, NONE);
  const r = useRun<EvaluateResult>("/evaluate", saved, setSaved);

  const stress = parseStress(st.stress);
  const peak = Number(st.peakTps) || 0;
  const errs: Record<string, string> = {
    ...(check(F.normalTps, st.normalTps) ? { "load.normalTps": check(F.normalTps, st.normalTps) } : {}),
    ...(check(F.peakTps, st.peakTps) ? { "load.peakTps": check(F.peakTps, st.peakTps) } : {}),
  };
  if (stress === null) errs["load.stressMultipliers"] = "Up to 4 numbers between 1 and 10, e.g. 1.5, 2";
  else if (stress.some((m) => m * peak > 2000)) errs["load.stressMultipliers"] = "Peak × multiplier must stay at or below 2,000 req/s";
  const runs = st.monteCarlo ? st.runs : 0;
  const mcTooBig = runs * peak > LIMITS.replicationWork;
  const maxRuns = Math.max(2, Math.min(50, Math.floor(LIMITS.replicationWork / Math.max(peak, 1))));
  const all = { ...errs, ...r.fieldErrors };
  const blocked = Object.keys(errs).length > 0 || mcTooBig;
  const estimate = 1 + peak * 0.03 + runs * peak * 0.006;
  const serviceErr = Object.keys(r.fieldErrors).filter((k) => !k.startsWith("load") && k !== "replications");

  const submit = () => {
    if (blocked) return;
    r.run({
      measuredSpec: svc.measuredSpec,
      measurement: svc.measurement,
      targetSpec: svc.targetSpec,
      sla: svc.sla,
      database: svc.database,
      load: { normalTps: st.normalTps, peakTps: st.peakTps, stressMultipliers: stress },
      replications: runs,
      includeTimeseries: true,
    });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Evaluate</h1>
        <p className="lede">Check whether the target setup meets the SLA at normal and peak load, and how close it is to breaking.</p>
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
              <legend>Load to evaluate</legend>
              <div className="grid-2">
                <NumberField def={F.normalTps} value={st.normalTps} serverError={all["load.normalTps"]} onChange={(v) => setSt({ ...st, normalTps: v })} />
                <NumberField def={F.peakTps} value={st.peakTps} serverError={all["load.peakTps"]} onChange={(v) => setSt({ ...st, peakTps: v })} />
              </div>
              <div className="field">
                <label htmlFor="stress">Stress multipliers</label>
                <input
                  id="stress"
                  className="plain"
                  type="text"
                  inputMode="decimal"
                  value={st.stress}
                  aria-invalid={all["load.stressMultipliers"] ? true : undefined}
                  aria-describedby="stress-hint"
                  onChange={(e) => setSt({ ...st, stress: e.target.value })}
                />
                <span id="stress-hint" className={all["load.stressMultipliers"] ? "error" : "hint"}>
                  {all["load.stressMultipliers"] ?? "Extra runs at peak × each number, to find the breaking point. Not part of the verdict."}
                </span>
              </div>
            </fieldset>
            <fieldset className="stack-sm">
              <legend>Probabilistic verdict</legend>
              <label className="check">
                <input type="checkbox" checked={st.monteCarlo} onChange={(e) => setSt({ ...st, monteCarlo: e.target.checked })} />
                <span>
                  Repeat the peak run with different random seeds (Monte Carlo)
                  <span className="hint" style={{ display: "block" }}>
                    One run can be lucky. Repeating it shows how often the SLA breaks by chance.
                  </span>
                </span>
              </label>
              {st.monteCarlo && (
                <div className="field">
                  <label htmlFor="runs">
                    Runs: <strong>{st.runs}</strong>
                  </label>
                  <input
                    id="runs"
                    type="range"
                    min={2}
                    max={maxRuns}
                    value={Math.min(st.runs, maxRuns)}
                    onChange={(e) => setSt({ ...st, runs: Number(e.target.value) })}
                    aria-describedby="runs-hint"
                  />
                  <span id="runs-hint" className={mcTooBig ? "error" : "hint"}>
                    {mcTooBig ? `At ${num(peak)} req/s, up to ${maxRuns} runs fit in one request.` : "More runs give a steadier estimate but take longer."}
                  </span>
                </div>
              )}
            </fieldset>
            <RunBar
              label="Evaluate"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={estimate}
              disabled={blocked}
              disabledReason="Fix the highlighted fields first."
              onCancel={r.cancel}
              error={r.error}
            />
            {serviceErr.length > 0 && (
              <Notice tone="warn">
                The service has values the engine rejected ({serviceErr.join(", ")}). <Link href="/service/">Review the service</Link>.
              </Notice>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSt(DEFAULTS)}>
              Reset to defaults
            </button>
          </form>
        </aside>
        <section id="results" style={{ scrollMarginTop: 120 }} aria-label="Results" aria-busy={r.running} className="stack">
          {r.result ? <Results res={r.result} sla={svc.sla} stale={r.running} /> : <Empty running={r.running} />}
        </section>
      </div>
    </div>
  );
}

function Empty({ running }: { running: boolean }) {
  return running ? (
    <div className="stack">
      <div className="skeleton" style={{ height: 110 }} />
      <div className="skeleton" style={{ height: 90 }} />
      <div className="skeleton" style={{ height: 260 }} />
    </div>
  ) : (
    <div className="card stack-sm" style={{ textAlign: "center", padding: 40 }}>
      <h2>No result yet</h2>
      <p className="muted">Check the load and press Evaluate. The example service works as is.</p>
    </div>
  );
}

function Results({ res, sla, stale }: { res: EvaluateResult; sla: { maxP95Ms: number; maxCpuPct: number }; stale: boolean }) {
  const peak = res.scenarios.find((s) => s.kind === "peak");
  const ts = peak?.timeseries?.filter((b) => b.t >= 0) ?? [];
  const mc = res.monteCarlo;
  const items = useMemo(
    () =>
      (res.capacity?.perResource ?? [])
        .slice()
        .sort((a, b) => a.maxTps - b.maxTps)
        .map((p) => ({ name: resourceName(p.resource), value: p.maxTps, highlight: p.resource === res.capacity?.limitingResource })),
    [res],
  );
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      <VerdictBanner verdict={res.verdict}>
        <ul className="reasons">
          {res.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        {res.conditions.length > 0 && (
          <div className="stack-sm" style={{ marginTop: 6 }}>
            <strong>Conditions</strong>
            <ul className="reasons">
              {res.conditions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
      </VerdictBanner>

      <div className="stats">
        <Stat
          k="Max sustainable load"
          v={res.capacity ? `${num(res.capacity.maxTps, 1)} req/s` : "—"}
          s={peak && res.capacity ? `${num(res.capacity.maxTps / peak.tps, 1)}× the peak` : undefined}
        />
        <Stat k="Limiting resource" v={resourceName(res.limitingResource)} s="Runs out first as load grows" />
        <Stat k="Breaking point" v={res.breakingPointTps ? `${num(res.breakingPointTps)} req/s` : "Not reached"} s="First stress run that fails" />
        <Stat
          k="Calibration error"
          v={pct(res.calibration.errorPct, 1)}
          s={`Simulated ${num(res.calibration.simulatedP95Ms)} ms vs measured ${num(res.calibration.referenceP95Ms)} ms`}
        />
      </div>

      {mc && (
        <div className="card stack">
          <div className="card-head">
            <h2>Breach probability at peak</h2>
            <span className={`badge tone-${mc.breachProbability === 0 ? "good" : mc.breachProbability < 0.5 ? "warn" : "bad"}`}>
              {pct(mc.breachProbability * 100)} of {mc.runs} runs
            </span>
          </div>
          <p className="muted small">
            The peak scenario was simulated {mc.runs} times with different random arrivals and service times. Each dot is one run;
            the shaded band holds the middle 90%.
          </p>
          <div className="stack-sm">
            <span className="label">p95 response time per run</span>
            <RunSpread samples={mc.samples.p95Ms} limit={sla.maxP95Ms} unit="ms" label={`p95 across ${mc.runs} runs`} />
          </div>
          <div className="stack-sm">
            <span className="label">CPU per run</span>
            <RunSpread samples={mc.samples.cpuPct} limit={sla.maxCpuPct} unit="%" label={`CPU across ${mc.runs} runs`} />
          </div>
          <dl className="kv small">
            <dt>p95 range</dt>
            <dd>
              {num(mc.distribution.p95Ms.p5)}–{num(mc.distribution.p95Ms.p95)} ms (median {num(mc.distribution.p95Ms.p50)})
            </dd>
            <dt>Breaches by cause</dt>
            <dd>
              {Object.entries(mc.breachesBy)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${resourceName(k)} ${n}`)
                .join(", ") || "None"}
            </dd>
          </dl>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Scenarios</h2>
          <span className="hint">Simulated 60 s each after a warm-up</span>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Scenarios table">
          <table>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Load</th>
                <th scope="col">p95</th>
                <th scope="col">Errors</th>
                <th scope="col">CPU</th>
                <th scope="col">Threads</th>
                <th scope="col" className="left">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {res.scenarios.map((s) => (
                <tr key={s.name}>
                  <th scope="row" className="left" style={{ fontWeight: 500 }}>
                    {SCENARIO_NAME[s.name] ?? s.name.replace(/^stress-?/, "Stress ×").replace(/x$/, "")}
                  </th>
                  <td>{num(s.tps, 1)} req/s</td>
                  <td>{num(s.summary.p95Ms)} ms</td>
                  <td>{pct(s.summary.errorRatePct, 2)}</td>
                  <td>{pct(s.summary.cpuPct, 1)}</td>
                  <td>{pct(s.summary.threadPct, 1)}</td>
                  <td className="left">
                    <VerdictBadge verdict={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ts.length > 0 && (
        <div className="card stack">
          <h2>Peak run over time</h2>
          <LineChart
            label="p95 response time during the peak run"
            yLabel="p95 (ms)"
            xLabel="Second"
            series={[{ name: "p95", color: "var(--series-1)", unit: "ms", points: ts.map((b) => ({ x: b.t, y: b.p95 })) }]}
            threshold={{ y: sla.maxP95Ms, label: `SLA ${num(sla.maxP95Ms)} ms` }}
            height={200}
          />
          <LineChart
            label="CPU and worker-thread use during the peak run"
            yLabel="Utilization (%)"
            xLabel="Second"
            yMax={100}
            series={[
              { name: "CPU", color: "var(--series-1)", unit: "%", points: ts.map((b) => ({ x: b.t, y: b.cpu })) },
              { name: "Worker threads", color: "var(--series-2)", unit: "%", points: ts.map((b) => ({ x: b.t, y: b.thread })) },
              { name: "DB connections", color: "var(--series-3)", unit: "%", points: ts.map((b) => ({ x: b.t, y: b.conn })) },
            ]}
            threshold={{ y: sla.maxCpuPct, label: `CPU limit ${num(sla.maxCpuPct)}%` }}
            height={200}
          />
        </div>
      )}

      {items.length > 0 && peak && (
        <div className="card stack">
          <div className="card-head">
            <h2>Capacity by resource</h2>
            <span className="hint">The shortest bar sets the limit</span>
          </div>
          <BarList items={items} unit="req/s" label="Maximum load per resource" marker={{ value: peak.tps, label: `Peak load ${num(peak.tps)} req/s` }} />
        </div>
      )}

      <details className="card more">
        <summary>Calibration details</summary>
        <dl className="kv small">
          <dt>CPU time per request</dt>
          <dd>
            {num(res.calibration.cpuMsPerRequest, 1)} ms measured → {num(res.calibration.targetCpuMsPerRequest ?? res.calibration.cpuMsPerRequest, 1)} ms on target
          </dd>
          <dt>Scalability factor</dt>
          <dd>{num(res.calibration.uslFactor ?? 1, 3)}</dd>
          <dt>Database wait</dt>
          <dd>{num(res.calibration.databaseWaitMs, 1)} ms</dd>
          <dt>External wait</dt>
          <dd>{num(res.calibration.externalWaitMs, 1)} ms</dd>
          <dt>Background CPU</dt>
          <dd>{pct(res.calibration.backgroundCpuPct, 1)}</dd>
          <dt>Compute time</dt>
          <dd>{num(res.durationS, 1)} s</dd>
        </dl>
      </details>
    </div>
  );
}
