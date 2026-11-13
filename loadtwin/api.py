"""HTTP API (FastAPI). Run locally with ``uvicorn loadtwin.api:app``.

Environment variables
---------------------
LOADTWIN_API_KEY
    When set, ``/v1/*`` requires ``Authorization: Bearer <key>``.
LOADTWIN_CORS_ORIGINS
    Comma-separated origins allowed by CORS; ``*`` by default.
"""

from __future__ import annotations

import hmac
import os
import time
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from loadtwin import __version__
from loadtwin.calibration import calibrate
from loadtwin.capacity import capacity
from loadtwin.engine import seed_from, simulate, usl_factor
from loadtwin.evaluate import evaluate
from loadtwin.models import EXAMPLE_EVALUATE, EXAMPLE_SIMULATE, EvaluateRequest, SimulateRequest

app = FastAPI(
    title="LoadTwin",
    version=__version__,
    description=(
        "A discrete-event **digital twin** for capacity planning. Calibrate from one load-test measurement, "
        "scale to the target environment, and simulate it with SimPy.\n\n"
        "- `POST /v1/evaluate`: verdict (PASS, PASS_WITH_CONDITIONS, FAIL, NOT_ASSESSABLE), limiting resource, "
        "capacity, normal/peak/stress scenarios.\n"
        "- `POST /v1/simulate`: raw simulation of up to 10 loads, no verdict.\n\n"
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


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """Redirect to the interactive documentation."""
    return RedirectResponse("/docs")


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Liveness check.

    Returns
    -------
    dict
        ``status`` and ``version``.
    """
    return {"status": "ok", "version": __version__}


@app.get("/v1/examples", tags=["meta"])
def examples() -> dict:
    """Ready-to-send request bodies.

    Returns
    -------
    dict
        Example bodies for ``/v1/evaluate`` and ``/v1/simulate``.
    """
    return {"evaluate": EXAMPLE_EVALUATE, "simulate": EXAMPLE_SIMULATE}


@app.post("/v1/evaluate", tags=["twin"], dependencies=[Depends(require_key)])
def evaluate_endpoint(req: EvaluateRequest) -> dict:
    """Evaluate whether the target environment carries the load within the SLA.

    Parameters
    ----------
    req : EvaluateRequest
        Measured environment and observation, target environment, loads, SLA, database.

    Returns
    -------
    dict
        Verdict, reasons, conditions, limiting resource, calibration, scenarios, capacity,
        breaking point and ``durationS``.
    """
    t0 = time.perf_counter()
    result = evaluate(
        req.measuredSpec.to_spec(),
        req.measurement.to_measurement(),
        req.targetSpec.to_spec(),
        req.load.to_load(),
        req.sla.to_sla(),
        req.database.to_database(),
        req.seed,
        req.includeTimeseries,
    )
    result["durationS"] = round(time.perf_counter() - t0, 3)
    return result


@app.post("/v1/simulate", tags=["twin"], dependencies=[Depends(require_key)])
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
    t0 = time.perf_counter()
    measured, target = req.measuredSpec.to_spec(), req.targetSpec.to_spec()
    db = req.database.to_database()
    profile, cal = calibrate(measured, req.measurement.to_measurement(), db.wait_share, req.seed)
    factor = usl_factor(measured.vcpu, target.vcpu)
    profile.cpu_ms *= factor
    profile.db_capacity = db.max_concurrent_queries
    cal.update(
        uslFactor=round(factor, 3),
        targetCpuMsPerRequest=round(profile.cpu_ms, 1),
        scaleRatio=round(target.total_vcpu / measured.total_vcpu, 2),
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
        "durationS": round(time.perf_counter() - t0, 3),
    }
