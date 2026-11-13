# Changelog

## 0.3.0 (2026-11-13)

- **Failure scenarios** (`/api/v1/fault`, dashboard *Failures*): crash nodes, slow the database, or make external calls hang and fail or slow down, for part of the run. The failed run is compared with a healthy run on the same seed, phase by phase (before, during, after), with the recovery time. Requests lost on a crashed node count as errors at the moment of the crash.
- **Sensitivity analysis** (`/api/v1/sensitivity`, dashboard *Sensitivity*): vCPU, nodes, worker threads, DB connections, database, external and CPU time are each moved down and up with common random numbers; the tornado chart ranks them by p95 swing and the advice names what to change first.
- **Workspace**: save evaluations as scenarios per service, compare two side by side with the better value marked, print a report or comparison as PDF, and share a report as a self-contained link.
- **Ask** (`/api/v1/assistant`, dashboard *Ask*): plain-language what-if questions become a scenario that SimPy runs. Keyword rules in English and Indonesian work out of the box; an optional language model reads free-form questions and explains the result, and its explanation is rejected if it uses a number the simulation did not produce.
- `/api/health` reports whether Ask uses a language model or keyword rules.

## 0.2.0 (2026-11-13)

- **Web dashboard** (Next.js static export) served from the same origin as the API, on Vercel and in Docker: service setup with JSON export/import, Evaluate, Auto-size, Load patterns and Validate, with inline validation, run progress and cancel, charts with hover details, mobile and dark mode.
- Landing page with a live twin: drag the traffic slider and the engine simulates your service at that load. Bricolage Grotesque and Instrument Sans (both SIL OFL 1.1) are bundled in `web/app/fonts`.
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
