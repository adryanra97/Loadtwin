"use client";
import { ToolPageIntro } from "@/components/tool-page-intro";

import Link from "next/link";
import { useState } from "react";
import { LineChart } from "@/components/charts";
import { Trash, Upload } from "@/components/icons";
import { RunBar, useRun } from "@/components/run";
import { TwinStage } from "@/components/twin-stage";
import { ReplayOrLive, ToolIdle } from "@/components/live-playground";
import { validateFrames } from "@/lib/replay";
import { ServiceStrip, useService } from "@/components/shell";
import { Notice, Stat } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { check, type FieldDef } from "@/lib/fields";
import { num, pct } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { LoadPoint, Spec, ValidateResult } from "@/lib/types";

type Row = { tps: number | ""; p95Ms: number | ""; errorRatePct: number | ""; cpuPct: number | ""; memPct: number | "" };
type Draft = { source: string; rows: Row[]; calibrate: number };
const EMPTY: Draft = { source: "", rows: [], calibrate: 0 };
const NONE: ValidateResult | null = null;
const MAX_BYTES = 4_000_000;

const COLS: { k: keyof Row; label: string; def: FieldDef; optional?: boolean }[] = [
  { k: "tps", label: "Load (req/s)", def: { label: "Load", min: 0, gt: true, max: 1000 } },
  { k: "p95Ms", label: "p95 (ms)", def: { label: "p95", min: 0, gt: true, max: 60000 } },
  { k: "errorRatePct", label: "Errors (%)", def: { label: "Errors", min: 0, max: 100 } },
  { k: "cpuPct", label: "CPU (%)", def: { label: "CPU", min: 0, gt: true, max: 100 }, optional: true },
  { k: "memPct", label: "Memory (%)", def: { label: "Memory", min: 0, gt: true, max: 100 }, optional: true },
];

const SAMPLES = [
  { file: "jmeter-results.csv", label: "JMeter" },
  { file: "locust_stats_history.csv", label: "Locust" },
  { file: "k6-summary.json", label: "k6" },
];

const GRADE: Record<string, { tone: string; label: string; plain: string }> = {
  good: { tone: "good", label: "Good", plain: "Predictions are within 10% on average. Trust results inside the validated range." },
  fair: { tone: "warn", label: "Fair", plain: "Predictions are within 25% on average. Use results as a guide and keep a margin." },
  poor: { tone: "bad", label: "Poor", plain: "Predictions miss by more than 25%. Something the model does not capture is going on; do not rely on it." },
  untested: { tone: "na", label: "Untested", plain: "With one point the model matches by construction. Add more load levels." },
};

