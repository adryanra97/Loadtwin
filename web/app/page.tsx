import Link from "next/link";
import { HomeDemo } from "@/components/home-demo";

const PRIMARY = [
  { number:"01", type:"CAPACITY ASSESSMENT", title:"Will this setup pass?", description:"Compare normal, peak and stress traffic against your response-time, error and resource limits. Find the first constraint.", href:"/evaluate/", cta:"Evaluate capacity", output:"SLA verdict & headroom" },
  { number:"02", type:"INFRASTRUCTURE PLANNING", title:"What should we provision?", description:"Explore node counts and machine types that carry peak traffic, with explicit headroom and illustrative cost estimates.", href:"/autosize/", cta:"Explore sizing", output:"Nodes & estimated cost" },
  { number:"03", type:"TRAFFIC RESILIENCE", title:"What happens under pressure?", description:"Simulate traffic ramps, daily peaks and sudden spikes. See the worst moment and the time your service spends above its SLA.", href:"/patterns/", cta:"Explore traffic patterns", output:"Peak load & recovery" },
];
const MORE = [
  {href:"/failures/",title:"Failure testing",detail:"Node crashes, slow databases and dependency timeouts"},
  {href:"/sensitivity/",title:"Sensitivity analysis",detail:"Which input has the largest effect on p95?"},
  {href:"/validate/",title:"Model validation",detail:"Compare predictions with k6, JMeter and Locust"},
  {href:"/ask/",title:"Ask LoadTwin",detail:"Explore what-if questions with simulation-backed answers"},
];
const EXAMPLE = [
  {tps:8,p95:402,label:"Normal"},
  {tps:45,p95:390,label:"Peak"},
  {tps:67.5,p95:411,label:"Stress 1.5×"},
  {tps:90,p95:777,label:"Stress 2×"},
];
function ExamplePanel(){
  const x=(i:number)=>62+i*128;
  const y=(v:number)=>231-v/1000*184;
  return <div className="lt-example">
    <div className="lt-example-head"><div className="lt-example-brand"><span className="lt-example-indicator" aria-hidden="true"/><div><strong>Capacity evaluation</strong><small>Example checkout API</small></div></div><span className="lt-sample-label">SAMPLE RESULT</span></div>
    <div className="lt-example-summary"><div><span className="lt-overline">PEAK · 45 REQ/S</span><strong>390 <small>ms</small></strong><span>Predicted p95 response time</span></div><div className="lt-example-pass"><b aria-hidden="true">✓</b> Meets the example SLA</div></div>
    <div className="lt-example-chart"><div className="lt-example-chart-head"><strong>Response time under load</strong><span>p95 · milliseconds</span></div>
      <svg viewBox="0 0 470 284" role="img" aria-label="Documented example: predicted p95 is 402 ms at 8 requests per second, 390 ms at 45, 411 ms at 67.5, and 777 ms at 90. The last run exceeds the CPU limit.">
        {[0,250,500,750,1000].map(v=><g className="lt-plot-grid" key={v}><line x1="62" x2="447" y1={y(v)} y2={y(v)}/><text x="48" y={y(v)+4} textAnchor="end">{v}</text></g>)}
        <polyline className="lt-plot-line" points={EXAMPLE.map((v,i)=>String(x(i))+","+String(y(v.p95))).join(" ")}/>
        {EXAMPLE.map((v,i)=><g key={v.tps}><circle className={i===3?"lt-plot-dot lt-plot-warn":"lt-plot-dot"} cx={x(i)} cy={y(v.p95)} r="5.5"/><text className="lt-plot-x" x={x(i)} y="259" textAnchor="middle">{v.tps}</text></g>)}
        <text className="lt-plot-axis-label" x="447" y="279" textAnchor="end">Requests / second</text>
      </svg>
    </div>
    <div className="lt-example-insight"><span aria-hidden="true">!</span><p><strong>The next bottleneck</strong>At 90 req/s, predicted CPU reaches 93.3%, above the example 80% limit — even though latency is still under 800 ms.</p></div>
    <p className="lt-example-note">Documented example simulation. These are not live production measurements.</p>
  </div>;
}

