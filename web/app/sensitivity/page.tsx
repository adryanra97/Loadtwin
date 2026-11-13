"use client";

import { RunBar, useRun } from "@/components/run";
import { SensitivityStage } from "@/components/option-stages";
import { ToolIdle } from "@/components/live-playground";
import { ServiceStrip, useService } from "@/components/shell";
import { NumberField, Stat } from "@/components/ui";
import { check, type FieldDef } from "@/lib/fields";
import { num, pct } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { SensitivityResult } from "@/lib/types";

const PARAMS = [
  { id: "vcpu", label: "vCPU per node" },
  { id: "nodes", label: "Nodes" },
  { id: "threadPool", label: "Worker threads per node" },
  { id: "connPool", label: "DB connections per node" },
  { id: "dbMs", label: "Database time per query" },
  { id: "extMs", label: "External call time" },
  { id: "cpuMs", label: "CPU time per request" },
];
type Settings = { peakTps: number | ""; stepPct: number; params: string[] };
const DEFAULTS: Settings = { peakTps: 70, stepPct: 25, params: PARAMS.map((p) => p.id) };
const NONE: SensitivityResult | null = null;
const PEAK: FieldDef = { label: "Load to analyse", unit: "req/s", min: 0, gt: true, max: 600, hint: "Usually your peak." };

export default function SensitivityPage() {
  const [svc] = useService();
  const [st, setSt] = usePersistent<Settings>(KEYS.sensitivity, DEFAULTS);
  const [saved, setSaved] = usePersistent<SensitivityResult | null>(`${KEYS.sensitivity}.result`, NONE);
  const r = useRun<SensitivityResult>("/sensitivity", saved, setSaved);
  const peakErr = check(PEAK, st.peakTps);
  const blocked = !!peakErr || st.params.length === 0;
  const estimate = 0.5 + st.params.length * 2 * (Number(st.peakTps) || 0) * 0.004;

  return (
    <div>
      <div className="page-head">
        <h1>Sensitivity</h1>
        <p className="lede">
          Which setting moves p95 the most? Each input is turned down and up by the same amount while everything else stays put,
          so you know what to change first.
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
                  peakTps: st.peakTps,
                  step: st.stepPct / 100,
                  params: st.params,
                });
            }}
          >
            <NumberField def={PEAK} value={st.peakTps} serverError={peakErr || r.fieldErrors.peakTps} onChange={(v) => setSt({ ...st, peakTps: v })} />
            <div className="field">
              <label htmlFor="step">
                Change each input by <strong>±{st.stepPct}%</strong>
              </label>
              <input
                id="step"
                type="range"
                min={10}
                max={50}
                step={5}
                value={st.stepPct}
                onChange={(e) => setSt({ ...st, stepPct: Number(e.target.value) })}
              />
              <span className="hint">Whole numbers (nodes, vCPU) move by at least one.</span>
            </div>
            <fieldset className="stack-sm">
              <legend>Inputs to vary</legend>
              {PARAMS.map((p) => (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    checked={st.params.includes(p.id)}
                    onChange={(e) =>
                      setSt({ ...st, params: e.target.checked ? [...st.params, p.id] : st.params.filter((x) => x !== p.id) })
                    }
                  />
                  <span>{p.label}</span>
                </label>
              ))}
              {st.params.length === 0 && (
                <span className="error" role="alert">
                  Choose at least one input.
                </span>
              )}
            </fieldset>
            <RunBar
              label="Analyse"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={estimate}
              disabled={blocked}
              disabledReason="Fix the highlighted fields first."
              onCancel={r.cancel}
              error={r.error}
            />
          </form>
        </aside>
        <section id="results" style={{ scrollMarginTop: 120 }} aria-label="Results" aria-busy={r.running} className="stack">
          {r.result ? (
            <Results res={r.result} slaP95={svc.sla.maxP95Ms} stale={r.running} nodes={svc.targetSpec.nodes} />
          ) : (
            <ToolIdle nodes={svc.targetSpec.nodes} startTps={Number(st.peakTps) || undefined} running={r.running} idleText={<>Set the load and press Analyse. A load close to your limit shows the clearest differences.</>} />
          )}
        </section>
      </div>
    </div>
  );
}

