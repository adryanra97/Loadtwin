# Roadmap

LoadTwin grows in small, shippable releases. Each item keeps the same rule as today: numbers come from the simulation, never from guesses.

## v0.1 (this release)

- SimPy digital twin: multi-node cluster, thread and connection pools, shared database, external dependencies, timeouts, GC pressure.
- Calibration from one load-test measurement; Universal Scalability Law for vCPU scaling.
- Verdicts, limiting resource, Little's Law capacity, stress scenarios and breaking point.
- HTTP API with Swagger, CLI, Docker image and Vercel deployment.

## v0.2: Auto-sizing with cost

Give a target load and SLA; LoadTwin searches node count and machine size for the cheapest configuration that passes, using a configurable price list, and shows the cost/headroom trade-off.

## v0.3: Confidence instead of a single run

Monte Carlo replications per scenario: p95 distribution, probability of breaching the SLA, and verdicts that state their confidence.

## v0.4: Realistic load

Time-varying load (daily curves, ramps, spikes) and import of k6, JMeter and Locust results. Multi-point calibration with a holdout check of fit quality.

## v0.5: Failure scenarios

One node down, a slow database, an external dependency timing out, memory leaks and overlapping batch jobs: does the cluster still meet its SLA?

## v0.6: Sensitivity analysis

Which input moves p95 the most: vCPU, nodes, thread pool, database time? Tornado charts and "what to change first" advice.

## v0.7: Web dashboard

A single-user dashboard: scenario workspace, side-by-side comparison, charts of every resource over time, and exportable reports.

## Later

- Natural-language assistant that turns "what if traffic doubles on payday?" into a scenario and explains the simulated result.
- Multiple services in a call graph.
