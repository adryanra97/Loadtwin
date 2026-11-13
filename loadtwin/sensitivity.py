"""Sensitivity analysis: which input moves p95 the most.

One input at a time is moved down and up by the same relative step while everything else stays as
it is, and the peak load is simulated with the same seed each time (common random numbers), so the
differences come from the input and not from noise. The result is a tornado chart: inputs sorted
by how much p95 swings.

Attributes
----------
STEP : float
    Default relative change applied to every input (0.25 = 25% down and 25% up).
WINDOW_S : float
    Measurement window of each run.
PARAMS : dict
    The inputs, how to read them, and which direction is the improvement.
"""

from __future__ import annotations

from dataclasses import replace

from loadtwin.calibration import Database, Measurement, prepare
from loadtwin.engine import Spec, seed_from, simulate
from loadtwin.sla import SLA, violations

STEP = 0.25
WINDOW_S = 30.0

PARAMS = {
    "vcpu": {"label": "vCPU per node", "phrase": "vCPU per node", "unit": "", "kind": "spec"},
    "nodes": {"label": "Nodes", "phrase": "the number of nodes", "unit": "", "kind": "spec"},
    "threadPool": {"label": "Worker threads per node", "phrase": "worker threads per node", "unit": "", "kind": "spec"},
    "connPool": {"label": "DB connections per node", "phrase": "DB connections per node", "unit": "", "kind": "spec"},
    "dbMs": {"label": "Database time per query", "phrase": "database time per query", "unit": "ms", "kind": "profile"},
    "extMs": {"label": "External call time", "phrase": "external call time", "unit": "ms", "kind": "profile"},
    "cpuMs": {"label": "CPU time per request", "phrase": "CPU time per request", "unit": "ms", "kind": "profile"},
}
_SPEC_FIELD = {"vcpu": "vcpu", "nodes": "nodes", "threadPool": "thread_pool", "connPool": "conn_pool"}
_PROFILE_FIELD = {"dbMs": "db_ms", "extMs": "ext_ms", "cpuMs": "cpu_ms"}


def _moved(value: float, factor: float, integer: bool) -> float:
    """``value * factor``, rounded and kept at least one step away from ``value`` for integers."""
    if not integer:
        return value * factor
    out = round(value * factor)
    if out == value:
        out = value + (1 if factor > 1 else -1)
    return max(out, 1)


def sensitivity(
    measured_spec: Spec,
    measurement: Measurement,
    target_spec: Spec,
    peak_tps: float,
    sla: SLA | None = None,
    database: Database | None = None,
    step: float = STEP,
    params: list[str] | None = None,
    seed: int | None = None,
) -> dict:
    """Move each input down and up by ``step`` and measure p95 at ``peak_tps``.

    Parameters
    ----------
    measured_spec, measurement : Spec, Measurement
        Calibration input.
    target_spec : Spec
        The cluster being analysed.
    peak_tps : float
        Load to simulate.
    sla : SLA, optional
        Used to flag runs that break the SLA.
    database : Database, optional
        Database behaviour.
    step : float, default STEP
        Relative change, between 0.05 and 0.9.
    params : list of str, optional
        Inputs to vary; every key of ``PARAMS`` by default.
    seed : int, optional
        Random seed; derived from the input when omitted.

    Returns
    -------
    dict
        ``baseline`` (p95, error rate, CPU), ``params`` sorted by swing, each with its ``low`` and
        ``high`` value and result and the ``swingMs``, ``advice`` naming the most effective change,
        and ``step``.
    """
    sla = sla or SLA()
    database = database or Database()
    params = [p for p in (params or list(PARAMS)) if p in PARAMS]
    if seed is None:
        seed = seed_from(vars(measured_spec), vars(measurement), vars(target_spec), peak_tps, step, params)
    base_profile, cal = prepare(measured_spec, measurement, target_spec, database, seed)
    run_seed = seed_from(seed, "sensitivity")

    def run(spec: Spec, profile) -> dict:
        """One peak run with the shared seed."""
        s = simulate(spec, profile, peak_tps, run_seed, WINDOW_S).summary
        return {
            "p95Ms": s["p95Ms"],
            "errorRatePct": s["errorRatePct"],
            "cpuPct": s["cpuPct"],
            "meetsSla": not violations(s, sla),
        }

    baseline = run(target_spec, base_profile)
    rows = []
    for key in params:
        meta = PARAMS[key]
        out = {"param": key, "label": meta["label"], "phrase": meta["phrase"], "unit": meta["unit"]}
        for side, factor in (("low", 1 - step), ("high", 1 + step)):
            if meta["kind"] == "spec":
                field = _SPEC_FIELD[key]
                current = getattr(target_spec, field)
                value = _moved(current, factor, True)
                spec = replace(target_spec, **{field: int(value)})
                # A different vCPU count changes CPU time per request through the scalability law.
                profile = prepare(measured_spec, measurement, spec, database, seed)[0] if key == "vcpu" else base_profile
            else:
                field = _PROFILE_FIELD[key]
                current = getattr(base_profile, field)
                value = current * factor
                spec = target_spec
                profile = replace(base_profile, **{field: value})
            out["base"] = round(current, 1)
            out[side] = {"value": round(value, 1), **run(spec, profile)}
        lo, hi = out["low"]["p95Ms"], out["high"]["p95Ms"]
        out["swingMs"] = abs(hi - lo)
        better = min(("low", "high"), key=lambda k: (out[k]["p95Ms"], out[k]["errorRatePct"]))
        out["better"] = better
        out["gainMs"] = baseline["p95Ms"] - out[better]["p95Ms"]
        rows.append(out)

    rows.sort(key=lambda r: (-r["swingMs"], r["param"]))
    advice = []
    gains = sorted((r for r in rows if r["gainMs"] > 0), key=lambda r: -r["gainMs"])
    for r in gains[:2]:
        direction = "Lowering" if r["better"] == "low" else "Raising"
        unit = f" {r['unit']}" if r["unit"] else ""
        advice.append(
            f"{direction} {r['phrase']} from {r['base']:g} to {r[r['better']]['value']:g}{unit} "
            f"cuts p95 by {r['gainMs']:g} ms (to {r[r['better']]['p95Ms']} ms)."
        )
    flat = [r["phrase"] for r in rows if r["swingMs"] <= max(baseline["p95Ms"] * 0.02, 5)]
    if flat:
        joined = flat[0] if len(flat) == 1 else ", ".join(flat[:-1]) + " or " + flat[-1]
        advice.append(f"Changing {joined} barely moves p95 at this load.")
    return {
        "peakTps": peak_tps,
        "step": step,
        "baseline": baseline,
        "params": rows,
        "advice": advice,
        "calibration": cal,
    }
