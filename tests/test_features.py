import pytest

from loadtwin import SLA, Database, Load, MachineType, Measurement, Pattern, Point, Spec, autosize, evaluate, validate
from loadtwin.calibration import prepare
from loadtwin.loadtest import detect, parse_jmeter, parse_k6, parse_locust
from loadtwin.traffic import run_pattern, to_segments

MEASURED = Spec(vcpu=4, ram_gb=8, nodes=2, thread_pool=100, conn_pool=30, timeout_ms=3000)
M = Measurement(tps=40, cpu_pct=62, p95_ms=420, mem_pct=58, payload_kb=4, error_pct=0.1)
TARGET = Spec(vcpu=4, ram_gb=8, nodes=3, thread_pool=120, conn_pool=30, timeout_ms=2000)
DB = Database(0.6, 60)


@pytest.mark.parametrize(("peak", "verdicts"), [(45, {"PASS"}), (80, {"FAIL"})])
def test_monte_carlo_breach_probability(peak, verdicts):
    r = evaluate(MEASURED, M, TARGET, Load(8, peak, [1.5]), SLA(), DB, seed=3, replications=6)
    assert r["verdict"] in verdicts
    p = r["monteCarlo"]["breachProbability"]
    assert (p == 0) if peak == 45 else (p >= 0.5)


def test_autosize_recommends_cheapest_comfortable():
    cat = [MachineType("a", 2, 8, 0.1), MachineType("b", 4, 16, 0.2)]
    r = autosize(MEASURED, M, 60, SLA(), Database(), cat, seed=1)
    assert r["recommended"]["monthlyUsd"] == min(o["comfortable"]["monthlyUsd"] for o in r["options"] if o["comfortable"])
    assert r["cheapest"]["monthlyUsd"] <= r["recommended"]["monthlyUsd"]


def test_autosize_database_bound():
    r = autosize(MEASURED, M, 500, database=Database(0.6, 10), seed=1)
    assert r["options"] == [] and r["databaseLimitTps"] < 500 and "database" in r["notes"][0]


def test_patterns():
    profile, _ = prepare(MEASURED, M, TARGET, DB, 5)
    calm = run_pattern(TARGET, profile, Pattern("daily", peak_tps=40, seconds_per_hour=10), SLA(), 5)
    assert calm["verdict"] == "PASS" and calm["breachSeconds"] == 0
    spike = run_pattern(TARGET, profile, Pattern("spike", peak_tps=130, base_tps=30, spike_s=30), SLA(), 5)
    assert spike["verdict"] == "FAIL" and max(w["offeredTps"] for w in spike["windows"] if w["breach"]) > 60
    assert all(w["errorRatePct"] <= 100 for w in spike["windows"])
    assert len(to_segments(Pattern("ramp", peak_tps=50, base_tps=10))) == 10
    with pytest.raises(ValueError):
        to_segments(Pattern("custom"))


def test_parsers(examples_dir):
    lt = examples_dir / "loadtests"
    j = parse_jmeter((lt / "jmeter-results.csv").read_text())
    assert [round(p.tps) for p in j] == [10, 25, 40, 55]
    assert len(parse_locust((lt / "locust_stats_history.csv").read_text())) == 4
    assert parse_k6((lt / "k6-summary.json").read_text())[0].tps == pytest.approx(40, rel=0.05)
    assert detect('{"metrics": {}}') == "k6"
    with pytest.raises(ValueError):
        detect("a,b\n1,2")


def test_validate_scores_independent_points():
    pts = [Point(10, 402), Point(25, 414), Point(40, 428, cpu_pct=62, mem_pct=58), Point(55, 539)]
    r = validate(MEASURED, pts, payload_kb=4, seed=1)
    assert r["calibrationIndex"] == 2 and r["points"][2]["calibration"]
    assert r["grade"] in {"good", "fair"} and r["meanAbsErrorPct"] is not None
    one = validate(MEASURED, [Point(40, 428, cpu_pct=62)], seed=1)
    assert one["grade"] == "untested"
    with pytest.raises(ValueError):
        validate(MEASURED, [Point(40, 428)])
