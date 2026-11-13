from dataclasses import replace

from loadtwin.calibration import calibrate
from loadtwin.engine import Profile, Spec, percentile, seed_from, simulate, usl_factor


def profile(**kw):
    base = dict(cpu_ms=120, db_ms=40, ext_ms=60, payload_kb=4, base_mem_gb=4.5, mem_per_request_mb=2)
    return Profile(**(base | kw))


def test_usl_factor():
    assert usl_factor(4, 4) == 1
    assert 1.3 < usl_factor(4, 16) < 1.5
    assert usl_factor(16, 4) < 1


def test_spec_clamps_resources_to_one():
    s = Spec(vcpu=0, ram_gb=1, nodes=0, thread_pool=0, conn_pool=0)
    assert (s.vcpu, s.nodes, s.thread_pool, s.conn_pool) == (1, 1, 1, 1)


def test_deterministic_and_seed_sensitive(target):
    a = simulate(target, profile(), 40, seed=7, duration_s=20)
    b = simulate(target, profile(), 40, seed=7, duration_s=20)
    c = simulate(target, profile(), 40, seed=8, duration_s=20)
    assert a.summary == b.summary
    assert a.summary != c.summary
    assert seed_from({"a": 1}, 2) == seed_from({"a": 1}, 2)


def test_overload_is_nonlinear(target):
    ok = simulate(target, profile(), 45, seed=1, duration_s=20).summary
    hot = simulate(target, profile(), 110, seed=1, duration_s=20).summary
    assert hot["cpuPct"] > 95
    assert hot["p95Ms"] > 3 * ok["p95Ms"]
    assert hot["errorRatePct"] > 1


def test_small_thread_pool_rejects(target):
    s = simulate(replace(target, thread_pool=2), profile(), 60, seed=1, duration_s=20).summary
    assert s["rejected"] > 0 and s["errorRatePct"] > 5


def test_shared_database_queues(target):
    s = simulate(target, profile(db_capacity=2), 60, seed=1, duration_s=20).summary
    assert s["dbPct"] > 90
    assert s["connectionFailures"] > 0


def test_memory_leak_and_batch_job(target):
    base = simulate(target, profile(), 30, seed=1, duration_s=20).summary
    leak = simulate(target, profile(leak_gb=3), 30, seed=1, duration_s=20).summary
    batch = simulate(target, profile(batch_cpu_share=0.5), 30, seed=1, duration_s=20).summary
    assert leak["memPct"] > base["memPct"] + 30
    assert batch["cpuPct"] > base["cpuPct"] + 40


def test_background_full_core(target):
    s = simulate(target, profile(background_cores=2.0), 5, seed=1, duration_s=10).summary
    assert s["cpuPct"] >= 50


def test_timeseries_and_breakdown(target):
    r = simulate(target, profile(), 20, seed=1, duration_s=10)
    assert {"t", "cpu", "mem", "net", "thread", "conn", "p95"} <= set(r.timeseries[0])
    assert r.latency_breakdown_ms["cpu"] > 0
    assert percentile([], 0.95) == 0.0


def test_calibration_matches_measurement(measured, measurement):
    pr, info = calibrate(measured, measurement)
    assert info["errorPct"] <= 5
    assert info["cpuMsPerRequest"] == 124.0
    assert pr.db_ms > 0 and pr.ext_ms > 0


def test_calibration_moves_cpu_to_background(measured, measurement):
    pr, info = calibrate(measured, replace(measurement, p95_ms=60))
    assert info["backgroundCpuPct"] > 0
    assert pr.cpu_ms < 124
