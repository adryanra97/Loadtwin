"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useService } from "@/components/shell";
import { TwinStage } from "@/components/twin-stage";
import { FieldGroup, Notice } from "@/components/ui";
import { EXAMPLE_SERVICE } from "@/lib/defaults";
import { checkAll, DATABASE_FIELDS, MEASUREMENT_FIELDS, SLA_FIELDS, SPEC_FIELDS } from "@/lib/fields";
import { download } from "@/lib/format";
import type { Service } from "@/lib/types";

function validateService(s: Service) {
  return {
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

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        save(draft);
        setStatus("Saved. Every tool now uses these values.");
      }}
      noValidate
    >
      <div className="page-head">
        <h1>Your service</h1>
        <p className="lede">
          One measurement from a load test is enough to build the twin. Every tool uses what you enter here, and it stays in
          this browser.
        </p>
      </div>

      <div className="card">
        <TwinStage
          title="Your load test, as you measured it"
          nodes={Math.max(Number(draft.measuredSpec.nodes) || 1, 1)}
          frames={[
            {
              t: 0,
              tps: Number(draft.measurement.tps) || 0,
              cpu: Number(draft.measurement.cpuPct) || 0,
              p95: Number(draft.measurement.p95Ms) || 0,
              err: Number(draft.measurement.errorRatePct) || 0,
            },
          ]}
          maxTps={Math.max((Number(draft.measurement.tps) || 1) * 2, 1)}
          slaP95={Number(draft.sla.maxP95Ms) || undefined}
          slaCpu={Number(draft.sla.maxCpuPct) || 80}
          height={200}
          caption="This is the starting point of the twin: your measured environment at the load you tested. It updates as you type."
        />
      </div>

      <div className="card stack-sm">
        <label className="label" htmlFor="svc-name">
          Name
        </label>
        <input
          id="svc-name"
          className="plain"
          type="text"
          value={draft.name}
          maxLength={80}
          onChange={(e) => set("name")(e.target.value)}
        />
      </div>

      <div className="card">
        <FieldGroup
          legend="1. Where you ran the load test"
          description="The environment your measurement comes from, e.g. staging."
          prefix="measuredSpec"
          defs={SPEC_FIELDS}
          value={draft.measuredSpec}
          onChange={set("measuredSpec")}
          errors={errors}
        />
      </div>

      <div className="card">
        <FieldGroup
          legend="2. What the load test saw"
          description="Average values over a steady stretch of the test, not the warm-up."
          prefix="measurement"
          defs={MEASUREMENT_FIELDS}
          value={draft.measurement}
          onChange={set("measurement")}
          errors={errors}
        />
      </div>

      <div className="card">
        <FieldGroup
          legend="3. Where it will run"
          description="The setup to judge, e.g. production. Auto-size ignores this and searches for one."
          prefix="targetSpec"
          defs={SPEC_FIELDS}
          value={draft.targetSpec}
          onChange={set("targetSpec")}
          errors={errors}
        />
      </div>

      <div className="card">
        <FieldGroup
          legend="4. What “good enough” means (SLA)"
          prefix="sla"
          defs={SLA_FIELDS}
          value={draft.sla}
          onChange={set("sla")}
          errors={errors}
        />
      </div>

      <div className="card">
        <details className="more" open={Object.keys(errors).some((k) => k.startsWith("database")) || undefined}>
          <summary>5. Database (optional)</summary>
          <FieldGroup prefix="database" defs={DATABASE_FIELDS} value={draft.database} onChange={set("database")} errors={errors} />
        </details>
      </div>

      <div
        className="card spread"
        style={{ position: "sticky", bottom: 12, zIndex: 3, boxShadow: "0 4px 20px rgba(0,0,0,.1)" }}
        aria-label="Save changes"
      >
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!dirty || invalid}>
            Save service
          </button>
          <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(saved)}>
            Discard changes
          </button>
          <span className="small muted" role="status" aria-live="polite">
            {invalid ? `Fix ${Object.keys(errors).length} highlighted field(s) to save.` : dirty ? "Unsaved changes" : status}
          </span>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setDraft({ ...EXAMPLE_SERVICE });
              setStatus("Example loaded. Save to use it.");
            }}
          >
            Load example
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => download(`${(saved.name || "service").replace(/[^\w-]+/g, "-").toLowerCase()}.json`, { service: saved })}
          >
            Export JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {importError && <Notice tone="bad">{importError}</Notice>}
    </form>
  );
}
