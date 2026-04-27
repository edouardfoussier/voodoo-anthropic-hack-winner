/**
 * /ad/$id — single-creative deep dive.
 *
 * REAL DATA ONLY. The previous incarnation of this page (1346 lines)
 * rendered seven tabs of mock data — Audience Signals, Pattern Breakdown,
 * Community Reaction, Strategic Insights, Creative Brief — none of which
 * had a real backend. They've been removed.
 *
 * Now sourced from ``/api/creatives/{id}`` which scans the cached
 * SensorTower ``creatives_top_*.json`` files and returns:
 *   - Media (creative_url, preview_url, thumb_url, dimensions, duration)
 *   - Run metadata (first_seen_at, last_seen_at, days_active)
 *   - App info (icon, name, publisher, canonical country)
 *   - Network + ad_type + ad_formats + phashion_group
 *   - Up to 6 sibling creatives from the same advertiser
 *
 * If the creative isn't in any cache the API returns 404 and we render
 * a friendly empty state pointing the user back to the Library.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Play,
  ExternalLink,
  Calendar,
  Clock,
  Globe,
  Hash,
  Layers,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TopNav } from "@/components/dashboard/TopNav";
import { NetworkBadge } from "@/components/dashboard/NetworkBadge";
import { useCreativeDeconstruction } from "@/lib/api";
import type { Network } from "@/data/sample";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

interface CreativeDetailMedia {
  creative_url: string | null;
  preview_url: string | null;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  aspect_ratio: string | null;
  video_duration: number | null;
  title: string | null;
  button_text: string | null;
  message: string | null;
}

interface CreativeDetailApp {
  app_id: string;
  name: string;
  publisher_name: string | null;
  icon_url: string | null;
  canonical_country: string | null;
}

interface SimilarCreative {
  creative_id: string;
  network: Network;
  ad_type: string;
  thumb_url: string | null;
  advertiser_name: string | null;
  icon_url: string | null;
  first_seen_at: string | null;
  days_active: number;
}

interface CreativeDetail {
  creative_id: string;
  network: Network;
  ad_type: string;
  ad_formats: string[];
  first_seen_at: string | null;
  last_seen_at: string | null;
  days_active: number;
  phashion_group: string | null;
  media: CreativeDetailMedia;
  app: CreativeDetailApp;
  siblings: SimilarCreative[];
}

export const Route = createFileRoute("/ad/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Creative ${params.id} — Voodoo` },
      {
        name: "description",
        content:
          "Deep dive on a single mobile-game ad creative — real metadata, run history, and sibling ads from the same advertiser.",
      },
    ],
  }),
  component: AdDetailPage,
});

function useCreativeDetail(id: string) {
  return useQuery<CreativeDetail>({
    queryKey: ["creativeDetail", id],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/creatives/${encodeURIComponent(id)}`,
      );
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? `Creative not found in cache: ${id}`
            : `API → ${res.status}`,
        );
      }
      return res.json() as Promise<CreativeDetail>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function AdDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data: ad, isLoading, error } = useCreativeDetail(id);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto max-w-[1200px] px-6 py-6">
        <button
          type="button"
          onClick={() => router.history.back()}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Library
        </button>

        {isLoading && (
          <Card className="bg-card p-12 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Loading creative metadata…
            </p>
          </Card>
        )}

        {error && !isLoading && (
          <Card className="border-destructive/30 bg-destructive/5 p-8 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
            <h3 className="mt-3 text-base font-semibold">
              Creative not found
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {(error as Error).message}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try opening this link from the Ad Library — only creatives that
              have been fetched from SensorTower at least once are available
              here.
            </p>
            <Link to="/ads" className="mt-4 inline-block">
              <Button variant="outline" size="sm">
                Go to Ad Library
              </Button>
            </Link>
          </Card>
        )}

        {ad && (
          <>
            <Hero ad={ad} />
            <DeconstructionSection creativeId={ad.creative_id} />
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <RunHistoryCard ad={ad} />
              <CreativeMetaCard ad={ad} />
              <CopyCard ad={ad} />
            </div>
            {ad.siblings.length > 0 && <SiblingsSection ad={ad} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ HERO */

