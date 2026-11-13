"""Calibration of the digital twin from one load-test measurement.

Attributes
----------
WAIT_MIN_MS, WAIT_MAX_MS : float
    Search bounds for the combined database and external wait time, in milliseconds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from loadtwin.engine import Profile, Spec, simulate

WAIT_MIN_MS = 2.0
WAIT_MAX_MS = 20000.0


@dataclass
class Measurement:
    """What a load test observed.

    Attributes
    ----------
    tps : float
        Load during the test, in requests per second.
    cpu_pct : float
        Average CPU utilization in percent.
    p95_ms : float
        95th percentile response time in milliseconds.
    mem_pct : float, default 55
        Memory utilization in percent.
    payload_kb : float, default 6
        Mean payload size in KB.
    error_pct : float, default 0.1
        Error rate in percent; used as the load-independent error floor.
    """

    tps: float
    cpu_pct: float
    p95_ms: float
    mem_pct: float = 55.0
    payload_kb: float = 6.0
    error_pct: float = 0.1


def calibrate(spec: Spec, m: Measurement, db_share: float = 0.6, seed: int = 1) -> tuple[Profile, dict]:
    """Fit a workload profile so that simulated CPU and p95 match the measurement.

    Step 1 splits measured CPU into per-request CPU and background CPU: if treating all measured
    CPU as request work already makes the simulated p95 (with no waits) exceed the measured p95,
    per-request CPU is lowered and the remainder becomes background work, so total CPU still
    matches. Step 2 bisects the combined database and external wait on a log scale until the p95
    error is below 5%. Every iteration uses the same seed so p95 moves monotonically with the wait.

    Parameters
    ----------
    spec : Spec
        Environment where the measurement was taken.
    m : Measurement
        Load-test observation.
    db_share : float, default 0.6
        Share of the wait spent in the database (0 to 1); the rest is external dependencies.
    seed : int, default 1
        Simulation seed for calibration runs.

    Returns
    -------
    profile : Profile
        Calibrated workload profile.
    info : dict
        Reference values, simulated p95, error percent, iterations, CPU per request, background
        CPU share and the database and external waits.
    """
    tps = max(m.tps, 0.1)
    cpu_total_ms = max(m.cpu_pct / 100 * spec.vcpu * spec.nodes * 1000 / tps, 0.5)
    mem_req = 2 + m.payload_kb / 64
    base_mem = max(m.mem_pct / 100 * spec.ram_gb - (tps / spec.nodes) * 0.2 * mem_req / 1024, 0.2)

    def profile(cpu_ms: float, wait: float) -> Profile:
        """Profile for a given per-request CPU and combined wait (ms)."""
        return Profile(
            cpu_ms=cpu_ms,
            db_ms=wait * db_share,
            ext_ms=wait * (1 - db_share),
            payload_kb=m.payload_kb,
            base_mem_gb=base_mem,
            mem_per_request_mb=mem_req,
            base_error_pct=m.error_pct,
            background_cores=max(cpu_total_ms - cpu_ms, 0) * tps / 1000 / spec.nodes,
        )

    iterations = 0

    def p95(pr: Profile) -> float:
        """Return the simulated p95 of a candidate profile, at least 1 ms."""
        nonlocal iterations
        iterations += 1
        return max(simulate(spec, pr, tps, seed, duration_s=30).summary["p95Ms"], 1)

    cpu_ms = cpu_total_ms
    result = p95(profile(cpu_ms, WAIT_MIN_MS))
    for _ in range(6):
        if result <= m.p95_ms * 1.05:
            break
        cpu_ms = max(cpu_ms * (m.p95_ms / result) ** 1.1, 0.5)
        result = p95(profile(cpu_ms, WAIT_MIN_MS))
    best = (abs(result - m.p95_ms), WAIT_MIN_MS, result)

    if result < m.p95_ms * 0.95:
        lo, hi = math.log(WAIT_MIN_MS), math.log(WAIT_MAX_MS)
        for _ in range(12):
            mid = (lo + hi) / 2
            h = p95(profile(cpu_ms, math.exp(mid)))
            if abs(h - m.p95_ms) < best[0]:
                best = (abs(h - m.p95_ms), math.exp(mid), h)
            if abs(1 - h / m.p95_ms) < 0.05:
                break
            if h < m.p95_ms:
                lo = mid
            else:
                hi = mid
    _, wait, p95_sim = best
    pr = profile(cpu_ms, wait)
    return pr, {
        "referenceTps": round(tps, 2),
        "referenceP95Ms": round(m.p95_ms),
        "simulatedP95Ms": round(p95_sim),
        "errorPct": round(100 * abs(p95_sim - m.p95_ms) / max(m.p95_ms, 1), 1),
        "iterations": iterations,
        "cpuMsPerRequest": round(cpu_ms, 1),
        "backgroundCpuPct": round(100 * pr.background_cores / spec.vcpu, 1),
        "databaseWaitMs": round(wait * db_share, 1),
        "externalWaitMs": round(wait * (1 - db_share), 1),
    }
