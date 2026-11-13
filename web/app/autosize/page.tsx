"use client";

import { BarList } from "@/components/charts";
import { Trash } from "@/components/icons";
import { RunBar, useRun } from "@/components/run";
import { AutosizeStage } from "@/components/option-stages";
import { ToolIdle } from "@/components/live-playground";
import { ServiceStrip, useService } from "@/components/shell";
import { Notice, NumberField, Stat } from "@/components/ui";
import { DEFAULT_CATALOG, LIMITS } from "@/lib/defaults";
import { check, type FieldDef } from "@/lib/fields";
import { num, pct, resourceName, usd } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { AutosizeResult, MachineType } from "@/lib/types";

type Row = { name: string; vcpu: number | ""; ramGb: number | ""; hourlyUsd: number | "" };
type Settings = {
  peakTps: number | "";
  minNodes: number | "";
  maxNodes: number | "";
  threadsPerVcpu: number | "";
  connPool: number | "";
  timeoutMs: number | "";
  catalog: Row[];
};
const DEFAULTS: Settings = {
  peakTps: 150,
  minNodes: 2,
  maxNodes: 30,
  threadsPerVcpu: 25,
  connPool: 30,
  timeoutMs: 2000,
  catalog: DEFAULT_CATALOG,
};
const NONE: AutosizeResult | null = null;

type NumKey = "peakTps" | "minNodes" | "maxNodes" | "threadsPerVcpu" | "connPool" | "timeoutMs";
const F: Record<NumKey, FieldDef> = {
  peakTps: { label: "Peak load to carry", unit: "req/s", min: 0, gt: true, max: 2000 },
  minNodes: { label: "Fewest nodes", min: 1, max: 50, int: true, hint: "2 keeps one node of redundancy." },
  maxNodes: { label: "Most nodes", min: 1, max: 50, int: true },
  threadsPerVcpu: { label: "Worker threads per vCPU", min: 0, gt: true, max: 500, advanced: true },
  connPool: { label: "DB connections per node", min: 1, max: 1000, int: true, advanced: true },
  timeoutMs: { label: "Request timeout", unit: "ms", min: 50, max: 120000, int: true, advanced: true },
};
type NumCol = "vcpu" | "ramGb" | "hourlyUsd";
const COL: Record<NumCol, FieldDef> = {
  vcpu: { label: "vCPU", min: 1, max: 128, int: true },
  ramGb: { label: "RAM", min: 0, gt: true, max: 1024 },
  hourlyUsd: { label: "$/hour", min: 0, gt: true, max: 100 },
};

