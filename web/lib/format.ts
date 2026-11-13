const RESOURCE: Record<string, string> = {
  cpu: "CPU",
  memory: "Memory",
  threadPool: "Worker threads",
  connectionPool: "DB connections",
  network: "Network",
  database: "Shared database",
  p95: "p95 latency",
  errorRate: "Error rate",
  calibration: "Calibration",
};

export const resourceName = (r: string | null | undefined) => (r ? (RESOURCE[r] ?? r) : "—");

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const pct = (v: number, digits = 0) => `${num(v, digits)}%`;

export const seconds = (s: number) => (s < 60 ? `${num(s, 1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

export function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
