"""Maximum sustainable load per resource, using Little's Law where queues are involved."""

from __future__ import annotations

import math

from loadtwin.engine import Profile, SimulationResult, Spec


def capacity(spec: Spec, profile: Profile, at_load: SimulationResult, load_tps: float, cpu_limit_pct: float) -> dict:
    """Capacity of CPU, thread pool, connection pool, network and shared database.

    The smallest capacity is the cluster's maximum load and its resource is the limiting one.
    Little's Law (L = lambda x W) gives the capacity of the thread and connection pools and the
    suggested thread pool size per node.

    Parameters
    ----------
    spec : Spec
        Evaluated cluster.
    profile : Profile
        Calibrated workload profile.
    at_load : SimulationResult
        Simulation at the reference load, source of the residence time W per stage.
    load_tps : float
        The reference load (lambda) in requests per second.
    cpu_limit_pct : float
        Highest acceptable CPU utilization in percent.

    Returns
    -------
    dict
        ``maxTps``, ``limitingResource``, ``perResource`` (with the formula used) and
        ``littlesLaw`` (lambda, W, L, available and suggested threads per node).
    """
    b = at_load.latency_breakdown_ms
    w_thread = max(sum(b.get(k, 0) for k in ("cpu", "cpu_queue", "connection_queue", "database", "external")) / 1000, 0.001)
    w_conn = max(b.get("database", profile.db_ms) / 1000, 0.0005)
    bg = min(profile.background_cores, spec.vcpu * 0.9)
    cores = max(spec.vcpu * (1 - profile.batch_cpu_share) * cpu_limit_pct / 100 - bg, 0.01)
    per = [
        {
            "resource": "cpu",
            "maxTps": round(cores * spec.nodes * 1000 / max(profile.cpu_ms, 0.01), 1),
            "formula": (
                f"({spec.vcpu} vCPU x {cpu_limit_pct:.0f}% limit"
                + (f" - {bg:.2f} background cores" if bg > 0.01 else "")
                + f") x {spec.nodes} nodes / {profile.cpu_ms:.1f} ms CPU per request"
            ),
        },
        {
            "resource": "threadPool",
            "maxTps": round(spec.thread_pool * spec.nodes / w_thread, 1),
            "formula": f"L = {spec.thread_pool} x {spec.nodes} threads, W = {w_thread * 1000:.0f} ms, lambda = L / W",
        },
        {
            "resource": "connectionPool",
            "maxTps": round(spec.conn_pool * spec.nodes / w_conn, 1),
            "formula": f"L = {spec.conn_pool} x {spec.nodes} connections, W = {w_conn * 1000:.0f} ms, lambda = L / W",
        },
        {
            "resource": "network",
            "maxTps": round(spec.bandwidth_mbps * 1e6 * spec.nodes * 0.9 / (profile.payload_kb * 2 * 1024 * 8), 1),
            "formula": f"{spec.bandwidth_mbps:.0f} Mbps x {spec.nodes} nodes x 90% / ({profile.payload_kb:.0f} KB x 2)",
        },
    ]
    if profile.db_capacity > 0:
        per.append(
            {
                "resource": "database",
                "maxTps": round(profile.db_capacity * 0.8 / max(profile.db_ms / 1000, 0.0005), 1),
                "formula": (
                    f"{profile.db_capacity} concurrent queries x 80% / {profile.db_ms:.0f} ms per query (shared by all nodes)"
                ),
            }
        )
    limit = min(per, key=lambda x: x["maxTps"])
    in_flight = load_tps * w_thread
    return {
        "maxTps": limit["maxTps"],
        "limitingResource": limit["resource"],
        "perResource": per,
        "littlesLaw": {
            "lambdaTps": round(load_tps, 1),
            "wSeconds": round(w_thread, 3),
            "lRequests": round(in_flight, 1),
            "threadsPerNode": spec.thread_pool,
            "suggestedThreadsPerNode": max(math.ceil(in_flight / spec.nodes * 1.3), 1),
        },
    }
