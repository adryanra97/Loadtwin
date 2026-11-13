"use client";

import { KEYS, usePersistent } from "./store";
import type { EvaluateResult, SavedScenario as Scenario } from "./types";

const EMPTY: Scenario[] = [];

export function useScenarios() {
  return usePersistent<Scenario[]>(KEYS.scenarios, EMPTY);
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Drop data a report does not need, so saved scenarios and links stay small. */
export function slim(result: EvaluateResult): EvaluateResult {
  return {
    ...result,
    scenarios: result.scenarios.map((s) => (s.kind === "peak" ? s : { ...s, timeseries: undefined })),
  };
}

function toB64Url(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Encode a scenario into a URL fragment: compressed, never sent to any server. */
export async function encodeShare(s: Scenario): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, s }));
  if (typeof CompressionStream === "undefined") return "j" + toB64Url(json);
  return "z" + toB64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeShare(frag: string): Promise<Scenario> {
  const kind = frag[0];
  let bytes = fromB64Url(frag.slice(1));
  if (kind === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  else if (kind !== "j") throw new Error("unknown link format");
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data?.v !== 1 || !data.s?.result?.verdict || !data.s?.service?.targetSpec) throw new Error("not a LoadTwin report");
  return data.s as Scenario;
}

export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
