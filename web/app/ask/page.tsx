"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EvaluateResults } from "@/components/evaluate-results";
import { RunBar, useRun } from "@/components/run";
import { ServiceStrip, useService } from "@/components/shell";
import { Notice, VerdictBadge } from "@/components/ui";
import { health } from "@/lib/api";
import { DEFAULT_PATTERN } from "@/lib/defaults";
import { num, pct } from "@/lib/format";
import { KEYS, usePersistent, write } from "@/lib/store";
import type {
  AssistantResult,
  EvaluateResult,
  FaultResult,
  PatternResult,
  SensitivityResult,
  Service,
} from "@/lib/types";

const EXAMPLES = [
  "Kalau trafik naik 2× saat payday gimana?",
  "What if one node goes down at peak?",
  "Database lambat 3× selama 1 menit, masih aman?",
  "Payment gateway timeout 20%, apa yang terjadi?",
  "Ada lonjakan flash sale, kuat nggak?",
  "Parameter mana yang paling berpengaruh ke p95?",
];
const TOOL_NAME: Record<string, string> = { evaluate: "Evaluate", fault: "Failures", pattern: "Load patterns", sensitivity: "Sensitivity" };
const TOOL_PATH: Record<string, string> = { evaluate: "/evaluate/", fault: "/failures/", pattern: "/patterns/", sensitivity: "/sensitivity/" };

type Saved = { q: string; a: AssistantResult } | null;
const NONE: Saved = null;
const EVAL_DEFAULTS = { normalTps: 8, peakTps: 45 };

