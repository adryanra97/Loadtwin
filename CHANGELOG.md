# Changelog

## 0.1.0 (2026-11-13)

First public release.

- Discrete-event digital twin (SimPy) of a multi-node service with thread pool, CPU cores, connection pool, shared database, external dependencies, timeouts, rejections and GC pressure.
- Calibration from one load-test measurement (CPU per request, background CPU, database and external waits) to within 5% of the measured p95.
- Universal Scalability Law correction when vCPUs per node change.
- `POST /v1/evaluate`: `PASS`, `PASS_WITH_CONDITIONS`, `FAIL`, `NOT_ASSESSABLE`, limiting resource, Little's Law capacity, stress scenarios and breaking point.
- `POST /v1/simulate`: raw simulation of up to 10 loads.
- CLI (`loadtwin evaluate | simulate | example | serve`), Docker image, Vercel configuration, optional API key.
