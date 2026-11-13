import Link from "next/link";
import { TwinArchitecture } from "@/components/twin-architecture";
import { HomeDemo } from "@/components/home-demo";

const DECISIONS = [
  { number: "01", category: "CAPACITY", question: "Will this system hold?", detail: "Understand if your target configuration meets latency, error and utilization limits — and which resource becomes the constraint first.", href: "/evaluate/", action: "Evaluate capacity" },
  { number: "02", category: "ARCHITECTURE", question: "What should we change?", detail: "Compare machines, node counts and the headroom of each option before committing to the next infrastructure configuration.", href: "/autosize/", action: "Explore auto-sizing" },
  { number: "03", category: "RESILIENCE", question: "What happens when things go wrong?", detail: "Explore surges, node failures and bottlenecks. See how simulated performance changes when the environment is under pressure.", href: "/failures/", action: "Test failure scenarios" },
];

export default function Home() {
  return (
    <div className="lt-home ed-home">
      <section className="ed-hero" aria-labelledby="ed-hero-title">
        <div className="ed-hero-shell">
          <div className="ed-hero-copy">
            <p className="ed-eyebrow"><span className="ed-rule" /> DIGITAL TWIN / CAPACITY INTELLIGENCE</p>
            <h1 id="ed-hero-title">Your next bottleneck is already <em>in the model.</em></h1>
            <p className="ed-hero-lede">LoadTwin turns real load-test measurements into a simulation of your service — so you can challenge the assumptions behind your next deployment.</p>
            <div className="ed-hero-cta">
              <Link href="/evaluate/" className="ed-primary-cta">Explore an evaluation <span aria-hidden="true">↗</span></Link>
              <a href="#approach" className="ed-secondary-cta">Understand the approach <span aria-hidden="true">↓</span></a>
            </div>
            <p className="ed-hero-annotation">A simulation tool for understanding capacity, cost and performance risk. No account required.</p>
          </div>
          <div className="ed-hero-figure"><TwinArchitecture /></div>
        </div>
        <div className="ed-hero-bottom"><div><span>01 — UNDERSTAND</span><span>02 — EXPERIMENT</span><span>03 — DECIDE</span></div><a href="#question">SCROLL TO EXPLORE <span aria-hidden="true">↓</span></a></div>
      </section>

      <section id="question" className="ed-statement ed-section" aria-labelledby="ed-question-title">
        <div className="ed-container ed-statement-grid">
          <div className="ed-section-mark"><span>THE QUESTION</span><span>01 / 04</span></div>
          <div className="ed-statement-content">
            <h2 id="ed-question-title">A load test tells you <em>what happened.</em><br />What about everything you haven&apos;t tested?</h2>
            <div className="ed-statement-lower">
              <p>Production conditions rarely stand still. Workloads shift. Machines change. Dependencies slow down. LoadTwin lets you explore those scenarios using an explicit model calibrated from the evidence you already have.</p>
              <Link href="/service/" className="ed-text-link">Start with your measurements <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="ed-evidence" aria-labelledby="ed-evidence-title">
        <div className="ed-container">
          <div className="ed-evidence-heading"><span className="ed-label">ONE EXAMPLE, TWO VERY DIFFERENT OUTCOMES</span><h2 id="ed-evidence-title">The first failure isn&apos;t always where you expect.</h2></div>
          <div className="ed-evidence-comparison">
            <div className="ed-evidence-cell">
              <span className="ed-evidence-index">01 / PEAK TRAFFIC</span>
              <strong>45 <small>req/s</small></strong>
              <div className="ed-evidence-line"><span>Predicted CPU</span><b>46.8%</b></div>
              <div className="ed-evidence-line"><span>Predicted p95 latency</span><b>390 ms</b></div>
              <p className="ed-evidence-conclusion">Within the example thresholds.</p>
            </div>
            <div className="ed-evidence-connector" aria-hidden="true"><span>2×</span><b>→</b></div>
            <div className="ed-evidence-cell ed-evidence-risk">
              <span className="ed-evidence-index">02 / STRESS TRAFFIC</span>
              <strong>90 <small>req/s</small></strong>
              <div className="ed-evidence-line"><span>Predicted CPU</span><b>93.3%</b></div>
              <div className="ed-evidence-line"><span>Predicted p95 latency</span><b>777 ms</b></div>
              <p className="ed-evidence-conclusion">CPU breaches the 80% resource limit.</p>
            </div>
          </div>
          <div className="ed-evidence-caption"><span>THE TAKEAWAY</span><p>Latency alone would not tell the full story. In this documented example, resource saturation becomes the limiting factor as demand doubles.</p></div>
          <p className="ed-fine-print">Illustrative output reproduced from the project&apos;s documented example simulation. Not a measurement of a live production service.</p>
        </div>
      </section>

      <section id="decisions" className="ed-decisions ed-section" aria-labelledby="ed-decisions-title">
        <div className="ed-container">
          <div className="ed-decisions-intro"><p className="ed-label">THE WORK / THREE IMPORTANT DECISIONS</p><h2 id="ed-decisions-title">Complex systems.<br /><em>Clearer questions.</em></h2><p>One model. Different ways to understand how your service behaves — before you change the infrastructure behind it.</p></div>
          <div className="ed-decision-list">{DECISIONS.map(d=>(
            <Link href={d.href} key={d.number} className="ed-decision">
              <span className="ed-decision-number">{d.number}</span>
              <div className="ed-decision-main"><span>{d.category}</span><h3>{d.question}</h3><p>{d.detail}</p></div>
              <span className="ed-decision-action">{d.action} <b aria-hidden="true">↗</b></span>
            </Link>
          ))}</div>
          <p className="ed-decisions-note">Also available: <Link href="/patterns/">traffic patterns</Link>, <Link href="/sensitivity/">sensitivity analysis</Link>, <Link href="/validate/">model validation</Link> and <Link href="/ask/">what-if questions</Link>.</p>
        </div>
      </section>

      <section id="approach" className="ed-approach ed-section" aria-labelledby="ed-approach-title">
        <div className="ed-container ed-approach-grid">
          <div><p className="ed-label">THE METHOD</p><h2 id="ed-approach-title">Make the model visible.<br /><em>Make the decision defensible.</em></h2><p>LoadTwin is built around discrete-event simulation with SimPy. It models queues and shared constraints rather than treating infrastructure capacity as a simple multiplier.</p><Link href="/validate/" className="ed-text-link">Explore model validation <span aria-hidden="true">↗</span></Link></div>
          <ol className="ed-method-list">
            <li><span>01</span><div><h3>Calibrate</h3><p>Start with observed throughput, CPU and latency from a load test.</p></div></li>
            <li><span>02</span><div><h3>Simulate</h3><p>Change demand, resource sizing and failure conditions inside a controlled model.</p></div></li>
            <li><span>03</span><div><h3>Interpret</h3><p>Read the predicted limits, constraints and assumptions together — not as isolated scores.</p></div></li>
          </ol>
        </div>
      </section>

      <section id="explore" className="ed-play ed-section" aria-labelledby="ed-play-title">
        <div className="ed-container">
          <div className="ed-play-head"><div><span className="ed-label">THE INTERACTIVE MODEL</span><h2 id="ed-play-title">Curiosity, meet <em>consequence.</em></h2><p>Change the load or the machine setup. When you launch the playground, LoadTwin asks the real simulation engine to estimate the result.</p></div><Link href="/service/" className="ed-text-link">Change service inputs <span aria-hidden="true">↗</span></Link></div>
          <HomeDemo />
        </div>
      </section>

      <section className="ed-close" aria-labelledby="ed-close-title">
        <div className="ed-container ed-close-inner"><div><p className="ed-label">YOUR NEXT DEPLOYMENT</p><h2 id="ed-close-title">Know more.<br /><em>Assume less.</em></h2><p>Bring your test measurements, or begin with an example. See the model at work before making a capacity decision.</p></div><Link href="/service/" className="ed-close-cta">Build your service twin <span aria-hidden="true">↗</span></Link></div>
      </section>
    </div>
  );
}
