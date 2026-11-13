"use client";

import { useEffect, useRef, useState } from "react";

/**
 * All numbers are drawn from README.md's documented evaluate-pass example.
 * This illustrates a model output; it does not run a simulation by itself.
 */
const EXAMPLE = {
  peak: { label: "Peak traffic", load: 45, cpu: 46.8, p95: 390, message: "Within the example resource and latency limits.", status: "Within limits" },
  stress: { label: "Stress traffic", load: 90, cpu: 93.3, p95: 777, message: "CPU exceeds the example 80% limit. The bottleneck is capacity, not the p95 threshold.", status: "CPU limit exceeded" },
} as const;
type Mode = keyof typeof EXAMPLE;

/** Full request routes: requests, balancer, one service, database. */
const ROUTES = [
  "M 102 201 H 335 Q 351 201 351 181 V 88 Q 351 71 369 71 H 576 Q 592 71 592 87 V 181 Q 592 201 609 201 H 638",
  "M 102 201 H 638",
  "M 102 201 H 335 Q 351 201 351 221 V 312 Q 351 328 369 328 H 576 Q 592 328 592 312 V 221 Q 592 201 609 201 H 638",
];
/** Routes that stop at a service: requests that time out under stress. */
const DROPS = [
  "M 102 201 H 335 Q 351 201 351 181 V 88 Q 351 71 369 71 H 424",
  "M 102 201 H 424",
  "M 102 201 H 335 Q 351 201 351 221 V 312 Q 351 328 369 328 H 424",
];
const SERVICE_Y = [71, 201, 328];
const CYCLE_MS = 6500;

/** Count from the previous value to the new one when the example changes. */
function useTween(target: number, ms = 650) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      from.current = target;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min((now - start) / ms, 1);
      const e = 1 - (1 - k) ** 3;
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms]);
  return v;
}

