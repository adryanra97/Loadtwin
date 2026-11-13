"""Request schemas of the HTTP API (camelCase JSON) and their conversion to engine objects.

Upper bounds keep a single request within a few seconds of compute, which matters when the API is
deployed publicly (for example on Vercel).

Attributes
----------
MAX_TPS : float
    Highest arrival rate accepted for any simulated scenario.
MAX_MEASURED_TPS : float
    Highest load accepted for the calibration measurement.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from loadtwin.calibration import Measurement
from loadtwin.engine import Spec
from loadtwin.evaluate import SLA, Database, Load

MAX_TPS = 2000.0
MAX_MEASURED_TPS = 1000.0


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
    """Input of ``POST /v1/evaluate``."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXAMPLE_EVALUATE]})

    measuredSpec: SpecIn
    measurement: MeasurementIn
    targetSpec: SpecIn
    load: LoadIn
    sla: SLAIn = SLAIn()
    database: DatabaseIn = DatabaseIn()
    seed: Annotated[int | None, Field(ge=0, description="Random seed; derived from the input when omitted.")] = None
    includeTimeseries: bool = False


class SimulateRequest(_Model):
    """Input of ``POST /v1/simulate``."""

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
