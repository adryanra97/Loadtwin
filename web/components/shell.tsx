"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE, getApiKey, health, setApiKey } from "@/lib/api";
import { EXAMPLE_SERVICE } from "@/lib/defaults";
import { num } from "@/lib/format";
import { KEYS, usePersistent } from "@/lib/store";
import type { Service } from "@/lib/types";
import { Logo } from "./icons";

const NAV = [
  { href: "/service/", label: "Service" },
  { href: "/evaluate/", label: "Evaluate" },
  { href: "/autosize/", label: "Auto-size" },
  { href: "/patterns/", label: "Patterns" },
  { href: "/failures/", label: "Failures" },
  { href: "/sensitivity/", label: "Sensitivity" },
  { href: "/validate/", label: "Validate" },
  { href: "/workspace/", label: "Workspace" },
  { href: "/ask/", label: "Ask" },
];

type Engine = { state: "checking" } | { state: "up"; version: string; auth: boolean } | { state: "down" };

export function Header() {
  const path = usePathname();
  const [engine, setEngine] = useState<Engine>({ state: "checking" });
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    let alive = true;
    health()
      .then((h) => alive && setEngine({ state: "up", version: h.version, auth: h.auth }))
      .catch(() => alive && setEngine({ state: "down" }));
    setKey(getApiKey());
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" aria-label="LoadTwin home">
          <Logo /> LoadTwin
        </Link>
        <div className="nav-wrap">
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={
                path === n.href || path + "/" === n.href || (n.href === "/workspace/" && /^\/(report|compare)/.test(path))
                  ? "page"
                  : undefined
              }>
              {n.label}
            </Link>
          ))}
        </nav>
        </div>
        <div className="topbar-tools">
          <span className="small muted row" style={{ gap: 6 }} role="status">
            <span
              className="dot"
              style={{
                background: engine.state === "up" ? "var(--good)" : engine.state === "down" ? "var(--bad)" : "var(--line-strong)",
              }}
            />
            <span className="hide-sm">
              {engine.state === "up" ? `Engine v${engine.version}` : engine.state === "down" ? "Engine offline" : "Connecting…"}
            </span>
            <span className="sr-only">{engine.state === "down" ? "Simulation engine unreachable" : ""}</span>
          </span>
          {engine.state === "up" && engine.auth && (
            <button type="button" className="btn btn-sm" aria-expanded={keyOpen} onClick={() => setKeyOpen((o) => !o)}>
              API key{key ? " ✓" : ""}
            </button>
          )}
          <a className="btn btn-sm btn-ghost hide-sm" href={`${API_BASE}/api/docs`} target="_blank" rel="noreferrer">
            API docs
          </a>
        </div>
      </div>
      {keyOpen && (
        <form
          className="topbar-inner"
          style={{ paddingBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            setApiKey(key.trim());
            setKeyOpen(false);
          }}
        >
          <label htmlFor="apikey" className="label">
            API key
          </label>
          <input
            id="apikey"
            className="plain"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <button className="btn btn-sm btn-primary">Save</button>
          <span className="hint">Kept only for this browser tab.</span>
        </form>
      )}
      {engine.state === "down" && (
        <div className="topbar-inner small" style={{ minHeight: 0, paddingBottom: 10, color: "var(--bad-ink)" }} role="alert">
          The simulation engine is not reachable, so runs will fail. Your saved service and results are still here.
        </div>
      )}
    </header>
  );
}

/** Compact reminder of the service every tool uses, with a link to change it. */
export function ServiceStrip({ show = ["measured", "target", "sla"] }: { show?: ("measured" | "target" | "sla")[] }) {
  const [svc] = usePersistent<Service>(KEYS.service, EXAMPLE_SERVICE);
  const m = svc.measuredSpec;
  const t = svc.targetSpec;
  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="spread">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="section-title">Service</span>
          <strong>{svc.name}</strong>
        </div>
        <Link className="btn btn-sm" href="/service/">
          Edit service
        </Link>
      </div>
      <dl className="kv small" style={{ marginTop: 8 }}>
        {show.includes("measured") && (
          <>
            <dt>Measured</dt>
            <dd>
              {m.nodes} × {m.vcpu} vCPU at {num(svc.measurement.tps)} req/s: CPU {num(svc.measurement.cpuPct)}%, p95{" "}
              {num(svc.measurement.p95Ms)} ms
            </dd>
          </>
        )}
        {show.includes("target") && (
          <>
            <dt>Target</dt>
            <dd>
              {t.nodes} × {t.vcpu} vCPU, {num(t.ramGb)} GB, {t.threadPool} threads
            </dd>
          </>
        )}
        {show.includes("sla") && (
          <>
            <dt>SLA</dt>
            <dd>
              p95 ≤ {num(svc.sla.maxP95Ms)} ms, errors ≤ {num(svc.sla.maxErrorRatePct, 1)}%, CPU ≤ {num(svc.sla.maxCpuPct)}%
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function useService() {
  return usePersistent<Service>(KEYS.service, EXAMPLE_SERVICE);
}
