"use client";

import { useState } from "react";

/**
 * All numbers are drawn from README.md's documented evaluate-pass example.
 * This illustrates a model output; it does not run a simulation by itself.
 */
const EXAMPLE = {
  peak: { label: "Peak traffic", load: 45, cpu: 46.8, p95: 390, message: "Within the example resource and latency limits.", status: "Within limits" },
  stress: { label: "Stress traffic", load: 90, cpu: 93.3, p95: 777, message: "CPU exceeds the example 80% limit. The bottleneck is capacity, not the p95 threshold.", status: "CPU limit exceeded" },
} as const;

export function TwinArchitecture() {
  const [mode, setMode] = useState<keyof typeof EXAMPLE>("peak");
  const data = EXAMPLE[mode];
  const stressed = mode === "stress";

  return <figure className={"ed-architecture" + (stressed ? " is-stressed" : "")}>
    <div className="ed-architecture-top">
      <span>LOADTWIN / MODEL EXPLORER</span>
      <span className="ed-arch-status"><i aria-hidden="true" /> DOCUMENTED EXAMPLE</span>
    </div>

    <div className="ed-architecture-modes" role="group" aria-label="View documented simulation examples">
      <button type="button" aria-pressed={!stressed} onClick={() => setMode("peak")}>Peak load <span>45 req/s</span></button>
      <button type="button" aria-pressed={stressed} onClick={() => setMode("stress")}>Stress load <span>90 req/s</span></button>
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

      {[71,201,328].map((y, i) => <g className="ed-arch-node" key={i}>
        <rect x="424" y={y-32} width="122" height="64" rx="8" />
        <rect x="441" y={y-16} width="26" height="26" rx="3" className="ed-arch-chip" />
        <path d={"M478 "+(y-10)+"h48M478 "+y+"h34M478 "+(y+10)+"h40"} />
        <circle cx="528" cy={y-16} r="3.4" className="ed-arch-led" />
        <text x="485" y={y+54} textAnchor="middle">SERVICE 0{i+1}</text>
      </g>)}

      <g className="ed-arch-database">
        <path d="M638 175c0-9 14-16 31-16s31 7 31 16v53c0 10-14 17-31 17s-31-7-31-17z" />
        <path d="M638 175c0 10 14 17 31 17s31-7 31-17M638 200c0 10 14 17 31 17s31-7 31-17" />
        <text x="669" y="268" textAnchor="middle">DATABASE</text>
      </g>
      <g className="ed-arch-signal" aria-hidden="true">
        <circle cx="159" cy="201" r="3" />
        <circle cx="382" cy="71" r="3" />
        <circle cx="382" cy="201" r="3" />
        <circle cx="382" cy="328" r="3" />
        <circle cx="605" cy="201" r="3" />
      </g>
      <text x="24" y="375" className="ed-arch-foot">A simplified diagram of the simulated system topology</text>
    </svg>

    <div className="ed-architecture-readings">
      <div className="ed-arch-primary"><span>CPU UTILIZATION</span><strong>{data.cpu.toFixed(1)}<small>%</small></strong><div className="ed-arch-meter" role="img" aria-label={"CPU utilization " + data.cpu + " percent, with 80 percent example limit"}><span style={{ width: data.cpu + "%" }} /><i style={{ left: "80%" }} /></div><small>Example threshold <b>80%</b></small></div>
      <div className="ed-arch-secondary"><div><span>P95 LATENCY</span><strong>{data.p95}<small> ms</small></strong></div><div><span>THROUGHPUT</span><strong>{data.load}<small> req/s</small></strong></div></div>
    </div>

    <figcaption className="ed-architecture-caption" aria-live="polite" aria-atomic="true"><span className="ed-arch-caption-dot" aria-hidden="true" /><p><strong>{data.status}.</strong> {data.message}</p></figcaption>
  </figure>;
}
