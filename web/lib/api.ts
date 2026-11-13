"use client";

/** Same origin by default (Vercel, Docker); set NEXT_PUBLIC_API_BASE for a separate API during development. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
const KEY_STORAGE = "loadtwin.apiKey";

export function getApiKey(): string {
  try {
    return window.sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(v: string) {
  try {
    if (v) window.sessionStorage.setItem(KEY_STORAGE, v);
    else window.sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

/** A failed request, with per-field messages when the API rejected the input. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Detail = { loc?: (string | number)[]; msg?: string };

function humanize(msg: string): string {
  return msg
    .replace(/^Value error, /, "")
    .replace(/^Input should be greater than or equal to/, "Must be at least")
    .replace(/^Input should be greater than/, "Must be more than")
    .replace(/^Input should be less than or equal to/, "Must be at most")
    .replace(/^Input should be a valid number.*/, "Enter a number")
    .replace(/^Input should be a valid integer.*/, "Enter a whole number")
    .replace(/^Field required/, "Required");
}

export async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    const key = getApiKey();
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Cannot reach the simulation engine. Check your connection and try again.", 0);
  }
  if (res.ok) return (await res.json()) as T;
  let data: { detail?: string | Detail[] } = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (res.status === 401) throw new ApiError("This server requires an API key. Add it under “API key” in the header.", 401);
  if (res.status === 422 && Array.isArray(data.detail)) {
    const fields: Record<string, string> = {};
    const general: string[] = [];
    for (const d of data.detail) {
      const loc = (d.loc ?? []).filter((x) => x !== "body").join(".");
      const msg = humanize(d.msg ?? "Invalid value");
      if (loc) fields[loc] = msg;
      else general.push(msg);
    }
    const first = general[0] ?? Object.entries(fields)[0]?.join(": ");
    throw new ApiError(first ? `Check the highlighted fields. ${first}` : "Some values are not valid.", 422, fields);
  }
  if (res.status === 504 || res.status === 408)
    throw new ApiError("The simulation took too long. Reduce the load, the number of runs or the machine types.", res.status);
  const detail = typeof data.detail === "string" ? data.detail : `The engine returned an error (${res.status}).`;
  throw new ApiError(detail, res.status);
}

export async function health(): Promise<{ status: string; version: string; auth: boolean }> {
  const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
