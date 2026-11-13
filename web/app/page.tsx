import Link from "next/link";
import { ServiceStrip } from "@/components/shell";

const TOOLS = [
  {
    href: "/evaluate/",
    title: "Evaluate",
    q: "Does the target setup meet the SLA at peak, and how likely is it to break?",
    out: "Verdict, limiting resource, capacity, breach probability",
  },
  {
    href: "/autosize/",
    title: "Auto-size",
    q: "What is the cheapest cluster that carries my peak load?",
    out: "Nodes per machine type, monthly cost, recommendation",
  },
  {
    href: "/patterns/",
    title: "Load patterns",
    q: "Does it survive a daily curve, a sudden spike or a ramp?",
    out: "Time over the SLA, worst moment, recovery time",
  },
  {
    href: "/validate/",
    title: "Validate",
    q: "How far can I trust the model? Import k6, JMeter or Locust results.",
    out: "Predicted vs measured at every load level, a trust grade",
  },
];

export default function Home() {
  return (
    <div className="stack" style={{ gap: 28 }}>
      <section className="page-head" style={{ marginBottom: 0 }}>
        <h1>Will your service survive its load?</h1>
        <p className="lede">
          LoadTwin builds a digital twin of your service from one load-test measurement, then simulates it request by request
          with SimPy. Ask it about bigger traffic, other machines, or what the cheapest safe setup is, before you pay for
          the infrastructure.
        </p>
      </section>

      <section className="stack-sm" aria-labelledby="svc-h">
        <h2 id="svc-h" className="section-title">
          1. Describe your service
        </h2>
        <ServiceStrip />
        <p className="hint">
          This starts as an example. Replace it with your own measurement on the <Link href="/service/">Service</Link> page;
          every tool uses it.
        </p>
      </section>

      <section className="stack-sm" aria-labelledby="tools-h">
        <h2 id="tools-h" className="section-title">
          2. Ask a question
        </h2>
        <div className="grid-cards">
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href} className="card tool-card">
              <h3>{t.title}</h3>
              <p className="q">{t.q}</p>
              <p className="hint">{t.out}</p>
              <span className="go" aria-hidden>
                Open {t.title.toLowerCase()} →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="how-h">
        <h2 id="how-h" style={{ marginBottom: 12 }}>
          How it works
        </h2>
        <ol className="steps">
          <li>
            <div>
              <strong>Calibrate.</strong> CPU time per request and waiting time are fitted until the simulated p95 matches the
              one you measured. If the fit is off by more than 15%, LoadTwin says the result is not assessable instead of
              guessing.
            </div>
          </li>
          <li>
            <div>
              <strong>Scale.</strong> The profile is moved to the target machines. Larger machines do not scale perfectly, so
              contention is modelled with the Universal Scalability Law.
            </div>
          </li>
          <li>
            <div>
              <strong>Simulate.</strong> Every request queues for a worker thread, CPU, a database connection and the shared
              database. The verdict comes from what happens in that queue, not from a formula.
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}