export default function Home(){
  return <div className="lt-home">
    <section className="lt-hero" aria-labelledby="lt-hero-title">
      <div className="lt-hero-wrap">
        <div className="lt-hero-copy">
          <div className="lt-hero-eyebrow"><span className="lt-eyebrow-dot"/> SIMULATION-LED CAPACITY PLANNING</div>
          <h1 id="lt-hero-title">Know your limits. <span>Before traffic finds them.</span></h1>
          <p>Turn load-test measurements into a digital twin of your service. See what happens when traffic grows, machines change or something fails — before committing to infrastructure.</p>
          <div className="lt-hero-actions"><Link className="lt-action lt-action-light" href="/evaluate/">Open evaluation <span aria-hidden="true">↗</span></Link><Link className="lt-action lt-action-outline" href="/service/">Set up my service <span aria-hidden="true">→</span></Link></div>
          <div className="lt-hero-proof"><span>✓ Calibrated from load tests</span><span>✓ SimPy-based simulation</span><span>✓ No sign-in required</span></div>
        </div>
        <ExamplePanel/>
      </div>
    </section>

    <section className="lt-section lt-what" aria-labelledby="lt-what-title">
      <div className="lt-section-intro"><span className="lt-overline">THE DECISIONS THAT MATTER</span><h2 id="lt-what-title">Less guessing. <span>Better infrastructure decisions.</span></h2><p>Start with a clear question. Explore the underlying detail only when you need to.</p></div>
      <div className="lt-capability-grid">{PRIMARY.map(t=><article className="lt-capability" key={t.href}><div className="lt-cap-kicker"><span>{t.number} / {t.type}</span><span aria-hidden="true">↗</span></div><h3>{t.title}</h3><p>{t.description}</p><div className="lt-cap-end"><span>{t.output}</span><Link href={t.href}>{t.cta} <span aria-hidden="true">→</span></Link></div></article>)}</div>
      <details className="lt-more-tools"><summary><span><strong>Need to dig deeper?</strong> Test failures, validate your model or identify the biggest performance drivers.</span><b>Explore more tools <span aria-hidden="true">+</span></b></summary><div className="lt-more-grid">{MORE.map(t=><Link href={t.href} key={t.href}><strong>{t.title}</strong><span>{t.detail}</span><b aria-hidden="true">↗</b></Link>)}</div></details>
    </section>

    <section className="lt-process"><div className="lt-section">
      <div className="lt-section-intro"><span className="lt-overline">HOW IT WORKS</span><h2>One measurement. <span>Three clear steps.</span></h2><p>LoadTwin models requests moving through queues and shared resources, rather than assuming twice the hardware means twice the capacity.</p></div>
      <div className="lt-step-grid"><div><span>01</span><h3>Start with evidence</h3><p>Enter the setup you measured, observed load, CPU usage and p95. An example is ready if you don&apos;t have test data yet.</p></div><div><span>02</span><h3>Explore the what-if</h3><p>Change traffic, machine sizes or simulated failures. Every scenario is processed by the same discrete-event engine.</p></div><div><span>03</span><h3>Decide with context</h3><p>Review the SLA verdict, limiting resource and model conditions. Save, compare or export the scenario.</p></div></div>
      <Link href="/service/" className="lt-inline-action">Set up your service <span aria-hidden="true">→</span></Link>
    </div></section>

    <section className="lt-section lt-play" aria-labelledby="lt-play-title">
      <div className="lt-play-head"><div><span className="lt-overline">INTERACTIVE PLAYGROUND</span><h2 id="lt-play-title">Change the load. <span>See what changes.</span></h2><p>Launch the interactive simulator when you are ready. It uses your saved service and the real simulation engine, rather than running calculations before you ask.</p></div><Link href="/service/" className="lt-inline-action">Edit inputs <span aria-hidden="true">↗</span></Link></div>
      <HomeDemo/>
    </section>

    <section className="lt-bottom"><div className="lt-section lt-bottom-wrap"><div><span className="lt-overline">READY WHEN YOU ARE</span><h2>A clearer picture of your next deployment.</h2><p>Service settings are saved in your browser. Simulation requests go to the engine. Always confirm high-impact decisions with a real load test.</p></div><div className="lt-bottom-actions"><Link href="/service/" className="lt-action lt-action-light">Set up a service <span aria-hidden="true">→</span></Link><Link href="/workspace/" className="lt-action lt-action-outline">Open workspace <span aria-hidden="true">↗</span></Link></div></div></section>
  </div>;
}
