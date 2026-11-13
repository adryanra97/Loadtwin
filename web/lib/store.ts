"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Small persistent store on top of localStorage. Everything stays in this browser; nothing is sent
 * anywhere except the simulation requests themselves. Reads and writes are wrapped because storage
 * can be unavailable (private windows, blocked site data).
 */
const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) value = JSON.parse(raw) as T;
  } catch {
    /* storage unavailable or corrupt: fall back */
  }
  cache.set(key, value);
  return value;
}

export function write<T>(key: string, value: T) {
  cache.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* keep the in-memory value */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key) cache.delete(e.key);
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** Persistent state keyed by ``key``; returns ``[value, set, hydrated]``. */
export function usePersistent<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const set = useCallback((v: T) => write(key, v), [key]);
  return [value, set, hydrated];
}

export const KEYS = {
  service: "loadtwin.service.v1",
  evaluate: "loadtwin.evaluate.v1",
  autosize: "loadtwin.autosize.v1",
  pattern: "loadtwin.pattern.v1",
  validate: "loadtwin.validate.v1",
  fault: "loadtwin.fault.v1",
  sensitivity: "loadtwin.sensitivity.v1",
  assistant: "loadtwin.assistant.v1",
  scenarios: "loadtwin.scenarios.v1",
};
