"""Acceptance criteria, verdict labels and SLA checks shared by every analysis.

Attributes
----------
THREAD_SATURATION_PCT : float
    Thread pool utilization at or above this value counts as a violation.
"""

from __future__ import annotations

from dataclasses import dataclass

THREAD_SATURATION_PCT = 95.0

PASS = "PASS"  # noqa: S105 - verdict label, not a password
PASS_WITH_CONDITIONS = "PASS_WITH_CONDITIONS"  # noqa: S105 - verdict label, not a password
FAIL = "FAIL"
NOT_ASSESSABLE = "NOT_ASSESSABLE"


@dataclass
class SLA:
    """Acceptance criteria.

    Attributes
    ----------
    max_p95_ms : float, default 800
    max_error_pct : float, default 1
    max_cpu_pct : float, default 80
    max_mem_pct : float, default 85
    """

    max_p95_ms: float = 800.0
    max_error_pct: float = 1.0
    max_cpu_pct: float = 80.0
    max_mem_pct: float = 85.0


def breached(summary: dict, sla: SLA) -> list[str]:
    """Kinds of SLA criteria a scenario breaks.

    Parameters
    ----------
    summary : dict
        ``SimulationResult.summary``.
    sla : SLA
        Acceptance criteria.

    Returns
    -------
    list of str
        Subset of ``p95``, ``errorRate``, ``cpu``, ``memory`` and ``threadPool``.
    """
    checks = {
        "p95": summary["p95Ms"] > sla.max_p95_ms,
        "errorRate": summary["errorRatePct"] > sla.max_error_pct,
        "cpu": summary["cpuPct"] > sla.max_cpu_pct,
        "memory": summary["memPct"] > sla.max_mem_pct,
        "threadPool": summary["threadPct"] >= THREAD_SATURATION_PCT,
    }
    return [k for k, hit in checks.items() if hit]


def violations(summary: dict, sla: SLA) -> list[str]:
    """SLA violations of one simulated scenario.

    Parameters
    ----------
    summary : dict
        ``SimulationResult.summary``.
    sla : SLA
        Acceptance criteria.

    Returns
    -------
    list of str
        Human-readable violations; empty when the scenario meets the SLA.
    """
    v = []
    if summary["p95Ms"] > sla.max_p95_ms:
        v.append(f"p95 {summary['p95Ms']} ms exceeds {sla.max_p95_ms:g} ms")
    if summary["errorRatePct"] > sla.max_error_pct:
        v.append(f"error rate {summary['errorRatePct']}% exceeds {sla.max_error_pct:g}%")
    if summary["cpuPct"] > sla.max_cpu_pct:
        v.append(f"CPU {summary['cpuPct']}% exceeds {sla.max_cpu_pct:g}%")
    if summary["memPct"] > sla.max_mem_pct:
        v.append(f"memory {summary['memPct']}% exceeds {sla.max_mem_pct:g}%")
    if summary["threadPct"] >= THREAD_SATURATION_PCT:
        v.append(f"thread pool {summary['threadPct']}% is saturated")
    return v


def utilization(summary: dict) -> dict[str, float]:
    """Utilization per resource in percent, skipping resources that were not modelled.

    The shared database comes first: when it saturates, connection pools fill up behind it, and on a
    tie the database is the root cause.

    Parameters
    ----------
    summary : dict
        ``SimulationResult.summary``.

    Returns
    -------
    dict
        Resource name to utilization percent.
    """
    u = {"database": summary["dbPct"]} if summary.get("dbPct") is not None else {}
    u |= {
        "cpu": summary["cpuPct"],
        "memory": summary["memPct"],
        "threadPool": summary["threadPct"],
        "connectionPool": summary["connPct"],
        "network": summary["netPct"],
    }
    return u
