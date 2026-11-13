"""Load-test imports (k6, JMeter, Locust) and multi-point validation of the model.

Load-testing tools record throughput and latency, not server CPU. Each file therefore becomes a
list of measured points (load, p95, error rate). CPU is added for at least one point by the user;
the model is calibrated on that point and asked to predict p95 at every other point. The gap
between prediction and measurement is the validation score: evidence of how far the twin can be
trusted beyond the calibration point.

Attributes
----------
WINDOW_S : float
    Window used to cut a JMeter results file into load points.
STEP_TOLERANCE : float
    Consecutive windows whose load differs by less than this share are merged into one step.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, replace

from loadtwin.calibration import Database, Measurement, calibrate
from loadtwin.engine import Spec, percentile, seed_from, simulate

WINDOW_S = 30.0
STEP_TOLERANCE = 0.15


@dataclass
class Point:
    """One measured load level.

    Attributes
    ----------
    tps : float
    p95_ms : float
    error_pct : float, default 0
    cpu_pct : float, optional
        Server CPU at this load, if known; needed on the calibration point.
    mem_pct : float, optional
    duration_s : float, optional
        How long the load was held.
    """

    tps: float
    p95_ms: float
    error_pct: float = 0.0
    cpu_pct: float | None = None
    mem_pct: float | None = None
    duration_s: float | None = None

    def as_dict(self) -> dict:
        """Camel-case dictionary for the API."""
        return {
            "tps": round(self.tps, 2),
            "p95Ms": round(self.p95_ms),
            "errorRatePct": round(self.error_pct, 2),
            "cpuPct": self.cpu_pct,
            "memPct": self.mem_pct,
            "durationS": self.duration_s,
        }


def _merge_steps(points: list[Point]) -> list[Point]:
    """Merge consecutive points whose load is within ``STEP_TOLERANCE`` into duration-weighted steps."""
    steps: list[list[Point]] = []
    for p in points:
        if steps and abs(p.tps - steps[-1][-1].tps) <= STEP_TOLERANCE * max(steps[-1][-1].tps, 1e-9):
            steps[-1].append(p)
        else:
            steps.append([p])
    out = []
    for group in steps:
        w = [g.duration_s or 1.0 for g in group]
        tw = sum(w)
        out.append(
            Point(
                tps=sum(g.tps * x for g, x in zip(group, w, strict=True)) / tw,
                p95_ms=max(g.p95_ms for g in group) if len(group) == 1 else percentile([g.p95_ms for g in group], 0.5),
                error_pct=sum(g.error_pct * x for g, x in zip(group, w, strict=True)) / tw,
                duration_s=tw,
            )
        )
    return out


def parse_k6(content: str) -> list[Point]:
    """Parse a k6 summary (``--summary-export`` or ``handleSummary`` JSON) into one point.

    Parameters
    ----------
    content : str
        JSON text.

    Returns
    -------
    list of Point
        A single point: request rate, p95 of ``http_req_duration`` and failed-request rate.

    Raises
    ------
    ValueError
        When the file has no ``http_reqs`` or ``http_req_duration`` metric.
    """
    data = json.loads(content)
    metrics = data.get("metrics", data)

    def values(name: str) -> dict:
        """Metric values, flat (summary-export) or nested under ``values`` (handleSummary)."""
        m = metrics.get(name) or {}
        return m.get("values", m)

    reqs, dur, failed = values("http_reqs"), values("http_req_duration"), values("http_req_failed")
    if "rate" not in reqs or "p(95)" not in dur:
        raise ValueError("k6 summary must contain http_reqs.rate and http_req_duration p(95)")
    rate = failed.get("rate", failed.get("value", 0.0))
    return [Point(tps=float(reqs["rate"]), p95_ms=float(dur["p(95)"]), error_pct=100 * float(rate))]


def parse_jmeter(content: str) -> list[Point]:
    """Parse a JMeter results CSV (``timeStamp``, ``elapsed``, ``success``) into load steps.

    Parameters
    ----------
    content : str
        CSV text with a header row.

    Returns
    -------
    list of Point
        One point per load step, from ``WINDOW_S`` windows merged with ``STEP_TOLERANCE``.

    Raises
    ------
    ValueError
        When required columns are missing or the file has no samples.
    """
    rows = list(csv.DictReader(io.StringIO(content)))
    if not rows or not {"timeStamp", "elapsed"} <= set(rows[0]):
        raise ValueError("JMeter CSV needs timeStamp and elapsed columns (and ideally success)")
    t0 = min(int(r["timeStamp"]) for r in rows)
    windows: dict[int, list[dict]] = {}
    for r in rows:
        windows.setdefault(int((int(r["timeStamp"]) - t0) / 1000 // WINDOW_S), []).append(r)
    points = []
    for k in sorted(windows):
        w = windows[k]
        if len(w) < 5:
            continue
        fails = sum(1 for r in w if str(r.get("success", "true")).lower() != "true")
        points.append(
            Point(
                tps=len(w) / WINDOW_S,
                p95_ms=percentile([float(r["elapsed"]) for r in w], 0.95),
                error_pct=100 * fails / len(w),
                duration_s=WINDOW_S,
            )
        )
    if not points:
        raise ValueError("JMeter CSV has no window with at least 5 samples")
    return _merge_steps(points)


def parse_locust(content: str) -> list[Point]:
    """Parse a Locust ``*_stats_history.csv`` into one point per user-count step.

    Parameters
    ----------
    content : str
        CSV text.

    Returns
    -------
    list of Point
        Mean requests/s, median of the 95th percentile and failure share per step of ``User Count``.

    Raises
    ------
    ValueError
        When required columns are missing.
    """
    rows = [r for r in csv.DictReader(io.StringIO(content)) if r.get("Name", "Aggregated") == "Aggregated"]
    need = {"User Count", "Requests/s", "95%"}
    if not rows or not need <= set(rows[0]):
        raise ValueError("Locust stats history needs 'User Count', 'Requests/s' and '95%' columns")
    steps: dict[str, list[dict]] = {}
    order: list[str] = []
    for r in rows:
        if float(r["Requests/s"] or 0) <= 0 or r["95%"] in ("", "N/A"):
            continue
        u = r["User Count"]
        if u not in steps:
            order.append(u)
        steps.setdefault(u, []).append(r)
    points = []
    for u in order:
        g = steps[u]
        rps = sum(float(r["Requests/s"]) for r in g) / len(g)
        fps = sum(float(r.get("Failures/s") or 0) for r in g) / len(g)
        points.append(
            Point(
                tps=rps,
                p95_ms=percentile([float(r["95%"]) for r in g], 0.5),
                error_pct=100 * fps / rps if rps else 0.0,
                duration_s=float(len(g)),
            )
        )
    return points


PARSERS = {"k6": parse_k6, "jmeter": parse_jmeter, "locust": parse_locust}


def detect(content: str) -> str:
    """Guess the format of a load-test file.

    Parameters
    ----------
    content : str
        File text.

    Returns
    -------
    str
        ``k6``, ``jmeter`` or ``locust``.

    Raises
    ------
    ValueError
        When the format is not recognised.
    """
    head = content.lstrip()[:2000]
    if head.startswith("{"):
        return "k6"
    first = head.splitlines()[0] if head else ""
    if "timeStamp" in first and "elapsed" in first:
        return "jmeter"
    if "User Count" in first and "Requests/s" in first:
        return "locust"
    raise ValueError("unrecognised file: expected a k6 summary JSON, a JMeter results CSV or a Locust stats history CSV")


def validate(
    spec: Spec,
    points: list[Point],
    calibration_index: int | None = None,
    database: Database | None = None,
    payload_kb: float = 6.0,
    seed: int | None = None,
) -> dict:
    """Calibrate on one measured point and predict p95 at every other point.

    Parameters
    ----------
    spec : Spec
        Environment the load test ran on.
    points : list of Point
        Measured load levels; the calibration point needs ``cpu_pct``.
    calibration_index : int, optional
        Point to calibrate on. Defaults to the point with CPU closest to the median load.
    database : Database, optional
        Database behaviour.
    payload_kb : float, default 6
        Mean payload size.
    seed : int, optional
        Random seed; derived from the input when omitted.

    Returns
    -------
    dict
        ``calibrationIndex``, ``calibration``, ``points`` (measured vs predicted p95 and error),
        ``meanAbsErrorPct`` over the other points, ``grade`` (``good`` up to 10%, ``fair`` up to 25%,
        ``poor`` above, ``untested`` with one point), ``validRangeTps`` and ``reasons``.

    Raises
    ------
    ValueError
        When no point carries ``cpu_pct``.
    """
    database = database or Database()
    with_cpu = [i for i, p in enumerate(points) if p.cpu_pct]
    if not with_cpu:
        raise ValueError("at least one point needs the server CPU (cpuPct) measured at that load")
    if calibration_index is None or calibration_index not in with_cpu:
        median = sorted(p.tps for p in points)[len(points) // 2]
        calibration_index = min(with_cpu, key=lambda i: abs(points[i].tps - median))
    ref = points[calibration_index]
    if seed is None:
        seed = seed_from(vars(spec), [vars(p) for p in points], calibration_index)
    m = Measurement(ref.tps, ref.cpu_pct, ref.p95_ms, ref.mem_pct or 55.0, payload_kb, ref.error_pct)
    profile, cal = calibrate(spec, m, database.wait_share, seed)
    profile = replace(profile, db_capacity=int(database.max_concurrent_queries))

    rows, errors = [], []
    for i, p in enumerate(points):
        s = simulate(spec, profile, p.tps, seed_from(seed, "validate", i)).summary
        err = 100 * abs(s["p95Ms"] - p.p95_ms) / max(p.p95_ms, 1)
        if i != calibration_index:
            errors.append(err)
        rows.append(
            p.as_dict()
            | {
                "predictedP95Ms": s["p95Ms"],
                "predictedCpuPct": s["cpuPct"],
                "predictedErrorRatePct": s["errorRatePct"],
                "p95ErrorPct": round(err, 1),
                "calibration": i == calibration_index,
            }
        )
    mae = round(sum(errors) / len(errors), 1) if errors else None
    grade = "untested" if mae is None else "good" if mae <= 10 else "fair" if mae <= 25 else "poor"
    good = [r for r in rows if r["p95ErrorPct"] <= 25]
    valid_range = [min(r["tps"] for r in good), max(r["tps"] for r in good)] if good else None
    reasons = []
    if mae is None:
        reasons.append("Only one point: the model matches it by construction. Add more load levels to validate it.")
    else:
        reasons.append(f"Predicted p95 is off by {mae}% on average across {len(errors)} independent points ({grade}).")
        worst = max((r for r in rows if not r["calibration"]), key=lambda r: r["p95ErrorPct"])
        reasons.append(
            f"Largest gap at {worst['tps']:g} TPS: predicted {worst['predictedP95Ms']} ms, measured {worst['p95Ms']} ms."
        )
    return {
        "calibrationIndex": calibration_index,
        "calibration": cal,
        "points": rows,
        "meanAbsErrorPct": mae,
        "grade": grade,
        "validRangeTps": valid_range,
        "reasons": reasons,
    }
