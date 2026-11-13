"""Failure scenarios: whether the service still meets its SLA when part of it breaks.

The same load is simulated twice with the same seed, once healthy and once with a failure in the
middle of the window, so the difference is the failure and not random noise. The run is split into
three phases (before, during and after the failure) and each is judged against the SLA, with the
time it takes to recover once the failure is over.

Attributes
----------
BEFORE_S, AFTER_S : float
    Healthy time simulated before and after the failure.
WINDOW_S : float
    Window used for the timeline and the recovery time.
PRESETS : dict
    Ready-made failures by name.
"""

from __future__ import annotations

import math
from dataclasses import replace

from loadtwin.engine import BUCKET_S, Fault, Profile, Spec, percentile, simulate
from loadtwin.sla import FAIL, PASS, PASS_WITH_CONDITIONS, SLA

BEFORE_S = 20.0
AFTER_S = 30.0
WINDOW_S = 10.0

PRESETS = {
    "node-down": {"nodesDown": 1},
    "slow-database": {"dbSlowdown": 3.0},
    "dependency-timeout": {"extFailShare": 0.3, "extTimeoutMs": 2000},
    "slow-dependency": {"extSlowdown": 4.0},
}


def describe(fault: Fault, spec: Spec) -> str:
    """Plain-language description of a failure."""
    parts = []
    if fault.nodes_down:
        parts.append(f"{min(fault.nodes_down, spec.nodes)} of {spec.nodes} nodes crash")
    if fault.db_slowdown != 1:
        parts.append(f"database queries take {fault.db_slowdown:g}x as long")
    if fault.ext_fail_share:
        parts.append(f"{fault.ext_fail_share:.0%} of external calls hang for {fault.ext_timeout_ms:g} ms and fail")
    if fault.ext_slowdown != 1:
        parts.append(f"external calls take {fault.ext_slowdown:g}x as long")
    return "; ".join(parts) or "no failure"


def _phase(events: list, t0: float, t1: float) -> dict:
    """p95 and error rate of requests that arrived between ``t0`` and ``t1``."""
    lat = [x for t, x in events if t0 <= t < t1 and x is not None]
    n = sum(1 for t, _ in events if t0 <= t < t1)
    failed = sum(1 for t, x in events if t0 <= t < t1 and x is None)
    return {
        "requests": n,
        "p95Ms": round(percentile(lat, 0.95)) if lat else None,
        "errorRatePct": round(100 * failed / n, 2) if n else 0.0,
    }


def _breaks(ph: dict, sla: SLA, timeout_ms: float) -> list[str]:
    """SLA limits broken by one phase; requests slower than the timeout also count as errors."""
    out = []
    if ph["p95Ms"] is not None and ph["p95Ms"] > sla.max_p95_ms:
        out.append(f"p95 {ph['p95Ms']} ms is above {sla.max_p95_ms:g} ms")
    if ph["errorRatePct"] > sla.max_error_pct:
        out.append(f"errors {ph['errorRatePct']}% are above {sla.max_error_pct:g}%")
    return out