export default function AutosizePage() {
  const [svc] = useService();
  const [st, setSt] = usePersistent<Settings>(KEYS.autosize, DEFAULTS);
  const [saved, setSaved] = usePersistent<AutosizeResult | null>(`${KEYS.autosize}.result`, NONE);
  const r = useRun<AutosizeResult>("/autosize", saved, setSaved);

  const errs: Record<string, string> = {};
  for (const k of ["peakTps", "minNodes", "maxNodes", "threadsPerVcpu", "connPool", "timeoutMs"] as const) {
    const e = check(F[k], st[k]);
    if (e) errs[k] = e;
  }
  if (!errs.minNodes && !errs.maxNodes && Number(st.minNodes) > Number(st.maxNodes)) errs.maxNodes = "Must be at least the fewest nodes";
  const rowErr = (i: number, k: NumCol) => check(COL[k], st.catalog[i][k]);
  const catalogInvalid = st.catalog.some((row, i) => !row.name.trim() || (Object.keys(COL) as (NumCol)[]).some((k) => rowErr(i, k)));
  const names = st.catalog.map((x) => x.name.trim());
  const dupes = names.some((n, i) => n && names.indexOf(n) !== i);
  const peak = Number(st.peakTps) || 0;
  const tooMuch = st.catalog.length * peak > LIMITS.autosizeWork;
  const blocked = Object.keys(errs).length > 0 || catalogInvalid || dupes || st.catalog.length === 0 || tooMuch;
  const estimate = 1 + st.catalog.length * (0.4 + peak * 0.006);

  const setRow = (i: number, patch: Partial<Row>) => setSt({ ...st, catalog: st.catalog.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const submit = () => {
    if (blocked) return;
    r.run({
      measuredSpec: svc.measuredSpec,
      measurement: svc.measurement,
      sla: svc.sla,
      database: svc.database,
      peakTps: st.peakTps,
      minNodes: st.minNodes,
      maxNodes: st.maxNodes,
      pools: { threadsPerVcpu: st.threadsPerVcpu, connPool: st.connPool, timeoutMs: st.timeoutMs },
      catalog: st.catalog.map((x) => ({ ...x, name: x.name.trim() })),
    });
  };

  const f = (k: NumKey) => (
    <NumberField def={F[k]} value={st[k] as number | ""} serverError={errs[k] ?? r.fieldErrors[k]} onChange={(v) => setSt({ ...st, [k]: v })} />
  );

  return (
    <div>
      <div className="page-head">
        <h1>Auto-size</h1>
        <p className="lede">
          Find the cheapest cluster that meets your SLA at peak load. For each machine type, the twin searches for the fewest nodes
          that pass, then prices them.
        </p>
      </div>
      <div className="tool">
        <aside className="stack">
          <ServiceStrip show={["measured", "sla"]} />
          <form
            className="card stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset className="stack">
              <legend>Requirement</legend>
              {f("peakTps")}
              <div className="grid-2">
                {f("minNodes")}
                {f("maxNodes")}
              </div>
              <details className="more">
                <summary>Pool sizing per node</summary>
                <div className="grid-2">
                  {f("threadsPerVcpu")}
                  {f("connPool")}
                  {f("timeoutMs")}
                </div>
              </details>
            </fieldset>

            <fieldset className="stack-sm">
              <legend>Machine types and prices</legend>
              <Notice tone="warn">These prices are illustrative, not any provider&apos;s. Replace them with your own for real numbers.</Notice>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">vCPU</th>
                      <th scope="col">RAM GB</th>
                      <th scope="col">$/hour</th>
                      <th scope="col">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.catalog.map((row, i) => (
                      <tr key={i}>
                        <td className="left">
                          <input
                            aria-label={`Machine ${i + 1} name`}
                            style={{ width: 96, textAlign: "left" }}
                            value={row.name}
                            maxLength={40}
                            aria-invalid={!row.name.trim() || (dupes && names.indexOf(row.name.trim()) !== i) ? true : undefined}
                            onChange={(e) => setRow(i, { name: e.target.value })}
                          />
                        </td>
                        {(Object.keys(COL) as (NumCol)[]).map((k) => (
                          <td key={k}>
                            <input
                              type="number"
                              step="any"
                              style={{ width: k === "hourlyUsd" ? 72 : 52 }}
                              aria-label={`${row.name || `Machine ${i + 1}`} ${COL[k].label}`}
                              aria-invalid={rowErr(i, k) ? true : undefined}
                              title={rowErr(i, k) || undefined}
                              value={row[k]}
                              onChange={(e) => setRow(i, { [k]: e.target.value === "" ? "" : Number(e.target.value) })}
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Remove ${row.name || `machine ${i + 1}`}`}
                            onClick={() => setSt({ ...st, catalog: st.catalog.filter((_, j) => j !== i) })}
                          >
                            <Trash size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={st.catalog.length >= 12}
                  onClick={() => setSt({ ...st, catalog: [...st.catalog, { name: `custom-${st.catalog.length + 1}`, vcpu: 4, ramGb: 16, hourlyUsd: 0.2 }] })}
                >
                  Add machine type
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSt({ ...st, catalog: DEFAULT_CATALOG })}>
                  Restore sample prices
                </button>
              </div>
              {(catalogInvalid || dupes) && (
                <span className="error" role="alert">
                  {dupes ? "Each machine type needs a unique name." : "Fill in every machine type with valid numbers (outlined in red)."}
                </span>
              )}
              {tooMuch && (
                <span className="error" role="alert">
                  At {num(peak)} req/s, up to {Math.floor(LIMITS.autosizeWork / Math.max(peak, 1))} machine types fit in one run. Remove some.
                </span>
              )}
            </fieldset>
            <RunBar
              label="Find the cheapest setup"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={estimate}
              disabled={blocked}
              disabledReason="Fix the highlighted fields first."
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
            <Results res={r.result} stale={r.running} sla={svc.sla} />
          ) : (
            <ToolIdle nodes={svc.targetSpec.nodes} startTps={Number(st.peakTps) || undefined} running={r.running} idleText={<>Set the peak load and the machine types you can buy, then search.</>} />
          )}
        </section>
      </div>
    </div>
  );
}

function machineLabel(m: MachineType) {
  return `${m.name} (${m.vcpu} vCPU, ${num(m.ramGb)} GB)`;
}

function Results({ res, stale, sla }: { res: AutosizeResult; stale: boolean; sla: { maxP95Ms: number; maxCpuPct: number } }) {
  const rec = res.recommended;
  const fits = res.options.filter((o) => o.fits);
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      {rec ? (
        <section className="verdict tone-good" aria-label="Recommendation">
          <span className="icon" aria-hidden>
            ★
          </span>
          <span className="section-title" style={{ color: "inherit" }}>
            Recommended for {num(res.peakTps)} req/s
          </span>
          <div className="stack-sm">
            <h2 style={{ fontSize: "1.5rem" }}>
              {rec.nodes} × {rec.machine.name}
              <span style={{ fontWeight: 500, display: "block", fontSize: "1.05rem", marginTop: 2 }}>
                {usd(rec.monthlyUsd)} per month
              </span>
            </h2>
            <p>
              {rec.config === "comfortable"
                ? `Meets the SLA and keeps every resource at or below 75% at peak (highest: ${resourceName(rec.topResource)} ${pct(rec.topUtilizationPct)}).`
                : `The cheapest setup that meets the SLA, but ${resourceName(rec.topResource)} reaches ${pct(rec.topUtilizationPct)} at peak, so there is little headroom.`}
            </p>
            <p className="small">
              At peak: p95 {num(rec.peak.p95Ms)} ms, CPU {pct(rec.peak.cpuPct, 1)}, errors {pct(rec.peak.errorRatePct, 2)}, {rec.totalVcpu} vCPU in total.
            </p>
          </div>
        </section>
      ) : (
        <Notice tone="bad" title="No setup meets the SLA">
          {res.notes.join(" ") || "Try a higher node limit or larger machines."}
        </Notice>
      )}

      {rec && res.notes.length > 0 && <Notice>{res.notes.join(" ")}</Notice>}

      {rec && <AutosizeStage res={res} slaP95={sla.maxP95Ms} slaCpu={sla.maxCpuPct} />}

      {res.cheapest && rec && (
        <div className="stats">
          <Stat k="Cheapest that passes" v={usd(res.cheapest.monthlyUsd)} s={`${res.cheapest.nodes} × ${res.cheapest.machine.name}`} />
          <Stat k="Machine types that fit" v={`${fits.length} of ${res.options.length}`} s={`Up to the node limit`} />
          {res.databaseLimitTps !== null && <Stat k="Shared database limit" v={`${num(res.databaseLimitTps)} req/s`} s="No node count goes past this" />}
        </div>
      )}

      {fits.length > 0 && (
        <div className="card stack">
          <div className="card-head">
            <h2>Monthly cost with headroom</h2>
            <span className="hint">{res.hoursPerMonth ?? 730} hours per month</span>
          </div>
          <BarList
            label="Monthly cost per machine type"
            unit=""
            format={(v) => usd(v)}
            items={fits
              .map((o) => ({
                name: `${(o.comfortable ?? o.minimal).nodes} × ${o.machine.name}`,
                value: (o.comfortable ?? o.minimal).monthlyUsd,
                highlight: rec?.machine.name === o.machine.name,
                note: o.comfortable ? undefined : <span className="muted"> (no headroom)</span>,
              }))
              .sort((a, b) => a.value - b.value)}
          />
        </div>
      )}

      {res.options.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>All machine types</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="All machine types table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Machine</th>
                  <th scope="col">Fewest nodes</th>
                  <th scope="col">Cost</th>
                  <th scope="col">With headroom</th>
                  <th scope="col">Cost</th>
                  <th scope="col" className="left">
                    Busiest at peak
                  </th>
                </tr>
              </thead>
              <tbody>
                {res.options.map((o) => (
                  <tr key={o.machine.name} className={rec?.machine.name === o.machine.name ? "hl" : undefined}>
                    <th scope="row" className="left" style={{ fontWeight: 500 }}>
                      {machineLabel(o.machine)}
                    </th>
                    {o.fits ? (
                      <>
                        <td>{o.minimal.nodes}</td>
                        <td>{usd(o.minimal.monthlyUsd)}</td>
                        <td>{o.comfortable ? o.comfortable.nodes : "—"}</td>
                        <td>{o.comfortable ? usd(o.comfortable.monthlyUsd) : "—"}</td>
                        <td className="left">
                          {resourceName((o.comfortable ?? o.minimal).topResource)} {pct((o.comfortable ?? o.minimal).topUtilizationPct)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="left muted">
                        Does not meet the SLA even with {o.minimal.nodes} nodes ({o.minimal.violations.join(", ")})
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            “With headroom” keeps every resource at or below 75% at peak. A dash means more nodes would not help, usually because
            memory or the shared database is the bottleneck.
          </p>
        </div>
      )}
    </div>
  );
}
