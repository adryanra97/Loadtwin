"use client";

import Link from "next/link";
import { useState } from "react";
import { num } from "@/lib/format";
import { newId, slim, useScenarios } from "@/lib/scenarios";
import type { EvaluateResult, SavedScenario, Service } from "@/lib/types";

export type EvaluateInput = {
  service: Service;
  load: { normalTps: number; peakTps: number; stressMultipliers: number[] };
  replications: number;
};

/** Save the evaluation on screen to the workspace, with a name the user can change. */
export function SaveScenario({ input, result }: { input: EvaluateInput; result: EvaluateResult }) {
  const [list, setList] = useScenarios();
  const t = input.service.targetSpec;
  const suggested = `${t.nodes} × ${t.vcpu} vCPU at ${num(input.load.peakTps)} req/s`;
  const [name, setName] = useState(suggested);
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = () => {
    const s: SavedScenario = {
      id: newId(),
      name: name.trim() || suggested,
      savedAt: new Date().toISOString(),
      service: input.service,
      load: input.load,
      replications: input.replications,
      result: slim(result),
    };
    setList([s, ...list].slice(0, 100));
    setSavedId(s.id);
  };

  return (
    <form
      className="card save-bar"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor="scn-name" className="label">
        Save this result as a scenario
      </label>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          id="scn-name"
          className="plain"
          type="text"
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSavedId(null);
          }}
        />
        <button className="btn" type="submit" disabled={!!savedId}>
          {savedId ? "Saved" : "Save"}
        </button>
      </div>
      <p className="hint" role="status">
        {savedId ? (
          <>
            Saved to the workspace under “{input.service.name}”. <Link href="/workspace/">Open the workspace</Link> to compare it or
            export a report.
          </>
        ) : (
          "Saved scenarios can be compared side by side, printed as PDF, or shared as a link."
        )}
      </p>
    </form>
  );
}
