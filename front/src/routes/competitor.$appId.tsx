/**
 * /competitor/$appId — full ad inventory for a single competitor app.
 *
 * Reached from the Competitive Scope table (clicking a row navigates
 * here). Renders the app's icon / publisher / description plus every
 * ad we've cached for that ``app_id`` across all networks, countries,
 * and weeks of SensorTower top-creatives queries.
 *
 * Backed by ``/api/competitor/{app_id}`` which builds entirely from
 * disk — no live SensorTower call. When the cache is empty we render
 * an explicit empty state with a precache hint instead of a stub.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  Image as ImageIcon,
  Play,
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
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { NetworkBadge } from "@/components/dashboard/NetworkBadge";
import { useCompetitorDetail } from "@/lib/api";
import type { Creative, Network } from "@/data/sample";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

export const Route = createFileRoute("/competitor/$appId")({
  head: ({ params }) => ({
    meta: [
      {
        title: `Competitor · ${params.appId} — VoodRadar`,
      },
    ],
  }),
  component: CompetitorDetailPage,
});

function CompetitorDetailPage() {
  const { appId } = Route.useParams();
  const { data, isLoading, error } = useCompetitorDetail(appId);

  return (
    <DashboardLayout title="Competitor detail">
      <div className="mb-4">
        <Link
          to="/competitive"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Competitive Scope
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Loading competitor inventory…
        </div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm font-medium text-destructive">
            Failed to load competitor: {(error as Error).message}
          </p>
        </Card>
      ) : !data ? (
        <Card className="border-border bg-card p-8">
          <h3 className="text-base font-semibold">No cached ads for this app</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            We haven't seen <code className="rounded bg-muted px-1 py-0.5 text-xs">{appId}</code> in
            any SensorTower top-creatives cache yet. Run a creative
            analysis on a game in the same category, or refresh the
            knowledge base via{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              uv run python -m scripts.scan_top_competitors
            </code>
            .
          </p>
        </Card>
      ) : (
        <CompetitorBody data={data} />
      )}
    </DashboardLayout>
  );
}

interface CompetitorDetail {
  app_id: string;
  name: string;
  publisher: string | null;
  icon_url: string | null;
  description: string | null;
  rating: number | null;
  rating_count: number | null;
  categories: string[] | null;
  creatives: Creative[];
  creatives_total: number;
  creatives_with_deconstruction: number;
  networks: Record<string, number>;
  formats: Record<string, number>;
}

function CompetitorBody({ data }: { data: CompetitorDetail }) {
  const [networkFilter, setNetworkFilter] = useState<Network | "All">("All");
  const filtered =
    networkFilter === "All"
      ? data.creatives
      : data.creatives.filter((c) => c.network === networkFilter);

  return (
    <div className="space-y-6">
      {/* Header card — icon, name, publisher, description, KPIs */}
      <Card className="border-border bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
            {data.icon_url ? (
              <img
                src={data.icon_url}
                alt={data.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground/40">
                <ImageIcon className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                {data.name}
              </h1>
              {data.publisher && (
                <span className="text-sm text-muted-foreground">
                  by {data.publisher}
                </span>
              )}
              {data.rating != null && (
                <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-amber-400 stroke-amber-400" />
                  {data.rating.toFixed(1)}
                  {data.rating_count
                    ? ` · ${abbrevNumber(data.rating_count)} reviews`
                    : ""}
                </span>
              )}
            </div>
            {data.categories && data.categories.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {data.categories.slice(0, 4).map((c) => (
                  <Badge key={c} variant="secondary" className="text-[11px]">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
            {data.description && (
              <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                {data.description}
              </p>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs sm:grid-cols-4">
          <KpiCell
            label="Cached ads"
            value={data.creatives_total.toString()}
            sub="across all networks"
          />
          <KpiCell
            label="Deconstructed"
            value={`${data.creatives_with_deconstruction}/${data.creatives_total}`}
            sub="full Gemini analysis"
          />
          <KpiCell
            label="Networks"
            value={Object.keys(data.networks).length.toString()}
            sub={Object.entries(data.networks)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 2)
              .map(([n, c]) => `${n} ${c}`)
              .join(" · ")}
          />
          <KpiCell
            label="Formats"
            value={Object.keys(data.formats).length.toString()}
            sub={Object.entries(data.formats)
              .map(([n, c]) => `${n} ${c}`)
              .join(" · ")}
          />
        </div>
      </Card>

      {/* Network filter pills */}
      {Object.keys(data.networks).length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <button
            type="button"
            onClick={() => setNetworkFilter("All")}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-all ${
              networkFilter === "All"
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({data.creatives.length})
          </button>
          {(["Meta", "TikTok", "Google", "ironSource"] as Network[]).map(
            (n) => {
              const count = data.creatives.filter((c) => c.network === n).length;
              if (count === 0) return null;
              const active = networkFilter === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNetworkFilter(n)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-all ${
                    active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {n} ({count})
                </button>
              );
            },
          )}
        </div>
      )}

      {/* Ad grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((c) => (
          <CompetitorAdCard key={c.id} creative={c} />
        ))}
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  );
}

function CompetitorAdCard({ creative: c }: { creative: Creative }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [thumbErr, setThumbErr] = useState(false);
  const hasVideo = Boolean(c.creativeUrl) && c.format === "Video";
  const hasThumb = Boolean(c.thumbUrl) && !thumbErr;

  return (
    <>
      <Card className="flex flex-col overflow-hidden border-border bg-card p-0 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
        <button
          type="button"
          onClick={() => hasVideo && setPreviewOpen(true)}
          disabled={!hasVideo}
          className="group relative block aspect-[9/16] w-full overflow-hidden bg-gradient-to-br from-muted to-muted/40"
        >
          {hasThumb ? (
            <img
              src={c.thumbUrl ?? undefined}
              alt={`${c.game} ad`}
              loading="lazy"
              onError={() => setThumbErr(true)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground/40">
              <ImageIcon className="h-10 w-10" />
            </div>
          )}
          {hasVideo && (
            <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <Play className="h-5 w-5 fill-foreground text-foreground" />
              </div>
            </div>
          )}
        </button>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <NetworkBadge network={c.network} />
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {c.format}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{c.startedAt || "—"}</span>
            {c.runDays > 0 && <span>{c.runDays}d running</span>}
          </div>
          <Link
            to="/ad/$id"
            params={{ id: c.id }}
            className="mt-1 inline-flex items-center gap-1 self-start text-[11px] text-primary hover:underline"
          >
            Open dossier
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </Card>

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
              {c.creativeUrl && (
                <a
                  href={resolveMediaUrl(c.creativeUrl)}
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
            {c.creativeUrl ? (
              <video
                key={c.creativeUrl}
                src={resolveMediaUrl(c.creativeUrl)}
                controls
                autoPlay
                playsInline
                className="h-full w-full object-contain"
              />
            ) : c.thumbUrl ? (
              <img
                src={c.thumbUrl}
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

function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

function abbrevNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
