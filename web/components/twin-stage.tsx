"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { num, pct } from "@/lib/format";

/** One moment of a run. Values come from the simulation result; the animation only draws them. */
export type StageFrame = {
  t: number;
  tps: number;
  cpu: number;
  thread?: number;
  p95?: number | null;
  err?: number;
  /** Nodes out of service at this moment. */
  down?: number;
  /** Database time multiplier (1 = normal). */
  dbSlow?: number;
  /** Share of external calls failing (0..1). */
  extFail?: number;
  breach?: boolean;
  label?: string;
};

export type StageBand = { x0: number; x1: number; kind: "fault" | "breach" };

type Live = {
  nodes: number;
  share: number;
  cpu: number;
  thread: number;
  p95: number;
  err: number;
  down: number;
  dbSlow: number;
  extFail: number;
  hasExt: boolean;
  slaCpu: number;
  dim: boolean;
};

type Dot = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  stage: "in" | "route" | "work" | "db" | "ext" | "drop";
  node: number;
  t: number;
  speed: number;
};

const MAX_ROWS = 8;

function nodeLayout(n: number, W: number, H: number) {
  const cols = Math.ceil(n / MAX_ROWS);
  const rows = Math.ceil(n / cols);
  const areaW = W * 0.34;
  const w = Math.min(112, areaW / cols - 8);
  const gap = (H - 44) / rows;
  const h = Math.max(Math.min(28, gap * 0.66), 8);
  const x0 = W * 0.52 - (cols * (w + 8)) / 2 + w / 2;
  return Array.from({ length: n }, (_, i) => {
    const c = Math.floor(i / rows);
    const r = i % rows;
    return { x: x0 + c * (w + 8), y: 22 + gap * (r + 0.5), w, h };
  });
}

