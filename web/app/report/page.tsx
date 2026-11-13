"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EvaluateResults } from "@/components/evaluate-results";
import { Notice } from "@/components/ui";
import { num, pct } from "@/lib/format";
import { loadIntoEvaluate } from "@/lib/open-scenario";
import { decodeShare, encodeShare, formatDate, useScenarios } from "@/lib/scenarios";
import type { SavedScenario } from "@/lib/types";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "broken" } | { kind: "ok"; s: SavedScenario; shared: boolean };

export default function ReportPage() {
  const [list, setList, hydrated] = useScenarios();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [link, setLink] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    const hash = window.location.hash.slice(1);
    const id = new URLSearchParams(window.location.search).get("id");
    if (hash) {
      decodeShare(hash)
        .then((s) => setState({ kind: "ok", s, shared: !list.some((x) => x.id === s.id) }))
        .catch(() => setState({ kind: "broken" }));
    } else {
      const s = list.find((x) => x.id === id);
      setState(s ? { kind: "ok", s, shared: false } : { kind: "missing" });
    }
    // list changes when a shared report is saved; that is handled by the save button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (state.kind === "loading") return <div className="skeleton" style={{ height: 400 }} />;
  if (state.kind !== "ok")
    return (
      <div className="card stack-sm empty">
        <h1>{state.kind === "broken" ? "This link cannot be opened" : "Report not found"}</h1>
        <p className="muted">
          {state.kind === "broken"
            ? "The link is incomplete or was changed. Ask for it again, copied in full."
            : "It may have been deleted, or it was saved in another browser."}
        </p>
        <p>
          <Link href="/workspace/">Go to the workspace</Link>
        </p>
      </div>
    );

  const s = state.s;
  const m = s.service.measuredSpec;
  const t = s.service.targetSpec;

  const share = async () => {
    setCopyMsg("");
    const url = `${window.location.origin}/report/#${await encodeShare(s)}`;
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Link copied. Anyone with it sees this report; nothing is stored on a server.");
    } catch {
      setCopyMsg("Copy the link below. Anyone with it sees this report; nothing is stored on a server.");
    }
  };

  return (
    <article className="report stack">
      <div className="spread no-print">
        <Link href="/workspace/" className="small">
          Back to the workspace
        </Link>
        <div className="row">
          {state.shared && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setList([s, ...list.filter((x) => x.id !== s.id)]);
                setState({ ...state, shared: false });
              }}
            >
              Save to my workspace
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              loadIntoEvaluate(s);
              router.push("/evaluate/");
            }}
          >
            Open in Evaluate
          </button>
          <button type="button" className="btn btn-sm" onClick={share}>
            Copy share link
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>
            Download PDF
          </button>
        </div>
      </div>
      {(copyMsg || link) && (
        <div className="no-print stack-sm">
          <p className="hint" role="status">
            {copyMsg}
          </p>
          {link && (
            <input className="plain" type="text" readOnly value={link} aria-label="Share link" onFocus={(e) => e.target.select()} />
          )}
        </div>
      )}
      {state.shared && (
        <div className="no-print">
          <Notice>This report was shared with you. It lives only in the link until you save it.</Notice>
        </div>
      )}

      <header className="report-head">
        <p className="report-kicker">LoadTwin capacity report</p>
        <h1>{s.name}</h1>
        <p className="muted">
          {s.service.name}, saved {formatDate(s.savedAt)}
        </p>
      </header>

      <section className="report-inputs" aria-label="Inputs">
        <div>
          <h2>Measured</h2>
          <dl className="kv small">
            <dt>Cluster</dt>
            <dd>
              {m.nodes} × {m.vcpu} vCPU, {num(m.ramGb)} GB
            </dd>
            <dt>Load test</dt>
            <dd>
              {num(s.service.measurement.tps)} req/s, CPU {pct(s.service.measurement.cpuPct)}, p95 {num(s.service.measurement.p95Ms)} ms
            </dd>
          </dl>
        </div>
        <div>
          <h2>Target</h2>
          <dl className="kv small">
            <dt>Cluster</dt>
            <dd>
              {t.nodes} × {t.vcpu} vCPU, {num(t.ramGb)} GB
            </dd>
            <dt>Pools</dt>
            <dd>
              {t.threadPool} threads, {t.connPool} DB connections per node
            </dd>
          </dl>
        </div>
        <div>
          <h2>Load and SLA</h2>
          <dl className="kv small">
            <dt>Load</dt>
            <dd>
              {num(s.load.normalTps)} normal, {num(s.load.peakTps)} peak req/s
            </dd>
            <dt>SLA</dt>
            <dd>
              p95 ≤ {num(s.service.sla.maxP95Ms)} ms, errors ≤ {num(s.service.sla.maxErrorRatePct, 1)}%, CPU ≤ {num(s.service.sla.maxCpuPct)}%
            </dd>
          </dl>
        </div>
      </section>

      <EvaluateResults res={s.result} sla={s.service.sla} stale={false} nodes={s.service.targetSpec.nodes} />

      <p className="hint">
        Every number comes from a SimPy discrete-event simulation calibrated on the measured load test. Results are estimates;
        confirm critical decisions with a load test.
      </p>
    </article>
  );
}