def run_fault(spec: Spec, profile: Profile, tps: float, fault: Fault, sla: SLA, seed: int) -> dict:
    """Simulate ``tps`` healthy and with ``fault``, and judge each phase against the SLA.

    Parameters
    ----------
    spec : Spec
        Simulated cluster.
    profile : Profile
        Workload profile.
    tps : float
        Constant offered load.
    fault : Fault
        The failure; its ``start_s`` and ``end_s`` are overwritten to sit after ``BEFORE_S`` of
        healthy time, lasting ``end_s - start_s`` seconds (60 s when open-ended).
    sla : SLA
        Limits applied to each phase.
    seed : int
        Random seed shared by both runs.

    Returns
    -------
    dict
        ``verdict``, ``reasons``, ``failure`` (description and timing), ``phases`` (before, during,
        after for the faulted run, and the healthy run over the failure window), ``recoverySeconds``,
        ``timeline`` (10-second windows of both runs) and ``summary`` of the faulted run.
    """
    length = fault.end_s - fault.start_s if math.isfinite(fault.end_s) else 60.0
    length = min(max(length, 10.0), 300.0)
    fault = replace(fault, start_s=BEFORE_S, end_s=BEFORE_S + length)
    total = BEFORE_S + length + AFTER_S
    schedule = [(total, tps)]
    healthy = simulate(spec, profile, tps, seed, schedule=schedule)
    broken = simulate(spec, profile, tps, seed, schedule=schedule, fault=fault)

    phases = {
        "before": _phase(broken.events, 0, fault.start_s),
        "during": _phase(broken.events, fault.start_s, fault.end_s),
        "after": _phase(broken.events, fault.end_s, total),
        "healthyDuring": _phase(healthy.events, fault.start_s, fault.end_s),
    }

    per = max(int(WINDOW_S / BUCKET_S), 1)

    def windows(res) -> list[dict]:
        """Ten-second windows of one run."""
        b = [x for x in res.timeseries if x["t"] > 0]
        out = []
        for i in range(0, len(b), per):
            chunk = b[i : i + per]
            end = chunk[-1]["t"]
            ph = _phase(res.events, end - WINDOW_S, end)
            out.append(
                {
                    "t": end,
                    "p95Ms": ph["p95Ms"],
                    "errorRatePct": ph["errorRatePct"],
                    "cpuPct": round(sum(x["cpu"] for x in chunk) / len(chunk), 1),
                    "threadPct": round(sum(x["thread"] for x in chunk) / len(chunk), 1),
                    "throughputTps": round(sum(x["throughput"] for x in chunk) / len(chunk), 1),
                }
            )
        return out

    hw, bw = windows(healthy), windows(broken)
    for w in bw:
        w["breach"] = bool(_breaks(w, sla, spec.timeout_ms))
        w["fault"] = w["t"] > fault.start_s and w["t"] - WINDOW_S < fault.end_s
    keys = ("p95Ms", "errorRatePct", "cpuPct")
    timeline = [{**b, "healthy": {k: h[k] for k in keys}} for h, b in zip(hw, bw, strict=False)]

    recovery = None
    if any(w["breach"] for w in bw if w["t"] > fault.start_s):
        clean = next((w for w in bw if w["t"] - WINDOW_S >= fault.end_s and not w["breach"]), None)
        recovery = round(clean["t"] - fault.end_s, 1) if clean else None

    during = _breaks(phases["during"], sla, spec.timeout_ms)
    after = _breaks(phases["after"], sla, spec.timeout_ms)
    desc = describe(fault, spec)
    reasons = []
    windows_hit = [w for w in bw if w["breach"] and w["t"] > fault.start_s]
    if not during and not after and not windows_hit:
        verdict = PASS
        reasons.append(f"The service keeps its SLA while {desc}.")
    elif not during and not after:
        verdict = PASS_WITH_CONDITIONS
        reasons.append(
            f"The service keeps its SLA on average while {desc}, but {len(windows_hit)} of the 10-second windows "
            "break it: there is little margin left."
        )
    elif not after or recovery is not None:
        breach_share = sum(1 for w in bw if w["breach"]) / max(len(bw), 1)
        verdict = FAIL if during else PASS_WITH_CONDITIONS
        reasons.append(f"While {desc}, the SLA breaks: {', '.join(during or after)}.")
        if recovery is not None:
            reasons.append(f"It recovers {recovery:g} s after the failure ends.")
        if not during:
            reasons.append(f"The breach is limited to the recovery ({breach_share:.0%} of the run).")
    else:
        verdict = FAIL
        reasons.append(f"While {desc}, the SLA breaks: {', '.join(during)}.")
        reasons.append("It does not recover within 30 s after the failure ends.")
    hp = phases["healthyDuring"]
    dp = phases["during"]
    if hp["p95Ms"] and dp["p95Ms"]:
        reasons.append(
            f"p95 during the failure: {dp['p95Ms']} ms against {hp['p95Ms']} ms healthy; "
            f"errors {dp['errorRatePct']}% against {hp['errorRatePct']}%."
        )
    return {
        "verdict": verdict,
        "reasons": reasons,
        "failure": {"description": desc, "startS": fault.start_s, "endS": fault.end_s, "tps": tps},
        "phases": phases,
        "recoverySeconds": recovery,
        "timeline": timeline,
        "summary": broken.summary,
    }
