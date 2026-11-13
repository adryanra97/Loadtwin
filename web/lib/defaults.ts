import type { MachineType, PatternIn, Service } from "./types";

export const EXAMPLE_SERVICE: Service = {
  name: "Example checkout API",
  measuredSpec: { vcpu: 4, ramGb: 8, nodes: 2, threadPool: 100, connPool: 30, timeoutMs: 3000, bandwidthMbps: 1000 },
  measurement: { tps: 40, cpuPct: 62, p95Ms: 420, memPct: 58, payloadKb: 4, errorRatePct: 0.1 },
  targetSpec: { vcpu: 4, ramGb: 8, nodes: 3, threadPool: 120, connPool: 30, timeoutMs: 2000, bandwidthMbps: 1000 },
  sla: { maxP95Ms: 800, maxErrorRatePct: 1, maxCpuPct: 80, maxMemPct: 85 },
  database: { waitShare: 0.6, maxConcurrentQueries: 60 },
};

/** Illustrative on-demand prices. They are not any provider's list prices. */
export const DEFAULT_CATALOG: MachineType[] = [
  { name: "general-2", vcpu: 2, ramGb: 8, hourlyUsd: 0.096 },
  { name: "general-4", vcpu: 4, ramGb: 16, hourlyUsd: 0.192 },
  { name: "general-8", vcpu: 8, ramGb: 32, hourlyUsd: 0.384 },
  { name: "general-16", vcpu: 16, ramGb: 64, hourlyUsd: 0.768 },
  { name: "compute-4", vcpu: 4, ramGb: 8, hourlyUsd: 0.17 },
  { name: "compute-8", vcpu: 8, ramGb: 16, hourlyUsd: 0.34 },
];

export const DEFAULT_PATTERN: PatternIn = {
  kind: "spike",
  peakTps: 120,
  baseTps: 30,
  secondsPerHour: 20,
  spikeS: 30,
  durationS: 300,
  segments: [
    { durationS: 60, tps: 20 },
    { durationS: 60, tps: 60 },
    { durationS: 60, tps: 20 },
  ],
};

/** Share of the daily peak per hour, mirrored from the engine so the preview matches the run. */
export const DAILY_SHAPE = [
  0.18, 0.12, 0.1, 0.1, 0.12, 0.18, 0.3, 0.5, 0.72, 0.85, 0.92, 0.97, 1.0, 0.95, 0.88, 0.85, 0.86, 0.9, 0.94, 1.0, 0.92,
  0.7, 0.45, 0.28,
];

export const LIMITS = { maxPatternS: 1200, maxPatternRequests: 150000, replicationWork: 6000, autosizeWork: 3000 };

/** Mirror of the engine's ``to_segments``: what the pattern will offer, second by second. */
export function patternSegments(p: PatternIn): { durationS: number; tps: number }[] {
  switch (p.kind) {
    case "daily":
      return DAILY_SHAPE.map((s) => ({ durationS: p.secondsPerHour, tps: Math.max(p.baseTps, p.peakTps * s) }));
    case "spike":
      return [
        { durationS: 60, tps: p.baseTps },
        { durationS: p.spikeS, tps: p.peakTps },
        { durationS: 90, tps: p.baseTps },
      ];
    case "ramp":
      return Array.from({ length: 10 }, (_, i) => ({
        durationS: p.durationS / 10,
        tps: p.baseTps + ((p.peakTps - p.baseTps) * (i + 0.5)) / 10,
      }));
    default:
      return p.segments;
  }
}
