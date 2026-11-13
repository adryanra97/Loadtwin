# Roadmap

LoadTwin grows in small, shippable releases. Each item keeps the same rule as today: numbers come from the simulation, never from guesses.

## Released

- **v0.1**: SimPy digital twin, calibration from one measurement, Universal Scalability Law, verdicts, capacity, HTTP API, CLI, Docker and Vercel.
- **v0.2**: web dashboard, Monte Carlo breach probability, cost-aware auto-sizing, load patterns (daily, spike, ramp, custom), and k6/JMeter/Locust import with multi-point validation.
- **v0.3**: failure scenarios, sensitivity analysis, a workspace with comparison, PDF reports and share links, and the Ask assistant.

## Next

- **Retries and circuit breakers**: model client retries (which amplify load during failures) and a breaker that sheds calls to a failing dependency.
- **Multiple services**: a call graph where one service's latency is another's external wait.
- **Fitted scalability**: estimate the USL coefficients from a load test with several vCPU sizes instead of using defaults.

## Later

- Multiple services in a call graph.
