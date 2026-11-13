"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VerdictBadge } from "@/components/ui";
import { num, resourceName } from "@/lib/format";
import { formatDate, useScenarios } from "@/lib/scenarios";
import type { SavedScenario } from "@/lib/types";

type Row = {
  label: string;
  get: (s: SavedScenario) => number | string | null | undefined;
  unit?: string;
  digits?: number;
  /** Lower is better (for the "better" marker); omit for neutral rows. */
  lowerBetter?: boolean;
};

const peak = (s: SavedScenario) => s.result.scenarios.find((x) => x.kind === "peak")?.summary;

const SETUP: Row[] = [
  { label: "Nodes", get: (s) => s.service.targetSpec.nodes },
  { label: "vCPU per node", get: (s) => s.service.targetSpec.vcpu },
  { label: "RAM per node", get: (s) => s.service.targetSpec.ramGb, unit: "GB" },
  { label: "Worker threads per node", get: (s) => s.service.targetSpec.threadPool },
  { label: "DB connections per node", get: (s) => s.service.targetSpec.connPool },
  { label: "Request timeout", get: (s) => s.service.targetSpec.timeoutMs, unit: "ms" },
  { label: "Peak load", get: (s) => s.load.peakTps, unit: "req/s" },
  { label: "SLA p95", get: (s) => s.service.sla.maxP95Ms, unit: "ms" },
];

const RESULTS: Row[] = [
  { label: "p95 at peak", get: (s) => peak(s)?.p95Ms, unit: "ms", lowerBetter: true },
  { label: "Errors at peak", get: (s) => peak(s)?.errorRatePct, unit: "%", digits: 2, lowerBetter: true },
  { label: "CPU at peak", get: (s) => peak(s)?.cpuPct, unit: "%", digits: 1, lowerBetter: true },
  { label: "Worker threads at peak", get: (s) => peak(s)?.threadPct, unit: "%", digits: 1, lowerBetter: true },
  { label: "Max sustainable load", get: (s) => s.result.capacity?.maxTps, unit: "req/s", digits: 1, lowerBetter: false },
  { label: "Breaking point", get: (s) => s.result.breakingPointTps, unit: "req/s", lowerBetter: false },
  {
    label: "Breach probability",
    get: (s) => (s.result.monteCarlo ? s.result.monteCarlo.breachProbability * 100 : null),
    unit: "%",
    lowerBetter: true,
  },
  { label: "Limiting resource", get: (s) => resourceName(s.result.limitingResource) },
];

function fmt(v: number | string | null | undefined, r: Row) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return `${num(v, r.digits ?? 0)}${r.unit ? (r.unit === "%" ? "%" : ` ${r.unit}`) : ""}`;
}

export default function ComparePage() {
  const [list, , hydrated] = useScenarios();
  const [ids, setIds] = useState<[string | null, string | null]>([null, null]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setIds([q.get("a"), q.get("b")]);
  }, []);
  const a = list.find((s) => s.id === ids[0]);
  const b = list.find((s) => s.id === ids[1]);

  if (!hydrated) return <div className="skeleton" style={{ height: 400 }} />;
  if (!a || !b)
    return (
      <div className="card stack-sm empty">
        <h1>Pick two scenarios</h1>
        <p className="muted">Select two saved scenarios in the workspace and press Compare.</p>
        <p>
          <Link href="/workspace/">Go to the workspace</Link>
        </p>
      </div>
    );

  const table = (title: string, rows: Row[], diff: boolean) => (
    <section className="card">
      <h2 style={{ marginBottom: 12 }}>{title}</h2>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={title}>
        <table className="compare">
          <thead>
            <tr>
              <th scope="col" className="left">
                <span className="sr-only">Item</span>
              </th>
              <th scope="col">{a.name}</th>
              <th scope="col">{b.name}</th>
              {diff && <th scope="col">Difference</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const va = r.get(a);
              const vb = r.get(b);
              const same = String(va) === String(vb);
              const nums = typeof va === "number" && typeof vb === "number";
              const better =
                nums && r.lowerBetter !== undefined && va !== vb ? ((va < vb) === r.lowerBetter ? "a" : "b") : null;
              return (
                <tr key={r.label} className={!same && !diff ? "changed" : undefined}>
                  <th scope="row" className="left" style={{ fontWeight: 500 }}>
                    {r.label}
                  </th>
                  <td className={better === "a" ? "better" : undefined}>{fmt(va, r)}</td>
                  <td className={better === "b" ? "better" : undefined}>{fmt(vb, r)}</td>
                  {diff && <td className="muted">{nums && !same ? `${(vb as number) > (va as number) ? "+" : "−"}${fmt(Math.abs((vb as number) - (va as number)), r)}` : ""}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <article className="report stack">
      <div className="spread no-print">
        <Link href="/workspace/" className="small">
          Back to the workspace
        </Link>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>
          Download PDF
        </button>
      </div>
      <header className="report-head">
        <p className="report-kicker">LoadTwin comparison</p>
        <h1>
          {a.name} <span className="muted">vs</span> {b.name}
        </h1>
      </header>
      <div className="compare-heads">
        {[a, b].map((s) => (
          <div key={s.id} className="card stack-sm">
            <div className="spread">
              <strong>{s.name}</strong>
              <VerdictBadge verdict={s.result.verdict} />
            </div>
            <p className="small muted">
              {s.service.name}, saved {formatDate(s.savedAt)}
            </p>
            <ul className="reasons small">
              {s.result.reasons.slice(0, 3).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <Link href={`/report/?id=${s.id}`} className="small no-print">
              Full report
            </Link>
          </div>
        ))}
      </div>
      {table("Setup", SETUP, false)}
      {table("Results", RESULTS, true)}
      <p className="hint">Highlighted rows in Setup differ between the two. In Results, the better value of each pair is marked.</p>
    </article>
  );
}
