"""Request schemas of the HTTP API (camelCase JSON) and their conversion to engine objects.

Upper bounds keep a single request within a few seconds of compute, which matters when the API is
deployed publicly (for example on Vercel).

Attributes
----------
MAX_TPS : float
    Highest arrival rate accepted for any simulated scenario.
MAX_MEASURED_TPS : float
    Highest load accepted for the calibration measurement.
MAX_REPLICATION_WORK : float
    Upper bound of Monte Carlo replications x peak TPS for one request.
MAX_AUTOSIZE_WORK : float
    Upper bound of machine types x peak TPS for one auto-sizing request.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from loadtwin.autosize import DEFAULT_CATALOG, MachineType, Pools
from loadtwin.calibration import Database, Measurement
from loadtwin.engine import Spec
from loadtwin.evaluate import Load
from loadtwin.loadtest import Point
from loadtwin.sla import SLA
from loadtwin.traffic import Pattern, to_segments

MAX_TPS = 2000.0
MAX_MEASURED_TPS = 1000.0
MAX_REPLICATION_WORK = 6000.0
MAX_AUTOSIZE_WORK = 3000.0


class _Model(BaseModel):
    """Base model that rejects unknown fields so typos surface as validation errors."""

    model_config = ConfigDict(extra="forbid")


class SpecIn(_Model):
    """Resources of one node and the cluster size."""

    vcpu: Annotated[int, Field(ge=1, le=128, description="vCPUs per node.")]
    ramGb: Annotated[float, Field(gt=0, le=1024, description="RAM per node in GB.")]
    nodes: Annotated[int, Field(ge=1, le=50, description="Nodes behind the load balancer.")]
    threadPool: Annotated[int, Field(ge=1, le=2000, description="Worker threads per node.")]
    connPool: Annotated[int, Field(ge=1, le=1000, description="Database connections per node.")]
    bandwidthMbps: Annotated[float, Field(gt=0, le=100000, description="Network bandwidth per node in Mbps.")] = 1000
    timeoutMs: Annotated[int, Field(ge=50, le=120000, description="Request timeout in ms.")] = 3000

    def to_spec(self) -> Spec:
        """Engine ``Spec``."""
        return Spec(self.vcpu, self.ramGb, self.nodes, self.threadPool, self.connPool, self.bandwidthMbps, self.timeoutMs)


class MeasurementIn(_Model):
    """What a load test observed on ``measuredSpec``."""

    tps: Annotated[float, Field(gt=0, le=MAX_MEASURED_TPS, description="Load during the test (requests/s).")]
    cpuPct: Annotated[float, Field(gt=0, le=100, description="Average CPU utilization (%).")]
    p95Ms: Annotated[float, Field(gt=0, le=60000, description="95th percentile response time (ms).")]
    memPct: Annotated[float, Field(gt=0, le=100, description="Memory utilization (%).")] = 55
    payloadKb: Annotated[float, Field(ge=0, le=10240, description="Mean payload size (KB).")] = 6
    errorRatePct: Annotated[float, Field(ge=0, le=100, description="Error rate (%).")] = 0.1

    def to_measurement(self) -> Measurement:
        """Engine ``Measurement``."""
        return Measurement(self.tps, self.cpuPct, self.p95Ms, self.memPct, self.payloadKb, self.errorRatePct)


class LoadIn(_Model):
    """Loads to evaluate on the target."""

    normalTps: Annotated[float, Field(gt=0, le=MAX_TPS, description="Typical load (requests/s).")]
    peakTps: Annotated[float, Field(gt=0, le=MAX_TPS, description="Peak load; the verdict is decided here.")]
    stressMultipliers: Annotated[
        list[Annotated[float, Field(gt=1, le=10)]],
        Field(max_length=4, description="Extra scenarios at peak x multiplier, reported but not part of the verdict."),
    ] = [1.5, 2.0]

    @model_validator(mode="after")
    def _bounded(self) -> LoadIn:
        """Keep stress scenarios within ``MAX_TPS``."""
        if any(self.peakTps * m > MAX_TPS for m in self.stressMultipliers):
            raise ValueError(f"peakTps x stressMultipliers must stay at or below {MAX_TPS:g} TPS")
        return self

    def to_load(self) -> Load:
        """Engine ``Load``."""
        return Load(self.normalTps, self.peakTps, list(self.stressMultipliers))


class SLAIn(_Model):
    """Acceptance criteria."""

    maxP95Ms: Annotated[float, Field(gt=0)] = 800
    maxErrorRatePct: Annotated[float, Field(ge=0, le=100)] = 1
    maxCpuPct: Annotated[float, Field(gt=0, le=100)] = 80
    maxMemPct: Annotated[float, Field(gt=0, le=100)] = 85

    def to_sla(self) -> SLA:
        """Engine ``SLA``."""
        return SLA(self.maxP95Ms, self.maxErrorRatePct, self.maxCpuPct, self.maxMemPct)


class DatabaseIn(_Model):
    """Database behaviour."""

    waitShare: Annotated[float, Field(ge=0, le=1, description="Share of non-CPU wait spent in the database.")] = 0.6
    maxConcurrentQueries: Annotated[int, Field(ge=0, le=100000, description="Shared database capacity; 0 = unlimited.")] = 0

    def to_database(self) -> Database:
        """Engine ``Database``."""
        return Database(self.waitShare, self.maxConcurrentQueries)


EXAMPLE_EVALUATE = {
    "measuredSpec": {"vcpu": 4, "ramGb": 8, "nodes": 2, "threadPool": 100, "connPool": 30, "timeoutMs": 3000},
    "measurement": {"tps": 40, "cpuPct": 62, "p95Ms": 420, "memPct": 58, "payloadKb": 4, "errorRatePct": 0.1},
    "targetSpec": {"vcpu": 4, "ramGb": 8, "nodes": 3, "threadPool": 120, "connPool": 30, "timeoutMs": 2000},
    "load": {"normalTps": 8, "peakTps": 45, "stressMultipliers": [1.5, 2]},
    "sla": {"maxP95Ms": 800, "maxErrorRatePct": 1, "maxCpuPct": 80, "maxMemPct": 85},
    "database": {"waitShare": 0.6, "maxConcurrentQueries": 60},
}

EXAMPLE_SIMULATE = {
    "measuredSpec": EXAMPLE_EVALUATE["measuredSpec"],
    "measurement": EXAMPLE_EVALUATE["measurement"],
    "targetSpec": EXAMPLE_EVALUATE["targetSpec"],
    "loadsTps": [8, 45, 75, 90],
    "database": EXAMPLE_EVALUATE["database"],
}


class EvaluateRequest(_Model):
    """Input of ``POST /api/v1/evaluate``."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXAMPLE_EVALUATE]})

    measuredSpec: SpecIn
    measurement: MeasurementIn
    targetSpec: SpecIn
    load: LoadIn
    sla: SLAIn = SLAIn()
    database: DatabaseIn = DatabaseIn()
    seed: Annotated[int | None, Field(ge=0, description="Random seed; derived from the input when omitted.")] = None
    includeTimeseries: bool = False
    replications: Annotated[
        int, Field(ge=0, le=50, description="Monte Carlo runs of the peak scenario (0 = off, 2 or more = on).")
    ] = 0

    @model_validator(mode="after")
    def _replication_budget(self) -> EvaluateRequest:
        """Keep Monte Carlo work within ``MAX_REPLICATION_WORK``."""
        if self.replications * self.load.peakTps > MAX_REPLICATION_WORK:
            raise ValueError(f"replications x peakTps must stay at or below {MAX_REPLICATION_WORK:g}")
        return self


