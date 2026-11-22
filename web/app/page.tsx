import Link from "next/link";
import { TwinArchitecture } from "@/components/twin-architecture";
import { HomeDemo } from "@/components/home-demo";
import { TOOLS, type ToolId } from "@/lib/tools";

const TOOL_ORDER: ToolId[] = ["evaluate", "autosize", "patterns", "failures", "sensitivity", "validate", "ask"];

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
              <Link href="/evaluate/" className="ed-primary-cta">Run an evaluation <span aria-hidden="true">→</span></Link>
              <a href="#try" className="ed-secondary-cta">Try it live <span aria-hidden="true">↓</span></a>
            </div>
            <p className="ed-hero-annotation">A simulation tool for understanding capacity, cost and performance risk. No account required.</p>
          </div>
          <div className="ed-hero-figure"><TwinArchitecture /></div>
        </div>
        <div className="ed-hero-bottom"><div><span>01 — UNDERSTAND</span><span>02 — EXPERIMENT</span><span>03 — DECIDE</span></div><a href="#question">SCROLL TO EXPLORE <span aria-hidden="true">↓</span></a></div>
      </section>

      <section id="try" className="ed-play ed-section" aria-labelledby="ed-play-title">
        <div className="ed-container">
          <div className="ed-play-head"><div><span className="ed-label">THE INTERACTIVE MODEL</span><h2 id="ed-play-title">Curiosity, meet <em>consequence.</em></h2><p>Change the load or the machine setup. Add traffic, add nodes, crash one. Every change is re-simulated by the real engine, on the spot.</p></div><Link href="/service/" className="ed-text-link">Enter your measurements <span aria-hidden="true">→</span></Link></div>
          <HomeDemo />
        </div>
      </section>

      <section id="question" className="ed-statement ed-section" aria-labelledby="ed-question-title">
        <div className="ed-container ed-statement-grid">
          <div className="ed-section-mark"><span>THE QUESTION</span></div>
          <div className="ed-statement-content">
            <h2 id="ed-question-title">A load test tells you <em>what happened.</em><br />What about everything you haven&apos;t tested?</h2>
            <div className="ed-statement-lower">
              <p>Production conditions rarely stand still. Workloads shift. Machines change. Dependencies slow down. LoadTwin lets you explore those scenarios using an explicit model calibrated from the evidence you already have.</p>
              <Link href="/service/" className="ed-text-link">Enter your measurements <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="ed-evidence" aria-labelledby="ed-evidence-title">
        <div className="ed-container">
          <div className="ed-evidence-heading"><span className="ed-label">ONE EXAMPLE, TWO VERY DIFFERENT OUTCOMES</span><h2 id="ed-evidence-title">The first failure isn&apos;t always where you expect.</h2></div>
          <div className="ed-evidence-comparison">
            <div className="ed-evidence-cell">
              <span className="ed-evidence-index">PEAK TRAFFIC</span>
              <strong>45 <small>req/s</small></strong>
              <div className="ed-evidence-line"><span>Predicted CPU</span><b>46.8%</b></div>
              <div className="ed-evidence-line"><span>Predicted p95 latency</span><b>390 ms</b></div>
              <p className="ed-evidence-conclusion">Within the example thresholds.</p>
            </div>
            <div className="ed-evidence-connector" aria-hidden="true"><span>2×</span><b>→</b></div>
            <div className="ed-evidence-cell ed-evidence-risk">
              <span className="ed-evidence-index">STRESS TRAFFIC (2× PEAK)</span>
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
          <div className="ed-decisions-intro"><p className="ed-label">THE TOOLS</p><h2 id="ed-decisions-title">Seven questions for <em>the same model.</em></h2><p>Each tool asks your calibrated twin something different: will it hold, what to buy, what happens when a node dies. Start with Evaluate; every tool reuses the service you saved.</p></div>
          <div className="ed-toolkit">
            <ul className="ed-toolkit-grid">
              {TOOL_ORDER.map((id) => {
                const t = TOOLS[id];
                return (
                  <li key={id}>
                    <Link href={t.href} className="ed-tool">
                      <span className="ed-tool-group">{id === "evaluate" ? "Start here" : t.group}</span>
                      <strong>{t.name}</strong>
                      <span className="ed-tool-q">{t.question}</span>
                      <span className="ed-tool-gives">{t.gives}</span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <a href="#try" className="ed-tool ed-tool-live">
                  <span className="ed-tool-group">Play</span>
                  <strong>Live mode</strong>
                  <span className="ed-tool-q">Add traffic, add nodes, crash one, and watch.</span>
                  <span className="ed-tool-gives">Re-simulated on every click, on this page</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section id="approach" className="ed-approach ed-section" aria-labelledby="ed-approach-title">
        <div className="ed-container ed-approach-grid">
          <div><p className="ed-label">THE METHOD</p><h2 id="ed-approach-title">Every prediction traces back to <em>your own load test.</em></h2><p>LoadTwin is built around discrete-event simulation with SimPy. It models queues and shared constraints rather than treating infrastructure capacity as a simple multiplier.</p><Link href="/validate/" className="ed-text-link">Explore model validation <span aria-hidden="true">→</span></Link></div>
          <ol className="ed-method-list">
            <li><span>01</span><div><h3>Calibrate</h3><p>Start with observed throughput, CPU and latency from a load test.</p></div></li>
            <li><span>02</span><div><h3>Simulate</h3><p>Change demand, resource sizing and failure conditions inside a controlled model.</p></div></li>
            <li><span>03</span><div><h3>Interpret</h3><p>Read the predicted limits, constraints and assumptions together — not as isolated scores.</p></div></li>
          </ol>
        </div>
      </section>


      <section className="ed-close" aria-labelledby="ed-close-title">
        <div className="ed-container ed-close-inner"><div><p className="ed-label">YOUR NEXT DEPLOYMENT</p><h2 id="ed-close-title">Find the breaking point <em>before your users do.</em></h2><p>Bring your test measurements, or begin with an example. See the model at work before making a capacity decision.</p></div><Link href="/service/" className="ed-close-cta">Enter your measurements <span aria-hidden="true">→</span></Link></div>
      </section>
    </div>
  );
}
