"""Cost-aware auto-sizing: the cheapest cluster that meets the SLA at peak load.

For every machine type in a catalog, the fewest nodes that pass the SLA at peak load are found by
simulation, starting from an analytic CPU estimate, and priced per month. Calibration runs once and
the profile is rescaled per machine type with the Universal Scalability Law.

Attributes
----------
HOURS_PER_MONTH : float
    Billing hours in an average month.
DEFAULT_CATALOG : list of MachineType
    Generic machine types with illustrative on-demand prices; replace them with your provider's.
SEARCH_WINDOW_S : float
    Measurement window of each search simulation, shorter than a full evaluation to stay fast.
COMFORT_EXTRA_NODES : int
    Most nodes added on top of the minimal configuration when looking for headroom.
NODE_SCALED : set of str
    Resources whose utilization falls when nodes are added; memory per node and a shared database do not.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

from loadtwin.calibration import Database, Measurement, calibrate
from loadtwin.engine import Spec, seed_from, simulate, usl_factor
from loadtwin.evaluate import HEADROOM_LIMIT_PCT
from loadtwin.sla import SLA, utilization, violations

HOURS_PER_MONTH = 730.0
SEARCH_WINDOW_S = 30.0
COMFORT_EXTRA_NODES = 4
NODE_SCALED = {"cpu", "threadPool", "connectionPool", "network"}
_NAMES = {
    "cpu": "CPU",
    "memory": "memory",
    "threadPool": "worker threads",
    "connectionPool": "DB connections",
    "network": "network",
    "database": "the database",
}


@dataclass
class MachineType:
    """A purchasable node size.

    Attributes
    ----------
    name : str
    vcpu : int
    ram_gb : float
    hourly_usd : float
        On-demand price per node-hour.
    """

    name: str
    vcpu: int
    ram_gb: float
    hourly_usd: float


DEFAULT_CATALOG = [
    MachineType("general-2", 2, 8, 0.096),
    MachineType("general-4", 4, 16, 0.192),
    MachineType("general-8", 8, 32, 0.384),
    MachineType("general-16", 16, 64, 0.768),
    MachineType("compute-4", 4, 8, 0.170),
    MachineType("compute-8", 8, 16, 0.340),
]


@dataclass
class Pools:
    """Per-node pool sizing used for every candidate.

    Attributes
    ----------
    threads_per_vcpu : float, default 25
        Worker threads per vCPU; a node with N vCPUs gets ``N x threads_per_vcpu`` threads.
    conn_pool : int, default 30
        Database connections per node.
    timeout_ms : int, default 3000
    bandwidth_mbps : float, default 1000
    """

    threads_per_vcpu: float = 25.0
    conn_pool: int = 30
    timeout_ms: int = 3000
    bandwidth_mbps: float = 1000.0


def _candidate(m: MachineType, nodes: int, pools: Pools) -> Spec:
    """Cluster spec of ``nodes`` machines of type ``m``."""
    return Spec(
        vcpu=m.vcpu,
        ram_gb=m.ram_gb,
        nodes=nodes,
        thread_pool=max(round(m.vcpu * pools.threads_per_vcpu), 1),
        conn_pool=pools.conn_pool,
        bandwidth_mbps=pools.bandwidth_mbps,
        timeout_ms=pools.timeout_ms,
    )


def autosize(
    measured_spec: Spec,
    measurement: Measurement,
    peak_tps: float,
    sla: SLA | None = None,
    database: Database | None = None,
    catalog: list[MachineType] | None = None,
    pools: Pools | None = None,
    min_nodes: int = 2,
    max_nodes: int = 30,
    seed: int | None = None,
) -> dict:
    """Find, per machine type, the fewest nodes that meet the SLA at ``peak_tps``, and price them.

    Parameters
    ----------
    measured_spec : Spec
        Environment where the load test ran.
    measurement : Measurement
        What the load test observed.
    peak_tps : float
        Load the cluster must carry.
    sla : SLA, optional
        Acceptance criteria.
    database : Database, optional
        Database behaviour. A shared database caps the cluster no matter how many nodes are added.
    catalog : list of MachineType, optional
        Candidate machine types; ``DEFAULT_CATALOG`` when omitted.
    pools : Pools, optional
        Pool sizing applied to every candidate.
    min_nodes : int, default 2
        Smallest cluster considered (2 keeps one node of redundancy).
    max_nodes : int, default 30
        Largest cluster considered.
    seed : int, optional
        Random seed; derived from the input when omitted.

    Returns
    -------
    dict
        ``options`` per machine type sorted by the cost of its ``minimal`` configuration (fewest nodes
        meeting the SLA) with its ``comfortable`` configuration (fewest nodes keeping every resource at
        or below 75% at peak); ``recommended`` (cheapest comfortable, else cheapest minimal);
        ``cheapest``; ``databaseLimitTps``; ``notes``; and ``calibration``.
    """
    sla = sla or SLA()
    database = database or Database()
    catalog = catalog or DEFAULT_CATALOG
    pools = pools or Pools()
    if seed is None:
        seed = seed_from(vars(measured_spec), vars(measurement), peak_tps, vars(database))
    base, cal = calibrate(measured_spec, measurement, database.wait_share, seed)
    base.db_capacity = int(database.max_concurrent_queries)

    db_limit = None
    if base.db_capacity > 0:
        db_limit = round(base.db_capacity * 0.8 / max(base.db_ms / 1000, 0.0005), 1)
    if db_limit is not None and db_limit < peak_tps:
        return {
            "peakTps": peak_tps,
            "options": [],
            "recommended": None,
            "cheapest": None,
            "databaseLimitTps": db_limit,
            "notes": [
                f"The shared database serves about {db_limit:g} TPS at 80% utilization, below the {peak_tps:g} TPS target. "
                "No number of nodes can fix this: scale the database, add a cache, or reduce queries per request."
            ],
            "calibration": cal,
            "hoursPerMonth": HOURS_PER_MONTH,
        }

    def run(m: MachineType, nodes: int, profile) -> dict:
        """Simulate ``nodes`` machines of type ``m`` at peak load."""
        spec = _candidate(m, nodes, pools)
        s = simulate(spec, profile, peak_tps, seed_from(seed, m.name, nodes), SEARCH_WINDOW_S).summary
        return {"nodes": nodes, "summary": s, "violations": violations(s, sla)}

    def describe(m: MachineType, r: dict) -> dict:
        """Price and indicators of one simulated cluster."""
        util = utilization(r["summary"])
        top_res, top_pct = max(util.items(), key=lambda kv: kv[1])
        return {
            "nodes": r["nodes"],
            "monthlyUsd": round(m.hourly_usd * r["nodes"] * HOURS_PER_MONTH, 2),
            "totalVcpu": m.vcpu * r["nodes"],
            "peak": {k: r["summary"][k] for k in ("cpuPct", "memPct", "threadPct", "p95Ms", "errorRatePct")},
            "topResource": top_res,
            "topUtilizationPct": top_pct,
            "violations": r["violations"],
        }

    options = []
    for m in catalog:
        profile = replace(base, cpu_ms=base.cpu_ms * usl_factor(measured_spec.vcpu, m.vcpu))
        usable = max(m.vcpu * sla.max_cpu_pct / 100 * 0.9 - profile.background_cores, 0.05)
        n = min(max(math.ceil(peak_tps * profile.cpu_ms / 1000 / usable), min_nodes), max_nodes)
        tried: dict[int, dict] = {}

        def at(k: int, m=m, profile=profile, tried=tried) -> dict:
            """Simulate ``k`` nodes, cached per node count."""
            if k not in tried:
                tried[k] = run(m, k, profile)
            return tried[k]

        # Minimal: walk up until the SLA holds, then down while it still holds.
        while at(n)["violations"] and n < max_nodes:
            n = min(max_nodes, n + max(1, n // 4))
        minimal = None
        if not at(n)["violations"]:
            while n > min_nodes and not at(n - 1)["violations"]:
                n -= 1
            minimal = at(n)
        # Comfortable: fewest nodes from the minimal one up with every resource at or below the headroom limit.
        # Only resources that shrink with more nodes are worth adding nodes for, and at most a few.
        comfortable = None
        if minimal is not None:
            for k in range(n, min(n + COMFORT_EXTRA_NODES, max_nodes) + 1):
                d = describe(m, at(k))
                if not d["violations"] and d["topUtilizationPct"] <= HEADROOM_LIMIT_PCT:
                    comfortable = at(k)
                    break
                if d["topResource"] not in NODE_SCALED:
                    break
        options.append(
            {
                "machine": {"name": m.name, "vcpu": m.vcpu, "ramGb": m.ram_gb, "hourlyUsd": m.hourly_usd},
                "fits": minimal is not None,
                "minimal": describe(m, minimal) if minimal else describe(m, at(max(tried))),
                "comfortable": describe(m, comfortable) if comfortable else None,
                "simulations": len(tried),
            }
        )

    options.sort(key=lambda o: (not o["fits"], o["minimal"]["monthlyUsd"]))
    fits = [o for o in options if o["fits"]]
    comfy = sorted((o for o in fits if o["comfortable"]), key=lambda o: o["comfortable"]["monthlyUsd"])
    recommended = None
    if comfy:
        recommended = {"machine": comfy[0]["machine"], "config": "comfortable"} | comfy[0]["comfortable"]
    elif fits:
        recommended = {"machine": fits[0]["machine"], "config": "minimal"} | fits[0]["minimal"]
    cheapest = {"machine": fits[0]["machine"], "config": "minimal"} | fits[0]["minimal"] if fits else None
    notes = []
    if not fits:
        notes.append(f"No machine type meets the SLA at {peak_tps:g} TPS with up to {max_nodes} nodes.")
    if recommended and cheapest and recommended["monthlyUsd"] > cheapest["monthlyUsd"]:
        extra = recommended["monthlyUsd"] - cheapest["monthlyUsd"]
        busiest = _NAMES.get(cheapest["topResource"], cheapest["topResource"])
        notes.append(
            f"The cheapest fit runs {busiest} at {cheapest['topUtilizationPct']}% at peak; "
            f"the recommendation costs ${extra:,.0f}/month more to keep every resource at or below {HEADROOM_LIMIT_PCT:g}%."
        )
    return {
        "peakTps": peak_tps,
        "options": options,
        "recommended": recommended,
        "cheapest": cheapest,
        "databaseLimitTps": db_limit,
        "notes": notes,
        "calibration": cal,
        "hoursPerMonth": HOURS_PER_MONTH,
    }