/** The twin drawn on a canvas: requests through a load balancer, nodes, the database and an external dependency. */
function StageCanvas({ live, height }: { live: React.MutableRefObject<Live>; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    let colors: Record<string, string> = {};
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      for (const k of ["--ink-2", "--muted", "--line-strong", "--surface", "--accent", "--good", "--warn", "--bad", "--surface-2"])
        colors[k] = cs.getPropertyValue(k).trim() || "#888";
      colors.font = cs.fontFamily;
    };
    readColors();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", readColors);

    let dots: Dot[] = [];
    let acc = 0;
    let rr = 0;
    let last = performance.now();
    let raf = 0;
    let pulse = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible || W === 0) return;
      pulse += dt;
      const L = live.current;
      const c = colors;
      const lbX = W * 0.13;
      const mid = H / 2;
      const dbX = W * 0.88;
      const dbY = L.hasExt ? mid + H * 0.2 : mid;
      const extY = mid - H * 0.24;
      const nodes = nodeLayout(L.nodes, W, H);
      const up = nodes.map((_, i) => i < L.nodes - L.down);
      const upIdx = up.flatMap((u, i) => (u ? [i] : []));

      // Arrivals: the rate follows the offered load.
      if (!reduce) {
        acc += (1.2 + L.share * 18) * dt;
        while (acc >= 1) {
          acc -= 1;
          dots.push({ x: -4, y: mid + (Math.random() - 0.5) * 24, tx: lbX, ty: mid, stage: "in", node: -1, t: 0, speed: 260 });
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c["--line-strong"];
      nodes.forEach((nd, i) => {
        ctx.globalAlpha = up[i] ? 1 : 0.35;
        ctx.beginPath();
        ctx.moveTo(lbX + 14, mid);
        ctx.bezierCurveTo(lbX + 60, mid, nd.x - nd.w / 2 - 50, nd.y, nd.x - nd.w / 2 - 3, nd.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nd.x + nd.w / 2 + 3, nd.y);
        ctx.bezierCurveTo(nd.x + nd.w / 2 + 40, nd.y, dbX - 50, dbY, dbX - 18, dbY);
        ctx.stroke();
        if (L.hasExt) {
          ctx.beginPath();
          ctx.moveTo(nd.x + nd.w / 2 + 3, nd.y);
          ctx.bezierCurveTo(nd.x + nd.w / 2 + 40, nd.y, dbX - 50, extY, dbX - 20, extY);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;

      // Move requests.
      const work = 0.25 + Math.min(L.p95 / 1000, 3) * 0.7;
      for (const d of dots) {
        if (d.stage === "work") {
          d.t -= dt;
          if (d.t <= 0) {
            const nd = nodes[d.node];
            const toExt = L.hasExt && Math.random() < 0.35;
            d.x = nd ? nd.x + nd.w / 2 : d.x;
            d.stage = toExt ? "ext" : "db";
            d.tx = dbX - 18;
            d.ty = toExt ? extY : dbY;
            d.speed = toExt ? 230 : 230 / Math.max(L.dbSlow, 1) ** 0.6;
            d.t = toExt && Math.random() < L.extFail ? -2 : 0; // -2 marks a call that will hang and fail
          }
          continue;
        }
        if (d.stage === "drop") {
          d.t -= dt;
          continue;
        }
        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy);
        const step = d.speed * dt;
        if (dist > step) {
          d.x += (dx / dist) * step;
          d.y += (dy / dist) * step;
          continue;
        }
        d.x = d.tx;
        d.y = d.ty;
        if (d.stage === "in") {
          if (!upIdx.length || Math.random() < L.err / 100) {
            d.stage = "drop";
            d.t = 0.7;
            continue;
          }
          d.node = upIdx[rr++ % upIdx.length];
          const nd = nodes[d.node];
          d.stage = "route";
          d.tx = nd.x - nd.w / 2 - 6;
          d.ty = nd.y;
        } else if (d.stage === "route") {
          d.stage = "work";
          d.t = work * (0.6 + Math.random() * 0.8);
        } else if (d.stage === "ext" && d.t === -2) {
          d.stage = "drop";
          d.t = 0.9;
        } else {
          d.t = -1;
        }
      }
      dots = dots.filter((d) => !(d.t === -1 && (d.stage === "db" || d.stage === "ext")) && !(d.stage === "drop" && d.t <= 0));
      if (dots.length > 400) dots = dots.slice(-400);


      // Load balancer
      ctx.fillStyle = c["--surface"];
      ctx.strokeStyle = c["--ink-2"];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lbX, mid - 16);
      ctx.lineTo(lbX + 14, mid);
      ctx.lineTo(lbX, mid + 16);
      ctx.lineTo(lbX - 14, mid);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Nodes
      const heat = L.cpu > L.slaCpu ? c["--bad"] : L.cpu > 75 ? c["--warn"] : c["--good"];
      const queue = L.thread > 55 ? Math.round(((L.thread - 55) / 45) * 7) : 0;
      ctx.font = `600 11px ${c.font}`;
      ctx.textBaseline = "middle";
      nodes.forEach((nd, i) => {
        const x = nd.x - nd.w / 2;
        const y = nd.y - nd.h / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, nd.w, nd.h, Math.min(7, nd.h / 3));
        ctx.fillStyle = up[i] ? c["--surface"] : c["--surface-2"];
        ctx.fill();
        ctx.strokeStyle = up[i] ? c["--ink-2"] : c["--bad"];
        ctx.setLineDash(up[i] ? [] : [4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (up[i]) {
          ctx.beginPath();
          ctx.roundRect(x + 3, y + 3, Math.max((nd.w - 6) * Math.min(L.cpu / 100, 1), 2), nd.h - 6, Math.min(5, nd.h / 4));
          ctx.fillStyle = heat;
          ctx.globalAlpha = 0.3;
          ctx.fill();
          ctx.globalAlpha = 1;
          for (let k = 0; k < queue; k++) {
            ctx.fillStyle = k >= 5 ? c["--bad"] : c["--accent"];
            ctx.fillRect(x - 9 - k * 5, nd.y - 4, 2.5, 8);
          }
        } else {
          ctx.strokeStyle = c["--bad"];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(nd.x - 5, nd.y - 5);
          ctx.lineTo(nd.x + 5, nd.y + 5);
          ctx.moveTo(nd.x + 5, nd.y - 5);
          ctx.lineTo(nd.x - 5, nd.y + 5);
          ctx.stroke();
          ctx.lineWidth = 1.5;
        }
        if (nd.w >= 64 && nd.h >= 18) {
          ctx.fillStyle = up[i] ? c["--ink-2"] : c["--muted"];
          ctx.textAlign = "left";
          ctx.fillText(up[i] ? `node ${i + 1}` : "down", x + 8, nd.y + 0.5);
        }
      });

      // Database (amber and pulsing when slowed)
      const slow = L.dbSlow > 1.01;
      ctx.strokeStyle = slow ? c["--warn"] : c["--ink-2"];
      ctx.lineWidth = slow ? 2 + Math.sin(pulse * 6) : 1.5;
      ctx.fillStyle = c["--surface"];
      ctx.beginPath();
      ctx.ellipse(dbX, dbY - 12, 14, 4.5, 0, 0, Math.PI * 2);
      ctx.moveTo(dbX - 14, dbY - 12);
      ctx.lineTo(dbX - 14, dbY + 12);
      ctx.ellipse(dbX, dbY + 12, 14, 4.5, 0, Math.PI, 0, true);
      ctx.lineTo(dbX + 14, dbY - 12);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1.5;

      // External dependency
      if (L.hasExt) {
        const failing = L.extFail > 0.001;
        ctx.beginPath();
        ctx.roundRect(dbX - 20, extY - 12, 40, 24, 12);
        ctx.fillStyle = c["--surface"];
        ctx.fill();
        ctx.strokeStyle = failing ? c["--bad"] : c["--ink-2"];
        ctx.lineWidth = failing ? 2 + Math.sin(pulse * 6) : 1.5;
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.fillStyle = failing ? c["--bad"] : c["--ink-2"];
        ctx.font = `700 11px ${c.font}`;
        ctx.textAlign = "center";
        ctx.fillText("API", dbX, extY + 0.5);
      }

      // Requests
      for (const d of dots) {
        if (d.stage === "work") continue;
        const red = d.stage === "drop" || (d.stage === "ext" && d.t === -2);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = red ? c["--bad"] : c["--accent"];
        ctx.globalAlpha = d.stage === "drop" ? Math.max(d.t / 0.9, 0) : 1;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Labels
      ctx.fillStyle = c["--muted"];
      ctx.font = `500 11px ${c.font}`;
      ctx.textAlign = "center";
      ctx.fillText("load balancer", lbX, mid + 30);
      ctx.fillText(slow ? `database ×${num(L.dbSlow, 1)}` : "database", dbX, dbY + 30);
      if (L.hasExt) ctx.fillText(L.extFail > 0.001 ? `${pct(L.extFail * 100)} fail` : "external", dbX, extY - 22);
      ctx.textAlign = "left";
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener("change", readColors);
    };
  }, [live]);
  return <canvas ref={ref} className="stage-canvas" style={{ height }} aria-hidden />;
}

/**
 * Replays a simulation result as an animation: the offered load, CPU, worker threads, latency and
 * errors at each moment drive what is drawn. With one frame it simply shows that state live.
 */
export function TwinStage({
  nodes,
  frames,
  maxTps,
  hasExt = true,
  slaP95,
  slaCpu = 80,
  title,
  caption,
  height = 240,
  bands = [],
  readout = true,
  simulating = false,
  speedHint,
}: {
  nodes: number;
  frames: StageFrame[];
  maxTps?: number;
  hasExt?: boolean;
  slaP95?: number;
  slaCpu?: number;
  title?: string;
  caption?: string;
  height?: number;
  bands?: StageBand[];
  readout?: boolean;
  simulating?: boolean;
  /** Simulated seconds per real second; chosen from the run length when omitted. */
  speedHint?: number;
}) {
  const t0 = frames[0]?.t ?? 0;
  const t1 = frames[frames.length - 1]?.t ?? 0;
  const span = Math.max(t1 - t0, 0);
  const replay = frames.length > 1;
  const top = maxTps ?? Math.max(...frames.map((f) => f.tps), 1);
  const baseSpeed = speedHint ?? Math.max(span / 14, 1);
  const [time, setTime] = useState(t0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(t0);
  const live = useRef<Live>({
    nodes,
    share: 0,
    cpu: 0,
    thread: 0,
    p95: 0,
    err: 0,
    down: 0,
    dbSlow: 1,
    extFail: 0,
    hasExt,
    slaCpu,
    dim: false,
  });

  const at = useMemo(
    () => (t: number) => {
      let i = 0;
      while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
      return i;
    },
    [frames],
  );
  const idx = at(time);
  const f = frames[idx];

  // Push the current frame into the canvas.
  useEffect(() => {
    if (!f) return;
    live.current = {
      nodes,
      share: Math.min(f.tps / top, 1.2),
      cpu: f.cpu,
      thread: f.thread ?? 0,
      p95: f.p95 ?? 0,
      err: f.err ?? 0,
      down: Math.min(f.down ?? 0, nodes),
      dbSlow: f.dbSlow ?? 1,
      extFail: f.extFail ?? 0,
      hasExt,
      slaCpu,
      dim: simulating,
    };
  }, [f, nodes, top, hasExt, slaCpu, simulating]);

  // Restart from the beginning when the run changes.
  useEffect(() => {
    timeRef.current = t0;
    setTime(t0);
    setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [frames, t0]);

  // Playback clock.
  useEffect(() => {
    if (!replay || !playing) return;
    let raf = 0;
    let last = performance.now();
    let shown = timeRef.current;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let t = timeRef.current + dt * baseSpeed * speed;
      if (t > t1) t = t0; // loop
      timeRef.current = t;
      if (Math.abs(t - shown) >= Math.max(baseSpeed * speed * 0.2, 0.5) || t < shown) {
        shown = t;
        setTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay, playing, baseSpeed, speed, t0, t1]);

  const breach = f?.breach ?? (slaP95 !== undefined && (f?.p95 ?? 0) > slaP95);
  return (
    <figure className="stage">
      {title && (
        <figcaption className="stage-head">
          <span className="stage-title">{title}</span>
          {simulating ? (
            <span className="badge tone-na stage-busy">Simulating…</span>
          ) : f?.label ? (
            <span className={`badge ${f.down || (f.dbSlow ?? 1) > 1 || (f.extFail ?? 0) > 0 ? "tone-warn" : "tone-na"}`}>{f.label}</span>
          ) : null}
        </figcaption>
      )}
      <div className="stage-body">
        <StageCanvas live={live} height={height} />
      </div>
      {readout && f && !simulating && (
        <dl className="stage-readout" aria-label="State at this moment">
          {replay && (
            <div>
              <dt>Time</dt>
              <dd>{num(time, 0)} s</dd>
            </div>
          )}
          <div>
            <dt>Load</dt>
            <dd>{num(f.tps, 1)} req/s</dd>
          </div>
          <div>
            <dt>CPU</dt>
            <dd>{pct(f.cpu)}</dd>
          </div>
          {f.thread !== undefined && (
            <div>
              <dt>Threads</dt>
              <dd>{pct(f.thread)}</dd>
            </div>
          )}
          <div>
            <dt>p95</dt>
            <dd>{f.p95 ? `${num(f.p95)} ms` : "—"}</dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd>{pct(f.err ?? 0, 1)}</dd>
          </div>
          <div className="stage-state">
            <dd>
              {breach ? <span className="badge tone-bad">SLA broken</span> : <span className="badge tone-good">Within SLA</span>}
            </dd>
          </div>
        </dl>
      )}
      {replay && !simulating && (
        <div className="stage-controls">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause replay" : "Play replay"}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <div className="stage-scrub">
            <div className="stage-bands" aria-hidden>
              {bands.map((b, i) => (
                <span
                  key={i}
                  className={`stage-band ${b.kind}`}
                  style={{ left: `${((b.x0 - t0) / Math.max(span, 1e-9)) * 100}%`, width: `${((b.x1 - b.x0) / Math.max(span, 1e-9)) * 100}%` }}
                />
              ))}
            </div>
            <input
              type="range"
              min={t0}
              max={t1}
              step={Math.max(span / 200, 0.1)}
              value={time}
              aria-label="Replay position (seconds)"
              aria-valuetext={`${num(time)} seconds`}
              onChange={(e) => {
                const t = Number(e.target.value);
                timeRef.current = t;
                setTime(t);
                setPlaying(false);
              }}
            />
          </div>
          <select className="stage-speed" aria-label="Replay speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </div>
      )}
      {caption && <p className="hint stage-caption">{caption}</p>}
    </figure>
  );
}

/**
 * Placeholder stage for a tool that has no result yet, or is waiting for one: the cluster as
 * configured with light illustrative traffic, so the page shows what will be simulated.
 */
export function PendingStage({
  nodes,
  running,
  idleText,
  hasExt = true,
}: {
  nodes: number;
  running: boolean;
  idleText: React.ReactNode;
  hasExt?: boolean;
}) {
  const frames = useMemo<StageFrame[]>(() => [{ t: 0, tps: running ? 1.4 : 0.5, cpu: running ? 55 : 25, thread: 0, p95: 300, err: 0 }], [running]);
  return (
    <div className="card stack-sm">
      <TwinStage
        title={running ? "Running the SimPy simulation" : "Your target cluster"}
        nodes={nodes}
        frames={frames}
        maxTps={2}
        hasExt={hasExt}
        readout={false}
        simulating={running}
        height={220}
      />
      <p className="muted" style={{ textAlign: "center" }} aria-live="polite">
        {running ? "Requests are being simulated one by one. The replay appears here when it finishes." : idleText}
      </p>
    </div>
  );
}
