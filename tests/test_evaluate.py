from dataclasses import replace

from loadtwin import SLA, Database, Load, evaluate


def test_pass(measured, measurement, target):
    r = evaluate(measured, measurement, target, Load(8, 45, [1.5, 2]))
    assert r["verdict"] == "PASS"
    assert r["limitingResource"] == "cpu"
    assert r["capacity"]["maxTps"] == 77.4
    assert r["breakingPointTps"] == 90
    assert [s["status"] for s in r["scenarios"]] == ["PASS", "PASS", "PASS", "FAIL"]


def test_fail_at_peak(measured, measurement, target):
    r = evaluate(measured, measurement, target, Load(8, 90, []))
    assert r["verdict"] == "FAIL"
    assert any("CPU" in x for x in r["reasons"])


def test_thin_headroom_is_conditional(measured, measurement, target):
    r = evaluate(measured, measurement, target, Load(8, 74, []), sla=SLA(max_cpu_pct=90))
    assert r["verdict"] == "PASS_WITH_CONDITIONS"
    assert "headroom" in r["reasons"][0]


def test_far_extrapolation_is_conditional(measured, measurement, target):
    big = replace(target, vcpu=16, ram_gb=32, nodes=5)
    r = evaluate(measured, measurement, big, Load(20, 120, []))
    assert r["verdict"] == "PASS_WITH_CONDITIONS"
    assert r["calibration"]["scaleRatio"] == 10
    assert r["calibration"]["uslFactor"] > 1
    assert r["conditions"]


def test_unreproducible_measurement_is_not_assessable(measured, measurement, target):
    r = evaluate(measured, replace(measurement, p95_ms=1), target, Load(8, 45, []))
    assert r["verdict"] == "NOT_ASSESSABLE"


def test_database_bound(measured, measurement, target):
    r = evaluate(measured, measurement, target, Load(15, 30, []), database=Database(0.8, 4))
    assert r["limitingResource"] == "database"
    assert r["capacity"]["limitingResource"] == "database"


def test_latency_bound_by_external_dependency(measured, measurement, target):
    slow = replace(measurement, cpu_pct=10, p95_ms=1500)
    r = evaluate(measured, slow, target, Load(8, 20, []), sla=SLA(max_p95_ms=900), database=Database(0.1))
    assert r["verdict"] == "FAIL"
    assert r["limitingResource"] == "external"


def test_same_input_same_output(measured, measurement, target):
    a = evaluate(measured, measurement, target, Load(8, 45, []), include_timeseries=True)
    b = evaluate(measured, measurement, target, Load(8, 45, []), include_timeseries=True)
    assert a == b
    assert a["scenarios"][0]["timeseries"]
