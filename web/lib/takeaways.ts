/**
 * Chart and section titles that state the takeaway, computed from the data they sit on
 * ("p95 stays under 450 ms, well within the 800 ms limit"), so a reader who only scans the
 * titles still gets the story.
 */
import { num, pct, resourceName } from "./format";
import type { EvaluateResult, FaultResult, PatternResult, SensitivityResult, ValidateResult } from "./types";

const span = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];

export function mcTitle(mc: NonNullable<EvaluateResult["monteCarlo"]>) {
  const n = Math.round(mc.breachProbability * mc.runs);
  if (n === 0) return `The SLA holds in all ${mc.runs} runs, not just the lucky one`;
  if (n === mc.runs) return `The SLA breaks in every one of ${mc.runs} runs`;
  return `The SLA breaks in ${n} of ${mc.runs} runs: ${pct(mc.breachProbability * 100)} odds at peak`;
}

export function scenariosTitle(res: EvaluateResult) {
  const pass = res.scenarios.filter((s) => s.status === "PASS");
  const fail = res.scenarios.filter((s) => s.status === "FAIL");
  if (!fail.length) return `Passes every scenario, up to ${num(Math.max(...res.scenarios.map((s) => s.tps)), 1)} req/s`;
  if (!pass.length) return `Fails from the lightest scenario, ${num(Math.min(...fail.map((s) => s.tps)), 1)} req/s`;
  return `Passes up to ${num(Math.max(...pass.map((s) => s.tps)), 1)} req/s, fails from ${num(Math.min(...fail.map((s) => s.tps)), 1)} req/s`;
}

export function p95Title(values: (number | null)[], limit: number) {
  const xs = values.filter((v): v is number => v !== null);
  if (!xs.length) return "No requests finished in this run";
  const [lo, hi] = span(xs);
  const over = xs.filter((v) => v > limit).length;
  if (!over) return `p95 stays between ${num(lo)} and ${num(hi)} ms, under the ${num(limit)} ms limit`;
  return `p95 goes over the ${num(limit)} ms limit in ${over} of ${xs.length} intervals, up to ${num(hi)} ms`;
}

export function cpuTitle(values: number[], limit: number) {
  if (!values.length) return "No CPU readings";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const hi = Math.max(...values);
  if (hi <= limit) return `CPU averages ${pct(avg)} and peaks at ${pct(hi)}, below the ${pct(limit)} limit`;
  return `CPU averages ${pct(avg)} and reaches ${pct(hi)}, past the ${pct(limit)} limit`;
}

export function capacityTitle(res: EvaluateResult, peak: number) {
  const c = res.capacity;
  if (!c) return "Capacity could not be estimated";
  return `${resourceName(c.limitingResource)} runs out first, at ${num(c.maxTps, 1)} req/s (${num(c.maxTps / Math.max(peak, 0.1), 1)}x the peak)`;
}

export function faultP95Title(res: FaultResult, limit: number) {
  const d = res.phases.during.p95Ms ?? 0;
  const h = res.phases.healthyDuring.p95Ms ?? 0;
  const x = h ? d / h : 0;
  if (d <= limit) return `During the failure p95 rises to ${num(d)} ms (${num(x, 1)}x healthy), still under ${num(limit)} ms`;
  return `During the failure p95 jumps to ${num(d)} ms, ${num(x, 1)}x healthy and over the ${num(limit)} ms limit`;
}

export function faultErrorTitle(res: FaultResult, limit: number) {
  const d = res.phases.during.errorRatePct;
  if (d <= limit) return `Errors stay at ${pct(d, 2)} during the failure, within the ${pct(limit, 1)} limit`;
  return `Errors climb to ${pct(d, 1)} during the failure, against a ${pct(limit, 1)} limit`;
}

export function patternLoadTitle(res: PatternResult) {
  const short = res.windows.filter((w) => w.throughputTps < w.offeredTps * 0.95);
  if (!short.length) return "Every request offered is served, all the way through";
  return `Served load falls behind what is offered in ${short.length} of ${res.windows.length} windows`;
}

export function sensitivityTitle(res: SensitivityResult) {
  const top = res.params[0];
  if (!top) return "Nothing was varied";
  return `${top.label} is the biggest lever: p95 swings ${num(top.swingMs)} ms between its low and high value`;
}

export function validateChartTitle(res: ValidateResult) {
  const others = res.points.filter((p) => !p.calibration);
  if (!others.length) return "Only the calibration point: nothing to compare yet";
  const worst = others.reduce((a, b) => (b.p95ErrorPct > a.p95ErrorPct ? b : a));
  return `Predictions track the measurements; the widest gap is ${pct(worst.p95ErrorPct, 1)} at ${num(worst.tps, 1)} req/s`;
}
