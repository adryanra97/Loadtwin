# Roadmap

LoadTwin grows in small, shippable releases. Each item keeps the same rule as today: numbers come from the simulation, never from guesses.

## Released

- **v0.1**: SimPy digital twin, calibration from one measurement, Universal Scalability Law, verdicts, capacity, HTTP API, CLI, Docker and Vercel.
- **v0.2**: web dashboard, Monte Carlo breach probability, cost-aware auto-sizing, load patterns (daily, spike, ramp, custom), and k6/JMeter/Locust import with multi-point validation.

## v0.3: Failure scenarios

One node down, a slow database, an external dependency timing out, memory leaks and overlapping batch jobs: does the cluster still meet its SLA?

## v0.4: Sensitivity analysis

Which input moves p95 the most: vCPU, nodes, thread pool, database time? Tornado charts and "what to change first" advice.

## v0.5: Compare and report

Save several scenarios, compare them side by side, and export a shareable report.

## Later

- Natural-language assistant that turns "what if traffic doubles on payday?" into a scenario and explains the simulated result.
- Multiple services in a call graph.
