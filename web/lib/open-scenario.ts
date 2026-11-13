"use client";

import { KEYS, write } from "./store";
import type { SavedScenario } from "./types";

/** Load a saved scenario back into the service and the Evaluate tool. */
export function loadIntoEvaluate(s: SavedScenario) {
  write(KEYS.service, s.service);
  write(KEYS.evaluate, {
    normalTps: s.load.normalTps,
    peakTps: s.load.peakTps,
    stress: s.load.stressMultipliers.join(", "),
    monteCarlo: s.replications > 1,
    runs: Math.max(s.replications, 2),
  });
  write(`${KEYS.evaluate}.result`, s.result);
  write(`${KEYS.evaluate}.input`, { service: s.service, load: s.load, replications: s.replications });
}
