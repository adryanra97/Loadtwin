"""Discrete-event digital twin of a horizontally scaled service (SimPy).

Every node owns a thread pool, CPU cores and a database connection pool as ``simpy.Resource``
objects. Requests arrive as a Poisson process, are spread round-robin across nodes behind a load
balancer, and each request holds one thread while it runs on the CPU, waits for the database
(holding a connection), waits for external dependencies, and runs on the CPU again. The same
input with the same seed always produces the same numbers.

Attributes
----------
BUCKET_S : float
    Time-series resolution in seconds.
SAMPLE_S : float
    Sampling interval for pool and memory utilization in seconds.
WARMUP_S : float
    Warm-up period excluded from measurements, in seconds.
DURATION_S : float
    Default measurement window in seconds.
QUEUE_FACTOR : int
    Maximum thread queue as a multiple of the thread pool size; extra requests are rejected.
CONN_WAIT_S : float
    Maximum wait for a database connection before a request fails, in seconds.
USL_ALPHA, USL_BETA : float
    Contention and coherency coefficients of Gunther's Universal Scalability Law, used when the
    number of vCPUs per node changes: relative capacity C(N) = N / (1 + a (N - 1) + b N (N - 1)).
GC_THRESHOLD : float
    Heap usage ratio above which garbage collection slows down CPU work.
GC_SLOPE : float
    Extra CPU time per unit of heap ratio above ``GC_THRESHOLD``.
CPU_SIGMA : float
    Log standard deviation of per-request CPU time (lognormal, coefficient of variation about 0.53).
BACKGROUND_BURST_S : float
    Length of one slice of background CPU work (GC, scheduler, monitoring), in seconds.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass, field

import simpy

BUCKET_S = 2.0
SAMPLE_S = 0.25
WARMUP_S = 10.0
DURATION_S = 60.0
QUEUE_FACTOR = 2
CONN_WAIT_S = 1.0
USL_ALPHA = 0.03
USL_BETA = 0.0002
GC_THRESHOLD = 0.75
GC_SLOPE = 3.0
CPU_SIGMA = 0.5
BACKGROUND_BURST_S = 0.005


def usl_factor(reference_vcpu: int, target_vcpu: int) -> float:
    """CPU time multiplier when the number of vCPUs per node changes (Universal Scalability Law).

    With N vCPUs the relative throughput is C(N) = N / (1 + a (N - 1) + b N (N - 1)), so the
    effective CPU time per request is proportional to N / C(N). Adding vCPUs per node never scales
    linearly; adding nodes is not affected by this factor.

    Parameters
    ----------
    reference_vcpu : int
        vCPUs per node where the measurement was taken.
    target_vcpu : int
        vCPUs per node of the simulated environment.

    Returns
    -------
    float
        Ratio of target to reference CPU time per request; 1.0 when both are equal.
    """

    def cost(n: int) -> float:
        """Relative effective CPU time at ``n`` vCPUs."""
        n = max(int(n), 1)
        return 1 + USL_ALPHA * (n - 1) + USL_BETA * n * (n - 1)

    return cost(target_vcpu) / cost(reference_vcpu)


@dataclass
class Spec:
    """Resources of one node and the size of the cluster.

    Attributes
    ----------
    vcpu : int
        vCPUs per node.
    ram_gb : float
        RAM per node in GB.
    nodes : int
        Nodes behind the load balancer.
    thread_pool : int
        Worker threads per node.
    conn_pool : int
        Database connections per node.
    bandwidth_mbps : float, default 1000
        Network bandwidth per node in Mbps.
    timeout_ms : int, default 3000
        Request timeout in milliseconds.
    """

    vcpu: int
    ram_gb: float
    nodes: int
    thread_pool: int
    conn_pool: int
    bandwidth_mbps: float = 1000.0
    timeout_ms: int = 3000

    def __post_init__(self) -> None:
        """Clamp integer resources to at least one so the simulation stays valid."""
        self.vcpu = max(int(self.vcpu), 1)
        self.nodes = max(int(self.nodes), 1)
        self.thread_pool = max(int(self.thread_pool), 1)
        self.conn_pool = max(int(self.conn_pool), 1)
        self.timeout_ms = int(self.timeout_ms)

    @property
    def total_vcpu(self) -> int:
        """Total vCPUs across all nodes."""
        return self.vcpu * self.nodes


@dataclass
class Profile:
    """Per-request workload profile produced by calibration.

    Attributes
    ----------
    cpu_ms : float
        Mean CPU time per request in milliseconds.
    db_ms : float
        Mean database time while holding a connection, in milliseconds.
    ext_ms : float
        Mean wait for external dependencies, in milliseconds.
    payload_kb : float
        Mean payload size in KB.
    base_mem_gb : float
        Baseline memory per node in GB.
    mem_per_request_mb : float
        Memory held by each in-flight request, in MB.
    base_error_pct : float, default 0.0
        Load-independent error rate in percent.
    leak_gb : float, default 0.0
        Leaked memory per node in GB (memory-leak scenarios).
    batch_cpu_share : float, default 0.0
        Share of CPU cores held by a batch job, 0 to 1 (batch-overlap scenarios).
    background_cores : float, default 0.0
        CPU cores per node used by background work outside requests (GC, scheduler, agents).
    db_capacity : int, default 0
        Concurrent queries the shared database can serve across all nodes; 0 means unlimited.
    """

    cpu_ms: float
    db_ms: float
    ext_ms: float
    payload_kb: float
    base_mem_gb: float
    mem_per_request_mb: float
    base_error_pct: float = 0.0
    leak_gb: float = 0.0
    batch_cpu_share: float = 0.0
    background_cores: float = 0.0
    db_capacity: int = 0


@dataclass
class Fault:
    """A failure injected for part of the measurement window.

    Times are seconds from the start of the measurement window (after the warm-up).

    Attributes
    ----------
    start_s : float
        When the failure starts.
    end_s : float
        When it ends; ``math.inf`` keeps it until the end of the run.
    nodes_down : int, default 0
        Nodes that crash. The load balancer stops routing to them at once; requests already on
        them are lost and count as errors. They come back at ``end_s``.
    db_slowdown : float, default 1
        Multiplier on database time per query (2 = queries take twice as long).
    ext_fail_share : float, default 0
        Share of calls to external dependencies that hang until ``ext_timeout_ms`` and then fail
        the request.
    ext_timeout_ms : float, default 2000
        Client timeout for an external call that hangs.
    ext_slowdown : float, default 1
        Multiplier on the time of external calls that do not fail.
    """

    start_s: float
    end_s: float = math.inf
    nodes_down: int = 0
    db_slowdown: float = 1.0
    ext_fail_share: float = 0.0
    ext_timeout_ms: float = 2000.0
    ext_slowdown: float = 1.0

    def active(self, t: float) -> bool:
        """Whether the failure is in effect at simulation time ``t`` (warm-up included)."""
        return WARMUP_S + self.start_s <= t < WARMUP_S + self.end_s


@dataclass
class SimulationResult:
    """Output of one simulation run.

    Attributes
    ----------
    summary : dict
        Aggregate indicators: utilization of CPU, memory, network, thread pool, connection pool and
        database, latency percentiles, error and timeout rates, throughput and request counts.
    timeseries : list of dict
        One entry per ``BUCKET_S`` seconds with keys ``t``, ``cpu``, ``mem``, ``net``, ``thread``,
        ``conn``, ``p95``, ``tps`` (offered), ``throughput`` and ``errorPct``.
    latency_breakdown_ms : dict
        Mean time per request spent in each stage: thread queue, CPU queue, CPU, connection queue,
        database and external dependencies.
    events : list of tuple
        ``(arrival_s, latency_ms or None)`` for every measured request, ``None`` meaning it failed.
        Times are relative to the start of the measurement window. Used to judge phases of a run.
    """

    summary: dict
    timeseries: list = field(default_factory=list)
    latency_breakdown_ms: dict = field(default_factory=dict)
    events: list = field(default_factory=list)


def seed_from(*parts) -> int:
    """Deterministic random seed from any JSON-serializable values.

    Parameters
    ----------
    *parts : object
        Values to hash; ``str`` is used for anything JSON cannot encode.

    Returns
    -------
    int
        48-bit seed taken from the SHA-256 of the input.
    """
    raw = json.dumps(parts, sort_keys=True, default=str).encode()
    return int(hashlib.sha256(raw).hexdigest()[:12], 16)


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile.

    Parameters
    ----------
    values : list of float
        Samples.
    p : float
        Percentile between 0 and 1.

    Returns
    -------
    float
        The percentile, or 0.0 for an empty list.
    """
    if not values:
        return 0.0
    s = sorted(values)
    k = min(len(s) - 1, max(0, math.ceil(p * len(s)) - 1))
    return s[k]