class SimulateRequest(_Model):
    """Input of ``POST /api/v1/simulate``."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXAMPLE_SIMULATE]})

    measuredSpec: SpecIn
    measurement: MeasurementIn
    targetSpec: SpecIn
    loadsTps: Annotated[
        list[Annotated[float, Field(gt=0, le=MAX_TPS)]], Field(min_length=1, max_length=10, description="Loads to simulate.")
    ]
    database: DatabaseIn = DatabaseIn()
    cpuLimitPct: Annotated[float, Field(gt=0, le=100, description="CPU limit used for capacity.")] = 80
    seed: Annotated[int, Field(ge=0)] = 1
    includeTimeseries: bool = False


class MachineTypeIn(_Model):
    """A purchasable node size and its price."""

    name: Annotated[str, Field(min_length=1, max_length=40)]
    vcpu: Annotated[int, Field(ge=1, le=128)]
    ramGb: Annotated[float, Field(gt=0, le=1024)]
    hourlyUsd: Annotated[float, Field(gt=0, le=100, description="On-demand price per node-hour (USD).")]


class PoolsIn(_Model):
    """Pool sizing applied to every candidate cluster."""

    threadsPerVcpu: Annotated[float, Field(gt=0, le=500)] = 25
    connPool: Annotated[int, Field(ge=1, le=1000)] = 30
    timeoutMs: Annotated[int, Field(ge=50, le=120000)] = 3000
    bandwidthMbps: Annotated[float, Field(gt=0, le=100000)] = 1000


EXAMPLE_AUTOSIZE = {
    "measuredSpec": EXAMPLE_EVALUATE["measuredSpec"],
    "measurement": EXAMPLE_EVALUATE["measurement"],
    "peakTps": 150,
    "sla": EXAMPLE_EVALUATE["sla"],
    "database": {"waitShare": 0.6, "maxConcurrentQueries": 0},
    "catalog": [{"name": m.name, "vcpu": m.vcpu, "ramGb": m.ram_gb, "hourlyUsd": m.hourly_usd} for m in DEFAULT_CATALOG],
    "pools": {"threadsPerVcpu": 25, "connPool": 30, "timeoutMs": 2000},
    "minNodes": 2,
    "maxNodes": 30,
}


class AutosizeRequest(_Model):
    """Input of ``POST /api/v1/autosize``."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXAMPLE_AUTOSIZE]})

    measuredSpec: SpecIn
    measurement: MeasurementIn
    peakTps: Annotated[float, Field(gt=0, le=MAX_TPS)]
    sla: SLAIn = SLAIn()
    database: DatabaseIn = DatabaseIn()
    catalog: Annotated[list[MachineTypeIn], Field(min_length=1, max_length=12)] = [
        MachineTypeIn(name=m.name, vcpu=m.vcpu, ramGb=m.ram_gb, hourlyUsd=m.hourly_usd) for m in DEFAULT_CATALOG
    ]
    pools: PoolsIn = PoolsIn()
    minNodes: Annotated[int, Field(ge=1, le=50)] = 2
    maxNodes: Annotated[int, Field(ge=1, le=50)] = 30
    seed: Annotated[int | None, Field(ge=0)] = None

    @model_validator(mode="after")
    def _nodes(self) -> AutosizeRequest:
        """Require ``minNodes <= maxNodes``."""
        if self.minNodes > self.maxNodes:
            raise ValueError("minNodes must not exceed maxNodes")
        if len(self.catalog) * self.peakTps > MAX_AUTOSIZE_WORK:
            raise ValueError(f"machine types x peakTps must stay at or below {MAX_AUTOSIZE_WORK:g}; remove machine types")
        return self

    def machine_types(self) -> list[MachineType]:
        """Engine catalog."""
        return [MachineType(m.name, m.vcpu, m.ramGb, m.hourlyUsd) for m in self.catalog]

    def to_pools(self) -> Pools:
        """Engine ``Pools``."""
        p = self.pools
        return Pools(p.threadsPerVcpu, p.connPool, p.timeoutMs, p.bandwidthMbps)


