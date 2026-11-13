# Changelog

## 0.2.0 (2026-11-13)

- **Web dashboard** (Next.js static export) served from the same origin as the API, on Vercel and in Docker: service setup with JSON export/import, Evaluate, Auto-size, Load patterns and Validate, with inline validation, run progress and cancel, charts with hover details, mobile and dark mode.
- **Monte Carlo verdicts**: `replications` on `/api/v1/evaluate` repeats the peak run with independent seeds and returns the breach probability, breaches by cause and the spread of p95, CPU and errors. A probability above 5% makes a pass conditional; 50% or more fails.
- **Cost-aware auto-sizing** (`/api/v1/autosize`): fewest nodes per machine type that meet the SLA, and a headroom-safe option, priced per month from an editable catalog. Detects when a shared database caps the cluster.
- **Load patterns** (`/api/v1/pattern`): daily curve, spike, ramp or custom segments with piecewise Poisson arrivals, judged in 10-second windows with time over the SLA, the worst window and recovery time.
- **Load-test import and validation** (`/api/v1/loadtest/parse`, `/api/v1/validate`): k6, JMeter and Locust results become load points; the model calibrates on one and is scored on the others.
- Breaking change: every route now lives under `/api` (`/api/health`, `/api/docs`, `/api/v1/...`).

## 0.1.0 (2026-11-13)

First public release.

- Discrete-event digital twin (SimPy) of a multi-node service with thread pool, CPU cores, connection pool, shared database, external dependencies, timeouts, rejections and GC pressure.
- Calibration from one load-test measurement (CPU per request, background CPU, database and external waits) to within 5% of the measured p95.
- Universal Scalability Law correction when vCPUs per node change.
- `POST /v1/evaluate`: `PASS`, `PASS_WITH_CONDITIONS`, `FAIL`, `NOT_ASSESSABLE`, limiting resource, Little's Law capacity, stress scenarios and breaking point.
- `POST /v1/simulate`: raw simulation of up to 10 loads.
- CLI (`loadtwin evaluate | simulate | example | serve`), Docker image, Vercel configuration, optional API key.
