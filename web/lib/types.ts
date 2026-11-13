export type Spec = {
  vcpu: number;
  ramGb: number;
  nodes: number;
  threadPool: number;
  connPool: number;
  timeoutMs: number;
  bandwidthMbps: number;
};

export type Measurement = {
  tps: number;
  cpuPct: number;
  p95Ms: number;
  memPct: number;
  payloadKb: number;
  errorRatePct: number;
};

export type SLA = { maxP95Ms: number; maxErrorRatePct: number; maxCpuPct: number; maxMemPct: number };
export type Database = { waitShare: number; maxConcurrentQueries: number };

/** Everything the tools share: where it was measured, what was seen, where it will run, and the SLA. */
export type Service = {
  name: string;
  measuredSpec: Spec;
  measurement: Measurement;
  targetSpec: Spec;
  sla: SLA;
  database: Database;
};

export type Verdict = "PASS" | "PASS_WITH_CONDITIONS" | "FAIL" | "NOT_ASSESSABLE";

export type Summary = {
  tps: number;
  throughputTps: number;
  cpuPct: number;
  memPct: number;
  threadPct: number;
  connPct: number;
  dbPct: number;
  netPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  timeoutPct: number;
  requests: number;
};

export type Bucket = {
  t: number;
  cpu: number;
  mem: number;
  thread: number;
  conn: number;
  p95: number | null;
  tps: number;
  throughput: number;
  errorPct: number;
};

export type Scenario = {
  name: string;
  kind: string;
  tps: number;
  status: Verdict | "NOT_ASSESSED";
  violations: string[];
  summary: Summary;
  latencyBreakdownMs: Record<string, number>;
  timeseries?: Bucket[];
};

export type Stats = { min: number; p5: number; p50: number; mean: number; p95: number; max: number };

export type MonteCarlo = {
  runs: number;
  tps: number;
  breachProbability: number;
  breachesBy: Record<string, number>;
  distribution: { p95Ms: Stats; errorRatePct: Stats; cpuPct: Stats };
  samples: { p95Ms: number[]; errorRatePct: number[]; cpuPct: number[] };
};

export type Calibration = {
  referenceTps: number;
  referenceP95Ms: number;
  simulatedP95Ms: number;
  errorPct: number;
  cpuMsPerRequest: number;
  backgroundCpuPct: number;
  databaseWaitMs: number;
  externalWaitMs: number;
  uslFactor?: number;
  targetCpuMsPerRequest?: number;
  scaleRatio?: number;
};

export type EvaluateResult = {
  verdict: Verdict;
  reasons: string[];
  conditions: string[];
  limitingResource: string;
  calibration: Calibration;
  scenarios: Scenario[];
  capacity: {
    maxTps: number;
    limitingResource: string;
    perResource: { resource: string; maxTps: number; formula: string }[];
  } | null;
  breakingPointTps: number | null;
  monteCarlo: MonteCarlo | null;
  durationS: number;
};

export type MachineType = { name: string; vcpu: number; ramGb: number; hourlyUsd: number };

export type SizedConfig = {
  nodes: number;
  monthlyUsd: number;
  totalVcpu: number;
  peak: { cpuPct: number; memPct: number; threadPct: number; p95Ms: number; errorRatePct: number };
  topResource: string;
  topUtilizationPct: number;
  violations: string[];
};

export type AutosizeResult = {
  peakTps: number;
  options: {
    machine: MachineType;
    fits: boolean;
    minimal: SizedConfig;
    comfortable: SizedConfig | null;
    simulations: number;
  }[];
  recommended: (SizedConfig & { machine: MachineType; config: "minimal" | "comfortable" }) | null;
  cheapest: (SizedConfig & { machine: MachineType; config: "minimal" }) | null;
  databaseLimitTps: number | null;
  hoursPerMonth?: number;
  notes: string[];
  calibration: Calibration;
  durationS: number;
};

export type PatternKind = "daily" | "spike" | "ramp" | "custom";

export type PatternIn = {
  kind: PatternKind;
  peakTps: number;
  baseTps: number;
  secondsPerHour: number;
  spikeS: number;
  durationS: number;
  segments: { durationS: number; tps: number }[];
};

export type PatternWindow = {
  t: number;
  offeredTps: number;
  throughputTps: number;
  cpuPct: number;
  threadPct: number;
  p95Ms: number | null;
  errorRatePct: number;
  breach: boolean;
};

export type PatternResult = {
  verdict: Verdict;
  reasons: string[];
  segments: { durationS: number; tps: number }[];
  windows: PatternWindow[];
  breachSeconds: number;
  breachShare: number;
  worstWindow: PatternWindow;
  recoverySeconds: number | null;
  durationS: number;
};

export type LoadPoint = {
  tps: number;
  p95Ms: number;
  errorRatePct: number;
  cpuPct: number | null;
  memPct: number | null;
  durationS: number | null;
};

export type ValidateResult = {
  calibrationIndex: number;
  calibration: Calibration;
  points: (LoadPoint & {
    predictedP95Ms: number;
    predictedCpuPct: number;
    predictedErrorRatePct: number;
    p95ErrorPct: number;
    calibration: boolean;
  })[];
  meanAbsErrorPct: number | null;
  grade: "good" | "fair" | "poor" | "untested";
  validRangeTps: [number, number] | null;
  reasons: string[];
  durationS: number;
};

export type FaultIn = {
  nodesDown: number;
  dbSlowdown: number;
  extFailShare: number;
  extTimeoutMs: number;
  extSlowdown: number;
  durationS: number;
};

export type Phase = { requests: number; p95Ms: number | null; errorRatePct: number };

export type FaultWindow = {
  t: number;
  p95Ms: number | null;
  errorRatePct: number;
  cpuPct: number;
  threadPct: number;
  throughputTps: number;
  breach: boolean;
  fault: boolean;
  healthy: { p95Ms: number | null; errorRatePct: number; cpuPct: number };
};

export type FaultResult = {
  verdict: Verdict;
  reasons: string[];
  failure: { description: string; startS: number; endS: number; tps: number };
  phases: { before: Phase; during: Phase; after: Phase; healthyDuring: Phase };
  recoverySeconds: number | null;
  timeline: FaultWindow[];
  durationS: number;
};

export type SensRun = { value: number; p95Ms: number; errorRatePct: number; cpuPct: number; meetsSla: boolean };
export type SensitivityResult = {
  peakTps: number;
  step: number;
  baseline: { p95Ms: number; errorRatePct: number; cpuPct: number; meetsSla: boolean };
  params: {
    param: string;
    label: string;
    unit: string;
    base: number;
    low: SensRun;
    high: SensRun;
    swingMs: number;
    better: "low" | "high";
    gainMs: number;
  }[];
  advice: string[];
  durationS: number;
};

export type AssistantResult = {
  planSource: "llm" | "rules";
  tool: "evaluate" | "fault" | "pattern" | "sensitivity";
  restated: string;
  changes: string[];
  peakTps: number;
  targetSpec: Spec;
  result: EvaluateResult | FaultResult | PatternResult | SensitivityResult;
  facts: Record<string, unknown>;
  explanation: string;
  explanationSource: "llm" | "template";
  notes: string[];
  durationS: number;
};

export type SavedScenario = {
  id: string;
  name: string;
  savedAt: string;
  service: Service;
  load: { normalTps: number; peakTps: number; stressMultipliers: number[] };
  replications: number;
  result: EvaluateResult;
};
