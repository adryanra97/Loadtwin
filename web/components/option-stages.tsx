"use client";

import { useState } from "react";
import { num } from "@/lib/format";
import type { AutosizeResult, SensitivityResult } from "@/lib/types";
import { ReplayOrLive } from "./live-playground";
import { useService } from "./shell";
import { TwinStage } from "./twin-stage";
import { Segmented } from "./ui";

/** Auto-sizing: watch each candidate cluster carry the peak load. */
export function AutosizeStage({ res, slaP95, slaCpu }: { res: AutosizeResult; slaP95: number; slaCpu: number }) {
  const choices = [
    ...(res.recommended ? [{ value: "rec", label: "Recommended", cfg: res.recommended }] : []),
    ...(res.cheapest && res.cheapest.monthlyUsd !== res.recommended?.monthlyUsd
      ? [{ value: "cheap", label: "Cheapest", cfg: res.cheapest }]
      : []),
  ];
  const [pick, setPick] = useState(choices[0]?.value ?? "rec");
  const [svc] = useService();
  const cfg = (choices.find((c) => c.value === pick) ?? choices[0])?.cfg;
  if (!cfg) return null;
  return (
    <div className="stack-sm">
      {choices.length > 1 && (
        <Segmented
          name="as-stage"
          label="Cluster to show"
          value={pick}
          options={choices.map((c) => ({ value: c.value, label: `${c.label}: ${c.cfg.nodes} × ${c.cfg.machine.name}` }))}
          onChange={setPick}
        />
      )}
      <ReplayOrLive
        startTps={res.peakTps}
        startSpec={{ ...svc.targetSpec, nodes: cfg.nodes, vcpu: cfg.machine.vcpu, ramGb: cfg.machine.ramGb }}
        replay={
          <TwinStage
            key={pick}
            title={`${cfg.nodes} × ${cfg.machine.name} at ${num(res.peakTps)} req/s`}
            nodes={cfg.nodes}
            frames={[
              {
                t: 0,
                tps: res.peakTps,
                cpu: cfg.peak.cpuPct,
                thread: cfg.peak.threadPct,
                p95: cfg.peak.p95Ms,
                err: cfg.peak.errorRatePct,
              },
            ]}
            maxTps={res.peakTps}
            slaP95={slaP95}
            slaCpu={slaCpu}
            caption="Node fill is the CPU this cluster reaches at peak in the simulation."
          />
        }
      />
    </div>
  );
}

/** Sensitivity: flip one input between its low, current and high value and watch the cluster respond. */
export function SensitivityStage({ res, nodes, slaP95 }: { res: SensitivityResult; nodes: number; slaP95: number }) {
  const [param, setParam] = useState(res.params[0]?.param ?? "");
  const [side, setSide] = useState<"low" | "base" | "high">("low");
  const p = res.params.find((x) => x.param === param) ?? res.params[0];
  if (!p) return null;
  const run = side === "base" ? { value: p.base, ...res.baseline } : { ...p[side] };
  const n = p.param === "nodes" ? Math.round(run.value) : nodes;
  const step = Math.round(res.step * 100);
  return (
    <div className="card stack-sm">
      <div className="spread">
        <label className="label" htmlFor="sens-param">
          Watch one input change
        </label>
        <select id="sens-param" className="stage-speed" value={p.param} onChange={(e) => setParam(e.target.value)}>
          {res.params.map((x) => (
            <option key={x.param} value={x.param}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      <Segmented
        name="sens-side"
        label="Value"
        value={side}
        onChange={setSide}
        options={[
          { value: "low", label: `−${step}%: ${num(p.low.value, 1)}` },
          { value: "base", label: `Now: ${num(p.base, 1)}` },
          { value: "high", label: `+${step}%: ${num(p.high.value, 1)}` },
        ]}
      />
      <TwinStage
        title={`${p.label}: ${num(run.value, 1)}${p.unit ? ` ${p.unit}` : ""}`}
        nodes={n}
        frames={[{ t: 0, tps: res.peakTps, cpu: run.cpuPct, p95: run.p95Ms, err: run.errorRatePct }]}
        maxTps={res.peakTps}
        slaP95={slaP95}
        caption="Switch between the values to see CPU and latency move. Numbers are from the simulation of each variant."
      />
    </div>
  );
}
