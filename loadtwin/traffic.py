"""Time-varying load: daily curves, spikes and ramps instead of one constant rate.

A pattern becomes a list of ``(duration_s, tps)`` segments, the simulation runs them back to back,
and the result is judged in 10-second windows: how long the SLA was breached, the worst window,
and how fast the cluster recovered after the load dropped.

Attributes
----------
WINDOW_S : float
    Length of the windows the SLA is judged on.
DAILY_SHAPE : list of float
    Share of the peak rate for each hour of a typical business day (00:00 to 23:00).
MAX_PATTERN_S : float
    Longest simulated pattern.
MAX_PATTERN_REQUESTS : float
    Largest number of requests in one pattern, to keep a request within seconds of compute.
"""

from __future__ import annotations

from dataclasses import dataclass

from loadtwin.engine import BUCKET_S, Profile, Spec, percentile, simulate
from loadtwin.sla import FAIL, PASS, PASS_WITH_CONDITIONS, SLA

WINDOW_S = 10.0
MAX_PATTERN_S = 1200.0
MAX_PATTERN_REQUESTS = 150_000
DAILY_SHAPE = [
    0.18, 0.12, 0.10, 0.10, 0.12, 0.18, 0.30, 0.50, 0.72, 0.85, 0.92, 0.97,
    1.00, 0.95, 0.88, 0.85, 0.86, 0.90, 0.94, 1.00, 0.92, 0.70, 0.45, 0.28,
]  # fmt: skip


@dataclass
class Pattern:
    """A load pattern.

    Attributes
    ----------
    kind : str
        ``daily``, ``spike``, ``ramp`` or ``custom``.
    peak_tps : float
        Highest rate (daily, spike) or end rate (ramp).
    base_tps : float, default 0
        Off-peak rate (spike) or start rate (ramp). For ``daily`` it is the floor of the curve.
    seconds_per_hour : float, default 20
        ``daily``: simulated seconds per hour of the day (the day is compressed).
    spike_s : float, default 30
        ``spike``: length of the spike.
    duration_s : float, default 300
        ``ramp``: length of the ramp.
    segments : list of (float, float), optional
        ``custom``: explicit ``(duration_s, tps)`` segments.
    """

    kind: str
    peak_tps: float = 0.0
    base_tps: float = 0.0
    seconds_per_hour: float = 20.0
    spike_s: float = 30.0
    duration_s: float = 300.0
    segments: list[tuple[float, float]] | None = None


def to_segments(p: Pattern) -> list[tuple[float, float]]:
    """Turn a pattern into ``(duration_s, tps)`` segments.

    Parameters
    ----------
    p : Pattern
        The pattern.

    Returns
    -------
    list of (float, float)
        Segments in order.

    Raises
    ------
    ValueError
        For an unknown kind, an empty custom pattern, or a pattern beyond ``MAX_PATTERN_S`` or
        ``MAX_PATTERN_REQUESTS``.
    """
    if p.kind == "daily":
        floor = p.base_tps
        segs = [(p.seconds_per_hour, max(floor, p.peak_tps * share)) for share in DAILY_SHAPE]
    elif p.kind == "spike":
        segs = [(60.0, p.base_tps), (p.spike_s, p.peak_tps), (90.0, p.base_tps)]
    elif p.kind == "ramp":
        steps = 10
        segs = [(p.duration_s / steps, p.base_tps + (p.peak_tps - p.base_tps) * (i + 0.5) / steps) for i in range(steps)]
    elif p.kind == "custom" and p.segments:
        segs = [(float(d), float(t)) for d, t in p.segments]
    else:
        raise ValueError(f"unknown or empty pattern: {p.kind}")
    total = sum(d for d, _ in segs)
    requests = sum(d * t for d, t in segs)
    if total > MAX_PATTERN_S:
        raise ValueError(f"pattern lasts {total:g} s; the limit is {MAX_PATTERN_S:g} s")
    if requests > MAX_PATTERN_REQUESTS:
        raise ValueError(f"pattern has about {requests:,.0f} requests; the limit is {MAX_PATTERN_REQUESTS:,}")
    return segs