function Hero({ ad }: { ad: CreativeDetail }) {
  const aspect = ad.media.aspect_ratio ?? "9:16";
  const isVertical = aspect === "9:16" || aspect === "4:5";
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
      {/* Media — left 40% */}
      <div className="md:col-span-2">
        <div
          className="relative w-full overflow-hidden rounded-md bg-gradient-to-br from-muted to-muted/40"
          style={{
            aspectRatio: isVertical ? "9 / 16" : "16 / 9",
            maxHeight: isVertical ? 480 : undefined,
          }}
        >
          {/* SensorTower URL conventions (verified empirically against
              the live S3 bucket on 2026-04-26):
                - creative_url → real mp4 (Content-Type: video/mp4)
                - preview_url  → JPEG thumbnail (Content-Type: image/jpeg)
                - thumb_url    → JPEG thumbnail (smaller)
              The previous code passed preview_url to <video src> which
              only loaded the JPEG and never played anything. For
              video ads, use creative_url; for images/playables, fall
              back through preview_url then thumb_url as static <img>. */}
          {ad.ad_type.startsWith("video") && ad.media.creative_url ? (
            <video
              src={ad.media.creative_url}
              poster={ad.media.thumb_url ?? ad.media.preview_url ?? undefined}
              controls
              loop
              playsInline
              className="h-full w-full object-cover"
            />
          ) : ad.media.preview_url || ad.media.thumb_url ? (
            <img
              src={(ad.media.preview_url || ad.media.thumb_url) as string}
              alt={ad.media.title ?? ad.creative_id}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-background/40 backdrop-blur-sm">
                <Play className="h-6 w-6 fill-foreground text-foreground" />
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ad.media.creative_url && (
            <a href={ad.media.creative_url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Open source video
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Meta — right 60% */}
      <div className="md:col-span-3">
        <div className="flex items-center gap-3">
          {ad.app.icon_url ? (
            <img
              src={ad.app.icon_url}
              alt={ad.app.name}
              className="h-10 w-10 rounded-md ring-1 ring-border"
            />
          ) : (
            <div
              className="grid h-10 w-10 place-items-center rounded-md text-xs font-bold text-white ring-1 ring-border"
              style={{ background: "linear-gradient(135deg,#c9a24a,#7a3a1f)" }}
            >
              {ad.app.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold leading-tight">
              {ad.app.name}
            </div>
            {ad.app.publisher_name && (
              <div className="truncate text-xs text-muted-foreground">
                by {ad.app.publisher_name}
              </div>
            )}
          </div>
        </div>

        <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {ad.creative_id}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <NetworkBadge network={ad.network} />
          <Pill icon={<Layers className="h-3 w-3" />}>{ad.ad_type}</Pill>
          {ad.ad_formats.length > 0 &&
            ad.ad_formats.map((f) => (
              <Pill key={f}>{f}</Pill>
            ))}
          {ad.app.canonical_country && (
            <Pill icon={<Globe className="h-3 w-3" />}>
              {ad.app.canonical_country}
            </Pill>
          )}
          {ad.media.aspect_ratio && (
            <Pill>
              {ad.media.aspect_ratio}
              {ad.media.width && ad.media.height && (
                <span className="ml-1 text-muted-foreground/70">
                  · {ad.media.width}×{ad.media.height}
                </span>
              )}
            </Pill>
          )}
          {ad.media.video_duration != null && (
            <Pill icon={<Clock className="h-3 w-3" />}>
              {ad.media.video_duration}s
            </Pill>
          )}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat label="Days active" value={`${ad.days_active}d`} />
          <Stat
            label="First seen"
            value={ad.first_seen_at ?? "—"}
          />
          <Stat
            label="Last seen"
            value={ad.last_seen_at ?? "—"}
          />
        </div>
      </div>
    </div>
  );
}

function Pill({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs">
      {icon}
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium tabular-nums">
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ INFO CARDS */

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && (
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

function RunHistoryCard({ ad }: { ad: CreativeDetail }) {
  return (
    <Card className="bg-card p-5">
      <SectionTitle
        title="Run history"
        subtitle="Active window per SensorTower"
      />
      <dl className="mt-4 space-y-2.5 text-sm">
        <Row icon={<Calendar className="h-3 w-3" />} label="First seen">
          {ad.first_seen_at ?? "—"}
        </Row>
        <Row icon={<Calendar className="h-3 w-3" />} label="Last seen">
          {ad.last_seen_at ?? "—"}
        </Row>
        <Row icon={<Clock className="h-3 w-3" />} label="Days active">
          <span className="tabular-nums">{ad.days_active}</span>
        </Row>
        <Row icon={<Hash className="h-3 w-3" />} label="phash group">
          <span className="font-mono text-[11px] text-muted-foreground">
            {ad.phashion_group?.slice(0, 12) ?? "—"}…
          </span>
        </Row>
      </dl>
    </Card>
  );
}

function CreativeMetaCard({ ad }: { ad: CreativeDetail }) {
  return (
    <Card className="bg-card p-5">
      <SectionTitle title="Creative spec" subtitle="Format + dimensions" />
      <dl className="mt-4 space-y-2.5 text-sm">
        <Row label="Network">
          <NetworkBadge network={ad.network} />
        </Row>
        <Row label="Ad type">{ad.ad_type}</Row>
        {ad.media.video_duration != null && (
          <Row label="Duration">{ad.media.video_duration}s</Row>
        )}
        {ad.media.width != null && ad.media.height != null && (
          <Row label="Resolution">
            <span className="tabular-nums">
              {ad.media.width}×{ad.media.height}
            </span>
          </Row>
        )}
        {ad.media.aspect_ratio && (
          <Row label="Aspect">{ad.media.aspect_ratio}</Row>
        )}
      </dl>
    </Card>
  );
}

function CopyCard({ ad }: { ad: CreativeDetail }) {
  const hasCopy =
    ad.media.title || ad.media.message || ad.media.button_text;
  return (
    <Card className="bg-card p-5">
      <SectionTitle
        title="Ad copy"
        subtitle="Headline + body + CTA from network"
      />
      {hasCopy ? (
        <dl className="mt-4 space-y-3 text-sm">
          {ad.media.title && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Title
              </dt>
              <dd className="mt-0.5 font-medium">{ad.media.title}</dd>
            </div>
          )}
          {ad.media.message && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Message
              </dt>
              <dd className="mt-0.5 leading-snug">{ad.media.message}</dd>
            </div>
          )}
          {ad.media.button_text && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                CTA button
              </dt>
              <dd className="mt-0.5">
                <span className="inline-block rounded bg-primary/15 px-2 py-1 text-xs font-medium text-primary">
                  {ad.media.button_text}
                </span>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          No headline, body, or CTA copy was extracted by SensorTower for this
          creative.
        </p>
      )}
    </Card>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ SIBLINGS */

function SiblingsSection({ ad }: { ad: CreativeDetail }) {
  return (
    <section className="mt-8">
      <header className="mb-3 flex items-baseline justify-between">
        <SectionTitle
          title="Other creatives from this advertiser"
          subtitle={`${ad.siblings.length} more from ${ad.app.name}`}
        />
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ad.siblings.map((s) => (
          <Link
            key={s.creative_id}
            to="/ad/$id"
            params={{ id: s.creative_id }}
            className="group block overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/50"
          >
            <div
              className="relative w-full overflow-hidden bg-muted"
              style={{ aspectRatio: "9 / 16" }}
            >
              {s.thumb_url ? (
                <img
                  src={s.thumb_url}
                  alt={s.creative_id}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                  <Play className="h-5 w-5" />
                </div>
              )}
              <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
                {s.days_active}d
              </div>
            </div>
            <div className="space-y-0.5 px-2 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <NetworkBadge network={s.network} />
                <span className="truncate">{s.ad_type}</span>
              </div>
              <div className="truncate text-[11px] tabular-nums text-muted-foreground/70">
                {s.first_seen_at ?? "—"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ DECONSTRUCTION */

const PITCH_PALETTE: Record<string, string> = {
  satisfaction: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  fail: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  curiosity: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  rage_bait: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  tutorial: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  asmr: "border-pink-500/40 bg-pink-500/10 text-pink-300",
  celebrity: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  challenge: "border-red-500/40 bg-red-500/10 text-red-300",
  transformation: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  other: "border-border bg-card text-muted-foreground",
};

/**
 * "AI analysis" section — when this creative has a cached Gemini
 * deconstruction, surface it as a structured dossier (hook, scene
 * flow, on-screen text, palette, audience). Renders nothing when
 * the creative hasn't been analysed yet, so the rest of the page
 * is unaffected.
 */
function DeconstructionSection({ creativeId }: { creativeId: string }) {
  const { data: decon, isLoading } = useCreativeDeconstruction(creativeId);

  if (isLoading) {
    return (
      <section className="mt-6">
        <Card className="border-dashed border-border bg-card/40 p-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading AI analysis…
          </div>
        </Card>
      </section>
    );
  }
  if (!decon) return null;

  const pitchClass =
    decon.hook_emotional_pitch
      ? PITCH_PALETTE[decon.hook_emotional_pitch] ?? PITCH_PALETTE.other
      : PITCH_PALETTE.other;

  return (
    <section className="mt-6">
      <Card className="border-border bg-card p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI deconstruction
            </div>
            <h3 className="mt-0.5 text-base font-semibold">
              What Gemini sees in this ad
            </h3>
          </div>
          {decon.hook_emotional_pitch && (
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${pitchClass}`}
            >
              {decon.hook_emotional_pitch.replace("_", " ")}
            </span>
          )}
        </header>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Hook column */}
          <div className="space-y-3">
            {decon.hook_summary && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-primary">
                  Hook · 0–3s
                </div>
                <p className="mt-1 text-sm leading-relaxed">
                  {decon.hook_summary}
                </p>
              </div>
            )}
            {decon.hook_visual_action && (
              <Field label="Visual action">{decon.hook_visual_action}</Field>
            )}
            {decon.hook_text_overlay && (
              <Field label="Text overlay">"{decon.hook_text_overlay}"</Field>
            )}
            {decon.hook_voiceover_transcript && (
              <Field label="Voiceover">
                <span className="italic">
                  "{decon.hook_voiceover_transcript}"
                </span>
              </Field>
            )}
            {decon.audience_proxy && (
              <Field label="Audience proxy">{decon.audience_proxy}</Field>
            )}
            {decon.visual_style && (
              <Field label="Visual style">{decon.visual_style}</Field>
            )}
          </div>

          {/* Story arc column */}
          <div className="space-y-3">
            {decon.scene_flow.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Scene flow
                </div>
                <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-foreground/85">
                  {decon.scene_flow.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              </div>
            )}
            {decon.on_screen_text.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  On-screen text (chronological)
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {decon.on_screen_text.map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className="rounded-md border border-border bg-background/60 px-2 py-0.5 text-[11px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {decon.cta_text && (
              <Field label="Call to action">
                <span className="inline-block rounded bg-violet-500/15 px-2 py-1 text-xs font-medium text-violet-300">
                  {decon.cta_text}
                </span>
                {decon.cta_timing_seconds != null && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    appears at ~{decon.cta_timing_seconds.toFixed(1)}s
                  </span>
                )}
              </Field>
            )}
            {decon.palette_hex.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Dominant palette
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  {decon.palette_hex.map((hex) => (
                    <div
                      key={hex}
                      className="flex flex-col items-center gap-1"
                    >
                      <span
                        className="h-7 w-7 rounded-md border border-border shadow-inner"
                        style={{ background: hex }}
                        title={hex}
                      />
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {hex}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {decon.deconstruction_model && (
          <div className="mt-4 text-[10px] text-muted-foreground/70">
            Analysed with {decon.deconstruction_model}
          </div>
        )}
      </Card>
    </section>
  );
}
