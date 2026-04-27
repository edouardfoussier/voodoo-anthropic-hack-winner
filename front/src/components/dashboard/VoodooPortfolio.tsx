/**
 * Voodoo Portfolio — grid of Voodoo's top mobile games, each with the live
 * ad creatives they're currently running on SensorTower-tracked networks.
 *
 * The data comes from `data/cache/voodoo/portfolio_summary.json`, written by
 * `scripts.precache_voodoo_ads`. Every cell renders instantly from disk
 * during the demo (no live SensorTower fan-out — the precache script does
 * that ahead of time).
 *
 * Composition:
 *   - Header: catalog count + "last refreshed at" + Run-precache CLI hint
 *   - Grid of GameCard components (icon, name, categories, rating,
 *     ads_total, network mix, top-3 ad thumbnails)
 *   - Click a card → expand to a detailed list of all ad samples (mp4
 *     preview on click)
 *   - Each card has a "Run analysis" CTA → opens LaunchAnalysisModal
 *     pre-filled with the picked game name
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Play,
  Sparkles,
  Star,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, Minus, TrendingDown } from "lucide-react";
import { LaunchAnalysisModal } from "@/components/insights/LaunchAnalysisModal";
import { RunAnalysisDialog } from "@/components/insights/RunAnalysisDialog";
import {
  usePipelineRuns,
  type PipelineRunConfig,
} from "@/lib/pipeline-runs-context";
import {
  useVoodooPortfolio,
  type VoodooAdSample,
  type VoodooPortfolioEntry,
} from "@/lib/api";
import { useGame } from "@/lib/game-context";

// Tailwind-friendly network color hints (kept inline so we don't pull more deps).
const NETWORK_HEX: Record<string, string> = {
  TikTok: "#ec4899",
  Facebook: "#3b82f6",
  Instagram: "#a855f7",
  Youtube: "#ef4444",
  Admob: "#10b981",
  Unity: "#f59e0b",
  Applovin: "#06b6d4",
};

function networkColor(network: string): string {
  return NETWORK_HEX[network] ?? "#94a3b8";
}

const PAGE_SIZE = 9;

export function VoodooPortfolio() {
  const { gameName, setGameName } = useGame();
  const { data, isLoading, error } = useVoodooPortfolio(50);

  const [configOpen, setConfigOpen] = useState(false);
  // Game name to seed the LaunchAnalysisModal with — set the moment the
  // user clicks "Run analysis" on a card, so the modal's autocomplete is
  // already filled when it pops open. Distinct from the global gameName
  // in GameContext (which can be stale from a previous Insights load).
  const [pendingGameName, setPendingGameName] = useState<string>("");
  // ⚠️ Pagination state MUST live before the early returns below (loading
  // / error / empty). Otherwise React sees a different hook count on the
  // first render vs the loaded render → "Rendered more hooks than during
  // the previous render". Hard rule of hooks.
  const [page, setPage] = useState(0);
  const { startRun, openDialog, run } = usePipelineRuns();

  // Auto-navigate to the Insights page when a run completes from this view.
  // The Insights page itself also watches the run, but we want the user to
  // land there even if they kicked off the analysis from the portfolio.
  useEffect(() => {
    if (run?.phase === "done" && run.doneEvent) {
      setGameName(run.doneEvent.name);
      // Don't dismiss here — leave the floating pill clickable so the
      // user can navigate to /insights at their own pace.
    }
  }, [run?.phase, run?.doneEvent?.name, setGameName]);

  function handleAnalyze(name: string) {
    setGameName(name);
    setPendingGameName(name);
    setConfigOpen(true);
  }

  function handleLaunch(name: string, config: PipelineRunConfig) {
    setConfigOpen(false);
    startRun(name, config);
    openDialog();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Loading Voodoo portfolio…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-destructive">
          Failed to load Voodoo portfolio: {(error as Error).message}
        </p>
      </div>
    );
  }

  if (!data || data.apps.length === 0) {
    return (
      <Card className="border-border bg-card p-8">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
          <div>
            <h3 className="text-base font-semibold">
              Portfolio cache not populated yet
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The Voodoo Portfolio reads from a precomputed snapshot under{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                data/cache/voodoo/portfolio_summary.json
              </code>
              . Generate it with:
            </p>
            <pre className="mt-3 rounded-md bg-muted px-4 py-3 text-xs">
              uv run python -m scripts.precache_voodoo_ads
            </pre>
            <p className="mt-3 text-xs text-muted-foreground">
              ~30s for the top 15 most-rated Voodoo games. Once written, this
              page renders instantly from disk.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const generatedAt = data.generated_at
    ? new Date(data.generated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const totalAds = data.apps.reduce((acc, a) => acc + a.ads_total, 0);
  const networkTotals = aggregateNetworks(data.apps);
  const decliningApps = data.apps.filter(
    (a) =>
      typeof a.downloads_trend_7d_pct === "number" &&
      a.downloads_trend_7d_pct < -0.05,
  );

  // Sort: declining games first (most negative trend at the top), then
  // unknowns (no trend data), then growers. The PM should see "needs
  // attention" titles before the cruise-control hits.
  const sortedApps = [...data.apps].sort((a, b) => {
    const ta = a.downloads_trend_7d_pct;
    const tb = b.downloads_trend_7d_pct;
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });

  const totalPages = Math.ceil(sortedApps.length / PAGE_SIZE);
  const pageApps = sortedApps.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            <span className="text-foreground">{data.apps.length}</span> Voodoo
            games · <span className="text-foreground">{totalAds}</span> live
            ads scanned ·{" "}
            <span className="text-foreground">{data.country}</span>
          </span>
          {generatedAt && (
            <span>· refreshed {generatedAt}</span>
          )}
        </div>
        {Object.keys(networkTotals).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(networkTotals)
              .sort(([, a], [, b]) => b - a)
              .map(([network, count]) => (
                <span
                  key={network}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs"
                  title={`${count} ads on ${network}`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: networkColor(network) }}
                  />
                  <span className="text-muted-foreground">{network}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </span>
              ))}
          </div>
        )}
      </div>

      {decliningApps.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-start gap-3">
            <TrendingDown className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-500" />
            <div>
              <h3 className="text-sm font-semibold text-rose-700">
                {decliningApps.length} title
                {decliningApps.length === 1 ? "" : "s"} declining this week —
                worth running a fresh creative analysis
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {decliningApps
                  .slice()
                  .sort(
                    (a, b) =>
                      (a.downloads_trend_7d_pct ?? 0) -
                      (b.downloads_trend_7d_pct ?? 0),
                  )
                  .map(
                    (a) =>
                      `${a.name} (${(
                        (a.downloads_trend_7d_pct ?? 0) * 100
                      ).toFixed(0)}%)`,
                  )
                  .join(" · ")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pageApps.map((app) => (
          <GameCard key={app.app_id} app={app} onAnalyze={handleAnalyze} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page === totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <LaunchAnalysisModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        initialGameName={pendingGameName || gameName || ""}
        onLaunch={handleLaunch}
      />
      <RunAnalysisDialog />
    </div>
  );
}

interface GameCardProps {
  app: VoodooPortfolioEntry;
  onAnalyze: (name: string) => void;
}

function GameCard({ app, onAnalyze }: GameCardProps) {
  const [adsOpen, setAdsOpen] = useState(false);
  const [iconErr, setIconErr] = useState(false);

  const networkChips = useMemo(() => {
    const entries = Object.entries(app.ads_by_network).sort(
      ([, a], [, b]) => b - a,
    );
    return entries.slice(0, 4);
  }, [app.ads_by_network]);

  const hasAds = app.ads_total > 0;
  const hasUaSplit =
    app.paid_share != null && app.organic_share != null;

  return (
    <>
      <Card className="flex flex-col overflow-hidden border-border bg-card transition-colors hover:border-primary/50">
        <div className="flex items-start gap-3 p-4">
          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-muted">
            {app.icon_url && !iconErr ? (
              <img
                src={app.icon_url}
                alt={app.name}
                onError={() => setIconErr(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground/50">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-sm font-semibold leading-tight">
                {app.name}
              </h3>
              {app.rating != null && (
                <span className="inline-flex flex-shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-amber-400 stroke-amber-400" />
                  {app.rating.toFixed(1)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <span className="truncate">app_id {app.app_id}</span>
              {app.rating_count != null && app.rating_count > 0 && (
                <span>· {abbrevNumber(app.rating_count)} ratings</span>
              )}
            </div>
          </div>
        </div>

        {/* 30-day downloads sparkline + week-over-week trend chip — surfaces
            "needs attention" titles. The card border tints rose when w/w
            drop is steep, so a PM scanning the grid spots them in 2s. */}
        {(app.downloads_30d_curve?.length ?? 0) > 0 && (
          <DownloadsTrendStrip
            curve={app.downloads_30d_curve ?? []}
            trendPct={app.downloads_trend_7d_pct ?? null}
            country="US"
          />
        )}

        {/* Ad activity strip */}
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Live ads
            </span>
            <span
              className={`text-sm font-semibold tabular-nums ${
                hasAds ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {app.ads_total}
            </span>
          </div>

          {hasAds ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {networkChips.map(([network, count]) => (
                  <span
                    key={network}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px]"
                  >
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: networkColor(network) }}
                    />
                    <span>{network}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </span>
                ))}
              </div>

              {/* Top-3 thumbnails preview */}
              {app.ads_sample.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAdsOpen(true)}
                  className="mt-3 grid w-full grid-cols-3 gap-1.5 transition-opacity hover:opacity-90"
                >
                  {app.ads_sample.slice(0, 3).map((s, i) => (
                    <ThumbCell key={s.creative_id || i} sample={s} />
                  ))}
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-[11px] italic text-muted-foreground">
              No tracked creatives in the last 180 days.
            </p>
          )}
        </div>

        {/* UA-dependency strip: paid vs organic downloads share over the last
            3 months. Skipped quietly when SensorTower has no data. */}
        {hasUaSplit && (
          <UaDependencyStrip
            paidShare={app.paid_share!}
            organicShare={app.organic_share!}
            totalDownloads={app.total_downloads_3mo}
          />
        )}

        <div className="mt-auto flex gap-2 border-t border-border p-3">
          <Button
            size="sm"
            variant="default"
            className="flex-1"
            onClick={() => onAnalyze(app.name)}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Run analysis
          </Button>
          {hasAds && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdsOpen(true)}
            >
              View ads
            </Button>
          )}
        </div>
      </Card>

      {/* Ads detail dialog */}
      <Dialog open={adsOpen} onOpenChange={setAdsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="truncate">
                {app.name} — {app.ads_total} live ads
              </span>
              {app.ads_latest_first_seen && (
                <Badge variant="outline" className="text-xs">
                  latest {app.ads_latest_first_seen}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {app.ads_sample.map((s, i) => (
              <AdSampleCard key={s.creative_id || i} sample={s} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ThumbCellProps {
  sample: VoodooAdSample;
}

function ThumbCell({ sample }: ThumbCellProps) {
  const [errored, setErrored] = useState(false);
  const showImage = sample.thumb_url && !errored;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-sm bg-muted">
      {showImage ? (
        <img
          src={sample.thumb_url ?? undefined}
          alt={`${sample.network} ad`}
          loading="lazy"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/40">
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
      <span
        className="absolute bottom-0.5 left-0.5 rounded-sm px-1 py-px text-[8px] font-medium text-white"
        style={{ background: `${networkColor(sample.network)}cc` }}
      >
        {sample.network}
      </span>
    </div>
  );
}

interface AdSampleCardProps {
  sample: VoodooAdSample;
}

function AdSampleCard({ sample }: AdSampleCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [errored, setErrored] = useState(false);
  const hasVideo = Boolean(sample.creative_url);
  const showImage = sample.thumb_url && !errored;

  return (
    <>
      <button
        type="button"
        onClick={() => hasVideo && setPreviewOpen(true)}
        disabled={!hasVideo}
        className="group relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-muted ring-1 ring-border transition-all hover:ring-primary/50"
      >
        {showImage ? (
          <img
            src={sample.thumb_url ?? undefined}
            alt={`${sample.network} ad`}
            loading="lazy"
            onError={() => setErrored(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground/40">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
        {hasVideo && (
          <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/40">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-background/80 opacity-0 transition-opacity group-hover:opacity-100">
              <Play className="h-4 w-4 fill-foreground text-foreground" />
            </div>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5">
          <span
            className="rounded-sm px-1 py-px text-[10px] font-medium text-white"
            style={{ background: `${networkColor(sample.network)}cc` }}
          >
            {sample.network}
          </span>
          {sample.first_seen_at && (
            <span className="text-[10px] text-white/80">
              {sample.first_seen_at}
            </span>
          )}
        </div>
      </button>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl overflow-hidden p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>
                {sample.network} ·{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {sample.ad_type}
                  {sample.first_seen_at ? ` · since ${sample.first_seen_at}` : ""}
                </span>
              </span>
              {sample.creative_url && (
                <a
                  href={sample.creative_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-normal text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  Open original
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="relative aspect-[9/16] max-h-[70vh] w-full bg-black">
            {sample.creative_url ? (
              <video
                key={sample.creative_url}
                src={sample.creative_url}
                controls
                autoPlay
                playsInline
                className="h-full w-full object-contain"
              />
            ) : sample.thumb_url ? (
              <img
                src={sample.thumb_url}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface UaDependencyStripProps {
  paidShare: number;
  organicShare: number;
  totalDownloads: number | null;
}

function UaDependencyStrip({
  paidShare,
  organicShare,
  totalDownloads,
}: UaDependencyStripProps) {
  // Render shares as percentages clamped 0-100. Rare rounding pushes the sum
  // marginally above 1; clip so the bar never overflows.
  const paidPct = Math.max(0, Math.min(100, Math.round(paidShare * 100)));
  const organicPct = Math.max(0, Math.min(100 - paidPct, Math.round(organicShare * 100)));
  // Highlight in primary red when the game leans heavily on paid UA — those
  // are the titles whose creative ROI matters most to Voodoo's PMs.
  const heavy = paidPct >= 50;
  const paidBarColor = heavy ? "bg-rose-500" : "bg-primary";

  return (
    <div className="border-t border-border bg-muted/10 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          UA dependency
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            heavy ? "text-rose-400" : "text-foreground"
          }`}
        >
          {paidPct}%
        </span>
      </div>
      <div
        className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        title={`Paid ${paidPct}% · Organic ${organicPct}%`}
      >
        <div
          className={`h-full ${paidBarColor}`}
          style={{ width: `${paidPct}%` }}
        />
        <div
          className="h-full bg-emerald-500/70"
          style={{ width: `${organicPct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          paid {paidPct}% · organic {organicPct}%
        </span>
        {totalDownloads != null && totalDownloads > 0 && (
          <span className="tabular-nums">
            {abbrevNumber(totalDownloads)} dl · 90d
          </span>
        )}
      </div>
    </div>
  );
}

interface DownloadsTrendStripProps {
  curve: number[];
  trendPct: number | null;
  country: string;
}

/**
 * 30-day downloads sparkline + week-over-week trend chip.
 *
 * Sparkline = inline SVG polyline normalised to the cell's height. No
 * recharts dep; renders in <1ms even with 30 cards on screen.
 *
 * Trend chip color:
 * - rose when w/w drop ≥ 5% (declining → "run analysis" CTA in primary)
 * - amber when w/w drop 1–5% (slowing)
 * - emerald when w/w growth ≥ 1% (healthy)
 * - muted when |Δ| < 1% (flat)
 */
function DownloadsTrendStrip({
  curve,
  trendPct,
  country,
}: DownloadsTrendStripProps) {
  if (curve.length === 0) return null;

  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const stepX = curve.length > 1 ? w / (curve.length - 1) : 0;
  const points = curve
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const last7Total = curve.slice(-7).reduce((a, b) => a + b, 0);
  const last7Avg = Math.round(last7Total / Math.min(7, curve.length));

  let trendColor = "text-muted-foreground";
  let trendIcon = <Minus className="h-3 w-3" />;
  let strokeColor = "rgb(148 163 184)"; // slate-400
  let label = "stable";
  if (typeof trendPct === "number") {
    if (trendPct < -0.05) {
      trendColor = "text-rose-500";
      trendIcon = <ArrowDown className="h-3 w-3" />;
      strokeColor = "#f43f5e";
      label = "declining";
    } else if (trendPct < -0.01) {
      trendColor = "text-amber-500";
      trendIcon = <ArrowDown className="h-3 w-3" />;
      strokeColor = "#f59e0b";
      label = "slowing";
    } else if (trendPct > 0.01) {
      trendColor = "text-emerald-600";
      trendIcon = <ArrowUp className="h-3 w-3" />;
      strokeColor = "#10b981";
      label = "growing";
    }
  }

  return (
    <div
      className="border-t border-border bg-muted/10 px-4 py-3"
      title={`${label} · last 7d avg ${last7Avg.toLocaleString()} dl/day · ${country}`}
    >
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Downloads · 30d</span>
        {typeof trendPct === "number" ? (
          <span
            className={`inline-flex items-center gap-0.5 normal-case tracking-normal ${trendColor}`}
          >
            {trendIcon}
            <span className="font-semibold tabular-nums">
              {`${trendPct >= 0 ? "+" : ""}${(trendPct * 100).toFixed(0)}%`}
            </span>
            <span className="text-[10px] text-muted-foreground">w/w</span>
          </span>
        ) : (
          <span className="text-muted-foreground/60 normal-case tracking-normal">
            n/a
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="mt-1.5 h-7 w-full"
        aria-label={`30-day downloads sparkline · ${label}`}
      >
        <polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {curve.length > 0 && (
          <circle
            cx={(curve.length - 1) * stepX}
            cy={h - ((curve[curve.length - 1] - min) / range) * h}
            r="1.6"
            fill={strokeColor}
          />
        )}
      </svg>
      <div className="mt-1 text-[10px] text-muted-foreground">
        last 7d avg{" "}
        <span className="font-medium text-foreground tabular-nums">
          {abbrevNumber(last7Avg)}
        </span>{" "}
        dl/day · {country}
      </div>
    </div>
  );
}

function aggregateNetworks(apps: VoodooPortfolioEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of apps) {
    for (const [net, n] of Object.entries(a.ads_by_network)) {
      out[net] = (out[net] ?? 0) + n;
    }
  }
  return out;
}

function abbrevNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