def run_pattern(spec: Spec, profile: Profile, pattern: Pattern, sla: SLA, seed: int) -> dict:
    """Simulate a load pattern and judge it in ``WINDOW_S`` windows.

    Parameters
    ----------
    spec : Spec
        Simulated cluster.
    profile : Profile
        Workload profile.
    pattern : Pattern
        Load pattern.
    sla : SLA
        p95, error rate and CPU limits applied per window.
    seed : int
        Random seed.

    Returns
    -------
    dict
        ``verdict``, ``reasons``, ``segments``, ``windows`` (offered and served load, CPU, threads,
        p95, error rate and ``breach`` per window), ``breachSeconds``, ``breachShare``,
        ``worstWindow``, ``recoverySeconds`` (time from the last load drop until windows meet the SLA
        again; null when there is no drop or no recovery) and ``summary``.
    """
    segs = to_segments(pattern)
    res = simulate(spec, profile, max(t for _, t in segs), seed, schedule=segs)
    per = max(int(WINDOW_S / BUCKET_S), 1)
    buckets = [b for b in res.timeseries if b["t"] > 0]
    windows = []
    for i in range(0, len(buckets), per):
        chunk = buckets[i : i + per]
        p95s = [b["p95"] for b in chunk if b["p95"] is not None]
        offered = sum(b["tps"] for b in chunk) / len(chunk)
        errs = sum(b["errorPct"] * b["tps"] for b in chunk) / max(sum(b["tps"] for b in chunk), 1e-9)
        w = {
            "t": chunk[-1]["t"],
            "offeredTps": round(offered, 1),
            "throughputTps": round(sum(b["throughput"] for b in chunk) / len(chunk), 1),
            "cpuPct": round(sum(b["cpu"] for b in chunk) / len(chunk), 1),
            "threadPct": round(sum(b["thread"] for b in chunk) / len(chunk), 1),
            "p95Ms": round(percentile(p95s, 0.95)) if p95s else None,
            "errorRatePct": round(errs, 2),
        }
        w["breach"] = (w["p95Ms"] or 0) > sla.max_p95_ms or w["errorRatePct"] > sla.max_error_pct or w["cpuPct"] > sla.max_cpu_pct
        windows.append(w)

    breach = [w for w in windows if w["breach"]]
    breach_s = len(breach) * WINDOW_S
    total_s = len(windows) * WINDOW_S
    share = breach_s / max(total_s, 1)
    worst = max(windows, key=lambda w: ((w["p95Ms"] or 0), w["errorRatePct"]))

    # Recovery: after the last time the offered load drops by 20% or more, how long until windows are clean.
    recovery = None
    t, drop_at = 0.0, None
    for (d, tps), nxt in zip(segs, segs[1:], strict=False):
        t += d
        if nxt[1] <= tps * 0.8:
            drop_at = t
    if drop_at is not None and breach:
        after = [w for w in windows if w["t"] > drop_at]
        bad_before = any(w["breach"] for w in windows if w["t"] <= drop_at + WINDOW_S)
        if bad_before:
            clean = next((w for w in after if not w["breach"]), None)
            recovery = round(clean["t"] - drop_at, 1) if clean else None

    reasons = []
    if not breach:
        verdict = PASS
        reasons.append("Every 10-second window meets the SLA throughout the pattern.")
    elif share <= 0.05:
        verdict = PASS_WITH_CONDITIONS
        reasons.append(f"The SLA breaks for {breach_s:g} s ({share:.0%} of the pattern), at most 5% of the time.")
    else:
        verdict = FAIL
        reasons.append(f"The SLA breaks for {breach_s:g} s ({share:.0%} of the pattern).")
    if breach:
        reasons.append(
            f"Worst window ends at {worst['t']:g} s: {worst['offeredTps']:g} TPS offered, p95 {worst['p95Ms']} ms, "
            f"errors {worst['errorRatePct']}%, CPU {worst['cpuPct']}%."
        )
    if recovery is not None:
        reasons.append(f"After the load drops, the cluster needs {recovery:g} s to meet the SLA again.")
    return {
        "verdict": verdict,
        "reasons": reasons,
        "segments": [{"durationS": d, "tps": round(tps, 2)} for d, tps in segs],
        "windows": windows,
        "breachSeconds": breach_s,
        "breachShare": round(share, 3),
        "worstWindow": worst,
        "recoverySeconds": recovery,
        "summary": res.summary,
    }
