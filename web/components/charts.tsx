"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { num } from "@/lib/format";

export type Series = {
  name: string;
  color: string;
  points: { x: number; y: number | null }[];
  step?: boolean;
  dashed?: boolean;
  unit?: string;
};

function niceMax(v: number) {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

function ticks(max: number, n = 4) {
  return Array.from({ length: n + 1 }, (_, i) => (max * i) / n);
}

/** Round tick positions between ``a`` and ``b``, about ``n`` of them. */
function niceTicks(a: number, b: number, n = 5) {
  const span = Math.max(b - a, 1e-9);
  const raw = span / n;
  const e = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * e).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

/** Width of the element in CSS pixels, so text in the SVG stays at its real size. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const PAD = { l: 48, r: 16, t: 12, b: 28 };

/**
 * Single-axis line chart with crosshair tooltip, optional threshold line and shaded x-ranges.
 * Two measures of different scale belong in two charts, never on a second axis.
 */
export function LineChart({
  series,
  height = 220,
  yLabel,
  xLabel,
  xFormat = (x) => `${num(x)}`,
  threshold,
  bands = [],
  label,
  yMax,
}: {
  series: Series[];
  height?: number;
  yLabel: string;
  xLabel: string;
  xFormat?: (x: number) => string;
  threshold?: { y: number; label: string };
  bands?: { x0: number; x1: number; label?: string }[];
  label: string;
  yMax?: number;
}) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const xs = useMemo(() => Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort((a, b) => a - b), [series]);
  const x0 = xs[0] ?? 0;
  const x1 = xs[xs.length - 1] ?? 1;
  const ys = series.flatMap((s) => s.points.map((p) => p.y ?? 0));
  const top = yMax ?? niceMax(Math.max(...ys, threshold ? threshold.y * 1.1 : 0, 1e-9));
  const H = height;
  const sx = (x: number) => PAD.l + ((x - x0) / Math.max(x1 - x0, 1e-9)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - (Math.min(y, top) / top) * (H - PAD.t - PAD.b);

  const path = (s: Series) => {
    let d = "";
    let prev: { x: number; y: number } | null = null;
    for (const p of s.points) {
      if (p.y === null) {
        prev = null;
        continue;
      }
      if (!prev) d += `M${sx(p.x)},${sy(p.y)}`;
      else if (s.step) d += `H${sx(p.x)}V${sy(p.y)}`;
      else d += `L${sx(p.x)},${sy(p.y)}`;
      prev = { x: p.x, y: p.y };
    }
    return d;
  };

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !xs.length) return;
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(sx(xs[i]) - x) < Math.abs(sx(xs[best]) - x)) best = i;
    setHover(best);
  };

  const hx = hover !== null ? xs[hover] : null;
  const xt = niceTicks(x0, x1, W < 420 ? 3 : 6);
  return (
    <figure className="chart" style={{ margin: 0 }}>
      {series.length > 1 && (
        <div className="legend" aria-hidden>
          {series.map((s) => (
            <span key={s.name}>
              <span className="sw" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
          {bands.length > 0 && (
            <span>
              <span className="sw block" style={{ background: "var(--breach)", outline: "1px solid var(--bad)" }} />
              SLA breached
            </span>
          )}
        </div>
      )}
      <div className="hint" aria-hidden style={{ marginBottom: 2 }}>
        {yLabel}
      </div>
      <div
        ref={ref}
        style={{ position: "relative" }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
          {bands.map((b, i) => (
            <rect key={i} x={sx(b.x0)} y={PAD.t} width={Math.max(sx(b.x1) - sx(b.x0), 1)} height={H - PAD.t - PAD.b} fill="var(--breach)" />
          ))}
          <g className="grid axis">
            {ticks(top).map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} strokeWidth={1} />
                <text x={PAD.l - 8} y={sy(t) + 4} textAnchor="end">
                  {num(t, top < 5 ? 1 : 0)}
                </text>
              </g>
            ))}
            {xt.map((t) => (
              <text key={t} x={sx(t)} y={H - 8} textAnchor="middle">
                {xFormat(t)}
              </text>
            ))}
          </g>
          <line className="baseline" x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} />
          {threshold && (
            <g>
              <line className="threshold" x1={PAD.l} x2={W - PAD.r} y1={sy(threshold.y)} y2={sy(threshold.y)} />
              <text className="threshold-label" x={W - PAD.r} y={sy(threshold.y) - 5} textAnchor="end">
                {threshold.label}
              </text>
            </g>
          )}
          {series.map((s) => (
            <path
              key={s.name}
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hx !== null && (
            <g>
              <line x1={sx(hx)} x2={sx(hx)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-strong)" />
              {series.map((s) => {
                const p = s.points.find((q) => q.x === hx);
                return p && p.y !== null ? (
                  <circle key={s.name} cx={sx(hx)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ) : null;
              })}
            </g>
          )}
        </svg>
        {hx !== null && (
          <div
            className="tooltip"
            style={{
              left: `${(sx(hx) / W) * 100}%`,
              top: 8,
              transform: sx(hx) > W * 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <strong>
              {xLabel} {xFormat(hx)}
            </strong>
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hx);
              return (
                <div className="t-row" key={s.name}>
                  <span>
                    <span className="dot" style={{ background: s.color, marginRight: 6 }} />
                    {s.name}
                  </span>
                  <span>
                    {p?.y === null || p === undefined ? "—" : num(p.y, 1)}
                    {s.unit ? ` ${s.unit}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <figcaption className="hint" style={{ marginTop: 4 }}>
        {xLabel} on the horizontal axis.
      </figcaption>
    </figure>
  );
}

/** Horizontal bars with a marker line, e.g. capacity per resource against the peak load. */
export function BarList({
  items,
  marker,
  unit,
  label,
  format = (v) => num(v, 1),
}: {
  items: { name: string; value: number; highlight?: boolean; note?: ReactNode }[];
  marker?: { value: number; label: string };
  unit: string;
  label: string;
  format?: (v: number) => string;
}) {
  // Keep the bars that matter readable: a resource 100x away from its limit would flatten the rest.
  const smallest = Math.min(...items.map((i) => i.value));
  const max = niceMax(Math.min(Math.max(...items.map((i) => i.value), marker?.value ?? 0) * 1.05, Math.max(smallest * 4, (marker?.value ?? 0) * 2)));
  return (
    <div className="stack-sm" role="list" aria-label={label}>
      {items.map((i) => {
        const w = (Math.min(i.value, max) / max) * 100;
        return (
          <div key={i.name} role="listitem" title={`${i.name}: ${format(i.value)} ${unit}`}>
            <div className="spread small" style={{ marginBottom: 3 }}>
              <span style={{ fontWeight: i.highlight ? 650 : 500 }}>
                {i.name}
                {i.note}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(i.value)} {unit}
              </span>
            </div>
            <div style={{ position: "relative", height: 10, background: "var(--surface-2)", borderRadius: 4 }}>
              <div
                style={{
                  width: `${w}%`,
                  ...(i.value > max ? { borderRadius: "4px 0 0 4px", maskImage: "linear-gradient(90deg, #000 85%, transparent)" } : {}),
                  height: "100%",
                  borderRadius: 4,
                  background: i.highlight ? "var(--series-2)" : "var(--series-1)",
                }}
              />
              {marker && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: -3,
                    bottom: -3,
                    left: `${(marker.value / max) * 100}%`,
                    width: 2,
                    background: "var(--ink)",
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
      {items.some((i) => i.value > max) && <p className="hint">Faded bars run past the scale.</p>}
      {marker && (
        <p className="hint">
          <span style={{ display: "inline-block", width: 2, height: 10, background: "var(--ink)", marginRight: 6, verticalAlign: "middle" }} />
          {marker.label}
        </p>
      )}
    </div>
  );
}

/** Spread of one indicator across Monte Carlo runs: dots for each run, a band for p5–p95, a limit line. */
export function RunSpread({ samples, limit, unit, label }: { samples: number[]; limit: number; unit: string; label: string }) {
  const [ref, W] = useWidth();
  const lo = Math.min(...samples, limit);
  const hi = Math.max(...samples, limit);
  const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
  const a = Math.max(0, lo - pad);
  const b = hi + pad;
  const H = 60;
  const sx = (v: number) => PAD.l + ((v - a) / (b - a)) * (W - PAD.l - PAD.r);
  const sorted = [...samples].sort((x, y) => x - y);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const lx = sx(limit);
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: "block", maxWidth: "100%" }}>
        <text x={lx} y={11} textAnchor={lx > W - 90 ? "end" : "middle"} fontSize={11} fill="var(--bad-ink)" fontWeight={600}>
          limit {num(limit, 1)} {unit}
        </text>
        <line x1={PAD.l} x2={W - PAD.r} y1={33} y2={33} stroke="var(--line)" />
        <rect x={sx(q(0.05))} y={24} width={Math.max(sx(q(0.95)) - sx(q(0.05)), 2)} height={18} rx={4} fill="var(--accent-soft)" />
        {samples.map((v, i) => (
          <circle key={i} cx={sx(v)} cy={33} r={4} fill={v > limit ? "var(--bad)" : "var(--series-1)"} stroke="var(--surface)" strokeWidth={1.5} />
        ))}
        <line x1={lx} x2={lx} y1={16} y2={48} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="4 3" />
        {niceTicks(a, b, W < 420 ? 3 : 6).map((t) => (
          <text key={t} x={sx(t)} y={58} fontSize={11} fill="var(--muted)" textAnchor="middle">
            {num(t, b - a < 5 ? 1 : 0)}
          </text>
        ))}
      </svg>
    </div>
  );
}
