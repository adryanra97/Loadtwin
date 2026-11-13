import Link from "next/link";
import { TwinHero } from "@/components/twin-hero";

const TOOLS = [
  {
    href: "/evaluate/",
    title: "Evaluate",
    q: "Does the production setup meet the SLA at peak, and how often would it break by chance?",
    out: "Verdict with reasons, limiting resource, capacity, breaking point, breach probability",
  },
  {
    href: "/autosize/",
    title: "Auto-size",
    q: "What is the cheapest cluster that carries my peak load?",
    out: "Fewest nodes per machine type, monthly cost, a recommendation with headroom",
  },
  {
    href: "/patterns/",
    title: "Patterns",
    q: "Does it survive a business day, a sudden spike or a steady ramp?",
    out: "Time over the SLA, the worst ten seconds, how long it takes to recover",
  },
  {
    href: "/failures/",
    title: "Failures",
    q: "What happens when a node crashes, the database slows down or a dependency times out?",
    out: "Before, during and after the failure against a healthy run, and the recovery time",
  },
  {
    href: "/sensitivity/",
    title: "Sensitivity",
    q: "Which setting moves p95 the most: vCPU, nodes, threads or database time?",
    out: "A ranking of every input by impact, and what to change first",
  },
  {
    href: "/validate/",
    title: "Validate",
    q: "How far can I trust the model? Import k6, JMeter or Locust results.",
    out: "Predicted against measured latency at every load level, and a trust grade",
  },
  {
    href: "/ask/",
    title: "Ask",
    q: "“What if traffic doubles on payday?” Ask in plain words.",
    out: "The question becomes a scenario, SimPy runs it, and the answer explains the numbers",
  },
];

export default function Home() {
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-copy">
          <h1 id="hero-h" className="hero-title">
            Find where your service breaks before your users do.
          </h1>
          <p className="hero-lede">
            LoadTwin builds a digital twin from one load test and simulates every request with SimPy: queues, threads, CPU,
            connections and the database. Try bigger traffic or other machines without paying for them first.
          </p>
          <div className="row hero-cta">
            <Link className="btn btn-primary btn-lg" href="/evaluate/">
              Evaluate the example
            </Link>
            <Link className="btn btn-lg" href="/service/">
              Enter my measurements
            </Link>
          </div>
        </div>
        <TwinHero />
      </section>

      <section aria-labelledby="tools-h" className="tools">
        <h2 id="tools-h">Questions it answers</h2>
        <ul className="tool-list">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="tool-row">
                <span className="tool-name">{t.title}</span>
                <span className="tool-q">{t.q}</span>
                <span className="tool-out">{t.out}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-h" className="how">
        <h2 id="how-h">How a result is made</h2>
        <ol className="how-steps">
          <li>
            <h3>Calibrate</h3>
            <p>
              CPU time per request and waiting time are fitted until the simulated p95 matches the one you measured. If the fit is
              off by more than 15%, you get “not assessable” instead of a guess.
            </p>
          </li>
          <li>
            <h3>Scale</h3>
            <p>
              The profile moves to the target machines. Bigger machines never scale perfectly, so contention is modelled with the
              Universal Scalability Law.
            </p>
          </li>
          <li>
            <h3>Simulate</h3>
            <p>
              Each request waits for a worker thread, a CPU core, a database connection and the shared database. The verdict comes
              from what happens in those queues, not from a formula.
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}
