"""Readiness evaluation: calibrate, scale to the target, simulate scenarios, and decide a verdict.

Attributes
----------
HEADROOM_LIMIT_PCT : float
    Peak utilization above this value makes the verdict at most ``PASS_WITH_CONDITIONS``.
EXTRAPOLATION_LIMIT : float
    Target CPU capacity above this multiple of the measured environment is a far extrapolation.
CALIBRATION_LIMIT_PCT : float
    Calibration p95 error above this value means the model cannot reproduce the measurement.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from loadtwin.calibration import Database, Measurement, prepare
from loadtwin.capacity import capacity
from loadtwin.engine import DURATION_S, Spec, seed_from, simulate
from loadtwin.montecarlo import apply_breach_probability, replicate
from loadtwin.sla import FAIL, NOT_ASSESSABLE, PASS, PASS_WITH_CONDITIONS, SLA, utilization, violations

HEADROOM_LIMIT_PCT = 75.0
EXTRAPOLATION_LIMIT = 4.0
CALIBRATION_LIMIT_PCT = 15.0


@dataclass
class Load:
    """Loads to evaluate on the target environment.

    Attributes
    ----------
    normal_tps : float
        Typical load.
    peak_tps : float
        Peak load; the verdict is decided here.
    stress_multipliers : list of float
        Extra scenarios at ``peak_tps`` times each multiplier, reported but not part of the verdict.
    """

    normal_tps: float
    peak_tps: float
    stress_multipliers: list[float] = field(default_factory=lambda: [1.5, 2.0])


def _limiting(summary: dict, breakdown: dict, sla: SLA, capacity_limit: str) -> str:
    """Resource that limits the cluster at peak load.

    When p95 is violated while no resource is above 85% and most time is spent waiting on the
    database or external dependencies, that wait is the limit. Otherwise the most utilized resource
    if it is at least 60%, else the resource that bounds maximum capacity.
    """
    util = utilization(summary)
    top, top_pct = max(util.items(), key=lambda kv: kv[1])
    if summary["p95Ms"] > sla.max_p95_ms and top_pct < 85:
        waits = {"database": breakdown.get("database", 0), "external": breakdown.get("external", 0)}
        dominant = max(waits, key=waits.get)
        if waits[dominant] >= max(breakdown.get("cpu", 0), breakdown.get("cpu_queue", 0)):
            return dominant
    return top if top_pct >= 60 else capacity_limit


def evaluate(
    measured_spec: Spec,
    measurement: Measurement,
    target_spec: Spec,
    load: Load,
    sla: SLA | None = None,
    database: Database | None = None,
    seed: int | None = None,
    include_timeseries: bool = False,
    replications: int = 0,
) -> dict:
    """Evaluate whether the target environment can carry the load within the SLA.

    Parameters
    ----------
    measured_spec : Spec
        Environment where the load test ran.
    measurement : Measurement
        What the load test observed.
    target_spec : Spec
        Environment to evaluate, typically production.
    load : Load
        Normal, peak and stress loads.
    sla : SLA, optional
        Acceptance criteria; defaults to ``SLA()``.
    database : Database, optional
        Database behaviour; defaults to ``Database()``.
    seed : int, optional
        Random seed; derived from the input when omitted, so equal input gives equal output.
    include_timeseries : bool, default False
        Include the 2-second time series of every scenario.
    replications : int, default 0
        Extra independent runs of the peak scenario (Monte Carlo). With two or more, the result has a
        ``monteCarlo`` section and the verdict accounts for the probability of breaching the SLA.

    Returns
    -------
    dict
        ``verdict``, ``reasons``, ``conditions``, ``limitingResource``, ``calibration``,
        ``scenarios``, ``capacity``, ``breakingPointTps``, ``monteCarlo`` and ``model``.
    """
    sla = sla or SLA()
    database = database or Database()
    if seed is None:
        seed = seed_from(vars(measured_spec), vars(measurement), vars(target_spec), vars(database))

    profile, cal = prepare(measured_spec, measurement, target_spec, database, seed)
    scale_ratio = target_spec.total_vcpu / measured_spec.total_vcpu

    plan = [("normal", "normal", load.normal_tps), ("peak", "peak", load.peak_tps)]
    plan += [(f"stress-{m:g}x", "stress", load.peak_tps * m) for m in load.stress_multipliers]
    scenarios = []
    peak_result = None
    for name, kind, tps in plan:
        r = simulate(target_spec, profile, tps, seed_from(seed, name, tps))
        v = violations(r.summary, sla)
        item = {
            "name": name,
            "kind": kind,
            "tps": round(tps, 2),
            "status": FAIL if v else PASS,
            "violations": v,
            "summary": r.summary,
            "latencyBreakdownMs": r.latency_breakdown_ms,
        }
        if include_timeseries:
            item["timeseries"] = r.timeseries
        scenarios.append(item)
        if kind == "peak":
            peak_result = r

    cap = capacity(target_spec, profile, peak_result, load.peak_tps, sla.max_cpu_pct)
    peak = next(s for s in scenarios if s["kind"] == "peak")
    limiting = _limiting(peak["summary"], peak["latencyBreakdownMs"], sla, cap["limitingResource"])
    failing_stress = [s for s in scenarios if s["kind"] == "stress" and s["status"] == FAIL]
    breaking = min((s["tps"] for s in failing_stress), default=None)

    reasons: list[str] = []
    conditions: list[str] = []
    core = [s for s in scenarios if s["kind"] in ("normal", "peak")]
    top_res, top_pct = max(utilization(peak["summary"]).items(), key=lambda kv: kv[1])
    if cal["errorPct"] > CALIBRATION_LIMIT_PCT:
        verdict = NOT_ASSESSABLE
        reasons.append(
            f"The model reproduces the measured p95 only within {cal['errorPct']}% "
            f"(limit {CALIBRATION_LIMIT_PCT:g}%), so its predictions are not reliable. "
            "Check the measurement, or provide one taken at a steadier load."
        )
    elif any(s["violations"] for s in core):
        verdict = FAIL
        for s in core:
            reasons += [f"{s['name']} ({s['tps']:g} TPS): {x}" for x in s["violations"]]
    elif scale_ratio > EXTRAPOLATION_LIMIT:
        verdict = PASS_WITH_CONDITIONS
        reasons.append(
            f"All criteria are met, but the target has {scale_ratio:.1f}x the CPU capacity of the measured "
            "environment, so the result is a far extrapolation."
        )
        conditions.append(
            f"Run a load test on an environment with at least 1/{EXTRAPOLATION_LIMIT:g} of the target CPU capacity "
            "before relying on this result."
        )
    elif top_pct > HEADROOM_LIMIT_PCT:
        verdict = PASS_WITH_CONDITIONS
        reasons.append(f"All criteria are met, but headroom is thin: {top_res} at {top_pct}% during peak.")
        conditions.append(f"Monitor {top_res} closely for the first 7 days after release.")
    else:
        verdict = PASS
        reasons.append("All indicators meet the SLA at normal and peak load with enough headroom.")
    reasons.append(
        f"Maximum sustainable load is {cap['maxTps']:g} TPS ({cap['maxTps'] / max(load.peak_tps, 0.1):.1f}x peak), "
        f"bounded by {cap['limitingResource']}."
    )

    mc = None
    if replications >= 2 and verdict != NOT_ASSESSABLE:
        mc = replicate(target_spec, profile, load.peak_tps, sla, replications, seed_from(seed, "monte-carlo"))
        verdict = apply_breach_probability(verdict, mc, reasons, conditions)

    return {
        "verdict": verdict,
        "reasons": reasons,
        "conditions": conditions,
        "limitingResource": limiting,
        "calibration": cal,
        "scenarios": scenarios,
        "capacity": cap,
        "breakingPointTps": breaking,
        "monteCarlo": mc,
        "model": {"engine": "simpy", "seed": seed, "measurementWindowS": DURATION_S},
    }
