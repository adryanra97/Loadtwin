"use client";

import Link from "next/link";
import { EvaluateResults } from "@/components/evaluate-results";
import { SaveScenario, type EvaluateInput } from "@/components/save-scenario";
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
const NO_INPUT: EvaluateInput | null = null;

const F: Record<string, FieldDef> = {
  normalTps: { label: "Normal load", unit: "req/s", min: 0, gt: true, max: 2000, hint: "A typical busy hour." },
  peakTps: { label: "Peak load", unit: "req/s", min: 0, gt: true, max: 2000, hint: "The verdict is decided here." },
};

function parseStress(s: string): number[] | null {
  if (!s.trim()) return [];
  const xs = s.split(/[,\s]+/).filter(Boolean).map(Number);
  return xs.every((x) => Number.isFinite(x) && x > 1 && x <= 10) && xs.length <= 4 ? xs : null;
}


export default function EvaluatePage() {
  const [svc] = useService();
  const [st, setSt] = usePersistent<Settings>(KEYS.evaluate, DEFAULTS);
  const [saved, setSaved] = usePersistent<EvaluateResult | null>(`${KEYS.evaluate}.result`, NONE);
  const [lastInput, setLastInput] = usePersistent<EvaluateInput | null>(`${KEYS.evaluate}.input`, NO_INPUT);
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
    setLastInput({
      service: svc,
      load: { normalTps: Number(st.normalTps), peakTps: Number(st.peakTps), stressMultipliers: stress ?? [] },
      replications: runs,
    });
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
          {r.result ? (
            <>
              <EvaluateResults res={r.result} sla={(lastInput ?? { service: svc }).service.sla} stale={r.running} />
              {lastInput && !r.running && <SaveScenario key={`${r.result.durationS}-${r.result.verdict}`} input={lastInput} result={r.result} />}
            </>
          ) : (
            <Empty running={r.running} />
          )}
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

