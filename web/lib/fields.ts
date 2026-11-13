/** Field definitions mirror the API's bounds so most mistakes are caught before a request is sent. */
export type FieldDef = {
  label: string;
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  /** ``min`` is exclusive (value must be greater). */
  gt?: boolean;
  int?: boolean;
  step?: number;
  advanced?: boolean;
  /** Display multiplier: the stored value is shown as ``value * scale``. */
  scale?: number;
};

export const SPEC_FIELDS: Record<string, FieldDef> = {
  nodes: { label: "Nodes", hint: "Instances behind the load balancer.", min: 1, max: 50, int: true },
  vcpu: { label: "vCPU per node", min: 1, max: 128, int: true },
  ramGb: { label: "RAM per node", unit: "GB", min: 0, gt: true, max: 1024, step: 0.5 },
  threadPool: {
    label: "Worker threads per node",
    hint: "Requests one node can process at once, e.g. the server's max threads.",
    min: 1,
    max: 2000,
    int: true,
  },
  connPool: { label: "DB connections per node", hint: "Size of the database connection pool.", min: 1, max: 1000, int: true },
  timeoutMs: { label: "Request timeout", unit: "ms", min: 50, max: 120000, int: true, advanced: true },
  bandwidthMbps: { label: "Network per node", unit: "Mbps", min: 0, gt: true, max: 100000, advanced: true },
};

export const MEASUREMENT_FIELDS: Record<string, FieldDef> = {
  tps: { label: "Load during the test", unit: "req/s", min: 0, gt: true, max: 1000, hint: "Average requests per second while measuring." },
  cpuPct: { label: "Average CPU", unit: "%", min: 0, gt: true, max: 100 },
  p95Ms: { label: "p95 response time", unit: "ms", min: 0, gt: true, max: 60000, hint: "95% of requests were faster than this." },
  memPct: { label: "Memory used", unit: "%", min: 0, gt: true, max: 100 },
  errorRatePct: { label: "Error rate", unit: "%", min: 0, max: 100, step: 0.1 },
  payloadKb: { label: "Mean payload", unit: "KB", min: 0, max: 10240, advanced: true, hint: "Request plus response size." },
};

export const SLA_FIELDS: Record<string, FieldDef> = {
  maxP95Ms: { label: "Max p95 response time", unit: "ms", min: 0, gt: true, max: 120000 },
  maxErrorRatePct: { label: "Max error rate", unit: "%", min: 0, gt: true, max: 100, step: 0.1 },
  maxCpuPct: { label: "Max CPU", unit: "%", min: 0, gt: true, max: 100 },
  maxMemPct: { label: "Max memory", unit: "%", min: 0, gt: true, max: 100 },
};

export const DATABASE_FIELDS: Record<string, FieldDef> = {
  waitShare: {
    label: "Time waiting on the database",
    unit: "%",
    min: 0,
    max: 100,
    scale: 100,
    hint: "Share of non-CPU waiting spent in the database; the rest is external calls.",
  },
  maxConcurrentQueries: {
    label: "Shared database capacity",
    unit: "queries",
    min: 0,
    max: 100000,
    int: true,
    hint: "Concurrent queries the database handles for all nodes together. 0 = no limit.",
  },
};

/** Returns an error message, or ``""`` when the value is valid. */
export function check(def: FieldDef, value: unknown): string {
  if (value === "" || value === null || value === undefined || Number.isNaN(value)) return "Required";
  const v = Number(value);
  if (!Number.isFinite(v)) return "Enter a number";
  if (def.int && !Number.isInteger(v)) return "Enter a whole number";
  if (def.min !== undefined && (def.gt ? v <= def.min : v < def.min))
    return def.gt ? `Must be more than ${def.min}` : `Must be at least ${def.min}`;
  if (def.max !== undefined && v > def.max) return `Must be at most ${def.max.toLocaleString("en-US")}`;
  return "";
}

/** Validate every field of ``obj`` against ``defs``; keys are prefixed with ``prefix``. */
export function checkAll(prefix: string, defs: Record<string, FieldDef>, obj: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, d] of Object.entries(defs)) {
    const raw = obj[k];
    const e = check(d, typeof raw === "number" && d.scale ? raw * d.scale : raw);
    if (e) out[`${prefix}.${k}`] = e;
  }
  return out;
}
