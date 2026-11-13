import type { StageBand, StageFrame } from "@/components/twin-stage";
import type { EvaluateResult, FaultResult, PatternResult, Service, ValidateResult } from "./types";

/** Peak run of an evaluation, second by second. */
export function evaluateFrames(res: EvaluateResult, sla: Service["sla"]): StageFrame[] {
  const peak = res.scenarios.find((s) => s.kind === "peak");
  const ts = (peak?.timeseries ?? []).filter((b) => b.t >= 0);
  if (!ts.length && peak)
    return [{ t: 0, tps: peak.tps, cpu: peak.summary.cpuPct, thread: peak.summary.threadPct, p95: peak.summary.p95Ms, err: peak.summary.errorRatePct }];
  return ts.map((b) => ({
    t: b.t,
    tps: b.tps,
    cpu: b.cpu,
    thread: b.thread,
    p95: b.p95,
    err: b.errorPct,
    breach: (b.p95 ?? 0) > sla.maxP95Ms || b.errorPct > sla.maxErrorRatePct || b.cpu > sla.maxCpuPct,
  }));
}

export function patternFrames(res: PatternResult): StageFrame[] {
  return res.windows.map((w) => ({
    t: w.t,
    tps: w.offeredTps,
    cpu: w.cpuPct,
    thread: w.threadPct,
    p95: w.p95Ms,
    err: w.errorRatePct,
    breach: w.breach,
  }));
}

export function breachBands(frames: StageFrame[], width: number): StageBand[] {
  const out: StageBand[] = [];
  for (const f of frames) {
    if (!f.breach) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x1 - (f.t - width)) < 1e-6) last.x1 = f.t;
    else out.push({ x0: f.t - width, x1: f.t, kind: "breach" });
  }
  return out;
}

export function faultFrames(res: FaultResult): StageFrame[] {
  const f = res.failure;
  return res.timeline.map((w) => {
    const on = w.t > f.startS && w.t - 10 < f.endS;
    return {
      t: w.t,
      tps: f.tps,
      cpu: w.cpuPct,
      thread: w.threadPct,
      p95: w.p95Ms,
      err: w.errorRatePct,
      down: on ? f.nodesDown : 0,
      dbSlow: on ? f.dbSlowdown : 1,
      extFail: on ? f.extFailShare : 0,
      breach: w.breach,
      label: on ? "Failure active" : w.t <= f.startS ? "Healthy" : "Recovering",
    };
  });
}

/** Each measured load level held for a while, with the model's prediction. */
export function validateFrames(res: ValidateResult): StageFrame[] {
  const pts = [...res.points].sort((a, b) => a.tps - b.tps);
  const frames: StageFrame[] = pts.map((p, i) => ({
    t: i * 10,
    tps: p.tps,
    cpu: p.predictedCpuPct,
    p95: p.predictedP95Ms,
    err: p.predictedErrorRatePct,
    label: `${p.calibration ? "Calibration" : "Check"}: measured ${Math.round(p.p95Ms)} ms`,
  }));
  // Hold the last level as long as the others before looping.
  if (frames.length) frames.push({ ...frames[frames.length - 1], t: frames.length * 10 });
  return frames;
}
