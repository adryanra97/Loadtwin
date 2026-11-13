"use client";
import { ToolPageIntro } from "@/components/tool-page-intro";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Trash } from "@/components/icons";
import { Notice, VerdictBadge } from "@/components/ui";
import { download, num } from "@/lib/format";
import { loadIntoEvaluate } from "@/lib/open-scenario";
import { formatDate, useScenarios } from "@/lib/scenarios";
import type { SavedScenario } from "@/lib/types";

export default function WorkspacePage() {
  const [list, setList, hydrated] = useScenarios();
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const groups = useMemo(() => {
    const m = new Map<string, SavedScenario[]>();
    for (const s of list) m.set(s.service.name, [...(m.get(s.service.name) ?? []), s]);
    return [...m.entries()];
  }, [list]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]));

  const remove = (s: SavedScenario) => {
    setList(list.filter((x) => x.id !== s.id));
    setPicked((p) => p.filter((x) => x !== s.id));
    setStatus(`Deleted “${s.name}”.`);
  };

  const onImport = async (f: File) => {
    setImportError("");
    try {
      const data = JSON.parse(await f.text());
      const items: SavedScenario[] = Array.isArray(data?.scenarios) ? data.scenarios : [];
      const valid = items.filter((s) => s?.id && s?.result?.verdict && s?.service?.targetSpec);
      if (!valid.length) throw new Error("empty");
      const ids = new Set(list.map((s) => s.id));
      const added = valid.filter((s) => !ids.has(s.id));
      setList([...added, ...list].slice(0, 100));
      setStatus(`Imported ${added.length} scenario(s).`);
    } catch {
      setImportError("That file is not a LoadTwin workspace export.");
    }
  };

  return (
    <div className="stack">
      <ToolPageIntro category="SAVED SCENARIOS" title="Workspace" description="Scenarios you saved from Evaluate, grouped by service. Pick two to compare them side by side, open one as a report to print or share, or load it back to keep working." />

      <div className="spread">
        <span className="small muted" role="status" aria-live="polite">
          {status}
        </span>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!list.length}
            onClick={() => download("loadtwin-workspace.json", { version: 1, scenarios: list })}
          >
            Export all
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
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

      {hydrated && list.length === 0 && (
        <div className="card stack-sm empty">
          <h2>No saved scenarios yet</h2>
          <p className="muted">
            Run <Link href="/evaluate/">Evaluate</Link>, then use “Save this result as a scenario” under the result. Try the same
            service on two setups to compare them here.
          </p>
        </div>
      )}

      {groups.map(([service, items]) => (
        <section key={service} className="card" aria-label={`Scenarios for ${service}`}>
          <div className="card-head">
            <h2>{service}</h2>
            <span className="hint">{items.length} scenario(s)</span>
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={`${service} scenarios`}>
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Select to compare</span>
                  </th>
                  <th scope="col" className="left">
                    Scenario
                  </th>
                  <th scope="col">Target</th>
                  <th scope="col">Peak</th>
                  <th scope="col">Capacity</th>
                  <th scope="col" className="left">
                    Verdict
                  </th>
                  <th scope="col" className="left">
                    Saved
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const t = s.service.targetSpec;
                  return (
                    <tr key={s.id} className={picked.includes(s.id) ? "hl" : undefined}>
                      <td className="left">
                        <input
                          type="checkbox"
                          style={{ width: 18, minHeight: 18 }}
                          aria-label={`Compare ${s.name}`}
                          checked={picked.includes(s.id)}
                          onChange={() => toggle(s.id)}
                        />
                      </td>
                      <th scope="row" className="left" style={{ fontWeight: 600, whiteSpace: "normal", minWidth: 180 }}>
                        <Link href={`/report/?id=${s.id}`}>{s.name}</Link>
                      </th>
                      <td>
                        {t.nodes} × {t.vcpu} vCPU
                      </td>
                      <td>{num(s.load.peakTps)} req/s</td>
                      <td>{s.result.capacity ? `${num(s.result.capacity.maxTps, 1)} req/s` : "—"}</td>
                      <td className="left">
                        <VerdictBadge verdict={s.result.verdict} />
                      </td>
                      <td className="left muted">{formatDate(s.savedAt)}</td>
                      <td>
                        <div className="row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              loadIntoEvaluate(s);
                              router.push("/evaluate/");
                            }}
                          >
                            Open
                          </button>
                          <button type="button" className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}>
                            <Trash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {list.length > 0 && (
        <div className="card compare-bar spread" aria-label="Compare">
          <span>
            {picked.length === 2
              ? "Two scenarios selected."
              : picked.length === 1
                ? "Select one more scenario to compare."
                : "Select two scenarios to compare them side by side."}
          </span>
          <Link
            className={`btn btn-primary${picked.length === 2 ? "" : " is-disabled"}`}
            href={picked.length === 2 ? `/compare/?a=${picked[0]}&b=${picked[1]}` : "#"}
            aria-disabled={picked.length !== 2}
            onClick={(e) => picked.length !== 2 && e.preventDefault()}
          >
            Compare
          </Link>
        </div>
      )}
    </div>
  );
}
