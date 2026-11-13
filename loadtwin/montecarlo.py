"""Monte Carlo replications: how likely is the SLA to break, not just whether one run broke it.

A single simulation is one sample of a random process. Running the same scenario with independent
seeds gives the spread of p95, error rate and CPU, and the share of runs that breach the SLA.

Attributes
----------
CONDITIONAL_BREACH : float
    Breach probability above which a passing verdict becomes ``PASS_WITH_CONDITIONS``.
FAIL_BREACH : float
    Breach probability at or above which the verdict becomes ``FAIL``.
"""

from __future__ import annotations

from loadtwin.engine import DURATION_S, Profile, Spec, percentile, seed_from, simulate
from loadtwin.sla import FAIL, PASS, PASS_WITH_CONDITIONS, SLA, breached

CONDITIONAL_BREACH = 0.05
FAIL_BREACH = 0.5


def _stats(values: list[float]) -> dict:
    """Distribution summary: min, p5, p50, mean, p95, max."""
    return {
        "min": round(min(values), 2),
        "p5": round(percentile(values, 0.05), 2),
        "p50": round(percentile(values, 0.5), 2),
        "mean": round(sum(values) / len(values), 2),
        "p95": round(percentile(values, 0.95), 2),
        "max": round(max(values), 2),
    }


def replicate(spec: Spec, profile: Profile, tps: float, sla: SLA, runs: int, seed: int, duration_s: float = DURATION_S) -> dict:
    """Simulate one load ``runs`` times with independent seeds.

    Parameters
    ----------
    spec : Spec
        Simulated cluster.
    profile : Profile
        Workload profile.
    tps : float
        Arrival rate.
    sla : SLA
        Acceptance criteria.
    runs : int
        Number of replications.
    seed : int
        Base seed; replication ``i`` uses ``seed_from(seed, i)``.
    duration_s : float, default DURATION_S
        Measurement window per run.

    Returns
    -------
    dict
        ``runs``, ``tps``, ``breachProbability``, ``breachesBy`` (count per criterion), the
        distributions of ``p95Ms``, ``errorRatePct`` and ``cpuPct``, and the raw ``samples``.
    """
    samples = {"p95Ms": [], "errorRatePct": [], "cpuPct": []}
    by: dict[str, int] = {k: 0 for k in ("p95", "errorRate", "cpu", "memory", "threadPool")}
    failed = 0
    for i in range(runs):
        s = simulate(spec, profile, tps, seed_from(seed, i), duration_s).summary
        for k in samples:
            samples[k].append(s[k])
        kinds = breached(s, sla)
        failed += bool(kinds)
        for k in kinds:
            by[k] += 1
    return {
        "runs": runs,
        "tps": round(tps, 2),
        "breachProbability": round(failed / runs, 3),
        "breachesBy": by,
        "distribution": {k: _stats(v) for k, v in samples.items()},
        "samples": samples,
    }


def apply_breach_probability(verdict: str, mc: dict, reasons: list[str], conditions: list[str]) -> str:
    """Adjust a verdict with the Monte Carlo breach probability.

    ``FAIL`` stays ``FAIL``. Otherwise a probability of at least ``FAIL_BREACH`` fails, and one above
    ``CONDITIONAL_BREACH`` makes a ``PASS`` conditional. A reason is always added.

    Parameters
    ----------
    verdict : str
        Verdict from the deterministic run.
    mc : dict
        Output of ``replicate``.
    reasons, conditions : list of str
        Lists extended in place.

    Returns
    -------
    str
        The adjusted verdict.
    """
    p = mc["breachProbability"]
    share = f"{p:.0%} of {mc['runs']} runs"
    if verdict != FAIL and p >= FAIL_BREACH:
        reasons.insert(0, f"The SLA breaks in {share} at peak, so the setup is more likely to fail than not.")
        return FAIL
    if p > CONDITIONAL_BREACH and verdict in (PASS, PASS_WITH_CONDITIONS):
        reasons.insert(0, f"The SLA breaks in {share} at peak: random variation alone can push it over the limit.")
        conditions.append("Add headroom (more nodes or larger machines) to bring the breach probability under 5%.")
        return PASS_WITH_CONDITIONS
    reasons.append(f"Monte Carlo: the SLA breaks in {share} at peak.")
    return verdict
