"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { post } from "@/lib/api";
import { num } from "@/lib/format";
import type { Service, Summary } from "@/lib/types";
import { useService } from "./shell";
import { TwinStage } from "./twin-stage";

function breaches(s: Summary, svc: Service) {
  const out: string[] = [];
  if (s.p95Ms > svc.sla.maxP95Ms) out.push("p95");
  if (s.errorRatePct > svc.sla.maxErrorRatePct) out.push("errors");
  if (s.cpuPct > svc.sla.maxCpuPct) out.push("CPU");
  return out;
}

/**
 * The landing hero: a live picture of the twin. Requests flow through a load balancer into each node's
 * queue; the numbers underneath come from the SimPy engine for the chosen traffic.
 */
export function TwinHero() {
  const [svc, , hydrated] = useService();
  const nodes = Math.min(Math.max(svc.targetSpec.nodes, 1), 6);
  const maxTps = useMemo(() => {
    const scale = (svc.targetSpec.nodes * svc.targetSpec.vcpu) / Math.max(svc.measuredSpec.nodes * svc.measuredSpec.vcpu, 1);
    return Math.min(2000, Math.max(20, Math.round((svc.measurement.tps * scale * 2.6) / 5) * 5));
  }, [svc]);
  const [tps, setTps] = useState<number | null>(null);
  const load = tps ?? Math.round((maxTps * 0.3) / 5) * 5;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  // Ask the engine for the real numbers, debounced while the slider moves.
  useEffect(() => {
    if (!hydrated) return;
    const c = new AbortController();
    setState("loading");
    const id = setTimeout(() => {
      post<{ results: { summary: Summary }[] }>(
        "/simulate",
        {
          measuredSpec: svc.measuredSpec,
          measurement: svc.measurement,
          targetSpec: svc.targetSpec,
          database: svc.database,
          loadsTps: [load],
        },
        c.signal,
      )
        .then((r) => {
          setSummary(r.results[0].summary);
          setState("idle");
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setState("error");
        });
    }, 350);
    return () => {
      clearTimeout(id);
      c.abort();
    };
  }, [load, svc, hydrated]);

  const rho = summary ? Math.max(summary.cpuPct, summary.threadPct) / 100 : load / maxTps;
  const heroFrames = useMemo(
    () => [
      {
        t: 0,
        tps: load,
        cpu: summary ? summary.cpuPct : rho * 100,
        thread: summary?.threadPct ?? 0,
        p95: summary?.p95Ms ?? 0,
        err: summary?.errorRatePct ?? 0,
      },
    ],
    [load, summary, rho],
  );
  const bad = summary ? breaches(summary, svc) : [];
  const verdict = !summary ? null : bad.length ? "bad" : rho > 0.75 ? "warn" : "good";

  return (
    <div className="hero-panel">
      <div className="hero-stage">
        <TwinStage
          nodes={nodes}
          frames={heroFrames}
          maxTps={maxTps}
          slaP95={svc.sla.maxP95Ms}
          slaCpu={svc.sla.maxCpuPct}
          readout={false}
          height={300}
          hasExt={false}
        />
      </div>
      <div className="hero-controls">
        <div className="field">
          <div className="spread">
            <label htmlFor="hero-load">Traffic</label>
            <output htmlFor="hero-load" className="hero-load">
              {num(load)} <span>req/s</span>
            </output>
          </div>
          <input
            id="hero-load"
            type="range"
            min={5}
            max={maxTps}
            step={5}
            value={load}
            onChange={(e) => setTps(Number(e.target.value))}
            aria-describedby="hero-readout"
          />
        </div>
        <dl id="hero-readout" className="hero-readout" aria-live="polite" aria-busy={state === "loading"}>
          <div>
            <dt>p95</dt>
            <dd>{summary ? `${num(summary.p95Ms)} ms` : "—"}</dd>
          </div>
          <div>
            <dt>CPU</dt>
            <dd>{summary ? `${num(summary.cpuPct)}%` : "—"}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd>{summary ? `${num(summary.errorRatePct, 1)}%` : "—"}</dd>
          </div>
          <div className="hero-verdict">
            <dt className="sr-only">Against your SLA</dt>
            <dd>
              {state === "error" ? (
                <span className="badge tone-na">Engine offline</span>
              ) : verdict === "good" ? (
                <span className="badge tone-good">Within SLA</span>
              ) : verdict === "warn" ? (
                <span className="badge tone-warn">Little headroom</span>
              ) : verdict === "bad" ? (
                <span className="badge tone-bad">SLA broken: {bad.join(", ")}</span>
              ) : (
                <span className="badge tone-na">Simulating…</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="hint">
          {svc.targetSpec.nodes} × {svc.targetSpec.vcpu} vCPU from <Link href="/service/">{svc.name}</Link>. Numbers come from the
          SimPy engine; the animation only illustrates the flow.
        </p>
      </div>
    </div>
  );
}