class SegmentIn(_Model):
    """One constant-rate stretch of a custom pattern."""

    durationS: Annotated[float, Field(gt=0, le=1200)]
    tps: Annotated[float, Field(ge=0, le=MAX_TPS)]


class PatternIn(_Model):
    """Load pattern."""

    kind: Literal["daily", "spike", "ramp", "custom"]
    peakTps: Annotated[float, Field(ge=0, le=MAX_TPS, description="Daily/spike peak, or ramp end.")] = 0
    baseTps: Annotated[float, Field(ge=0, le=MAX_TPS, description="Spike baseline, ramp start, or daily floor.")] = 0
    secondsPerHour: Annotated[float, Field(ge=5, le=60, description="Daily: simulated seconds per hour.")] = 20
    spikeS: Annotated[float, Field(ge=5, le=300, description="Spike length in seconds.")] = 30
    durationS: Annotated[float, Field(ge=30, le=1200, description="Ramp length in seconds.")] = 300
    segments: Annotated[list[SegmentIn], Field(max_length=48)] = []

    def to_pattern(self) -> Pattern:
        """Engine ``Pattern``."""
        return Pattern(
            self.kind,
            self.peakTps,
            self.baseTps,
            self.secondsPerHour,
            self.spikeS,
            self.durationS,
            [(x.durationS, x.tps) for x in self.segments] or None,
        )

    @model_validator(mode="after")
    def _bounded(self) -> PatternIn:
        """Reject patterns that are empty or too long to simulate quickly."""
        to_segments(self.to_pattern())
        return self


