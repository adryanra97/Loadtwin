"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE, getApiKey, health, setApiKey } from "@/lib/api";
import { EXAMPLE_SERVICE } from "@/lib/defaults";
import { num } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { Service } from "@/lib/types";
import { MORE_TOOLS, TOOLS } from "@/lib/tools";
import { Logo } from "./icons";

const PRIMARY_NAV = [
  { href: "/", label: "Overview" },
  { href: "/service/", label: "Service setup" },
  { href: "/evaluate/", label: "Evaluate" },
  { href: "/workspace/", label: "Workspace" },
];
const MORE_NAV = MORE_TOOLS.map((id) => ({ href: TOOLS[id].href, label: TOOLS[id].name, hint: TOOLS[id].question, group: TOOLS[id].group }));

type Engine = { state: "checking" } | { state: "up"; version: string; auth: boolean } | { state: "down" };

export function Header() {
  const path = usePathname();
  const [engine, setEngine] = useState<Engine>({ state: "checking" });
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const active = (href: string) => path === href || path + "/" === href || (href === "/workspace/" && /^\/(report|compare)/.test(path));

  // Close the menus after navigating.
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details.lt-nav-more, details.lt-mobile-nav").forEach((d) => (d.open = false));
  }, [path]);

  useEffect(() => {
    let alive = true;
    health()
      .then((h) => alive && setEngine({ state: "up", version: h.version, auth: h.auth }))
      .catch(() => alive && setEngine({ state: "down" }));
    setKey(getApiKey());
    return () => { alive = false; };
  }, []);

  return (
    <header className="lt-header">
      <div className="lt-header-main">
        <Link href="/" className="lt-brand" aria-label="LoadTwin home"><Logo size={31} /><span>LoadTwin</span></Link>

        <nav className="lt-primary-nav" aria-label="Primary navigation">
          {PRIMARY_NAV.map((item) => <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>{item.label}</Link>)}
          <details className="lt-nav-more">
            <summary aria-label="More simulation tools" aria-current={MORE_NAV.some(item=>active(item.href)) ? "page" : undefined}>More tools <span aria-hidden="true">⌄</span></summary>
            <div className="lt-nav-dropdown">
              <strong>Same model, other questions</strong>
              {MORE_NAV.map((item) => (
                <Link key={item.href} href={item.href} className="lt-tool-link" aria-current={active(item.href) ? "page" : undefined}>
                  <span className="lt-tool-link-name">{item.label} <em>{item.group}</em></span>
                  <span className="lt-tool-link-hint">{item.hint}</span>
                </Link>
              ))}
              <a href={API_BASE + "/api/docs"} target="_blank" rel="noopener noreferrer">API documentation <span aria-hidden="true">↗</span></a>
            </div>
          </details>
        </nav>

        <div className="lt-header-right">
          <span className="lt-engine-status" role="status" aria-live="polite">
            <i className={engine.state === "up" ? "is-up" : engine.state === "down" ? "is-down" : ""} aria-hidden="true"/>
            <span>{engine.state === "up" ? "Engine online" : engine.state === "down" ? "Engine offline" : "Connecting…"}</span>
          </span>
          {engine.state === "up" && engine.auth && <button type="button" className="lt-key-button" aria-expanded={keyOpen} aria-controls="lt-api-key-panel" onClick={() => setKeyOpen((v) => !v)}>API key{key ? " ✓" : ""}</button>}
          <Link href="/evaluate/" className="lt-header-cta">Run evaluation <span aria-hidden="true">↗</span></Link>
          <details className="lt-mobile-nav">
            <summary>Menu <span aria-hidden="true">☰</span></summary>
            <nav aria-label="Mobile navigation">
              {[...PRIMARY_NAV,...MORE_NAV].map((item) => <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>{item.label}</Link>)}
              <a href={API_BASE + "/api/docs"} target="_blank" rel="noopener noreferrer">API documentation ↗</a>
            </nav>
          </details>
        </div>
      </div>
      {keyOpen && <form id="lt-api-key-panel" className="lt-key-form" onSubmit={(e) => { e.preventDefault(); setApiKey(key.trim()); setKeyOpen(false); }}>
        <label className="label" htmlFor="apikey">API key</label>
        <input id="apikey" className="plain" type="password" autoComplete="off" value={key} onChange={(e)=>setKey(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm">Save key</button>
        <span className="hint">Saved for this browser tab only.</span>
      </form>}
      {engine.state === "down" && <p className="lt-engine-alert" role="alert">The simulation engine is unreachable. You can still review your saved service and scenarios. Try running again when the connection returns.</p>}
    </header>
  );
}

/** Compact reminder of the service every tool uses, with a link to change it. */
export function ServiceStrip({ show = ["measured", "target", "sla"] }: { show?: ("measured" | "target" | "sla")[] }) {
  const [svc] = usePersistent<Service>(KEYS.service, EXAMPLE_SERVICE);
  const m = svc.measuredSpec;
  const t = svc.targetSpec;
  return (
    <section className="xp-service-context" aria-label="Current simulation service">
      <div className="xp-service-context-header">
        <div>
          <span className="xp-service-context-label">CURRENT SERVICE</span>
          <strong>{svc.name}</strong>
        </div>
        <Link href="/service/" className="xp-service-edit">Edit setup <span aria-hidden="true">↗</span></Link>
      </div>
      <dl className="xp-service-context-details">
        {show.includes("measured") && (
          <>
            <dt>Measured baseline</dt>
            <dd>{m.nodes} × {m.vcpu} vCPU at {num(svc.measurement.tps)} req/s · CPU {num(svc.measurement.cpuPct)}% · p95 {num(svc.measurement.p95Ms)} ms</dd>
          </>
        )}
        {show.includes("target") && (
          <>
            <dt>Target setup</dt>
            <dd>{t.nodes} × {t.vcpu} vCPU · {num(t.ramGb)} GB RAM · {t.threadPool} threads</dd>
          </>
        )}
        {show.includes("sla") && (
          <>
            <dt>SLA thresholds</dt>
            <dd>p95 ≤ {num(svc.sla.maxP95Ms)} ms · errors ≤ {num(svc.sla.maxErrorRatePct, 1)}% · CPU ≤ {num(svc.sla.maxCpuPct)}%</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export function useService() {
  return usePersistent<Service>(KEYS.service, EXAMPLE_SERVICE);
}
