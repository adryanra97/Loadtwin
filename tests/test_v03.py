import json

import pytest

from loadtwin import SLA, Database, Measurement, Spec
from loadtwin import assistant as A
from loadtwin.calibration import prepare
from loadtwin.engine import Fault, simulate
from loadtwin.faults import run_fault
from loadtwin.sensitivity import sensitivity

MEASURED = Spec(vcpu=4, ram_gb=8, nodes=2, thread_pool=100, conn_pool=30, timeout_ms=3000)
M = Measurement(tps=40, cpu_pct=62, p95_ms=420, mem_pct=58, payload_kb=4, error_pct=0.1)
TARGET = Spec(vcpu=4, ram_gb=8, nodes=3, thread_pool=120, conn_pool=30, timeout_ms=2000)
DB = Database(0.6, 60)


@pytest.fixture(scope="module")
def profile():
    return prepare(MEASURED, M, TARGET, DB, 1)[0]


def test_no_fault_keeps_results_identical(profile):
    a = simulate(TARGET, profile, 45, 7)
    b = simulate(TARGET, profile, 45, 7, fault=Fault(1000, 2000, db_slowdown=5))
    assert a.summary == b.summary


@pytest.mark.parametrize(
    ("fault", "tps", "verdicts"),
    [
        (Fault(0, 40, nodes_down=1), 45, {"PASS", "PASS_WITH_CONDITIONS"}),
        (Fault(0, 40, nodes_down=2), 45, {"FAIL"}),
        (Fault(0, 40, ext_fail_share=0.3), 45, {"FAIL"}),
    ],
)
def test_faults(profile, fault, tps, verdicts):
    r = run_fault(TARGET, profile, tps, fault, SLA(), 3)
    assert r["verdict"] in verdicts
    assert r["phases"]["during"]["requests"] > 0 and r["timeline"]
    assert any(w["fault"] for w in r["timeline"]) and not r["timeline"][0]["fault"]


def test_slow_database_raises_p95(profile):
    r = run_fault(TARGET, profile, 45, Fault(0, 40, db_slowdown=3), SLA(), 3)
    assert r["phases"]["during"]["p95Ms"] > r["phases"]["healthyDuring"]["p95Ms"] * 1.3


def test_sensitivity_ranks_and_advises():
    r = sensitivity(MEASURED, M, TARGET, 70, SLA(), DB, params=["nodes", "threadPool", "cpuMs"])
    assert [p["param"] for p in r["params"]][0] == "nodes"
    assert r["params"][0]["swingMs"] >= r["params"][-1]["swingMs"]
    assert r["advice"]


@pytest.mark.parametrize(
    ("q", "tool", "key", "value"),
    [
        ("kalau trafik naik 2x saat payday gimana?", "evaluate", "loadMultiplier", 2),
        ("Kalau trafik naik 2× saat payday gimana?", "evaluate", "loadMultiplier", 2),
        ("Database lambat 3× selama 1 menit", "fault", "fault", {"dbSlowdown": 3, "durationS": 60}),
        ("What if one node goes down?", "fault", "fault", {"nodesDown": 1}),
        ("database lambat 3x", "fault", "fault", {"dbSlowdown": 3}),
        ("ada lonjakan flash sale", "pattern", "pattern", {"kind": "spike"}),
        ("parameter mana yang paling berpengaruh?", "sensitivity", None, None),
        ("traffic naik 50%", "evaluate", "loadMultiplier", 1.5),
    ],
)
def test_rule_plan(q, tool, key, value):
    plan = A.rule_plan(q)
    assert plan["tool"] == tool
    if key:
        assert plan[key] == value


def test_sanitize_clamps():
    clean = A.sanitize({"tool": "fault", "loadMultiplier": 1000, "fault": {"nodesDown": 99}}, 45, TARGET)
    assert clean["peakTps"] == 2000 and clean["fault"].nodes_down == TARGET.nodes - 1
    assert A.sanitize({"tool": "nope"}, 45, TARGET)["tool"] == "evaluate"


def test_number_guard():
    facts = {"p95Ms": 431, "errorRatePct": 0.1, "breachProbability": 0.25}
    assert A.unverified_numbers("p95 is 431 ms, 25% of runs break, errors 0.1%.", facts) == []
    assert A.unverified_numbers("p95 would be about 520 ms.", facts) == [520.0]


def test_ask_with_rules(monkeypatch):
    monkeypatch.delenv("LOADTWIN_LLM_API_KEY", raising=False)
    r = A.ask("trafik naik 2x", MEASURED, M, TARGET, 8, 45, SLA(), DB)
    assert r["planSource"] == "rules" and r["peakTps"] == 90 and r["explanationSource"] == "template"
    assert r["result"]["verdict"] in {"PASS", "PASS_WITH_CONDITIONS", "FAIL"}


def test_ask_with_llm_rejects_invented_numbers(monkeypatch):
    monkeypatch.setenv("LOADTWIN_LLM_API_KEY", "test")
    calls = []

    def fake(system, messages, tools=None, tool_choice=None):
        calls.append(tools is not None)
        if tools:
            return {"content": [{"type": "tool_use", "input": {"tool": "evaluate", "loadMultiplier": 2, "restated": "Peak x2"}}]}
        text = messages[0]["content"]
        facts = json.loads(text.split("RESULT: ", 1)[1])
        p95 = facts["peak"]["p95Ms"]
        text = f"Yes, it holds: p95 is {p95} ms." if len(calls) == 2 else "p95 is 12345 ms."
        return {"content": [{"type": "text", "text": text}]}

    monkeypatch.setattr(A, "_call_llm", fake)
    ok = A.ask("payday doubles traffic", MEASURED, M, TARGET, 8, 45, SLA(), DB)
    assert ok["planSource"] == "llm" and ok["explanationSource"] == "llm" and ok["restated"] == "Peak x2"
    calls.clear()
    calls.append(True)  # make the next explanation the invented one
    calls.append(True)
    bad = A.ask("payday doubles traffic", MEASURED, M, TARGET, 8, 45, SLA(), DB)
    assert bad["explanationSource"] == "template" and any("numbers" in n for n in bad["notes"])


def test_ask_llm_failure_falls_back(monkeypatch):
    monkeypatch.setenv("LOADTWIN_LLM_API_KEY", "test")

    def boom(*a, **k):
        raise TimeoutError

    monkeypatch.setattr(A, "_call_llm", boom)
    r = A.ask("2 node mati", MEASURED, M, TARGET, 8, 45, SLA(), DB)
    assert r["planSource"] == "rules" and r["tool"] == "fault" and r["notes"]