def simulate(
    spec: Spec,
    profile: Profile,
    tps: float,
    seed: int,
    duration_s: float = DURATION_S,
    schedule: list[tuple[float, float]] | None = None,
    fault: Fault | None = None,
) -> SimulationResult:
    """Run one discrete-event simulation at a constant or piecewise-constant arrival rate.

    Parameters
    ----------
    spec : Spec
        Simulated cluster.
    profile : Profile
        Per-request workload profile.
    tps : float
        Arrival rate across the whole cluster, in requests per second.
    seed : int
        Random seed; the same seed gives the same result.
    duration_s : float, default DURATION_S
        Measurement window after the warm-up, in seconds. Ignored when ``schedule`` is given.
    schedule : list of (float, float), optional
        Time-varying load as ``(duration_s, tps)`` segments after the warm-up. The warm-up runs at
        the first segment's rate, and ``tps`` is then only used for the summary.
    fault : Fault, optional
        Failure injected for part of the window: crashed nodes, a slow database, or external
        dependencies that hang.

    Returns
    -------
    SimulationResult
        Summary, time series and latency breakdown.

    Notes
    -----
    The database is shared by every node: when ``profile.db_capacity`` is smaller than the total
    connection pool, queries queue at the database and that wait counts as database time. The error
    rate counts requests rejected because the thread queue is full, requests that could not get a
    connection within ``CONN_WAIT_S``, requests slower than the timeout, and requests still queued
    when the window ends.
    """
    env = simpy.Environment()
    rng = random.Random(seed)
    if schedule:
        duration_s = sum(d for d, _ in schedule)
        bounds, t = [], WARMUP_S
        for d, rate in schedule:
            t += d
            bounds.append((t, rate))
    else:
        bounds = [(math.inf, tps)]
    total = WARMUP_S + duration_s
    nbucket = math.ceil(total / BUCKET_S)

    class Node:
        """One service instance with its SimPy resources."""

        def __init__(self) -> None:
            """Create the thread pool, CPU cores and connection pool of this node."""
            self.threads = simpy.Resource(env, capacity=spec.thread_pool)
            self.cpu = simpy.Resource(env, capacity=spec.vcpu)
            self.conns = simpy.Resource(env, capacity=spec.conn_pool)
            self.inflight = 0
            self.alive = True
            self.epoch = 0
            self.died_at = 0.0

    nodes = [Node() for _ in range(spec.nodes)]
    db = simpy.Resource(env, capacity=profile.db_capacity) if profile.db_capacity > 0 else None
    db_busy = [0.0]
    st = {"arrived": 0, "completed": 0, "rejected": 0, "connection_failed": 0, "timeouts": 0, "lost": 0, "dependency_failed": 0}
    events: list[tuple[float, float | None]] = []
    b_alive = [0.0] * nbucket
    latencies: list[float] = []
    stages = {"thread_queue": 0.0, "cpu_queue": 0.0, "cpu": 0.0, "connection_queue": 0.0, "database": 0.0, "external": 0.0}
    b_lat: list[list[float]] = [[] for _ in range(nbucket)]
    b_cpu = [0.0] * nbucket
    b_bytes = [0.0] * nbucket
    b_thread = [0.0] * nbucket
    b_conn = [0.0] * nbucket
    b_mem = [0.0] * nbucket
    b_n = [0] * nbucket
    b_arr = [0] * nbucket
    b_fail = [0] * nbucket

    def bucket(t: float) -> int:
        """Index of the time-series bucket for simulation time ``t``."""
        return min(nbucket - 1, int(t / BUCKET_S))

    def cpu_work(node: Node, ms: float, rec: dict):
        """Queue for a core, then work for a lognormal time with mean ``ms``.

        Heap usage above ``GC_THRESHOLD`` stretches the work to model garbage collection.

        Yields
        ------
        simpy.events.Event
            Core request and work timeout.
        """
        t0 = env.now
        with node.cpu.request() as core:
            yield core
            rec["cpu_queue"] += env.now - t0
            heap = (profile.base_mem_gb + profile.leak_gb + node.inflight * profile.mem_per_request_mb / 1024) / spec.ram_gb
            gc = 1 + GC_SLOPE * max(heap - GC_THRESHOLD, 0)
            dur = rng.lognormvariate(math.log(max(ms, 0.01)) - CPU_SIGMA**2 / 2, CPU_SIGMA) / 1000.0 * gc
            yield env.timeout(dur)
            rec["cpu"] += dur
            b_cpu[bucket(env.now)] += dur

    def request(node: Node):
        """Lifecycle of one request from arrival to completion or failure.

        Yields
        ------
        simpy.events.Event
            Resource requests and timeouts.
        """
        t0 = env.now
        measured = t0 >= WARMUP_S
        st["arrived"] += 1 if measured else 0
        b_arr[bucket(t0)] += 1
        epoch = node.epoch

        def fail(kind: str, at: float | None = None) -> None:
            """Count this request as failed for reason ``kind``, at its arrival or at ``at``."""
            t = t0 if at is None else max(t0, at)
            b_fail[bucket(t)] += 1
            if measured:
                st[kind] += 1
                events.append((t - WARMUP_S, None))

        if len(node.threads.queue) >= spec.thread_pool * QUEUE_FACTOR:
            fail("rejected")
            return
        rec = dict.fromkeys(stages, 0.0)
        with node.threads.request() as th:
            yield th
            rec["thread_queue"] = env.now - t0
            node.inflight += 1
            yield from cpu_work(node, profile.cpu_ms * 0.6, rec)
            t1 = env.now
            with node.conns.request() as cn:
                got = yield cn | env.timeout(CONN_WAIT_S)
                rec["connection_queue"] = env.now - t1
                if cn not in got:
                    node.inflight -= 1
                    fail("connection_failed")
                    return
                d = rng.lognormvariate(math.log(max(profile.db_ms, 0.1)) - 0.08, 0.4) / 1000.0
                if fault is not None and fault.db_slowdown != 1 and fault.active(env.now):
                    d *= fault.db_slowdown
                if db is None:
                    yield env.timeout(d)
                    rec["database"] = d
                else:
                    t2 = env.now
                    with db.request() as q:
                        yield q
                        yield env.timeout(d)
                        if t2 >= WARMUP_S:
                            db_busy[0] += d
                    rec["database"] = env.now - t2
            if profile.ext_ms > 0:
                e = rng.lognormvariate(math.log(profile.ext_ms) - 0.08, 0.4) / 1000.0
                if fault is not None and fault.active(env.now) and (fault.ext_fail_share > 0 or fault.ext_slowdown != 1):
                    if fault.ext_fail_share > 0 and rng.random() < fault.ext_fail_share:
                        yield env.timeout(fault.ext_timeout_ms / 1000.0)
                        node.inflight -= 1
                        fail("dependency_failed")
                        return
                    e *= fault.ext_slowdown
                yield env.timeout(e)
                rec["external"] = e
            yield from cpu_work(node, profile.cpu_ms * 0.4, rec)
            node.inflight -= 1
        if node.epoch != epoch:
            # Lost when the node crashed: count it then, not when it arrived.
            fail("lost", node.died_at)
            return
        lat = env.now - t0
        b_bytes[bucket(env.now)] += profile.payload_kb * 2 * 1024 * 8
        if lat * 1000 > spec.timeout_ms:
            b_fail[bucket(t0)] += 1
        if measured:
            events.append((t0 - WARMUP_S, lat * 1000))
            st["completed"] += 1
            latencies.append(lat * 1000)
            b_lat[bucket(env.now)].append(lat * 1000)
            for k in stages:
                stages[k] += rec[k]
            if lat * 1000 > spec.timeout_ms:
                st["timeouts"] += 1

    def batch_job(node: Node, cores: int):
        """Hold ``cores`` CPU cores for the whole run (batch-overlap scenarios).

        Yields
        ------
        simpy.events.Event
            Core requests and one long timeout.
        """
        reqs = [node.cpu.request() for _ in range(cores)]
        for r in reqs:  # noqa: UP028 - SimPy sends values into the generator; yield from a list cannot
            yield r
        yield env.timeout(total + 1)

    def background(node: Node, duty: float):
        """Use one core for a ``duty`` share of the time (GC, scheduler, monitoring agents).

        Yields
        ------
        simpy.events.Event
            Core request, work slice and pause.
        """
        pause = BACKGROUND_BURST_S * (1 - duty) / duty
        while True:
            with node.cpu.request() as core:
                yield core
                yield env.timeout(BACKGROUND_BURST_S)
                b_cpu[bucket(env.now)] += BACKGROUND_BURST_S
            if pause > 0:
                yield env.timeout(pause)

    def rate_until(now: float) -> tuple[float, float]:
        """Return the current arrival rate and when it changes (warm-up uses the first segment)."""
        for end, rate in bounds:
            if now < end:
                return rate, end
        return bounds[-1][1], math.inf

    def arrivals():
        """Poisson arrivals distributed round-robin over the nodes.

        With a schedule, the rate is piecewise constant: an inter-arrival time that would cross a
        segment boundary is discarded and drawn again from the boundary, which is exact for a
        Poisson process because it is memoryless.

        Yields
        ------
        simpy.events.Timeout
            Exponential inter-arrival time, or the wait until the next segment.
        """
        i = 0
        while True:
            rate, end = rate_until(env.now)
            if rate <= 0:
                yield env.timeout(end - env.now)
                continue
            dt = rng.expovariate(rate)
            if env.now + dt > end:
                yield env.timeout(end - env.now)
                continue
            yield env.timeout(dt)
            up = [n for n in nodes if n.alive]
            if not up:
                b_arr[bucket(env.now)] += 1
                b_fail[bucket(env.now)] += 1
                if env.now >= WARMUP_S:
                    st["arrived"] += 1
                    st["rejected"] += 1
                    events.append((env.now - WARMUP_S, None))
                continue
            env.process(request(up[i % len(up)]))
            i += 1

    def crash():
        """Take ``fault.nodes_down`` nodes out of rotation for the fault window, then bring them back.

        Yields
        ------
        simpy.events.Timeout
            Waits until the start and the end of the failure.
        """
        yield env.timeout(WARMUP_S + fault.start_s)
        down = nodes[len(nodes) - min(fault.nodes_down, len(nodes)) :]
        for n in down:
            n.alive = False
            n.epoch += 1
            n.died_at = env.now
        if math.isfinite(fault.end_s):
            yield env.timeout(fault.end_s - fault.start_s)
            for n in down:
                n.alive = True

    def monitor():
        """Sample thread, connection and memory usage every ``SAMPLE_S`` seconds.

        Yields
        ------
        simpy.events.Timeout
            Sampling interval.
        """
        while True:
            b = bucket(env.now)
            up = [n for n in nodes if n.alive] or nodes
            busy_t = sum(n.threads.count for n in up) / (spec.thread_pool * len(up))
            busy_c = sum(n.conns.count for n in up) / (spec.conn_pool * len(up))
            queued = sum(len(n.threads.queue) for n in up) / len(up)
            inflight = sum(n.inflight for n in up) / len(up)
            b_alive[b] += len(up)
            mem = (
                profile.base_mem_gb
                + profile.leak_gb
                + (inflight * profile.mem_per_request_mb + queued * profile.payload_kb / 1024 * 4) / 1024
            )
            b_thread[b] += busy_t
            b_conn[b] += busy_c
            b_mem[b] += mem / spec.ram_gb
            b_n[b] += 1
            yield env.timeout(SAMPLE_S)

    bg_cores = min(profile.background_cores, spec.vcpu * 0.9)
    if bg_cores > 0.01:
        k = math.ceil(bg_cores)
        for n in nodes:
            for _ in range(k):
                env.process(background(n, bg_cores / k))
    batch_cores = round(spec.vcpu * profile.batch_cpu_share)
    if batch_cores > 0:
        for n in nodes:
            env.process(batch_job(n, min(batch_cores, spec.vcpu - 1)))
    env.process(arrivals())
    env.process(monitor())
    if fault is not None and fault.nodes_down > 0:
        env.process(crash())
    env.run(until=total)

    series = []
    for i in range(nbucket):
        n = max(b_n[i], 1)
        alive = b_alive[i] / n if b_n[i] else spec.nodes
        cpu_cap = spec.vcpu * alive * BUCKET_S
        net_cap = spec.bandwidth_mbps * 1e6 * alive * BUCKET_S
        batch_part = batch_cores * alive * BUCKET_S if batch_cores else 0
        series.append(
            {
                "t": round((i + 1) * BUCKET_S - WARMUP_S, 1),
                "cpu": round(100 * (b_cpu[i] + batch_part) / cpu_cap, 1),
                "mem": round(100 * b_mem[i] / n, 1),
                "net": round(100 * b_bytes[i] / net_cap, 2),
                "thread": round(100 * b_thread[i] / n, 1),
                "conn": round(100 * b_conn[i] / n, 1),
                "p95": round(percentile(b_lat[i], 0.95)) if b_lat[i] else None,
                "tps": round(b_arr[i] / BUCKET_S, 1),
                "throughput": round(len(b_lat[i]) / BUCKET_S, 1),
                "errorPct": round(100 * b_fail[i] / b_arr[i], 2) if b_arr[i] else 0.0,
            }
        )
    window = [d for d in series if d["t"] > 0]

    def mean(key: str) -> float:
        """Mean of one time-series column over the measurement window."""
        return round(sum(d[key] for d in window) / max(len(window), 1), 1)

    arrived = max(st["arrived"], 1)
    failed = st["rejected"] + st["connection_failed"] + st["timeouts"] + st["lost"] + st["dependency_failed"]
    stuck = sum(len(n.threads.queue) for n in nodes)
    err = 100 * (failed + stuck) / arrived + profile.base_error_pct
    ok = max(st["completed"], 1)
    summary = {
        "tps": round(tps, 2),
        "throughputTps": round(st["completed"] / duration_s, 2),
        "cpuPct": mean("cpu"),
        "memPct": round(max(d["mem"] for d in window), 1),
        "netPct": mean("net"),
        "threadPct": mean("thread"),
        "connPct": mean("conn"),
        "dbPct": round(100 * db_busy[0] / (profile.db_capacity * duration_s), 1) if db is not None else None,
        "p50Ms": round(percentile(latencies, 0.5)),
        "p95Ms": round(percentile(latencies, 0.95)),
        "p99Ms": round(percentile(latencies, 0.99)),
        "meanMs": round(sum(latencies) / ok, 1) if latencies else 0,
        "errorRatePct": round(min(err, 100.0), 2),
        "timeoutPct": round(100 * st["timeouts"] / arrived, 2),
        "rejected": st["rejected"],
        "connectionFailures": st["connection_failed"],
        "lostRequests": st["lost"],
        "dependencyFailures": st["dependency_failed"],
        "requests": st["arrived"],
    }
    breakdown = {k: round(v / ok * 1000, 1) for k, v in stages.items()}
    return SimulationResult(summary=summary, timeseries=series, latency_breakdown_ms=breakdown, events=events)
