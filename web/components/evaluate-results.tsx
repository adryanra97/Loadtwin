"use client";

import { useMemo } from "react";
import { BarList, LineChart, RunSpread } from "@/components/charts";
import { Stat, VerdictBadge, VerdictBanner } from "@/components/ui";
import { num, pct, resourceName } from "@/lib/format";
import type { EvaluateResult } from "@/lib/types";

const SCENARIO_NAME: Record<string, string> = { normal: "Normal", peak: "Peak" };

/** Everything an evaluation returns: verdict, numbers, Monte Carlo spread, scenarios and charts. */
export function EvaluateResults({ res, sla, stale }: { res: EvaluateResult; sla: { maxP95Ms: number; maxCpuPct: number }; stale: boolean }) {
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
