import { useMemo, useState } from "react";
import { Play, ChevronDown, Check, Image as ImageIcon, ExternalLink, Sparkles } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  NETWORKS,
  FORMATS,
  type Creative,
  type Network,
  type Format,
} from "@/data/sample";
import { useCreatives, useGeneratedCreatives } from "@/lib/api";
import { useGame } from "@/lib/game-context";
import { NetworkBadge } from "./NetworkBadge";

type SortKey = "Run duration" | "Impressions" | "Date";

/**
 * Performance-tier filter values. ``"all"`` is the no-filter default;
 * the three others map 1:1 to the badges rendered by
 * ``performanceTier()`` further down in this file. Single-select keeps
 * the UI predictable (multi-select would have to handle the implicit
 * "ordinary, untiered" rows separately).
 */
type TierFilter = "all" | "performing" | "trending" | "fresh";

const TIER_FILTERS: {
  value: TierFilter;
  label: string;
  emoji: string;
  cls: string;
}[] = [
  {
    value: "all",
    label: "All",
    emoji: "",
    cls: "border-border bg-card text-foreground",
  },
  {
    value: "performing",
    label: "Performing",
    emoji: "🟢",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  {
    value: "trending",
    label: "Trending",
    emoji: "📈",
    cls: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  {
    value: "fresh",
    label: "Fresh",
    emoji: "🆕",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
];

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
}) {
  const count = selected.size;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {label}
          {count > 0 && (
            <span className="rounded-sm bg-primary/15 px-1.5 text-xs text-primary">{count}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt}
            checked={selected.has(opt)}
            onCheckedChange={() => onToggle(opt)}
            onSelect={(e) => e.preventDefault()}
          >
            {opt}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// "All" sentinel ⇒ backend fans out across US/GB/DE/FR/JP/BR/KR and
// dedupes — wired in api/main.py:get_creatives.
const COUNTRIES = ["All", "US", "GB", "DE", "FR", "JP", "BR", "KR"] as const;
type Country = (typeof COUNTRIES)[number];

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

/**
 * Generated ads come back from the API with relative paths
 * (``/videos/variant_xyz.mp4``) because they're served by FastAPI's
 * static mount, not SensorTower's CDN. The browser would resolve
 * those against the React app origin (8080) instead of the API
 * (8000), so we rewrite to absolute URLs at the boundary.
 */
function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

/**
 * Top-of-page mode toggle: ``competitor`` shows every ad in the
 * Gemini-deconstruction knowledge base (~500 entries),
 * ``generated`` shows only the ads VoodRadar has rendered itself
 * via the per-variant pipeline (Scenario + ffmpeg). Defaults to
 * competitor for the demo narrative ("here's the market") with
 * a 1-click swap to "here's what we built from it".
 */
type LibraryMode = "competitor" | "generated";

export function AdLibrary() {
  const { gameName, period } = useGame();
  const [country, setCountry] = useState<Country>("US");
  // Default to ``generated`` so a fresh Ad Library visit shows the ads
  // VoodRadar has rendered itself — that's the punchline. Toggle to
  // ``competitor`` reveals the underlying knowledge base used to write
  // those briefs.
  const [mode, setMode] = useState<LibraryMode>("generated");

  const { data: competitorData = [], isLoading: competitorLoading } = useCreatives({
    game_name: gameName || undefined,
    period,
    country: country === "All" ? "all" : country,
    // The backend defaults to knowledge-base mode (every
    // Gemini-deconstructed ad on disk, ~499 entries) instead of the
    // live SensorTower top-N capped at ~40. Bump the cap accordingly.
    limit: 500,
  });
  const { data: generatedData = [], isLoading: generatedLoading } =
    useGeneratedCreatives();

  const creativesData = mode === "generated" ? generatedData : competitorData;
  const isLoading = mode === "generated" ? generatedLoading : competitorLoading;
  const [networks, setNetworks] = useState<Set<Network>>(new Set());
  const [formats, setFormats] = useState<Set<Format>>(new Set());
  const [games, setGames] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("Impressions");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  /**
   * Per-tier counts on the *currently visible* (non-tier-filtered) corpus
   * — i.e. respecting Network / Format / Game / Region but NOT the tier
   * pill itself. Lets each pill show a badge like "Performing · 12" so
   * the PM knows at a glance which buckets have signal.
   */
  const tierCounts = useMemo(() => {
    const base = creativesData.filter(
      (c) =>
        (networks.size === 0 || networks.has(c.network)) &&
        (formats.size === 0 || formats.has(c.format)) &&
        (games.size === 0 || games.has(c.game)),
    );
    const counts: Record<TierFilter, number> = {
      all: base.length,
      performing: 0,
      trending: 0,
      fresh: 0,
    };
    for (const c of base) {
      const t = performanceTier(c.runDays, c.startedAt);
      if (!t) continue;
      const key = t.label.toLowerCase() as TierFilter;
      if (key in counts) counts[key]++;
    }
    return counts;
  }, [creativesData, networks, formats, games]);

  const gamesList = useMemo(
    () => [...new Set(creativesData.map((c) => c.game))].sort(),
    [creativesData],
  );

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  const filtered = useMemo(() => {
    let list = creativesData.filter(
      (c) =>
        (networks.size === 0 || networks.has(c.network)) &&
        (formats.size === 0 || formats.has(c.format)) &&
        (games.size === 0 || games.has(c.game)),
    );
    // Tier pill — keep only creatives whose performanceTier matches.
    if (tierFilter !== "all") {
      list = list.filter((c) => {
        const t = performanceTier(c.runDays, c.startedAt);
        return t && t.label.toLowerCase() === tierFilter;
      });
    }
    list = [...list].sort((a, b) => {
      if (sort === "Run duration") return b.runDays - a.runDays;
      // "Impressions" → sort by REAL SoV (the synthetic impressions field is
      // a flat 10k for almost everything; keep the menu label for back-compat
      // but use sov as the actual signal).
      if (sort === "Impressions") return (b.sov ?? 0) - (a.sov ?? 0);
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });
    return list;
  }, [creativesData, networks, formats, games, sort, tierFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
        Loading ad library…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Mode toggle — competitor knowledge base vs our own generated
          outputs. Two distinct corpora; the rest of the filter bar
          adapts (tier pills hidden in generated mode since runDays /
          startedAt are not meaningful for our renders). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("competitor")}
            className={`rounded-md px-3 py-1.5 font-medium transition-all ${
              mode === "competitor"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Every ad we've Gemini-deconstructed (the knowledge base)"
          >
            Market ads
            <span className="ml-1.5 tabular-nums opacity-70">
              {competitorData.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("generated")}
            className={`rounded-md px-3 py-1.5 font-medium transition-all ${
              mode === "generated"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Ads VoodRadar has rendered through the per-variant pipeline"
          >
            VoodRadar outputs
            <span className="ml-1.5 tabular-nums opacity-70">
              {generatedData.length}
            </span>
          </button>
        </div>
        {mode === "generated" && (
          <span className="text-xs text-muted-foreground">
            Variants rendered through the Scenario → Kling → ffmpeg pipeline,
            with bespoke Opus narration when audio is enabled.
          </span>
        )}
      </div>

      {/* Tier pills — quick performance filter (Performing / Trending /
          Fresh / All) with live counts. Single-select; clicking the
          active pill re-clicks "All". Only meaningful for competitor
          ads (run-duration / first-seen come from SensorTower). */}
      {mode === "competitor" && (
      <div className="flex flex-wrap items-center gap-1.5">
        {TIER_FILTERS.map((t) => {
          const active = tierFilter === t.value;
          const count = tierCounts[t.value];
          const disabled = count === 0 && t.value !== "all";
          return (
            <button
              key={t.value}
              type="button"
              disabled={disabled}
              onClick={() => setTierFilter(active ? "all" : t.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                active
                  ? `${t.cls} ring-1 ring-current/30 shadow-sm`
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/70"
              } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
              title={
                t.value === "all"
                  ? `Show all ${count} creatives`
                  : disabled
                    ? `No ${t.label.toLowerCase()} creatives in current view`
                    : `Show only ${t.label.toLowerCase()} (${count})`
              }
            >
              {t.emoji && <span aria-hidden>{t.emoji}</span>}
              <span>{t.label}</span>
              <span
                className={`tabular-nums ${
                  active ? "opacity-90" : "text-muted-foreground/70"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          label="Network"
          options={NETWORKS}
          selected={networks}
          onToggle={(v) => toggle(networks, v, setNetworks)}
        />
        <MultiSelect
          label="Format"
          options={FORMATS}
          selected={formats}
          onToggle={(v) => toggle(formats, v, setFormats)}
        />
        <MultiSelect
          label="Game"
          options={gamesList}
          selected={games}
          onToggle={(v) => toggle(games, v, setGames)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <span className="text-muted-foreground text-xs">Region:</span>
              <span>{country}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {COUNTRIES.map((c) => (
              <DropdownMenuItem key={c} onClick={() => setCountry(c)}>
                <Check
                  className={`mr-2 h-3.5 w-3.5 ${c === country ? "opacity-100" : "opacity-0"}`}
                />
                {c}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <span className="text-muted-foreground text-xs">Sort:</span>
                <span>{sort}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["Run duration", "Impressions", "Date"] as SortKey[]).map((s) => (
                <DropdownMenuItem key={s} onClick={() => setSort(s)}>
                  <Check className={`mr-2 h-3.5 w-3.5 ${s === sort ? "opacity-100" : "opacity-0"}`} />
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((c) => (
          <CreativeCard key={c.id} creative={c} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No creatives match your filters.
          </div>
        )}
      </div>
    </div>
  );
}

interface CreativeCardProps {
  creative: Creative;
}

/**
 * Single ad card with the SensorTower thumbnail as hero. Click → opens an
 * inline video preview (Dialog with <video controls>) when a creativeUrl
 * is available; falls back to the ad-detail route otherwise.
 *
 * Card body shows ONLY honest data:
 * - app icon + game name + publisher_name (real, from app_info)
 * - Run duration (real, from first/last seen dates)
 * - Share of Voice in category × network × period (real, SensorTower)
 *
 * Removed: opaque creative_id (was just noise), synthetic impressions
 * (was a flat 10k floor), synthetic score / spend tier.
 */
function CreativeCard({ creative: c }: CreativeCardProps) {
  const [thumbErrored, setThumbErrored] = useState(false);
  const [iconErrored, setIconErrored] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const navigate = useNavigate();
  const { setGameName } = useGame();

  const isGenerated = c.id.startsWith("generated:");
  const resolvedThumb = resolveMediaUrl(c.thumbUrl);
  const resolvedIcon = resolveMediaUrl(c.appIconUrl);
  const resolvedVideo = resolveMediaUrl(c.creativeUrl);
  const hasThumb = Boolean(resolvedThumb) && !thumbErrored;
  const hasIcon = Boolean(resolvedIcon) && !iconErrored;
  const hasVideo = Boolean(resolvedVideo) && c.format === "Video";

  function handleHeroClick() {
    if (hasVideo) {
      setPreviewOpen(true);
    }
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden border-border bg-card p-0 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
        {/* Hero / thumbnail */}
        <button
          type="button"
          onClick={handleHeroClick}
          className="group relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-muted to-muted/40"
          disabled={!hasVideo}
          aria-label={hasVideo ? `Preview ad for ${c.game}` : `Ad for ${c.game}`}
        >
          {hasThumb ? (
            <img
              src={resolvedThumb}
              alt={`${c.game} — ${c.format} ad`}
              loading="lazy"
              onError={() => setThumbErrored(true)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground/40">
              <ImageIcon className="h-10 w-10" />
            </div>
          )}
          {/* Play overlay (video format only) */}
          {hasVideo && (
            <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <Play className="h-5 w-5 fill-foreground text-foreground" />
              </div>
            </div>
          )}
          {/* Format badge */}
          <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            {c.format}
          </span>
          {isGenerated && (
            <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground backdrop-blur-sm">
              <span aria-hidden>✦</span>
              VoodRadar
            </span>
          )}
        </button>

        <div className="flex flex-1 flex-col gap-3 p-4">
          {/* App icon + game name + publisher */}
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border">
              {hasIcon ? (
                <img
                  src={resolvedIcon}
                  alt={c.game}
                  loading="lazy"
                  onError={() => setIconErrored(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-muted-foreground/40">
                  <ImageIcon className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight">
                {c.game}
              </div>
              {c.publisherName && (
                <div className="truncate text-[11px] text-muted-foreground">
                  by {c.publisherName}
                </div>
              )}
            </div>
            {!isGenerated && <NetworkBadge network={c.network} />}
          </div>

          {/* Performance signal: runDays-based tier + a "trending" badge
              when first-seen is < 14d. The tier is the most honest
              read-at-a-glance KPI we have — when a creative survives
              30d+ in the SensorTower top-N, it's performing. */}
          {(() => {
            const tier = performanceTier(c.runDays, c.startedAt);
            if (!tier) return null;
            return (
              <div
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium ${tier.cls}`}
                title={tier.tooltip}
              >
                <span>{tier.emoji}</span>
                <span>{tier.label}</span>
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-muted/50 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Running
              </div>
              <div className="font-medium tabular-nums text-foreground">
                {c.runDays}d
              </div>
            </div>
            {c.sov != null && c.sov > 0 ? (
              <div
                className="rounded-md bg-muted/50 px-2 py-1.5"
                title="Share of Voice in category × network × period (SensorTower)"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  SoV
                </div>
                <div className="font-medium tabular-nums text-foreground">
                  {c.sov >= 0.001 ? `${(c.sov * 100).toFixed(2)}%` : "<0.1%"}
                </div>
              </div>
            ) : (
              <div
                className="rounded-md bg-muted/50 px-2 py-1.5"
                title="First time this creative was seen by SensorTower"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Started
                </div>
                <div className="font-medium tabular-nums text-foreground">
                  {c.startedAt.slice(0, 7)}
                </div>
              </div>
            )}
          </div>

          {isGenerated ? (
            // Generated ads have no /ad/$id dossier (they're our own
            // renders, not SensorTower creatives). Route to /insights
            // instead, after seeding the GameContext with the source
            // game so the page lands on the right report.
            <Button
              size="sm"
              variant="secondary"
              className="mt-auto w-full gap-1.5"
              onClick={() => {
                setGameName(c.game);
                navigate({ to: "/insights" });
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Open analysis
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="mt-auto w-full" asChild>
              <Link to="/ad/$id" params={{ id: c.id }}>
                View details
              </Link>
            </Button>
          )}
        </div>
      </Card>

      {/* Inline video preview */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl overflow-hidden p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="flex items-center justify-between gap-3">
              <span className="truncate">
                {c.game}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {c.network} · {c.format}
                </span>
              </span>
              {resolvedVideo && (
                <a
                  href={resolvedVideo}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-normal text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {isGenerated ? "Download MP4" : "Open original"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="relative aspect-[9/16] max-h-[70vh] w-full bg-black">
            {resolvedVideo ? (
              <video
                key={resolvedVideo}
                src={resolvedVideo}
                controls
                autoPlay
                playsInline
                className="h-full w-full object-contain"
              />
            ) : resolvedThumb ? (
              <img
                src={resolvedThumb}
                alt={c.game}
                className="h-full w-full object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Classify a creative as Trending / Performing / Fresh based on its
 * SensorTower-reported run duration and first-seen date — the most
 * honest read-at-a-glance signal we have without growth-rate data.
 *
 * Heuristics (drawn from mobile UA folklore):
 * - **Performing** ≥ 90 days running. Long-runners are battle-tested
 *   winners; advertisers don't keep losing creatives in market for 3+
 *   months. Emerald.
 * - **Trending** 30–90 days running AND first-seen ≤ 60 days ago. Recent
 *   enough to still be growing, established enough to know it works.
 *   Sky-blue.
 * - **Fresh** < 7 days first-seen. Just launched, watch this one.
 *   Amber.
 *
 * Returns ``null`` when the creative falls in the "ordinary" 7-30 day
 * band — no badge clutter for unremarkable rows.
 */
function performanceTier(
  runDays: number,
  startedAt: string,
): { label: string; emoji: string; cls: string; tooltip: string } | null {
  const startedMs = startedAt ? new Date(startedAt).getTime() : 0;
  const ageDays = startedMs > 0 ? (Date.now() - startedMs) / 86_400_000 : 999;

  if (runDays >= 90) {
    return {
      label: "Performing",
      emoji: "🟢",
      cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      tooltip: `Running ${runDays}d (3 months+) — battle-tested winner`,
    };
  }
  if (runDays >= 30 && ageDays <= 60) {
    return {
      label: "Trending",
      emoji: "📈",
      cls: "border-sky-500/30 bg-sky-500/10 text-sky-300",
      tooltip: `Running ${runDays}d, launched ${Math.round(ageDays)}d ago — proven hook still in growth`,
    };
  }
  if (ageDays <= 7) {
    return {
      label: "Fresh",
      emoji: "🆕",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      tooltip: `First seen ${Math.round(ageDays)}d ago — just launched`,
    };
  }
  return null;
}
