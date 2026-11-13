"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useService } from "@/components/shell";
import { TwinStage } from "@/components/twin-stage";
import { FieldGroup, Notice } from "@/components/ui";
import { EXAMPLE_SERVICE } from "@/lib/defaults";
import { checkAll, DATABASE_FIELDS, MEASUREMENT_FIELDS, SLA_FIELDS, SPEC_FIELDS } from "@/lib/fields";
import { download } from "@/lib/format";
import type { Service } from "@/lib/types";

function validateService(s: Service) {
  return {
    ...(s.name.trim() ? {} : { name: "Enter a name for this service." }),
    ...checkAll("measuredSpec", SPEC_FIELDS, s.measuredSpec),
    ...checkAll("measurement", MEASUREMENT_FIELDS, s.measurement),
    ...checkAll("targetSpec", SPEC_FIELDS, s.targetSpec),
    ...checkAll("sla", SLA_FIELDS, s.sla),
    ...checkAll("database", DATABASE_FIELDS, s.database),
  };
}

function isService(x: unknown): x is Service {
  const s = x as Service;
  return !!s && typeof s === "object" && !!s.measuredSpec && !!s.measurement && !!s.targetSpec && !!s.sla && !!s.database;
}

export default function ServicePage() {
  const [saved, save, hydrated] = useService();
  const [draft, setDraft] = useState<Service>(saved);
  const [status, setStatus] = useState("");
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hydrated) setDraft(saved);
    // load the stored service once it is available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const errors = useMemo(() => validateService(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const invalid = Object.keys(errors).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Service>(k: K) => (v: Service[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setStatus("");
  };

  const onImport = async (file: File) => {
    setImportError("");
    try {
      const data = JSON.parse(await file.text());
      const svc = data.service ?? data;
      if (!isService(svc)) throw new Error("not a service");
      setDraft({ ...EXAMPLE_SERVICE, ...svc, name: svc.name || file.name.replace(/\.json$/, "") });
      setStatus("Imported. Review the values, then save.");
    } catch {
      setImportError("That file is not a LoadTwin service export. Export one from this page to see the format.");
    }
  };

  const issues = Object.keys(errors);
  const sectionIssues = (prefix: string) => issues.some(key => key === prefix || key.startsWith(prefix + "."));
  const jumpToFirstIssue = () => {
    const first = issues[0];
    if (!first) return;
    const group = first === "name" ? "service-name" : "service-" + first.split(".")[0];
    document.getElementById(group)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Review the highlighted fields before saving.");
  };

  return (
    <form
      className="lt-service"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) { jumpToFirstIssue(); return; }
        save(draft);
        setStatus("Saved. Your service is ready to use in all simulation tools.");
      }}
    >
      <div className="lt-service-header">
        <nav className="lt-service-breadcrumb" aria-label="Breadcrumb"><Link href="/">Overview</Link><span aria-hidden="true">/</span><span aria-current="page">Service setup</span></nav>
        <div className="lt-service-head-row">
          <div><span className="lt-overline">YOUR SIMULATION STARTS HERE</span><h1>Set up your service<span className="lt-service-period">.</span></h1><p>Use measurements from one load test to define your baseline. Then choose the environment you want to evaluate and the limits it needs to meet.</p></div>
          <button type="button" className="lt-use-example" onClick={() => { setDraft({ ...EXAMPLE_SERVICE }); setStatus("Example loaded. Review it and save to use it in your evaluations."); }}>↗ Use example values</button>
        </div>
        <div className="lt-service-assurance">
          <span><i aria-hidden="true">✓</i> Saved in this browser</span>
          <span><i aria-hidden="true">✓</i> All tools use the same setup</span>
          <span><i aria-hidden="true">✓</i> Change values any time</span>
        </div>
      </div>

      <div className="lt-service-layout">
        <aside className="lt-service-sidebar">
          <div className="lt-service-rail">
            <span className="lt-overline">SETUP CHECKLIST</span>
            <nav aria-label="Service setup sections">
              {[
                {id:"name",title:"Service name",n:"01"},
                {id:"measuredSpec",title:"Test environment",n:"02"},
                {id:"measurement",title:"Measured results",n:"03"},
                {id:"targetSpec",title:"Target environment",n:"04"},
                {id:"sla",title:"SLA thresholds",n:"05"},
                {id:"database",title:"Database settings",n:"+"},
              ].map(step => <a key={step.id} href={"#service-"+step.id}><span>{step.n}</span>{step.title}<b className={sectionIssues(step.id) ? "is-issue" : "is-ready"} aria-label={sectionIssues(step.id) ? "Check this section" : "Valid values"}>{sectionIssues(step.id) ? "!" : "✓"}</b></a>)}
            </nav>
            <div className="lt-service-sidebar-tip"><strong>Have your results ready?</strong><p>You need load (req/s), average CPU, p95 response time, and the hardware that ran the test. Start from an example if you don&apos;t have them yet.</p></div>
          </div>
        </aside>

        <div className="lt-service-content">
          <section id="service-name" className="lt-service-card" aria-labelledby="lt-service-name-title">
            <div className="lt-service-section-title"><span>01</span><div><h2 id="lt-service-name-title">Name your service</h2><p>Give this setup a recognizable name for your saved scenarios.</p></div></div>
            <div className="lt-service-name-field">
              <label htmlFor="svc-name">Service name</label>
              <input id="svc-name" type="text" className="plain" value={draft.name} maxLength={80} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "svc-name-error" : "svc-name-hint"} onChange={e => set("name")(e.target.value)} />
              {errors.name ? <span role="alert" className="error" id="svc-name-error">{errors.name}</span> : <small id="svc-name-hint">Example: Checkout API — staging benchmark</small>}
            </div>
          </section>

          <section id="service-measuredSpec" className="lt-service-card" aria-labelledby="lt-service-measured-title">
            <div className="lt-service-section-title"><span>02</span><div><h2 id="lt-service-measured-title">Where did you run the test?</h2><p>Describe the machines that produced your measured result. This is the baseline, not necessarily your target.</p></div></div>
            <FieldGroup prefix="measuredSpec" legend="Load-test environment" defs={SPEC_FIELDS} value={draft.measuredSpec} onChange={set("measuredSpec")} errors={errors} />
          </section>

          <section id="service-measurement" className="lt-service-card" aria-labelledby="lt-service-results-title">
            <div className="lt-service-section-title"><span>03</span><div><h2 id="lt-service-results-title">What did the test measure?</h2><p>Use values from a steady portion of the run, excluding warm-up traffic.</p></div></div>
            <FieldGroup prefix="measurement" legend="Observed load-test results" defs={MEASUREMENT_FIELDS} value={draft.measurement} onChange={set("measurement")} errors={errors} />
          </section>

          <section id="service-targetSpec" className="lt-service-card" aria-labelledby="lt-service-target-title">
            <div className="lt-service-section-title"><span>04</span><div><h2 id="lt-service-target-title">What setup should we evaluate?</h2><p>Describe the environment you want to run in production. LoadTwin uses the baseline to simulate this target.</p></div></div>
            <FieldGroup prefix="targetSpec" legend="Target environment" defs={SPEC_FIELDS} value={draft.targetSpec} onChange={set("targetSpec")} errors={errors} />
          </section>

          <section id="service-sla" className="lt-service-card" aria-labelledby="lt-service-sla-title">
            <div className="lt-service-section-title"><span>05</span><div><h2 id="lt-service-sla-title">What counts as acceptable?</h2><p>Set the response-time, error and resource limits your target environment must meet.</p></div></div>
            <FieldGroup prefix="sla" legend="Service level thresholds" defs={SLA_FIELDS} value={draft.sla} onChange={set("sla")} errors={errors} />
          </section>

          <section id="service-database" className="lt-service-card lt-service-optional" aria-label="Optional database settings">
            <details className="lt-service-details" open={sectionIssues("database") || undefined}>
              <summary><span className="lt-step-no">+</span><span><strong>Database &amp; dependencies</strong><small>Optional tuning if you know your query concurrency and waiting time</small></span><span className="lt-details-chevron" aria-hidden="true">⌄</span></summary>
              <div className="lt-service-details-body"><FieldGroup prefix="database" legend="Shared database model" defs={DATABASE_FIELDS} value={draft.database} onChange={set("database")} errors={errors} /></div>
            </details>
          </section>

          <details className="lt-service-preview">
            <summary>Preview the measured baseline <span aria-hidden="true">⌄</span></summary>
            <div className="lt-service-preview-body"><TwinStage
              title="Baseline from your measurements"
              nodes={Math.max(Number(draft.measuredSpec.nodes) || 1, 1)}
              frames={[{ t:0, tps:Number(draft.measurement.tps) || 0, cpu:Number(draft.measurement.cpuPct) || 0, p95:Number(draft.measurement.p95Ms) || 0, err:Number(draft.measurement.errorRatePct) || 0 }]}
              maxTps={Math.max((Number(draft.measurement.tps) || 1)*2,1)}
              slaP95={Number(draft.sla.maxP95Ms) || undefined}
              slaCpu={Number(draft.sla.maxCpuPct) || 80}
              height={200}
              caption="This visual reflects the load-test values you entered. It is your starting point, not a completed simulation."
            /></div>
          </details>

          <section className="lt-service-utilities" aria-label="Import and export">
            <div><strong>Manage your setup</strong><p>Import an earlier configuration or download your saved values as JSON.</p></div>
            <div className="lt-utility-buttons">
              <button type="button" className="btn btn-sm" onClick={()=>fileRef.current?.click()}>Import JSON</button>
              <button type="button" className="btn btn-sm" onClick={()=>download((saved.name || "service").replace(/[^\w-]+/g,"-").toLowerCase()+".json", {service:saved})}>Export saved JSON</button>
            </div>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event)=>{ const f=event.target.files?.[0];if(f) onImport(f);event.target.value=""; }}/>
            {importError && <Notice tone="bad">{importError}</Notice>}
          </section>
        </div>
      </div>

      <div className="lt-service-savebar" aria-label="Save service changes">
        <div className="lt-service-save-status" role="status" aria-live="polite">
          <span className={invalid ? "lt-save-dot is-invalid" : dirty ? "lt-save-dot is-dirty" : "lt-save-dot"} aria-hidden="true"/>
          <div><strong>{invalid ? (issues.length === 1 ? "1 field needs attention" : String(issues.length)+" fields need attention") : dirty ? "Unsaved changes" : "Your service is up to date"}</strong><small>{status || (invalid ? "Review the sections marked with an exclamation point." : dirty ? "Save to use these inputs in other tools." : "Changes are stored in this browser.")}</small></div>
        </div>
        <div className="lt-service-save-buttons">
          <button type="button" className="btn" disabled={!dirty} onClick={()=>{setDraft(saved);setStatus("Changes discarded.");}}>Discard</button>
          <button type="submit" className="btn btn-primary" disabled={!dirty}>{invalid ? "Review & save" : "Save service"}</button>
          {!dirty && !invalid && <Link href="/evaluate/" className="lt-service-next">Continue to evaluation →</Link>}
        </div>
      </div>
    </form>
  );
}