export function TwinArchitecture() {
  const [mode, setMode] = useState<Mode>("peak");
  const [auto, setAuto] = useState(true);
  const [motion, setMotion] = useState(false);
  const data = EXAMPLE[mode];
  const stressed = mode === "stress";
  const cpu = useTween(data.cpu);
  const p95 = useTween(data.p95);
  const load = useTween(data.load);

  // Motion only when the visitor allows it.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setMotion(!mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  // Alternate between the two examples until the visitor picks one.
  useEffect(() => {
    if (!auto || !motion) return;
    const id = setInterval(() => setMode((m) => (m === "peak" ? "stress" : "peak")), CYCLE_MS);
    return () => clearInterval(id);
  }, [auto, motion]);

  const pick = (m: Mode) => {
    setAuto(false);
    setMode(m);
  };

  // More requests, moving faster, under stress; some of them time out at a busy service.
  const perRoute = stressed ? 4 : 2;
  const dur = stressed ? 2.4 : 3.4;

  return <figure className={"ed-architecture" + (stressed ? " is-stressed" : "") + (motion ? " is-live" : "")}>
    <div className="ed-architecture-top">
      <span>LOADTWIN / MODEL EXPLORER</span>
      <span className="ed-arch-status"><i aria-hidden="true" /> DOCUMENTED EXAMPLE</span>
    </div>

    <div className="ed-architecture-modes" role="group" aria-label="View documented simulation examples">
      <button type="button" aria-pressed={!stressed} onClick={() => pick("peak")}>Peak load <span>45 req/s</span></button>
      <button type="button" aria-pressed={stressed} onClick={() => pick("stress")}>Stress load <span>90 req/s</span></button>
      {auto && motion && <span key={mode} className="ed-arch-cycle" aria-hidden="true" style={{ animationDuration: CYCLE_MS + "ms" }} />}
    </div>

    <svg className="ed-architecture-graphic" viewBox="0 0 740 398" role="img" aria-label={"Model topology: request traffic through a load balancer and three service nodes to a database. " + data.label + " example: " + data.cpu + " percent CPU and " + data.p95 + " ms p95 latency."}>
      <defs>
        <linearGradient id="ed-flow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#58dbe2" stopOpacity=".15" /><stop offset="1" stopColor="#82c6ff" stopOpacity=".9" /></linearGradient>
        <linearGradient id="ed-node" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1e3c58" /><stop offset="1" stopColor="#12283d" /></linearGradient>
      </defs>
      <g className="ed-arch-grid" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <line key={"v"+i} x1={i*50} y1="0" x2={i*50} y2="398" />)}{Array.from({ length: 9 }, (_, i) => <line key={"h"+i} x1="0" y1={i*50} x2="740" y2={i*50} />)}</g>

      <g className="ed-arch-connections" fill="none" strokeWidth="1.6">
        <path d="M 102 201 H 192" />
        <path d="M 289 201 H 335 Q 351 201 351 181 V 88 Q 351 71 369 71 H 424" />
        <path d="M 289 201 H 424" />
        <path d="M 289 201 H 335 Q 351 201 351 221 V 312 Q 351 328 369 328 H 424" />
        <path d="M 546 71 H 576 Q 592 71 592 87 V 181 Q 592 201 609 201 H 638" />
        <path d="M 546 201 H 638" />
        <path d="M 546 328 H 576 Q 592 328 592 312 V 221 Q 592 201 609 201 H 638" />
      </g>

      {/* Requests travel under the boxes, so they disappear into the balancer and the services. */}
      {motion && <g key={mode} className="ed-arch-packets" aria-hidden="true">
        {ROUTES.flatMap((d, r) => Array.from({ length: perRoute }, (_, k) => (
          <circle key={`${r}-${k}`} r="3.4" className="ed-arch-packet">
            <animateMotion dur={`${dur}s`} begin={`${((k / perRoute) * dur + r * 0.37).toFixed(2)}s`} repeatCount="indefinite" path={d} keyPoints="0;0.6;0.83;1" keyTimes={stressed ? "0;0.28;0.8;1" : "0;0.38;0.7;1"} calcMode="linear" />
          </circle>
        )))}
        {stressed && DROPS.map((d, r) => (
          <circle key={`drop-${r}`} r="3.4" className="ed-arch-packet is-drop">
            <animateMotion dur="2.6s" begin={`${0.8 + r * 0.7}s`} repeatCount="indefinite" path={d} />
            <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur="2.6s" begin={`${0.8 + r * 0.7}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </g>}

      <g className="ed-arch-traffic">
        <circle cx="74" cy="201" r="29" />
        <path d="M60 202h28M69 190l-9 12 9 12M79 190l9 12-9 12" />
        <text x="74" y="260" textAnchor="middle">REQUESTS</text>
      </g>

      <g className="ed-arch-node">
        <rect x="192" y="167" width="97" height="68" rx="9" />
        <path d="M216 190h49M216 201h36M216 212h43" />
        <text x="240" y="263" textAnchor="middle">BALANCER</text>
      </g>

      {SERVICE_Y.map((y, i) => <g className="ed-arch-node ed-arch-service" key={i}>
        <rect x="424" y={y-32} width="122" height="64" rx="8" />
        <rect x="441" y={y-16} width="26" height="26" rx="3" className="ed-arch-chip" />
        <path d={"M478 "+(y-10)+"h48M478 "+y+"h34M478 "+(y+10)+"h40"} />
        <circle cx="528" cy={y-16} r="3.4" className="ed-arch-led" />
        {/* CPU of this service, from the example */}
        <rect x="433" y={y+22} width="104" height="3" rx="1.5" className="ed-arch-load-track" />
        <rect x="433" y={y+22} width={104 * Math.min(cpu, 100) / 100} height="3" rx="1.5" className="ed-arch-load" />
        <text x="485" y={y+54} textAnchor="middle">SERVICE 0{i+1}</text>
      </g>)}

      <g className="ed-arch-database">
        <path d="M638 175c0-9 14-16 31-16s31 7 31 16v53c0 10-14 17-31 17s-31-7-31-17z" />
        <path d="M638 175c0 10 14 17 31 17s31-7 31-17M638 200c0 10 14 17 31 17s31-7 31-17" />
        <text x="669" y="268" textAnchor="middle">DATABASE</text>
      </g>
      {!motion && <g className="ed-arch-signal" aria-hidden="true">
        <circle cx="159" cy="201" r="3" />
        <circle cx="382" cy="71" r="3" />
        <circle cx="382" cy="201" r="3" />
        <circle cx="382" cy="328" r="3" />
        <circle cx="605" cy="201" r="3" />
      </g>}
      <text x="24" y="375" className="ed-arch-foot">A simplified diagram of the simulated system topology</text>
    </svg>

    <div className="ed-architecture-readings">
      <div className="ed-arch-primary"><span>CPU UTILIZATION</span><strong>{cpu.toFixed(1)}<small>%</small></strong><div className="ed-arch-meter" role="img" aria-label={"CPU utilization " + data.cpu + " percent, with 80 percent example limit"}><span style={{ width: Math.min(cpu, 100) + "%" }} /><i style={{ left: "80%" }} /></div><small>Example threshold <b>80%</b></small></div>
      <div className="ed-arch-secondary"><div><span>P95 LATENCY</span><strong>{Math.round(p95)}<small> ms</small></strong></div><div><span>THROUGHPUT</span><strong>{Math.round(load)}<small> req/s</small></strong></div></div>
    </div>

    <figcaption className="ed-architecture-caption" aria-live="polite" aria-atomic="true"><span className="ed-arch-caption-dot" aria-hidden="true" /><p><strong>{data.status}.</strong> {data.message}</p></figcaption>
  </figure>;
}
