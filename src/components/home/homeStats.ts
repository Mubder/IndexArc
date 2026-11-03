import type { VaultEntry, HealthCheckRow } from "../../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the local day containing `t`. */
function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Entries created per day over the last `days` days, oldest first.
 * Bad or missing timestamps are skipped, never counted as "today".
 */
export function dailyCounts(entries: VaultEntry[], days: number, now = Date.now()): number[] {
  const counts = new Array<number>(days).fill(0);
  const today = dayStart(now);
  for (const e of entries) {
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t)) continue;
    const idx = days - 1 - Math.round((today - dayStart(t)) / DAY_MS);
    if (idx >= 0 && idx < days) counts[idx] += 1;
  }
  return counts;
}

/** Entries created in the last `days` days (today included). */
export function addedWithin(entries: VaultEntry[], days: number, now = Date.now()): number {
  return dailyCounts(entries, days, now).reduce((a, b) => a + b, 0);
}

/**
 * Running total per day, so the line climbs as the vault grows. The base is
 * the count of entries older than the window.
 */
export function cumulative(counts: number[], base: number): number[] {
  let run = base;
  return counts.map((c) => (run += c));
}

/** SVG polyline points for `values` inside a `w`×`h` box with `pad` inset. */
export function sparkPoints(values: number[], w: number, h: number, pad = 2): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * step;
      // A flat series sits in the middle instead of on the floor.
      const y = max === min ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Short relative time: "now", "5 min", "3 h", "2 d", else a date. */
export function relativeTime(iso: string, lang: "en" | "ar", now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  const ar = lang === "ar";
  if (s < 60) return ar ? "الآن" : "now";
  const m = Math.round(s / 60);
  if (m < 60) return ar ? `${m} د` : `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return ar ? `${h} س` : `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return ar ? `${d} ي` : `${d} d`;
  return new Date(t).toLocaleDateString(ar ? "ar" : "en", { month: "short", day: "numeric" });
}

/** Score 0–100: share of passing checks, critical ones weighted 3×. */
export function healthScore(checks: HealthCheckRow[] | undefined): number | null {
  if (!checks || !checks.length) return null;
  let total = 0;
  let ok = 0;
  for (const c of checks) {
    const w = c.severity === "critical" ? 3 : 1;
    total += w;
    if (c.ok) ok += w;
  }
  return Math.round((ok / total) * 100);
}

/** Failing checks first (critical before info), then passing ones. */
export function orderChecks(checks: HealthCheckRow[] | undefined): HealthCheckRow[] {
  const rank = (c: HealthCheckRow) => (c.ok ? 2 : c.severity === "critical" ? 0 : 1);
  return [...(checks ?? [])].sort((a, b) => rank(a) - rank(b));
}

/**
 * Text safe to show in a list row. Secrets are masked down to a short
 * prefix and suffix; anything else is collapsed to one line.
 */
export function previewOf(entry: VaultEntry): string {
  const v = (entry.value || entry.raw_fragment || "").replace(/\s+/g, " ").trim();
  if (entry.family === "secret") {
    if (v.length <= 8) return "••••••••";
    return `${v.slice(0, 4)}••••••••${v.slice(-3)}`;
  }
  return v.length > 120 ? v.slice(0, 117) + "…" : v;
}
