from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from loadtwin.api import app

client = TestClient(app)
EXAMPLES = Path(__file__).resolve().parents[1] / "examples" / "loadtests"


def ex(name):
    return client.get("/api/v1/examples").json()[name]


def test_meta():
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["auth"] is False
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/openapi.json").json()["info"]["title"] == "LoadTwin"
    assert set(client.get("/api/v1/examples").json()) == {"evaluate", "simulate", "autosize", "pattern", "validate"}


def test_evaluate_and_simulate():
    r = client.post("/api/v1/evaluate", json=ex("evaluate")).json()
    assert r["verdict"] == "PASS" and r["durationS"] > 0 and r["monteCarlo"] is None
    s = client.post("/api/v1/simulate", json={**ex("simulate"), "includeTimeseries": True}).json()
    assert [x["tps"] for x in s["results"]] == [8, 45, 75, 90]
    assert s["results"][-1]["summary"]["p95Ms"] > s["results"][0]["summary"]["p95Ms"]
    assert s["results"][0]["timeseries"]


def test_evaluate_monte_carlo():
    r = client.post("/api/v1/evaluate", json=ex("evaluate") | {"replications": 5}).json()
    mc = r["monteCarlo"]
    assert mc["runs"] == 5 and 0 <= mc["breachProbability"] <= 1
    assert set(mc["distribution"]["p95Ms"]) >= {"p5", "p50", "p95"}


def test_autosize_endpoint():
    body = ex("autosize") | {"peakTps": 60, "catalog": ex("autosize")["catalog"][:2]}
    r = client.post("/api/v1/autosize", json=body).json()
    assert r["recommended"]["monthlyUsd"] > 0 and len(r["options"]) == 2


def test_pattern_endpoint():
    r = client.post("/api/v1/pattern", json=ex("pattern")).json()
    assert r["verdict"] in {"PASS", "PASS_WITH_CONDITIONS", "FAIL"} and r["windows"]


def test_parse_and_validate():
    for name, fmt in [("jmeter-results.csv", "jmeter"), ("locust_stats_history.csv", "locust"), ("k6-summary.json", "k6")]:
        r = client.post("/api/v1/loadtest/parse", json={"content": (EXAMPLES / name).read_text()}).json()
        assert r["format"] == fmt and r["points"]
    v = client.post("/api/v1/validate", json=ex("validate")).json()
    assert v["grade"] in {"good", "fair", "poor"} and len(v["points"]) == 4


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/v1/evaluate", lambda: ex("evaluate") | {"load": {"normalTps": 8, "peakTps": 1500, "stressMultipliers": [2]}}),
        ("/api/v1/evaluate", lambda: ex("evaluate") | {"targetSpec": {"vcpu": 0, "ramGb": 8, "nodes": 3}}),
        ("/api/v1/evaluate", lambda: ex("evaluate") | {"unknownField": 1}),
        ("/api/v1/evaluate", lambda: ex("evaluate") | {"replications": 50, "load": {"normalTps": 8, "peakTps": 200}}),
        ("/api/v1/autosize", lambda: ex("autosize") | {"minNodes": 5, "maxNodes": 3}),
        ("/api/v1/autosize", lambda: ex("autosize") | {"peakTps": 1000}),
        ("/api/v1/pattern", lambda: ex("pattern") | {"pattern": {"kind": "custom"}}),
        ("/api/v1/pattern", lambda: ex("pattern") | {"pattern": {"kind": "daily", "peakTps": 2000, "secondsPerHour": 60}}),
        ("/api/v1/loadtest/parse", lambda: {"content": "hello,world\n1,2"}),
        ("/api/v1/validate", lambda: ex("validate") | {"points": [{"tps": 10, "p95Ms": 300}]}),
    ],
)
def test_rejects_bad_input(path, body):
    assert client.post(path, json=body()).status_code == 422


def test_optional_api_key(monkeypatch):
    body = ex("simulate") | {"loadsTps": [10]}
    monkeypatch.setenv("LOADTWIN_API_KEY", "secret")
    assert client.get("/api/health").json()["auth"] is True
    assert client.post("/api/v1/simulate", json=body).status_code == 401
    assert client.post("/api/v1/simulate", json=body, headers={"Authorization": "Bearer secret"}).status_code == 200


def test_serves_dashboard_when_built(tmp_path, monkeypatch):
    import importlib

    import loadtwin.api as api

    (tmp_path / "index.html").write_text("<h1>dash</h1>")
    monkeypatch.setenv("LOADTWIN_WEB_DIR", str(tmp_path))
    mod = importlib.reload(api)
    try:
        c = TestClient(mod.app)
        assert "dash" in c.get("/").text and c.get("/api/health").status_code == 200
    finally:
        monkeypatch.delenv("LOADTWIN_WEB_DIR")
        importlib.reload(api)