export default function ValidatePage() {
  const [svc, saveSvc] = useService();
  const [d, setD] = usePersistent<Draft>(KEYS.validate, EMPTY);
  const [saved, setSaved] = usePersistent<ValidateResult | null>(`${KEYS.validate}.result`, NONE);
  const r = useRun<ValidateResult>("/validate", saved, setSaved);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [over, setOver] = useState(false);
  const [applied, setApplied] = useState("");

  const cellErr = (i: number, k: keyof Row) => {
    const c = COLS.find((x) => x.k === k)!;
    const v = d.rows[i][k];
    return c.optional && v === "" ? "" : check(c.def, v);
  };
  const invalid = d.rows.some((_, i) => COLS.some((c) => cellErr(i, c.k)));
  const calRow = d.rows[d.calibrate];
  const needsCpu = !!calRow && calRow.cpuPct === "";
  const blocked = d.rows.length === 0 || invalid || needsCpu;

  const loadText = async (content: string, source: string) => {
    setParseError("");
    setApplied("");
    if (content.length > MAX_BYTES) {
      setParseError("The file is larger than 4 MB. Export a summary or a shorter run.");
      return;
    }
    setParsing(true);
    try {
      const res = await post<{ format: string; points: LoadPoint[] }>("/loadtest/parse", { content, format: "auto" });
      const rows = res.points.map((p) => ({
        tps: p.tps,
        p95Ms: p.p95Ms,
        errorRatePct: p.errorRatePct,
        cpuPct: (p.cpuPct ?? "") as number | "",
        memPct: (p.memPct ?? "") as number | "",
      }));
      const mid = sortedMiddle(rows);
      setD({ source: `${source} (${res.format})`, rows, calibrate: mid });
      r.clear();
    } catch (e) {
      setParseError(e instanceof ApiError ? e.message.replace(/^Check the highlighted fields\. /, "") : "Could not read the file.");
    } finally {
      setParsing(false);
    }
  };

  const onFile = async (f: File) => loadText(await f.text(), f.name);
  const onSample = async (file: string) => {
    try {
      const res = await fetch(`/samples/${file}`);
      await loadText(await res.text(), `Sample ${file}`);
    } catch {
      setParseError("Could not load the sample file.");
    }
  };

  const setCell = (i: number, k: keyof Row, v: string) =>
    setD({ ...d, rows: d.rows.map((row, j) => (j === i ? { ...row, [k]: v === "" ? "" : Number(v) } : row)) });

  const submit = () => {
    if (blocked) return;
    r.run({
      measuredSpec: svc.measuredSpec,
      database: svc.database,
      payloadKb: svc.measurement.payloadKb,
      calibrationIndex: d.calibrate,
      points: d.rows.map((x) => ({
        tps: x.tps,
        p95Ms: x.p95Ms,
        errorRatePct: x.errorRatePct === "" ? 0 : x.errorRatePct,
        cpuPct: x.cpuPct === "" ? null : x.cpuPct,
        memPct: x.memPct === "" ? null : x.memPct,
      })),
    });
  };

  return (
    <div>
      <ToolPageIntro category="MODEL VALIDATION" title="Validate the model" description="Import a load test with several load levels. The twin calibrates on one level and predicts the others; how close it gets tells you how far its answers can be trusted." />
      <div className="tool tool-even">
        <aside className="stack">
          <ServiceStrip show={["measured"]} />
          <div className="card stack">
            <h2 style={{ fontSize: "1rem" }}>1. Import results</h2>
            <label
              className="dropzone"
              data-over={over || undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) onFile(f);
              }}
            >
              <Upload size={22} />
              <span>
                <strong style={{ color: "var(--accent)" }}>Choose a file</strong> or drop it here
              </span>
              <span className="hint">k6 summary JSON, JMeter results CSV, or Locust stats history CSV. Up to 4 MB.</span>
              <input
                type="file"
                accept=".json,.csv,.jtl,application/json,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="row small">
              <span className="muted">No file handy? Try a sample:</span>
              {SAMPLES.map((s) => (
                <button key={s.file} type="button" className="btn btn-sm" onClick={() => onSample(s.file)} disabled={parsing}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="hint" aria-live="polite">
              {parsing ? "Reading the file…" : d.source ? `Loaded: ${d.source}, ${d.rows.length} load level(s).` : ""}
            </p>
            {parseError && <Notice tone="bad">{parseError}</Notice>}
          </div>

          <form
            className="card stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <h2 style={{ fontSize: "1rem" }}>2. Check the load levels</h2>
            <p className="hint">
              Load tools do not record server CPU. Pick the level to calibrate on and enter the CPU your monitoring showed at that
              time. The other levels are predicted from it.
            </p>
            {d.rows.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Calibrate</th>
                      {COLS.map((c) => (
                        <th key={c.k} scope="col">
                          {c.label}
                        </th>
                      ))}
                      <th scope="col">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((row, i) => (
                      <tr key={i} className={i === d.calibrate ? "hl" : undefined}>
                        <td className="left">
                          <input
                            type="radio"
                            name="cal"
                            style={{ width: 18, minHeight: 18 }}
                            aria-label={`Calibrate on level ${i + 1}`}
                            checked={i === d.calibrate}
                            onChange={() => setD({ ...d, calibrate: i })}
                          />
                        </td>
                        {COLS.map((c) => (
                          <td key={c.k}>
                            <input
                              type="number"
                              step="any"
                              style={{ width: 64 }}
                              aria-label={`Level ${i + 1} ${c.label}`}
                              aria-invalid={cellErr(i, c.k) || (c.k === "cpuPct" && i === d.calibrate && needsCpu) ? true : undefined}
                              title={cellErr(i, c.k) || undefined}
                              placeholder={c.optional ? "—" : undefined}
                              value={row[c.k]}
                              onChange={(e) => setCell(i, c.k, e.target.value)}
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Remove level ${i + 1}`}
                            onClick={() =>
                              setD({ ...d, rows: d.rows.filter((_, j) => j !== i), calibrate: Math.max(0, d.calibrate - (i <= d.calibrate ? 1 : 0)) })
                            }
                          >
                            <Trash size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">Import a file above, or add levels by hand.</p>
            )}
            <div className="row">
              <button
                type="button"
                className="btn btn-sm"
                disabled={d.rows.length >= 20}
                onClick={() => setD({ ...d, rows: [...d.rows, { tps: "", p95Ms: "", errorRatePct: 0, cpuPct: "", memPct: "" }] })}
              >
                Add load level
              </button>
              {d.rows.length > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => (setD(EMPTY), r.clear())}>
                  Clear
                </button>
              )}
            </div>
            {needsCpu && (
              <span className="error" role="alert">
                Enter the CPU for the level you calibrate on (highlighted row).
              </span>
            )}
            {invalid && (
              <span className="error" role="alert">
                Fix the outlined values.
              </span>
            )}
            <p className="hint">
              The test is assumed to have run on the <strong>measured</strong> environment of your service (
              {svc.measuredSpec.nodes} × {svc.measuredSpec.vcpu} vCPU). <Link href="/service/">Change it</Link> if not.
            </p>
            <RunBar
              label="Validate"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={1 + d.rows.length * 0.4}
              disabled={blocked}
              disabledReason={d.rows.length === 0 ? "Import results or add load levels first." : "Fix the highlighted values first."}
              onCancel={r.cancel}
              error={r.error}
            />
          </form>
        </aside>
        <section id="results" style={{ scrollMarginTop: 120 }} aria-label="Results" aria-busy={r.running} className="stack">
          {r.result ? (
            <Results
              nodes={svc.measuredSpec.nodes}
              measuredSpec={svc.measuredSpec}
              res={r.result}
              stale={r.running}
              applied={applied}
              onApply={() => {
                const p = r.result!.points[r.result!.calibrationIndex];
                saveSvc({
                  ...svc,
                  measurement: {
                    ...svc.measurement,
                    tps: p.tps,
                    p95Ms: p.p95Ms,
                    cpuPct: p.cpuPct ?? svc.measurement.cpuPct,
                    memPct: p.memPct ?? svc.measurement.memPct,
                    errorRatePct: p.errorRatePct,
                  },
                });
                setApplied(`Service measurement set to ${num(p.tps, 1)} req/s, p95 ${num(p.p95Ms)} ms, CPU ${num(p.cpuPct ?? 0)}%.`);
              }}
            />
          ) : (
            <ToolIdle nodes={svc.measuredSpec.nodes} startSpec={svc.measuredSpec} running={r.running} idleText={<>Import a load test (or try a sample), enter the CPU for one level, then validate.</>} />
          )}
        </section>
      </div>
    </div>
  );
}

function sortedMiddle(rows: Row[]) {
  const order = rows.map((r, i) => [Number(r.tps), i] as const).sort((a, b) => a[0] - b[0]);
  return order[Math.floor(order.length / 2)]?.[1] ?? 0;
}

function Results({
  res,
  stale,
  onApply,
  applied,
  nodes,
  measuredSpec,
}: {
  res: ValidateResult;
  stale: boolean;
  onApply: () => void;
  applied: string;
  nodes: number;
  measuredSpec: Spec;
}) {
  const g = GRADE[res.grade];
  const pts = [...res.points].sort((a, b) => a.tps - b.tps);
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      <section className={`verdict tone-${g.tone}`} aria-label="Validation grade">
        <span className="icon" aria-hidden style={{ fontWeight: 700 }}>
          {g.label[0]}
        </span>
        <h2>Model fit: {g.label}</h2>
        <div className="stack-sm">
          <p>{g.plain}</p>
          <ul className="reasons">
            {res.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>
      <ReplayOrLive
        startSpec={measuredSpec}
        startTps={res.points[res.calibrationIndex]?.tps}
        replay={
          <TwinStage
            title="Replay of each load level"
            nodes={nodes}
            frames={validateFrames(res)}
            speedHint={2.5}
            caption="The twin steps through every load level of your test. The readout is the model's prediction; the badge shows what the load test measured."
          />
        }
      />
      <div className="stats">
        <Stat k="Average p95 error" v={res.meanAbsErrorPct === null ? "—" : pct(res.meanAbsErrorPct, 1)} s="On levels not used for calibration" />
        <Stat
          k="Validated range"
          v={res.validRangeTps ? `${num(res.validRangeTps[0])}–${num(res.validRangeTps[1])}` : "—"}
          s="req/s where predictions are within 25%"
        />
        <Stat k="Calibrated on" v={`${num(res.points[res.calibrationIndex].tps, 1)} req/s`} s={`Fit error ${pct(res.calibration.errorPct, 1)}`} />
      </div>
      <div className="card stack">
        <h2>Measured vs predicted p95</h2>
        <LineChart
          label="Measured and predicted p95 by load level"
          yLabel="p95 (ms)"
          xLabel="req/s"
          series={[
            { name: "Measured", color: "var(--series-1)", unit: "ms", points: pts.map((p) => ({ x: p.tps, y: p.p95Ms })) },
            { name: "Predicted", color: "var(--series-2)", unit: "ms", dashed: true, points: pts.map((p) => ({ x: p.tps, y: p.predictedP95Ms })) },
          ]}
        />
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Measured vs predicted p95 table">
          <table>
            <thead>
              <tr>
                <th scope="col">Load</th>
                <th scope="col">Measured p95</th>
                <th scope="col">Predicted p95</th>
                <th scope="col">Gap</th>
                <th scope="col" className="left">
                  Role
                </th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p.tps} className={p.calibration ? "hl" : undefined}>
                  <td>{num(p.tps, 1)} req/s</td>
                  <td>{num(p.p95Ms)} ms</td>
                  <td>{num(p.predictedP95Ms)} ms</td>
                  <td>{pct(p.p95ErrorPct, 1)}</td>
                  <td className="left">{p.calibration ? "Calibration" : <span className="muted">Check</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card spread">
        <div className="stack-sm" style={{ gap: 2, flex: "1 1 280px" }}>
          <strong>Use this measurement for the other tools</strong>
          <span className="hint">Replaces the service&apos;s measurement with the calibration level above.</span>
        </div>
        <button type="button" className="btn" onClick={onApply}>
          Use as service measurement
        </button>
        {applied && (
          <p className="small" role="status" style={{ flexBasis: "100%", color: "var(--good-ink)" }}>
            {applied}
          </p>
        )}
      </div>
    </div>
  );
}
