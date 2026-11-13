import pytest
from fastapi.testclient import TestClient

from loadtwin.api import app

client = TestClient(app)


def test_meta():
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/", follow_redirects=False).headers["location"] == "/docs"
    assert client.get("/docs").status_code == 200
    assert set(client.get("/v1/examples").json()) == {"evaluate", "simulate"}


def test_evaluate_and_simulate():
    ex = client.get("/v1/examples").json()
    r = client.post("/v1/evaluate", json=ex["evaluate"]).json()
    assert r["verdict"] == "PASS" and r["durationS"] > 0
    s = client.post("/v1/simulate", json={**ex["simulate"], "includeTimeseries": True}).json()
    assert [x["tps"] for x in s["results"]] == [8, 45, 75, 90]
    assert s["results"][-1]["summary"]["p95Ms"] > s["results"][0]["summary"]["p95Ms"]
    assert s["results"][0]["timeseries"]


@pytest.mark.parametrize(
    "patch",
    [
        {"load": {"normalTps": 8, "peakTps": 1500, "stressMultipliers": [2]}},
        {"targetSpec": {"vcpu": 0, "ramGb": 8, "nodes": 3, "threadPool": 120, "connPool": 30}},
        {"unknownField": 1},
    ],
)
def test_validation(patch):
    ex = client.get("/v1/examples").json()["evaluate"]
    assert client.post("/v1/evaluate", json=ex | patch).status_code == 422


def test_optional_api_key(monkeypatch):
    ex = client.get("/v1/examples").json()["simulate"] | {"loadsTps": [10]}
    monkeypatch.setenv("LOADTWIN_API_KEY", "secret")
    assert client.post("/v1/simulate", json=ex).status_code == 401
    ok = client.post("/v1/simulate", json=ex, headers={"Authorization": "Bearer secret"})
    assert ok.status_code == 200
