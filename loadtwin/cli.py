"""Command-line interface. The JSON files use the same schema as the HTTP API.

Examples
--------
    loadtwin example evaluate > scenario.json
    loadtwin evaluate scenario.json
    loadtwin evaluate scenario.json --json result.json
    loadtwin simulate examples/simulate.json
    loadtwin serve --port 8000
"""

from __future__ import annotations

import argparse
import json
import sys

from pydantic import ValidationError

from loadtwin import __version__


def _load(path: str, model):
    """Read and validate a JSON file (``-`` for stdin).

    Parameters
    ----------
    path : str
        File path or ``-``.
    model : type
        Pydantic request model.

    Returns
    -------
    pydantic.BaseModel
        Validated request.
    """
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    try:
        return model.model_validate_json(raw)
    except ValidationError as e:
        sys.exit(f"Invalid input in {path}:\n{e}")


def _table(rows: list[dict]) -> None:
    """Print scenario rows as an aligned table."""
    print(f"\n{'scenario':14} {'TPS':>7} {'CPU%':>6} {'Mem%':>6} {'Thr%':>6} {'p95 ms':>8} {'Err%':>6}  status")
    for r in rows:
        s = r["summary"]
        print(
            f"{r.get('name', ''):14} {r['tps']:>7g} {s['cpuPct']:>6} {s['memPct']:>6} {s['threadPct']:>6} "
            f"{s['p95Ms']:>8} {s['errorRatePct']:>6}  {r.get('status', '')}"
        )


def _save(result: dict, path: str | None) -> None:
    """Write the full result as JSON when ``path`` is given."""
    if path:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"\nFull result written to {path}")


def main(argv: list[str] | None = None) -> None:
    """Entry point of the ``loadtwin`` command.

    Parameters
    ----------
    argv : list of str, optional
        Arguments; ``sys.argv[1:]`` when omitted.
    """
    ap = argparse.ArgumentParser(prog="loadtwin", description="Digital twin for capacity planning (SimPy).")
    ap.add_argument("--version", action="version", version=f"loadtwin {__version__}")
    sub = ap.add_subparsers(dest="command", required=True)
    for name, help_ in (("evaluate", "verdict, limiting resource and capacity"), ("simulate", "raw simulation of several loads")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("file", help="JSON request (same schema as the API), or - for stdin")
        p.add_argument("--json", help="write the full result to this file")
    ex = sub.add_parser("example", help="print an example request")
    ex.add_argument("kind", choices=["evaluate", "simulate"])
    sv = sub.add_parser("serve", help="run the HTTP API")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)
    args = ap.parse_args(argv)

    if args.command == "example":
        from loadtwin.models import EXAMPLE_EVALUATE, EXAMPLE_SIMULATE

        print(json.dumps(EXAMPLE_EVALUATE if args.kind == "evaluate" else EXAMPLE_SIMULATE, indent=2))
        return
    if args.command == "serve":
        import uvicorn

        uvicorn.run("loadtwin.api:app", host=args.host, port=args.port)
        return

    from loadtwin.api import evaluate_endpoint, simulate_endpoint
    from loadtwin.models import EvaluateRequest, SimulateRequest

    if args.command == "evaluate":
        r = evaluate_endpoint(_load(args.file, EvaluateRequest))
        print(f"Verdict: {r['verdict']}   limiting resource: {r['limitingResource']}   ({r['durationS']} s)")
        for line in r["reasons"]:
            print(f"  - {line}")
        for line in r["conditions"]:
            print(f"  condition: {line}")
        c = r["calibration"]
        print(f"Calibration: {c['cpuMsPerRequest']} ms CPU/request, p95 error {c['errorPct']}%, scale {c['scaleRatio']}x")
        _table(r["scenarios"])
    else:
        r = simulate_endpoint(_load(args.file, SimulateRequest))
        print(f"Capacity: {r['capacity']['maxTps']} TPS, limited by {r['capacity']['limitingResource']}   ({r['durationS']} s)")
        _table(r["results"])
    _save(r, args.json)


if __name__ == "__main__":  # pragma: no cover
    main()