function Results({ res, slaP95, stale, nodes }: { res: SensitivityResult; slaP95: number; stale: boolean; nodes: number }) {
  const pct0 = Math.round(res.step * 100);
  const base = res.baseline.p95Ms;
  const all = res.params.flatMap((p) => [p.low.p95Ms, p.high.p95Ms]);
  // Keep differences of a few ms visible: one input that explodes (a node fewer) would flatten the rest.
  const hi = Math.min(Math.max(...all, base, slaP95) * 1.04, Math.max(base * 3, slaP95 * 1.2));
  const lo = Math.max(0, Math.min(...all, base) * 0.9);
  const x = (v: number) => ((Math.min(v, hi) - lo) / (hi - lo)) * 100;
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      <div className="stats">
        <Stat k={`p95 at ${num(res.peakTps)} req/s`} v={`${num(base)} ms`} s={res.baseline.meetsSla ? "Meets the SLA" : "Breaks the SLA"} />
        <Stat k="Biggest lever" v={res.params[0]?.label ?? "—"} s={res.params[0] ? `p95 swings by ${num(res.params[0].swingMs)} ms` : undefined} />
        <Stat k="CPU at this load" v={pct(res.baseline.cpuPct)} s={`Errors ${pct(res.baseline.errorRatePct, 2)}`} />
      </div>
      <div className="card stack">
        <div className="card-head">
          <h2>What moves p95</h2>
          <span className="hint">Each input −{pct0}% and +{pct0}%, sorted by impact</span>
        </div>
        <div className="legend" aria-hidden>
          <span>
            <span className="sw block" style={{ background: "var(--series-1)" }} />−{pct0}%
          </span>
          <span>
            <span className="sw block" style={{ background: "var(--series-2)" }} />+{pct0}%
          </span>
          <span>
            <span className="sw" style={{ background: "var(--ink)", width: 2, height: 12 }} />
            Now: {num(base)} ms
          </span>
          <span>
            <span className="sw" style={{ background: "var(--bad)", width: 2, height: 12 }} />
            SLA {num(slaP95)} ms
          </span>
        </div>
        <ul className="tornado" aria-label="p95 for each input moved down and up">
          {res.params.map((p) => {
            const a = x(p.low.p95Ms);
            const b = x(p.high.p95Ms);
            const m = x(base);
            return (
              <li key={p.param}>
                <div className="t-label">
                  <strong>{p.label}</strong>
                  <span className="hint">
                    {num(p.low.value, 1)} / <b>{num(p.base, 1)}</b> / {num(p.high.value, 1)}
                    {p.unit ? ` ${p.unit}` : ""}
                  </span>
                </div>
                <div className="t-track" role="img" aria-label={`${p.label}: ${num(p.low.p95Ms)} ms at −${pct0}%, ${num(p.high.p95Ms)} ms at +${pct0}%`}>
                  <span className="t-bar low" style={{ left: `${Math.min(a, m)}%`, width: `${Math.max(Math.abs(m - a), 0.6)}%` }} />
                  <span className="t-bar high" style={{ left: `${Math.min(b, m)}%`, width: `${Math.max(Math.abs(b - m), 0.6)}%` }} />
                  <span className="t-base" style={{ left: `${m}%` }} />
                  {slaP95 <= hi && <span className="t-sla" style={{ left: `${x(slaP95)}%` }} />}
                  {(p.low.p95Ms > hi || p.high.p95Ms > hi) && <span className="t-clip" title="Runs past the scale">›</span>}
                </div>
                <div className="t-vals">
                  {num(p.low.p95Ms)} / {num(p.high.p95Ms)} ms
                </div>
              </li>
            );
          })}
        </ul>
        <p className="hint">Values below each name: −{pct0}%, current, +{pct0}%. A › mark means the bar runs past the scale.</p>
      </div>
      <SensitivityStage res={res} nodes={nodes} slaP95={slaP95} />
      {res.advice.length > 0 && (
        <div className="card stack-sm">
          <h2>What to change first</h2>
          <ul className="reasons">
            {res.advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="card more">
        <summary>All runs as a table</summary>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Sensitivity table">
          <table>
            <thead>
              <tr>
                <th scope="col">Input</th>
                <th scope="col">−{pct0}%</th>
                <th scope="col">p95</th>
                <th scope="col">+{pct0}%</th>
                <th scope="col">p95</th>
                <th scope="col">Swing</th>
              </tr>
            </thead>
            <tbody>
              {res.params.map((p) => (
                <tr key={p.param}>
                  <th scope="row" className="left" style={{ fontWeight: 500 }}>
                    {p.label}
                  </th>
                  <td>{num(p.low.value, 1)}</td>
                  <td>{num(p.low.p95Ms)} ms</td>
                  <td>{num(p.high.value, 1)}</td>
                  <td>{num(p.high.p95Ms)} ms</td>
                  <td>{num(p.swingMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
