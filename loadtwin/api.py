"""HTTP API (FastAPI). Run locally with ``uvicorn loadtwin.api:app``.

Every route lives under ``/api``. When a built dashboard is found (``LOADTWIN_WEB_DIR``, or ``web/out``
next to the package), it is served from ``/``; otherwise ``/`` redirects to the API documentation.

Environment variables
---------------------
LOADTWIN_API_KEY
    When set, ``/api/v1/*`` requires ``Authorization: Bearer <key>``.
LOADTWIN_CORS_ORIGINS
    Comma-separated origins allowed by CORS; ``*`` by default.
LOADTWIN_WEB_DIR
    Directory of the static dashboard build.
"""

from __future__ import annotations

import hmac
import os
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from loadtwin import __version__
from loadtwin.autosize import autosize
from loadtwin.calibration import prepare
from loadtwin.capacity import capacity
from loadtwin.engine import seed_from, simulate
from loadtwin.evaluate import evaluate
from loadtwin.loadtest import PARSERS, detect, validate
from loadtwin.models import (
    EXAMPLE_AUTOSIZE,
    EXAMPLE_EVALUATE,
    EXAMPLE_PATTERN,
    EXAMPLE_SIMULATE,
    EXAMPLE_VALIDATE,
    AutosizeRequest,
    EvaluateRequest,
    LoadtestFileIn,
    PatternRequest,
    SimulateRequest,
    ValidateRequest,
)
from loadtwin.traffic import run_pattern

