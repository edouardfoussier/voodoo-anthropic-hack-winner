/**
 * Weekly Report — the knowledge base's market brief view.
 *
 * Aggregates every Gemini deconstruction in data/cache/deconstruct/
 * and surfaces:
 *   • a header card with KPIs (KB size, new this week, distribution
 *     by emotional pitch as a tiny stacked bar)
 *   • a grid of "top picks" — newest + highest-signal creatives,
 *     each clickable straight to its /ad/$id detail dossier
 *
 * This is what the PM opens on Monday morning to get a 2-minute read
 * of "what mobile gaming is running this week", instead of running a
 * fresh game-specific analysis. The mentor's vision in pitch form.
 */
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Calendar,
  Loader2,
  Play,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useWeeklyReport, type WeeklyEntry } from "@/lib/api";

const PITCH_COLOURS: Record<string, string> = {
  satisfaction: "bg-emerald-500",
  fail: "bg-rose-500",
  curiosity: "bg-violet-500",
  rage_bait: "bg-orange-500",
  tutorial: "bg-sky-500",
  asmr: "bg-pink-500",
  celebrity: "bg-amber-500",
  challenge: "bg-red-500",
  transformation: "bg-fuchsia-500",
  other: "bg-muted-foreground",
};
const PITCH_TEXT: Record<string, string> = {
  satisfaction: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  fail: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  curiosity: "text-violet-300 border-violet-500/40 bg-violet-500/10",
  rage_bait: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  tutorial: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  asmr: "text-pink-300 border-pink-500/40 bg-pink-500/10",
  celebrity: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  challenge: "text-red-300 border-red-500/40 bg-red-500/10",
  transformation:
    "text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10",
  other: "text-muted-foreground border-border bg-card",
};

export function WeeklyReport() {
  const { data, isLoading, error } = useWeeklyReport(7, 60);

  if (isLoading) {
    return (
      <Card className="border-dashed border-border bg-card/40 p-10 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Loading market brief…
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 p-6">
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {(error as Error).message}
        </p>
      </Card>
    );
  }

  if (!data || data.knowledge_base_size === 0) {
    return (
      <Card className="border-border bg-card p-8 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-muted-foreground/50" />
        <h3 className="mt-3 text-base font-semibold">
          No deconstructed creatives yet
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Run the knowledge base scan to populate this view:
        </p>
        <pre className="mx-auto mt-3 inline-block rounded-md bg-muted px-4 py-2 text-left text-xs">
          uv run python -m scripts.scan_top_competitors
        </pre>
      </Card>
    );
  }

  const generatedAt = new Date(data.generated_at).toLocaleString(
    undefined,
    { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  );
  const totalForBar = Object.values(data.by_pitch).reduce(
    (a, b) => a + b,
    0,
  );
  const sortedPitches = Object.entries(data.by_pitch).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="space-y-6">
      {/* KPI header */}
      <Card className="border-border bg-card p-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[auto_auto_1fr]">
          <Stat
            label="Knowledge base"
            value={data.knowledge_base_size.toLocaleString()}
            unit="ads deconstructed"
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
          <Stat
            label="New this week"
            value={data.new_this_week.toLocaleString()}
            unit={`fresh in past 7d`}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            highlight
          />
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> Distribution by hook type
            </div>
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {sortedPitches.map(([pitch, count]) => {
                const pct = (count / totalForBar) * 100;
                return (
                  <div
                    key={pitch}
                    className={PITCH_COLOURS[pitch] ?? "bg-muted-foreground"}
                    style={{ width: `${pct}%` }}
                    title={`${pitch}: ${count} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sortedPitches.map(([pitch, count]) => (
                <span
                  key={pitch}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    PITCH_TEXT[pitch] ?? PITCH_TEXT.other
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      PITCH_COLOURS[pitch] ?? "bg-muted-foreground"
                    }`}
                  />
                  {pitch.replace("_", " ")} · {count}
                </span>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Generated {generatedAt} · ranks new-this-week creatives first,
          then by recency, then by run-duration.
        </p>
      </Card>

      {/* Top picks grid */}
      <section>
        <header className="mb-3 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Top picks · {data.top_picks.length}
          </span>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {data.top_picks.map((entry) => (
            <PickCard key={entry.creative_id} entry={entry} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  unit: string;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        highlight
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background/40"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          highlight ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{unit}</div>
    </div>
  );
}

function PickCard({ entry }: { entry: WeeklyEntry }) {
  const pitch = entry.hook_emotional_pitch ?? "other";
  return (
    <Link
      to="/ad/$id"
      params={{ id: entry.creative_id }}
      className="group flex flex-col overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/50"
    >
      {/* Thumb — 9:16 with overlays */}
      <div
        className="relative w-full overflow-hidden bg-muted"
        style={{ aspectRatio: "9 / 16" }}
      >
        {entry.thumb_url ? (
          <img
            src={entry.thumb_url}
            alt={entry.advertiser_name ?? entry.creative_id}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground/40">
            <Play className="h-5 w-5" />
          </div>
        )}
        {entry.new_this_week && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary-foreground shadow">
            New
          </span>
        )}
        <span
          className={`absolute right-1.5 top-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider backdrop-blur-sm ${
            PITCH_TEXT[pitch] ?? PITCH_TEXT.other
          }`}
        >
          {pitch.replace("_", " ")}
        </span>
        {entry.days_active != null && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-white">
            {entry.days_active}d
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="flex items-start gap-2 p-2.5">
        {entry.icon_url ? (
          <img
            src={entry.icon_url}
            alt={entry.advertiser_name ?? ""}
            className="h-7 w-7 flex-shrink-0 rounded-md ring-1 ring-border"
            loading="lazy"
          />
        ) : (
          <div className="h-7 w-7 flex-shrink-0 rounded-md bg-muted ring-1 ring-border" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold leading-tight">
            {entry.advertiser_name ?? "Unknown advertiser"}
          </div>
          {entry.network && (
            <div className="text-[10px] text-muted-foreground">
              {entry.network}
            </div>
          )}
        </div>
      </div>

      {/* Hook teaser */}
      {entry.hook_summary && (
        <p className="border-t border-border px-2.5 py-2 text-[11px] leading-snug text-muted-foreground line-clamp-3">
          {entry.hook_summary}
        </p>
      )}
    </Link>
  );
}
