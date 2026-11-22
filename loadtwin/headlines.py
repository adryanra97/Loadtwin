"""One-sentence answers that lead every result.

Each tool's result starts with a headline that states the answer and the main reason, before any
supporting numbers: "Holds the 45 req/s peak with 1.7x headroom; CPU runs out first." The
numbers come straight from the result.

Attributes
----------
RESOURCE : dict
    Plain names of resources.
"""

from __future__ import annotations

RESOURCE = {
    "cpu": "CPU",
    "memory": "memory",
    "threadPool": "worker threads",
    "connectionPool": "DB connections",
    "network": "network",
    "database": "the shared database",
    "external": "external calls",
}


def resource(name: str | None) -> str:
    """Plain name of a resource."""
    return RESOURCE.get(name or "", name or "an unknown resource")


def _cap(text: str) -> str:
    """Capitalise the first letter only."""
    return text[:1].upper() + text[1:]


def evaluate_headline(
    verdict: str, peak_tps: float, peak: dict, cap: dict | None, calib_error: float, sla, mc: dict | None
) -> str:
    """Headline for an evaluation.

    Parameters
    ----------
    verdict : str
    peak_tps : float
    peak : dict
        Peak scenario (``summary`` and ``violations``).
    cap : dict or None
        Capacity (``maxTps``, ``limitingResource``).
    calib_error : float
        Calibration error in percent.
    sla : SLA
    mc : dict or None
        Monte Carlo result.

    Returns
    -------
    str
    """
    s = peak["summary"]
    load = f"{peak_tps:g} req/s"
    if verdict == "NOT_ASSESSABLE":
        return f"Not assessable: the model misses your measured p95 by {calib_error:g}%, so its predictions cannot be trusted."
    if verdict == "FAIL":
        if s["p95Ms"] > sla.max_p95_ms:
            why = f"p95 reaches {s['p95Ms']:,} ms against a {sla.max_p95_ms:,g} ms limit"
        elif s["errorRatePct"] > sla.max_error_pct:
            why = f"{s['errorRatePct']:g}% of requests fail against a {sla.max_error_pct:g}% limit"
        elif s["cpuPct"] > sla.max_cpu_pct:
            why = f"CPU reaches {s['cpuPct']:g}% against an {sla.max_cpu_pct:g}% limit"
        elif mc and mc["breachProbability"] >= 0.5:
            why = f"the SLA breaks in {mc['breachProbability']:.0%} of {mc['runs']} runs"
        else:
            why = "a lower load already breaks the SLA"
        return f"Breaks at the {load} peak: {why}."
    head = (cap or {}).get("maxTps")
    room = f" with {head / max(peak_tps, 0.1):.1f}x headroom" if head else ""
    first = f"; {resource((cap or {}).get('limitingResource'))} runs out first" if cap else ""
    if verdict == "PASS":
        return f"Holds the {load} peak{room}{first}."
    if mc and 0.05 < mc["breachProbability"] < 0.5:
        return f"Holds the {load} peak on average, but the SLA breaks in {mc['breachProbability']:.0%} of {mc['runs']} runs."
    return f"Holds the {load} peak, but with little margin{first}."


def fault_headline(verdict: str, description: str, during: dict, healthy: dict, recovery: float | None) -> str:
    """Headline for a failure scenario."""
    when = f"when {description}"
    if verdict == "PASS":
        return f"Survives {when}: p95 {during['p95Ms']:,} ms, errors {during['errorRatePct']:g}%."
    if verdict == "FAIL":
        rec = f", and needs {recovery:g} s to recover" if recovery else ""
        return f"Does not survive {when}: errors reach {during['errorRatePct']:g}% and p95 {during['p95Ms'] or 0:,} ms{rec}."
    return f"Survives {when}, with almost no margin: p95 {during['p95Ms']:,} ms against {healthy['p95Ms']:,} ms healthy."


def pattern_headline(verdict: str, kind: str, breach_s: float, share: float, worst: dict, recovery: float | None) -> str:
    """Headline for a load pattern."""
    name = {"daily": "the daily curve", "spike": "the spike", "ramp": "the ramp", "custom": "this pattern"}.get(
        kind, "this pattern"
    )
    if verdict == "PASS":
        return f"Rides {name} without breaking the SLA."
    rec = f"; it recovers {recovery:g} s after the load drops" if recovery is not None else ""
    peak_p95 = worst["p95Ms"] or 0
    return f"Breaks the SLA for {breach_s:g} s of {name} ({share:.0%} of the time), with p95 peaking at {peak_p95:,} ms{rec}."


def autosize_headline(peak_tps: float, recommended: dict | None, cheapest: dict | None, db_limit: float | None) -> str:
    """Headline for auto-sizing."""
    if recommended is None:
        if db_limit is not None and db_limit < peak_tps:
            return f"No cluster can carry {peak_tps:g} req/s: the shared database tops out near {db_limit:g} req/s."
        return f"No machine type in the catalog carries {peak_tps:g} req/s within the node limit."
    cluster = f"{recommended['nodes']} x {recommended['machine']['name']}"
    head = f"{cluster} at ${recommended['monthlyUsd']:,.0f} a month carries {peak_tps:g} req/s"
    if cheapest and cheapest["monthlyUsd"] < recommended["monthlyUsd"]:
        return f"{head} with headroom; the cheapest pass is ${cheapest['monthlyUsd']:,.0f}, but runs hot."
    return f"{head}."


def sensitivity_headline(rows: list[dict], baseline_p95: float) -> str:
    """Headline for a sensitivity analysis."""
    if not rows:
        return "No inputs were varied."
    top = rows[0]
    second = f", then {rows[1]['phrase']}" if len(rows) > 1 and rows[1]["swingMs"] > 0 else ""
    return f"{_cap(top['phrase'])} moves p95 the most (a {top['swingMs']:,} ms swing around {baseline_p95:,} ms){second}."


def validate_headline(grade: str, mae: float | None, valid: list | None) -> str:
    """Headline for model validation."""
    if grade == "untested":
        return "Only one load level: the model fits it by construction. Add more levels to test it."
    rng = f" between {valid[0]:g} and {valid[1]:g} req/s" if valid else ""
    if grade == "good":
        return f"The model predicts your load test within {mae:g}% on average: trust it{rng}."
    if grade == "fair":
        return f"The model is off by {mae:g}% on average: use it as a guide{rng}, with a margin."
    return f"The model is off by {mae:g}% on average: do not rely on it for this service yet."