app = FastAPI(
    title="LoadTwin",
    version=__version__,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    description=(
        "A discrete-event **digital twin** for capacity planning. Calibrate from load-test measurements, "
        "scale to the target environment, and simulate it with SimPy.\n\n"
        "- `POST /api/v1/evaluate`: verdict, limiting resource, capacity; optional Monte Carlo breach probability.\n"
        "- `POST /api/v1/autosize`: cheapest cluster per machine type that meets the SLA, priced per month.\n"
        "- `POST /api/v1/pattern`: daily, spike, ramp or custom load judged in 10-second windows.\n"
        "- `POST /api/v1/loadtest/parse` and `POST /api/v1/validate`: import k6, JMeter or Locust results "
        "and score the model against every measured point.\n"
        "- `POST /api/v1/simulate`: raw simulation of up to 10 loads.\n\n"
        "Source: https://github.com/adryanra97/loadtwin"
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("LOADTWIN_CORS_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_key(authorization: Annotated[str | None, Header()] = None) -> None:
    """Enforce the optional API key.

    Parameters
    ----------
    authorization : str, optional
        ``Authorization`` header.

    Raises
    ------
    fastapi.HTTPException
        401 when ``LOADTWIN_API_KEY`` is set and the bearer token does not match.
    """
    key = os.environ.get("LOADTWIN_API_KEY")
    if not key:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, key):
        raise HTTPException(401, "Missing or invalid API key.", headers={"WWW-Authenticate": "Bearer"})


meta = APIRouter(prefix="/api", tags=["meta"])
twin = APIRouter(prefix="/api/v1", tags=["twin"], dependencies=[Depends(require_key)])


def _timed(fn, *args, **kwargs) -> dict:
    """Run ``fn`` and add ``durationS`` to its result."""
    t0 = time.perf_counter()
    out = fn(*args, **kwargs)
    out["durationS"] = round(time.perf_counter() - t0, 3)
    return out


@meta.get("/health")
def health() -> dict:
    """Liveness check.

    Returns
    -------
    dict
        ``status``, ``version`` and ``auth`` (whether an API key is required).
    """
    return {"status": "ok", "version": __version__, "auth": bool(os.environ.get("LOADTWIN_API_KEY"))}


@meta.get("/v1/examples")
def examples() -> dict:
    """Ready-to-send request bodies.

    Returns
    -------
    dict
        Example bodies for every ``POST`` endpoint.
    """
    return {
        "evaluate": EXAMPLE_EVALUATE,
        "simulate": EXAMPLE_SIMULATE,
        "autosize": EXAMPLE_AUTOSIZE,
        "pattern": EXAMPLE_PATTERN,
        "validate": EXAMPLE_VALIDATE,
    }


@twin.post("/evaluate")
def evaluate_endpoint(req: EvaluateRequest) -> dict:
    """Evaluate whether the target environment carries the load within the SLA.

    Parameters
    ----------
    req : EvaluateRequest
        Measured environment and observation, target environment, loads, SLA, database and the
        number of Monte Carlo replications.

    Returns
    -------
    dict
        Verdict, reasons, conditions, limiting resource, calibration, scenarios, capacity, breaking
        point, ``monteCarlo`` (when replications are requested) and ``durationS``.
    """
    return _timed(
        evaluate,
        req.measuredSpec.to_spec(),
        req.measurement.to_measurement(),
        req.targetSpec.to_spec(),
        req.load.to_load(),
        req.sla.to_sla(),
        req.database.to_database(),
        req.seed,
        req.includeTimeseries,
        req.replications,
    )


@twin.post("/simulate")
def simulate_endpoint(req: SimulateRequest) -> dict:
    """Calibrate, then simulate the target at each load, without SLA or verdict.

    Parameters
    ----------
    req : SimulateRequest
        Measured environment and observation, target environment, loads.

    Returns
    -------
    dict
        ``calibration``, ``results`` per load, ``capacity`` at the highest load and ``durationS``.
    """

    def run() -> dict:
        target = req.targetSpec.to_spec()
        profile, cal = prepare(
            req.measuredSpec.to_spec(), req.measurement.to_measurement(), target, req.database.to_database(), req.seed
        )
        runs = []
        for tps in req.loadsTps:
            r = simulate(target, profile, tps, seed_from(req.seed, "simulate", tps))
            item = {"tps": tps, "summary": r.summary, "latencyBreakdownMs": r.latency_breakdown_ms}
            if req.includeTimeseries:
                item["timeseries"] = r.timeseries
            runs.append((r, item))
        top_r, top = max(runs, key=lambda x: x[1]["tps"])
        return {
            "calibration": cal,
            "results": [item for _, item in runs],
            "capacity": capacity(target, profile, top_r, top["tps"], req.cpuLimitPct),
        }

    return _timed(run)


@twin.post("/autosize")
def autosize_endpoint(req: AutosizeRequest) -> dict:
    """Find the cheapest cluster per machine type that meets the SLA at peak load.

    Parameters
    ----------
    req : AutosizeRequest
        Measured environment and observation, peak load, SLA, database, catalog and pool sizing.

    Returns
    -------
    dict
        ``options``, ``recommended``, ``cheapest``, ``databaseLimitTps``, ``notes``, ``calibration``
        and ``durationS``.
    """
    return _timed(
        autosize,
        req.measuredSpec.to_spec(),
        req.measurement.to_measurement(),
        req.peakTps,
        req.sla.to_sla(),
        req.database.to_database(),
        req.machine_types(),
        req.to_pools(),
        req.minNodes,
        req.maxNodes,
        req.seed,
    )


@twin.post("/pattern")
def pattern_endpoint(req: PatternRequest) -> dict:
    """Simulate a daily, spike, ramp or custom load pattern and judge it in 10-second windows.

    Parameters
    ----------
    req : PatternRequest
        Measured environment and observation, target environment, pattern, SLA and database.

    Returns
    -------
    dict
        Verdict, reasons, segments, windows, breach time, worst window, recovery time, calibration
        and ``durationS``.
    """

    def run() -> dict:
        target = req.targetSpec.to_spec()
        seed = req.seed if req.seed is not None else seed_from(req.model_dump(exclude={"seed"}))
        profile, cal = prepare(
            req.measuredSpec.to_spec(), req.measurement.to_measurement(), target, req.database.to_database(), seed
        )
        return run_pattern(target, profile, req.pattern.to_pattern(), req.sla.to_sla(), seed) | {"calibration": cal}

    return _timed(run)


@twin.post("/loadtest/parse")
def parse_endpoint(req: LoadtestFileIn) -> dict:
    """Turn a k6 summary, JMeter results CSV or Locust stats history into measured load points.

    Parameters
    ----------
    req : LoadtestFileIn
        File text and format (``auto`` detects it).

    Returns
    -------
    dict
        ``format`` and ``points`` (load, p95, error rate, duration).

    Raises
    ------
    fastapi.HTTPException
        422 when the file is not recognised or misses required fields.
    """
    try:
        fmt = detect(req.content) if req.format == "auto" else req.format
        points = PARSERS[fmt](req.content)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, f"Could not read the file: {exc}") from exc
    if len(points) > 20:
        points = sorted(points, key=lambda p: -(p.duration_s or 0))[:20]
        points.sort(key=lambda p: p.tps)
    return {"format": fmt, "points": [p.as_dict() for p in points]}


@twin.post("/validate")
def validate_endpoint(req: ValidateRequest) -> dict:
    """Calibrate on one measured point and score predictions against every other point.

    Parameters
    ----------
    req : ValidateRequest
        Environment the load test ran on and the measured points.

    Returns
    -------
    dict
        Calibration point, measured vs predicted p95 per point, mean error, grade, valid range and
        ``durationS``.
    """
    return _timed(
        validate,
        req.measuredSpec.to_spec(),
        [p.to_point() for p in req.points],
        req.calibrationIndex,
        req.database.to_database(),
        req.payloadKb,
        req.seed,
    )


app.include_router(meta)
app.include_router(twin)


def _web_dir() -> Path | None:
    """Directory of the dashboard build, if present."""
    env = os.environ.get("LOADTWIN_WEB_DIR")
    for candidate in [Path(env)] if env else [Path(__file__).resolve().parent.parent / "web" / "out"]:
        if (candidate / "index.html").is_file():
            return candidate
    return None


WEB_DIR = _web_dir()
if WEB_DIR is not None:
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
else:

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        """Redirect to the interactive documentation when no dashboard is built."""
        return RedirectResponse("/api/docs")
