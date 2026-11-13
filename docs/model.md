# The model

LoadTwin answers one question: *given what a load test measured on one environment, how will another environment behave under a given load?* It does so with a discrete-event simulation that is first calibrated to reproduce the measurement.

## 1. Request lifecycle

Each node has three SimPy resources: a **thread pool**, **CPU cores** and a **database connection pool**. The database itself can be a shared resource for the whole cluster.

```mermaid
flowchart LR
    A([Poisson arrivals]) --> LB[Round-robin load balancer]
    LB --> Q{Thread queue<br/>> 2x pool?}
    Q -- yes --> R[Rejected]
    Q -- no --> T[Hold a thread]
    T --> C1[CPU 60% of cpuMs]
    C1 --> CN{Connection<br/>within 1 s?}
    CN -- no --> F[Connection failure]
    CN -- yes --> DB[Database query<br/>shared capacity]
    DB --> EX[External dependencies]
    EX --> C2[CPU 40% of cpuMs]
    C2 --> D([Done; timeout if slower than timeoutMs])
```

- CPU time per request is lognormal (coefficient of variation about 0.5); database and external waits are lognormal too.
- When heap usage on a node exceeds 75%, CPU work is stretched to model garbage collection (up to about 1.6x at 95%).
- Background CPU (GC, scheduler, monitoring agents) occupies cores independently of requests.
- Warm-up: 10 s, measurement window: 60 s. Utilization is sampled every 0.25 s; the time series has 2 s buckets.

The error rate counts rejected requests, connection failures, timeouts and requests still queued at the end of the window, plus the measured baseline error rate.

## 2. Calibration

Input: load `λ`, CPU `u`, p95 and memory, measured on a spec with `v` vCPUs per node and `n` nodes.

1. **CPU per request**: `cpuMs = u × v × n × 1000 / λ`.
2. **Background split**: if this much CPU alone already pushes the simulated p95 above the measured p95, CPU per request is lowered (at most six steps) and the difference becomes background CPU, so total CPU still matches.
3. **Waits**: the combined database and external wait is found by bisection on a log scale between 2 ms and 20 s until the simulated p95 is within 5% of the measured p95. `waitShare` splits it between database and external dependencies.

Every calibration run uses the same seed so p95 moves monotonically with the wait. If the best fit is still more than 15% off, the verdict is `NOT_ASSESSABLE`.

## 3. Scaling to the target

Adding nodes adds capacity linearly, because the load balancer spreads requests evenly. Adding vCPUs per node does not: CPU time per request is multiplied by the Universal Scalability Law factor

```
cost(N) = 1 + α (N − 1) + β N (N − 1)      α = 0.03 (contention), β = 0.0002 (coherency)
factor  = cost(target vCPU) / cost(measured vCPU)
```

Going from 4 to 16 vCPUs per node multiplies CPU per request by about 1.37. When the target has more than 4x the measured CPU capacity, the result is flagged as a far extrapolation.

## 4. Capacity

At peak load, capacity is computed per resource and the smallest one bounds the cluster:

| Resource | Maximum load |
|---|---|
| CPU | `(vCPU × cpuLimit − background cores) × nodes × 1000 / cpuMs` |
| Thread pool | Little's Law: `threads × nodes / W`, with W the time a request holds a thread |
| Connection pool | `connections × nodes / W_db` |
| Network | `bandwidth × nodes × 90% / (payload × 2)` |
| Shared database | `maxConcurrentQueries × 80% / dbMs` |

Little's Law also gives the number of requests in flight at peak (`L = λW`) and a suggested thread pool size per node with 30% headroom.

## 5. Decision rules

Applied in order:

1. Calibration error above 15% → `NOT_ASSESSABLE`.
2. Any SLA violation at normal or peak load (p95, error rate, CPU, memory, or thread pool at 95% or more) → `FAIL`.
3. Target CPU capacity more than 4x the measured environment → `PASS_WITH_CONDITIONS`.
4. Highest utilization at peak above 75% → `PASS_WITH_CONDITIONS`.
5. Otherwise → `PASS`.

**Limiting resource** at peak: if p95 is violated while no resource is above 85% and most time is spent waiting, the dominant wait (database or external) is the limit. Otherwise it is the most utilized resource if that is at least 60%, else the resource that bounds capacity. On a tie between a saturated database and the connection pools behind it, the database wins.

## 6. Limitations

- One measurement point calibrates the model. Behaviour far above the measured load, especially where locks or caches change regime, is extrapolated; the far-extrapolation rule only partly guards against it.
- The USL coefficients are generic defaults, not fitted to your service.
- Arrivals are Poisson at a constant rate within a scenario; bursts and daily curves are on the roadmap.
- A single service is modelled. Downstream services appear only as an external wait time.
- Memory is modelled as baseline plus per-request usage; leaks and batch jobs exist in the engine but are not yet exposed in the API.

Treat the output as a well-reasoned estimate to be confirmed with a load test, not as a replacement for one.
