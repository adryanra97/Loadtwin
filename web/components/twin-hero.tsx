"use client";

import Link from "next/link";
import { LivePlayground } from "./live-playground";
import { useService } from "./shell";

/**
 * The landing hero: live mode on the user's own service. Add traffic, nodes or vCPU, or break
 * something, and the SimPy engine re-simulates it on the spot.
 */
export function TwinHero() {
  const [svc] = useService();
  return (
    <div className="hero-panel">
      <div className="hero-live">
        <LivePlayground title="Try it live" height={260} startTps={Math.round(svc.measurement.tps * 1.1)} />
        <p className="hint">
          {svc.targetSpec.nodes} × {svc.targetSpec.vcpu} vCPU from <Link href="/service/">{svc.name}</Link>. Every number is simulated
          by the engine for the exact setup you dial in.
        </p>
      </div>
    </div>
  );
}