EXAMPLE_PATTERN = {
    "measuredSpec": EXAMPLE_EVALUATE["measuredSpec"],
    "measurement": EXAMPLE_EVALUATE["measurement"],
    "targetSpec": EXAMPLE_EVALUATE["targetSpec"],
    "pattern": {"kind": "spike", "baseTps": 30, "peakTps": 120, "spikeS": 30},
    "sla": EXAMPLE_EVALUATE["sla"],
}


class PatternRequest(_Model):
    """Input of ``POST /api/v1/pattern``."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXAMPLE_PATTERN]})

    measuredSpec: SpecIn
    measurement: MeasurementIn
    targetSpec: SpecIn
    pattern: PatternIn
    sla: SLAIn = SLAIn()
    database: DatabaseIn = DatabaseIn()
    seed: Annotated[int | None, Field(ge=0)] = None


class LoadtestFileIn(_Model):
    """Input of ``POST /api/v1/loadtest/parse``."""

    format: Literal["auto", "k6", "jmeter", "locust"] = "auto"
    content: Annotated[str, Field(min_length=2, max_length=4_000_000, description="File text (up to about 4 MB).")]


class PointIn(_Model):
    """One measured load level."""

    tps: Annotated[float, Field(gt=0, le=MAX_MEASURED_TPS)]
    p95Ms: Annotated[float, Field(gt=0, le=60000)]
    errorRatePct: Annotated[float, Field(ge=0, le=100)] = 0
    cpuPct: Annotated[float | None, Field(gt=0, le=100)] = None
    memPct: Annotated[float | None, Field(gt=0, le=100)] = None
    durationS: Annotated[float | None, Field(gt=0)] = None

    def to_point(self) -> Point:
        """Engine ``Point``."""
        return Point(self.tps, self.p95Ms, self.errorRatePct, self.cpuPct, self.memPct, self.durationS)


EXAMPLE_VALIDATE = {
    "measuredSpec": EXAMPLE_EVALUATE["measuredSpec"],
    "points": [
        {"tps": 10, "p95Ms": 402},
        {"tps": 25, "p95Ms": 414},
        {"tps": 40, "p95Ms": 428, "cpuPct": 62, "memPct": 58},
        {"tps": 55, "p95Ms": 539},
    ],
    "payloadKb": 4,
}


class ValidateRequest(_Model):
    """Input of ``POST /api/v1/validate``."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXAMPLE_VALIDATE]})

    measuredSpec: SpecIn
    points: Annotated[list[PointIn], Field(min_length=1, max_length=20)]
    calibrationIndex: Annotated[int | None, Field(ge=0)] = None
    database: DatabaseIn = DatabaseIn()
    payloadKb: Annotated[float, Field(ge=0, le=10240)] = 6
    seed: Annotated[int | None, Field(ge=0)] = None

    @model_validator(mode="after")
    def _cpu(self) -> ValidateRequest:
        """At least one point must carry CPU, the calibration anchor."""
        if not any(p.cpuPct for p in self.points):
            raise ValueError("at least one point needs cpuPct (server CPU at that load) to calibrate on")
        return self
