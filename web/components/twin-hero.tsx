"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "@/lib/api";
import { num } from "@/lib/format";
import type { Service, Summary } from "@/lib/types";
import { useService } from "./shell";

type Dot = { x: number; y: number; node: number; stage: "in" | "lb" | "queue" | "work" | "out" | "drop"; t: number; tx: number; ty: number };

const MAX_QUEUE = 9;

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
  const bad = summary ? breaches(summary, svc) : [];
  const verdict = !summary ? null : bad.length ? "bad" : rho > 0.75 ? "warn" : "good";

  return (
    <div className="hero-panel">
      <TwinCanvas nodes={nodes} share={load / maxTps} rho={rho} />
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

function TwinCanvas({ nodes, share, rho }: { nodes: number; share: number; rho: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ nodes, share, rho });
  live.current = { nodes, share, rho };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const css = (v: string) => getComputedStyle(canvas).getPropertyValue(v).trim() || "#888";
    let dots: Dot[] = [];
    const queues: number[] = Array(6).fill(0);
    const busy: number[] = Array(6).fill(0);
    let rr = 0;
    let spawnAcc = 0;
    let last = performance.now();
    let raf = 0;

    const layout = () => {
      const n = live.current.nodes;
      const lbX = W * 0.2;
      const nodeX = W * 0.56;
      const dbX = W * 0.9;
      const top = 30;
      const gap = (H - top * 2) / n;
      const ys = Array.from({ length: n }, (_, i) => top + gap * (i + 0.5));
      return { lbX, nodeX, dbX, ys, mid: H / 2, nodeW: Math.min(120, W * 0.2), nodeH: Math.min(30, gap * 0.62) };
    };

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { nodes: n, share, rho } = live.current;
      const L = layout();
      const ink = css("--ink-2");
      const line = css("--line-strong");
      const surface = css("--surface");
      const accent = css("--accent");
      const good = css("--good");
      const warn = css("--warn");
      const bad = css("--bad");
      const heat = rho >= 0.95 ? bad : rho > 0.75 ? warn : good;

      // Visual rates: arrivals grow with traffic, service is set so utilization matches the engine.
      const lambda = 1.5 + share * 16;
      const perNodeService = Math.max(lambda / n / Math.max(rho, 0.05), 0.4);
      const workTime = 1 / perNodeService;

      if (!reduce) {
        spawnAcc += lambda * dt;
        while (spawnAcc >= 1) {
          spawnAcc -= 1;
          dots.push({ x: -6, y: L.mid + (Math.random() - 0.5) * 30, node: -1, stage: "in", t: 0, tx: L.lbX, ty: L.mid });
        }
      }

      ctx.clearRect(0, 0, W, H);
      // Wires
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(L.lbX + 16, L.mid);
        ctx.bezierCurveTo(L.lbX + 70, L.mid, L.nodeX - L.nodeW / 2 - 70, L.ys[i], L.nodeX - L.nodeW / 2 - 4, L.ys[i]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(L.nodeX + L.nodeW / 2 + 4, L.ys[i]);
        ctx.bezierCurveTo(L.nodeX + L.nodeW / 2 + 50, L.ys[i], L.dbX - 60, L.mid, L.dbX - 18, L.mid);
        ctx.stroke();
      }

      // Move dots
      for (const d of dots) {
        const speed = 160 * dt;
        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy);
        if (d.stage === "work") {
          d.t -= dt;
          if (d.t <= 0) {
            busy[d.node] = Math.max(0, busy[d.node] - 1);
            d.stage = "out";
            d.tx = L.dbX - 18;
            d.ty = L.mid;
          }
          continue;
        }
        if (dist > speed) {
          d.x += (dx / dist) * speed;
          d.y += (dy / dist) * speed;
          continue;
        }
        d.x = d.tx;
        d.y = d.ty;
        if (d.stage === "in") {
          d.node = rr++ % n;
          d.stage = "lb";
          d.tx = L.nodeX - L.nodeW / 2 - 10;
          d.ty = L.ys[d.node];
        } else if (d.stage === "lb") {
          if (queues[d.node] >= MAX_QUEUE) {
            d.stage = "drop";
            d.t = 0.6;
          } else {
            d.stage = "queue";
            queues[d.node]++;
          }
        } else if (d.stage === "out") {
          d.t = -1;
        }
      }
      // Start work where a node is free (2 cores visualised per node)
      for (let i = 0; i < n; i++) {
        while (busy[i] < 2 && queues[i] > 0) {
          const d = dots.find((x) => x.stage === "queue" && x.node === i);
          if (!d) break;
          queues[i]--;
          busy[i]++;
          d.stage = "work";
          d.t = workTime * 2 * (0.6 + Math.random() * 0.8);
          d.x = L.nodeX;
          d.y = L.ys[i];
        }
      }
      for (const d of dots) if (d.stage === "drop") d.t -= dt;
      dots = dots.filter((d) => !(d.stage === "out" && d.t === -1) && !(d.stage === "drop" && d.t <= 0));

      // Load balancer
      ctx.fillStyle = surface;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(L.lbX, L.mid - 18);
      ctx.lineTo(L.lbX + 16, L.mid);
      ctx.lineTo(L.lbX, L.mid + 18);
      ctx.lineTo(L.lbX - 16, L.mid);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Nodes with a utilization bar and queue
      ctx.font = `600 11px ${getComputedStyle(canvas).fontFamily}`;
      for (let i = 0; i < n; i++) {
        const x = L.nodeX - L.nodeW / 2;
        const y = L.ys[i] - L.nodeH / 2;
        roundRect(x, y, L.nodeW, L.nodeH, 7);
        ctx.fillStyle = surface;
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.stroke();
        roundRect(x + 3, y + 3, Math.max((L.nodeW - 6) * Math.min(rho, 1), 2), L.nodeH - 6, 5);
        ctx.fillStyle = heat;
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink;
        ctx.textBaseline = "middle";
        ctx.fillText(`node ${i + 1}`, x + 9, L.ys[i] + 0.5);
        // queue: stacked ticks left of the node
        const q = reduce ? Math.round(Math.min(Math.max(rho - 0.6, 0) * 20, MAX_QUEUE)) : queues[i];
        for (let k = 0; k < q; k++) {
          ctx.fillStyle = k >= MAX_QUEUE - 2 ? bad : accent;
          ctx.fillRect(x - 10 - k * 6, L.ys[i] - 5, 3, 10);
        }
      }

      // Database
      const dbW = 30;
      ctx.fillStyle = surface;
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.ellipse(L.dbX, L.mid - 14, dbW / 2, 5, 0, 0, Math.PI * 2);
      ctx.moveTo(L.dbX - dbW / 2, L.mid - 14);
      ctx.lineTo(L.dbX - dbW / 2, L.mid + 14);
      ctx.ellipse(L.dbX, L.mid + 14, dbW / 2, 5, 0, Math.PI, 0, true);
      ctx.lineTo(L.dbX + dbW / 2, L.mid - 14);
      ctx.fill();
      ctx.stroke();

      // Requests
      for (const d of dots) {
        if (d.stage === "queue" || d.stage === "work") continue;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = d.stage === "drop" ? bad : accent;
        ctx.globalAlpha = d.stage === "drop" ? Math.max(d.t / 0.6, 0) : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Labels
      ctx.fillStyle = css("--muted");
      ctx.font = `500 11px ${getComputedStyle(canvas).fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("load balancer", L.lbX, L.mid + 34);
      ctx.fillText("database", L.dbX, L.mid + 34);
      ctx.textAlign = "left";

      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const redraw = reduce ? setInterval(() => requestAnimationFrame(frame), 500) : undefined;
    return () => {
      cancelAnimationFrame(raf);
      if (redraw) clearInterval(redraw);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="hero-canvas" aria-hidden />;
}
