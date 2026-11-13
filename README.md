# LoadTwin

**Simulate your servers before production does it for you.**

LoadTwin is a discrete-event **digital twin** for capacity planning. Give it one load-test measurement from a small environment and the spec of the environment you care about, and it tells you whether that environment survives normal, peak and stress load: with a verdict, the limiting resource, the maximum sustainable load and the latency you should expect.

```text
$ loadtwin evaluate examples/evaluate-pass.json
Verdict: PASS   limiting resource: cpu   (1.1 s)
  - All indicators meet the SLA at normal and peak load with enough headroom.
  - Maximum sustainable load is 77.4 TPS (1.7x peak), bounded by cpu.
Calibration: 124.0 ms CPU/request, p95 error 1.9%, scale 1.5x

scenario           TPS   CPU%   Mem%   Thr%   p95 ms   Err%  status
normal               8    7.6   57.9    0.6      402    0.1  PASS
peak                45   46.8   58.0    3.5      390    0.1  PASS
stress-1.5x       67.5   69.9   58.1    5.4      411    0.1  PASS
stress-2x           90   93.3   58.5   10.5      777    0.1  FAIL
```

## Why

Load tests usually run on an environment that is smaller than production: fewer nodes, smaller machines. Problems that depend on capacity and topology, such as a CPU spike on one node, a thread pool that fills up or a database that cannot keep up, only show up after go-live. Linear extrapolation ("2x the nodes, 2x the throughput") hides exactly those problems.

LoadTwin replays the service as queues and resources in [SimPy](https://simpy.readthedocs.io), calibrated against what you actually measured:

| Step | What happens |
|---|---|
| **Calibrate** | Derive CPU time per request from the measured CPU and load, split off background CPU if needed, then search database and external wait times until the simulated p95 matches the measured p95 (within 5%). |
| **Scale** | Move the profile to the target spec. Adding vCPUs per node is corrected with the Universal Scalability Law, so it never scales linearly; adding nodes is not. |
| **Simulate** | Poisson arrivals, round-robin load balancer, per-node thread pool, CPU cores and connection pool, shared database, external dependencies, timeouts, rejections and GC slowdown under memory pressure. |
| **Decide** | Compare every scenario with your SLA, find the limiting resource, compute capacity per resource with Little's Law, and return a verdict. |

Same input, same output: every run is seeded from its input.

## Verdicts

| Verdict | Meaning |
|---|---|
| `PASS` | Normal and peak load meet the SLA with headroom. |
| `PASS_WITH_CONDITIONS` | The SLA is met, but headroom is thin (a resource above 75% at peak) or the target is more than 4x the measured environment, so the result is a far extrapolation. Conditions are listed. |
| `FAIL` | Normal or peak load violates the SLA (p95, error rate, CPU, memory, or a saturated thread pool). |
| `NOT_ASSESSABLE` | The model cannot reproduce your measurement within 15%, so its predictions would not be trustworthy. |

Stress scenarios are reported, and the first failing one is the `breakingPointTps`, but they never change the verdict.

## Quick start

### Docker

```bash
docker compose up --build        # or: docker build -t loadtwin . && docker run -p 8000:8000 loadtwin
```

Open <http://localhost:8000/docs> for the interactive API.

### Python

```bash
pip install .                    # Python 3.12+
loadtwin example evaluate > scenario.json
loadtwin evaluate scenario.json --json result.json
loadtwin serve --port 8000       # same API as the Docker image
```

### Vercel

The repository is ready to import into Vercel as is: `api/index.py` serves the whole API from one Python Function and `vercel.json` routes every path to it. Set `LOADTWIN_API_KEY` in the project settings to require `Authorization: Bearer <key>` on `/v1/*`.

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness and version. |
| `GET` | `/docs` | Swagger UI with ready-to-run examples. |
| `GET` | `/v1/examples` | Example request bodies. |
| `POST` | `/v1/evaluate` | Verdict, reasons, conditions, limiting resource, calibration, scenarios, capacity. |
| `POST` | `/v1/simulate` | Calibrate and simulate up to 10 loads, without SLA or verdict. |

```bash
curl -s -X POST http://localhost:8000/v1/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "measuredSpec": {"vcpu": 4, "ramGb": 8, "nodes": 2, "threadPool": 100, "connPool": 30},
    "measurement":  {"tps": 40, "cpuPct": 62, "p95Ms": 420, "memPct": 58},
    "targetSpec":   {"vcpu": 4, "ramGb": 8, "nodes": 3, "threadPool": 120, "connPool": 30, "timeoutMs": 2000},
    "load":         {"normalTps": 8, "peakTps": 45, "stressMultipliers": [1.5, 2]},
    "sla":          {"maxP95Ms": 800, "maxErrorRatePct": 1, "maxCpuPct": 80, "maxMemPct": 85},
    "database":     {"waitShare": 0.6, "maxConcurrentQueries": 60}
  }'
```

| Field | Meaning |
|---|---|
| `measuredSpec`, `measurement` | Where the load test ran and what it observed (load, CPU, p95, memory, payload, errors). |
| `targetSpec` | The environment to evaluate: vCPU and RAM per node, nodes, thread and connection pool per node, bandwidth, timeout. |
| `load` | Normal and peak load; stress scenarios are peak times each multiplier. |
| `sla` | Acceptance criteria. |
| `database` | Share of non-CPU wait spent in the database, and how many concurrent queries the shared database can serve (0 = unlimited). |

Request size is bounded (up to 2,000 TPS per scenario, 50 nodes, 10 loads) so a single call stays within a few seconds, which keeps a public deployment cheap. Typical calls take 1 to 2 seconds.

## Examples

| File | Shows | Result |
|---|---|---|
| [`evaluate-pass.json`](examples/evaluate-pass.json) | Healthy release | `PASS`, 77.4 TPS max, breaking point 90 TPS |
| [`evaluate-fail-peak.json`](examples/evaluate-fail-peak.json) | Peak above CPU capacity | `FAIL`: CPU 94% exceeds 80% |
| [`evaluate-scale-up.json`](examples/evaluate-scale-up.json) | Target 10x larger than the test environment | `PASS_WITH_CONDITIONS`: far extrapolation |
| [`evaluate-database-bound.json`](examples/evaluate-database-bound.json) | Small shared database | `PASS_WITH_CONDITIONS`: database at 92%, limited by database |
| [`simulate.json`](examples/simulate.json) | Raw curve at 8, 45, 75 and 90 TPS | p95 419, 432, 459, 595 ms as CPU approaches saturation |

## How it works

See [docs/model.md](docs/model.md) for the queueing model, calibration, scaling law, capacity formulas, decision rules and known limitations.

## Development

```bash
pip install -e ".[dev]"
pytest
ruff check . && ruff format --check .
```

CI runs lint, tests on Python 3.12 and 3.13, and builds and smoke-tests the Docker image.

## Roadmap

See [ROADMAP.md](ROADMAP.md): cost-aware auto-sizing, Monte Carlo confidence, time-varying load and load-test imports, failure scenarios, sensitivity analysis, and a web dashboard.

## License

[MIT](LICENSE)
