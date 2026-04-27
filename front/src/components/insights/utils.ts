import type { EmotionalPitch } from "@/types/hooklens";

/**
 * Tailwind class strings for each emotional pitch — used for centroid badges
 * in ArchetypesTable. Colors picked from the existing dashboard palette
 * (see PerformanceSignals.tsx, CompetitiveScope.tsx).
 */
export const PITCH_BADGE_CLASS: Record<EmotionalPitch, string> = {
  satisfaction: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  asmr: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  fail: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  rage_bait: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  curiosity: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  tutorial: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  transformation: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  celebrity: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  challenge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

export function pitchLabel(p: EmotionalPitch): string {
  return p.replace(/_/g, " ");
}

/** Velocity goes 0.5 → 5.0; 1.0 = stable, 1.5+ = ascending. */
export const VELOCITY_MIN = 0.5;
export const VELOCITY_MAX = 5.0;

export function velocityPct(v: number): number {
  const clamped = Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, v));
  return ((clamped - VELOCITY_MIN) / (VELOCITY_MAX - VELOCITY_MIN)) * 100;
}

export function velocityColor(v: number): string {
  if (v >= 1.5) return "#34d399"; // ascending → emerald
  if (v <= 0.7) return "#f87171"; // declining → rose
  return "#fbbf24"; // stable → amber
}

/** Derivative spread is already in [0, 1]. */
export function derivativeSpreadPct(d: number): number {
  return Math.max(0, Math.min(1, d)) * 100;
}

export function derivativeColor(d: number): string {
  if (d >= 0.66) return "#34d399";
  if (d >= 0.33) return "#fbbf24";
  return "#94a3b8";
}

/**
 * Freshness — INVERSE: lower (= fresher) days produce a fuller bar.
 * Cap at 60d. Color: green if <14, amber if 14–60, red if >60.
 */
export const FRESHNESS_CAP_DAYS = 60;

export function freshnessPct(days: number): number {
  const capped = Math.max(0, Math.min(FRESHNESS_CAP_DAYS, days));
  return ((FRESHNESS_CAP_DAYS - capped) / FRESHNESS_CAP_DAYS) * 100;
}

export function freshnessColor(days: number): string {
  if (days < 14) return "#34d399";
  if (days <= 60) return "#fbbf24";
  return "#f87171";
}

export function formatGenerated(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function fmtCurrency(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