export default function AskPage() {
  const [svc] = useService();
  const [evalSt] = usePersistent<{ normalTps: number | ""; peakTps: number | "" }>(KEYS.evaluate, EVAL_DEFAULTS);
  const [last, setLast] = usePersistent<Saved>(KEYS.assistant, NONE);
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const askedRef = useRef("");
  const [mode, setMode] = useState<"llm" | "rules" | null>(null);
  const r = useRun<AssistantResult>("/assistant", last?.a ?? null, (a) => setLast({ q: askedRef.current, a }));
  const router = useRouter();

  useEffect(() => {
    health()
      .then((h) => setMode(h.assistant ?? "rules"))
      .catch(() => setMode(null));
  }, []);

  const normal = Number(evalSt.normalTps) || 8;
  const peak = Number(evalSt.peakTps) || 45;
  const tooShort = q.trim().length < 3;

  const ask = (text: string) => {
    const t = text.trim();
    if (t.length < 3) return;
    setAsked(t);
    askedRef.current = t;
    r.run({
      question: t.slice(0, 500),
      measuredSpec: svc.measuredSpec,
      measurement: svc.measurement,
      targetSpec: svc.targetSpec,
      sla: svc.sla,
      database: svc.database,
      normalTps: Math.min(normal, peak),
      peakTps: peak,
    });
  };

  const open = (a: AssistantResult) => {
    const service: Service = { ...svc, targetSpec: a.targetSpec };
    write(KEYS.service, service);
    if (a.tool === "evaluate") {
      write(KEYS.evaluate, { normalTps: Math.min(normal, a.peakTps), peakTps: a.peakTps, stress: "1.5", monteCarlo: true, runs: 8 });
      write(`${KEYS.evaluate}.result`, a.result);
      write(`${KEYS.evaluate}.input`, {
        service,
        load: { normalTps: Math.min(normal, a.peakTps), peakTps: a.peakTps, stressMultipliers: [1.5] },
        replications: 8,
      });
    } else if (a.tool === "fault") {
      const f = (a as unknown as { fault: Record<string, number> }).fault;
      write(KEYS.fault, {
        tps: a.peakTps,
        nodesDown: f.nodes_down,
        dbSlowdown: f.db_slowdown,
        extFailShare: f.ext_fail_share,
        extTimeoutMs: f.ext_timeout_ms,
        extSlowdown: f.ext_slowdown,
        durationS: f.end_s - f.start_s,
      });
      write(`${KEYS.fault}.result`, a.result);
    } else if (a.tool === "pattern") {
      const p = (a as unknown as { pattern: Record<string, number | string> }).pattern;
      write(KEYS.pattern, {
        ...DEFAULT_PATTERN,
        kind: p.kind,
        peakTps: p.peak_tps,
        baseTps: p.base_tps,
        secondsPerHour: p.seconds_per_hour,
        spikeS: p.spike_s,
        durationS: p.duration_s,
      });
      write(`${KEYS.pattern}.result`, a.result);
    } else {
      write(KEYS.sensitivity, {
        peakTps: a.peakTps,
        stepPct: 25,
        params: ["vcpu", "nodes", "threadPool", "connPool", "dbMs", "extMs", "cpuMs"],
      });
      write(`${KEYS.sensitivity}.result`, a.result);
    }
    router.push(TOOL_PATH[a.tool]);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Ask</h1>
        <p className="lede">
          Ask a what-if question in plain words. LoadTwin turns it into a scenario, runs the SimPy simulation and explains the
          result. Every number in the answer comes from that simulation.
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
              ask(q);
            }}
          >
            <div className="field">
              <label htmlFor="q">Your question</label>
              <textarea
                id="q"
                className="plain"
                rows={3}
                maxLength={500}
                value={q}
                placeholder="What if traffic doubles on payday?"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(q);
                }}
                aria-describedby="q-hint"
              />
              <span id="q-hint" className="hint">
                Current peak: {num(peak)} req/s (from Evaluate). Mention a factor (“2×”, “+50%”), a load (“150 req/s”), nodes, a failure
                or a spike.
              </span>
            </div>
            <div className="stack-sm">
              <span className="label">Try one</span>
              <div className="chips">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="chip"
                    disabled={r.running}
                    onClick={() => {
                      setQ(e);
                      ask(e);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <RunBar
              label="Ask"
              running={r.running}
              elapsed={r.elapsed}
              estimateS={mode === "llm" ? 9 : 4}
              disabled={tooShort}
              disabledReason="Type a question or pick an example."
              onCancel={r.cancel}
              error={r.error}
            />
            {mode && (
              <p className="hint">
                {mode === "llm"
                  ? "A language model reads the question and writes the explanation. Its numbers are checked against the simulation; if any do not match, a plain summary is shown instead."
                  : "No language model is set up on this server, so questions are read with keyword rules (English or Indonesian) and answers are assembled from the simulation's own findings."}
              </p>
            )}
          </form>
        </aside>
        <section id="results" style={{ scrollMarginTop: 120 }} aria-label="Answer" aria-busy={r.running} className="stack">
          {r.result ? (
            <Answer a={r.result} q={r.running ? asked : last?.q || asked} stale={r.running} sla={svc.sla} onOpen={open} />
          ) : r.running ? (
            <div className="stack">
              <div className="skeleton" style={{ height: 160 }} />
              <div className="skeleton" style={{ height: 260 }} />
            </div>
          ) : (
            <div className="card stack-sm empty">
              <h2>Ask something</h2>
              <p className="muted">The answer shows what was simulated, the explanation, and the numbers behind it.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Answer({
  a,
  q,
  stale,
  sla,
  onOpen,
}: {
  a: AssistantResult;
  q: string;
  stale: boolean;
  sla: Service["sla"];
  onOpen: (a: AssistantResult) => void;
}) {
  const verdict = (a.result as { verdict?: string }).verdict;
  return (
    <div className="stack" style={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }}>
      <div className="card stack answer">
        {q && <p className="answer-q">“{q}”</p>}
        <div className="stack-sm">
          <span className="section-title">What was simulated</span>
          <div className="chips">
            <span className="chip chip-static">{TOOL_NAME[a.tool]}</span>
            {a.changes.length ? (
              a.changes.map((c) => (
                <span key={c} className="chip chip-static">
                  {c}
                </span>
              ))
            ) : (
              <span className="chip chip-static">current setup at {num(a.peakTps)} req/s</span>
            )}
          </div>
          {a.restated && <p className="small muted">{a.restated}</p>}
        </div>
        <div className="stack-sm">
          <div className="spread">
            <span className="section-title">Answer</span>
            {verdict && <VerdictBadge verdict={verdict} />}
          </div>
          <p className="answer-text">{a.explanation}</p>
          <p className="hint">
            {a.explanationSource === "llm"
              ? "Written by the language model from the simulation result; every number in it was checked against that result."
              : "Assembled from the simulation's own findings."}{" "}
            Question read by {a.planSource === "llm" ? "the language model" : "keyword rules"}. Simulated in {num(a.durationS, 1)} s.
          </p>
        </div>
        {a.notes.map((n) => (
          <Notice key={n} tone="warn">
            {n}
          </Notice>
        ))}
        <div className="row">
          <button type="button" className="btn" onClick={() => onOpen(a)}>
            Open in {TOOL_NAME[a.tool]}
          </button>
          <span className="hint">Loads this scenario into the tool so you can adjust it.</span>
        </div>
      </div>
      {a.tool === "evaluate" ? (
        <EvaluateResults res={a.result as EvaluateResult} sla={sla} stale={false} />
      ) : (
        <Facts a={a} />
      )}
    </div>
  );
}

function Facts({ a }: { a: AssistantResult }) {
  if (a.tool === "fault") {
    const r = a.result as FaultResult;
    return (
      <div className="stats">
        <Fact k="p95 during the failure" v={r.phases.during.p95Ms !== null ? `${num(r.phases.during.p95Ms)} ms` : "—"} s={`Healthy ${num(r.phases.healthyDuring.p95Ms ?? 0)} ms`} />
        <Fact k="Errors during the failure" v={pct(r.phases.during.errorRatePct, 2)} s={`Healthy ${pct(r.phases.healthyDuring.errorRatePct, 2)}`} />
        <Fact k="Recovery" v={r.recoverySeconds !== null ? `${num(r.recoverySeconds)} s` : "—"} s={r.failure.description} />
      </div>
    );
  }
  if (a.tool === "pattern") {
    const r = a.result as PatternResult;
    return (
      <div className="stats">
        <Fact k="Time over the SLA" v={`${num(r.breachSeconds)} s`} s={`${pct(r.breachShare * 100)} of the pattern`} />
        <Fact k="Worst 10 seconds" v={r.worstWindow.p95Ms ? `${num(r.worstWindow.p95Ms)} ms` : "—"} s={`${num(r.worstWindow.offeredTps)} req/s offered`} />
        <Fact k="Recovery" v={r.recoverySeconds !== null ? `${num(r.recoverySeconds)} s` : "—"} s="After the load drops" />
      </div>
    );
  }
  const r = a.result as SensitivityResult;
  return (
    <div className="card stack-sm">
      <h2>Ranking</h2>
      <ol className="reasons">
        {r.params.map((p) => (
          <li key={p.param}>
            <strong>{p.label}</strong>: p95 {num(p.low.p95Ms)} to {num(p.high.p95Ms)} ms (swing {num(p.swingMs)} ms)
          </li>
        ))}
      </ol>
      <p className="hint">Baseline p95 {num(r.baseline.p95Ms)} ms at {num(r.peakTps)} req/s.</p>
    </div>
  );
}

function Fact({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {s && <span className="s">{s}</span>}
    </div>
  );
}
