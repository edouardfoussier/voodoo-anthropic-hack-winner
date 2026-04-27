/**
 * GeneratedAdSection — final step of the report.
 *
 * Shows a variant selector (one chip per top variant) + a "Generate Ad"
 * CTA that fires the backend's parallel Scenario img2video pipeline.
 * The result is rendered inline as a 9:16 video player; the underlying
 * mp4 is also exposed for download / sharing.
 *
 * This is the section that delivers HookLens's promised output: an
 * actual ad video tailored to the publisher's game, not just a brief.
 *
 * Why a per-variant flow:
 *   The brief authoring step produces 1-3 variants, each with its own
 *   hero + 2 storyboards + per-frame prompts. Rendering each variant
 *   requires N parallel video calls; doing all variants automatically
 *   would burn ~$3-9 per report. So the PM picks ONE variant they like
 *   and clicks Generate — that single click fires 3 parallel calls,
 *   concats them, optionally appends the game's endcard, and returns
 *   the mp4 in 3-5 minutes.
 *
 * The PM can always come back and generate another variant; results
 * are cached on disk by (game, archetype_id) so re-clicks are instant.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Film,
  Loader2,
  Mic,
  Music,
  Sparkles,
  Video,
  Volume2,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useRenderVariantVideo,
  useVariantVideoStatus,
} from "@/lib/api";
import type { GeneratedVariant } from "@/types/hooklens";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

interface GeneratedAdSectionProps {
  gameName: string;
  variants: GeneratedVariant[];
}

export function GeneratedAdSection({
  gameName,
  variants,
}: GeneratedAdSectionProps) {
  const sorted = useMemo(
    () =>
      [...variants]
        .sort((a, b) => a.test_priority - b.test_priority)
        .slice(0, 3),
    [variants],
  );

  const [selectedId, setSelectedId] = useState<string>(
    sorted[0]?.brief.archetype_id ?? "",
  );
  const selected =
    sorted.find((v) => v.brief.archetype_id === selectedId) ?? sorted[0];

  // Audio knobs — sticky local state so the user's choice persists
  // across variant switches within the same Insights session.
  // All three default ON: the backend's `_try_apply_audio_layers`
  // mixes music (auto-ducked to 25%), voice (100%), and SFX
  // (timestamp-spliced) into a single track. The Opus-authored
  // bespoke narration is now reliable enough to be the demo default.
  const [includeMusic, setIncludeMusic] = useState(true);
  const [includeVoice, setIncludeVoice] = useState(true);
  const [includeSfx, setIncludeSfx] = useState(true);
  const [audioQuality, setAudioQuality] = useState<"fast" | "rich">(
    "fast",
  );
  // Natural-language refinement applied on the next render. Cleared
  // when the variant changes so a refinement doesn't accidentally
  // bleed into a different brief.
  const [correction, setCorrection] = useState("");

  const render = useRenderVariantVideo();

  // Status check — runs on mount + on variant + quality change. If a
  // video for this (game, variant, quality) tuple was rendered in a
  // previous session it lives on disk under data/cache/videos/ and we
  // surface it instantly, skipping the 5-min Scenario round-trip.
  const status = useVariantVideoStatus(
    gameName,
    selected?.brief.archetype_id,
    audioQuality,
  );

  if (!selected) return null;

  // Pick the most relevant video URL:
  //   1. The live render result (just-finished generation),
  //   2. The cached-on-disk URL the status endpoint reported,
  //   3. None — show the Generate CTA.
  const liveUrl = render.data?.video_url
    ? `${API_BASE}${render.data.video_url}`
    : null;
  const cachedUrl =
    status.data?.exists && status.data.video_url
      ? `${API_BASE}${status.data.video_url}`
      : null;
  const videoUrl = liveUrl ?? cachedUrl;
  const videoMeta = render.data
    ? {
        cached: render.data.cached,
        duration_s: render.data.duration_s,
        clips: render.data.clips,
        endcard_appended: render.data.endcard_appended,
        stub: render.data.stub,
        has_audio: render.data.has_audio ?? false,
      }
    : status.data?.exists && status.data.video_url
      ? {
          cached: true,
          duration_s: status.data.duration_s ?? 0,
          clips: 3,
          endcard_appended: status.data.endcard_appended ?? false,
          stub: false,
          has_audio: status.data.has_audio ?? false,
        }
      : null;

  function handleGenerate(opts: { withCorrection?: boolean } = {}) {
    render.mutate({
      gameName,
      archetypeId: selected!.brief.archetype_id,
      includeEndcard: true,
      includeAudio: includeMusic,
      includeVoice,
      includeSfx,
      voice: "alloy",
      audioQuality,
      correction: opts.withCorrection ? correction : undefined,
    });
  }

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Video className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Generated ad video
          </span>
          <Badge className="border border-pink-500/30 bg-pink-500/15 text-pink-300 shadow-none text-[10px]">
            Final output
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Pick a variant → fires 3 parallel Scenario img2video calls →
          concatenates the clips → appends the game's endcard if cached.
        </p>
      </header>

      <Card className="border-border bg-card overflow-hidden">
        {/* Variant chooser strip + audio toggles */}
        <div className="border-b border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pick the variant to render
            </div>
            <div className="flex items-center gap-1.5">
              {/* Quality toggle — rich = Kling 2.6 Pro with native
                  per-clip audio (diegetic SFX/music synced to visual
                  events). fast = Kling O1 silent + post-hoc overlay. */}
              <QualityToggle
                quality={audioQuality}
                onChange={setAudioQuality}
                disabled={render.isPending}
              />
              <AudioToggle
                label="Music bed"
                icon={<Music className="h-3 w-3" />}
                active={includeMusic && audioQuality === "fast"}
                onClick={() => setIncludeMusic((v) => !v)}
                disabled={render.isPending || audioQuality === "rich"}
                tooltip={
                  audioQuality === "rich"
                    ? "Disabled in Rich mode — music comes from each clip's native audio."
                    : "Stock track from data/cache/audio/library/<vibe>.mp3 matched to the variant's emotional pitch."
                }
              />
              <AudioToggle
                label="Brainrot voice"
                icon={<Mic className="h-3 w-3" />}
                active={includeVoice && audioQuality === "fast"}
                onClick={() => setIncludeVoice((v) => !v)}
                disabled={render.isPending || audioQuality === "rich"}
                tooltip={
                  audioQuality === "rich"
                    ? "Disabled in Rich mode — Kling 2.6 Pro generates voice + sfx natively from the brief's audio cues."
                    : "OpenAI TTS reads the brief's text_overlays + cta. Music auto-ducks to 25% volume."
                }
              />
              <AudioToggle
                label="Game SFX"
                icon={<Volume2 className="h-3 w-3" />}
                active={includeSfx && audioQuality === "fast"}
                onClick={() => setIncludeSfx((v) => !v)}
                disabled={render.isPending || audioQuality === "rich"}
                tooltip={
                  audioQuality === "rich"
                    ? "Disabled in Rich mode — Kling 2.6 Pro generates SFX natively per clip."
                    : "Splices whoosh / swoosh / drop / brand chime at fixed beats matching the 5-second clip boundaries. Reads from data/cache/audio/sfx/<stem>.mp3."
                }
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {sorted.map((v) => {
              const isActive = v.brief.archetype_id === selected.brief.archetype_id;
              return (
                <button
                  key={v.brief.archetype_id}
                  type="button"
                  onClick={() => {
                    setSelectedId(v.brief.archetype_id);
                    setCorrection("");
                    render.reset();
                  }}
                  disabled={render.isPending}
                  className={`group flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-all ${
                    isActive
                      ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
                      : "border-border bg-card hover:border-primary/30"
                  } ${render.isPending ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <img
                    src={v.hero_frame_path}
                    alt={`#${v.test_priority} hero`}
                    className="h-12 w-7 flex-shrink-0 rounded-sm object-cover ring-1 ring-border"
                    style={{ aspectRatio: "9 / 16" }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Priority #{v.test_priority}
                      {isActive && <Check className="h-2.5 w-2.5 text-primary" />}
                    </div>
                    <div className="line-clamp-1 text-xs font-medium leading-tight">
                      {v.brief.title}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Render area — pick one of: generate CTA, loading, error, video */}
        <div className="p-5">
          {render.isPending && <RenderingState selected={selected} />}

          {render.isError && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">
                  Render failed
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(render.error as Error)?.message ??
                    "Check the API server logs for details."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => handleGenerate({ withCorrection: false })}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Idle: show the cached video if we have one, else the CTA. */}
          {!render.isPending && !render.isError && videoUrl && videoMeta && (
            <RenderedVideo
              videoUrl={videoUrl}
              meta={videoMeta}
              variantTitle={selected.brief.title}
              correction={correction}
              onCorrectionChange={setCorrection}
              onRegenerate={() => handleGenerate({ withCorrection: false })}
              onRegenerateWithCorrection={() =>
                handleGenerate({ withCorrection: true })
              }
            />
          )}
          {!render.isPending && !render.isError && !videoUrl && (
            <GenerateCta
              selected={selected}
              onGenerate={() => handleGenerate({ withCorrection: false })}
            />
          )}
        </div>
      </Card>
    </section>
  );
}

function GenerateCta({
  selected,
  onGenerate,
}: {
  selected: GeneratedVariant;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 py-10 px-6">
      <Film className="h-8 w-8 text-muted-foreground/60" />
      <div className="text-center">
        <p className="text-sm font-medium">
          Ready to render <span className="text-primary">{selected.brief.title}</span>
        </p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Three Scenario img2video jobs run in parallel from the hero +
          storyboard frames. Total wait ≈ 3-5 minutes. The first run
          burns Scenario credits; subsequent clicks on the same variant
          return instantly from disk cache.
        </p>
      </div>
      <Button onClick={onGenerate} size="lg" className="gap-2">
        <Sparkles className="h-4 w-4" />
        Generate Ad
      </Button>
    </div>
  );
}

function RenderingState({ selected }: { selected: GeneratedVariant }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/10 py-12 px-6">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <div className="text-center">
        <p className="text-sm font-medium">
          Rendering <span className="text-primary">{selected.brief.title}</span>…
        </p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          3 parallel Scenario img2video jobs, then ffmpeg concat. This
          typically takes 3-5 minutes — keep this tab open.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-muted-foreground">
        <span className="rounded-full border border-border bg-card/60 px-2 py-0.5">
          ✓ Frames downloaded
        </span>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
          ⟳ Scenario img2video × 3
        </span>
        <span className="rounded-full border border-border bg-card/60 px-2 py-0.5">
          ◌ ffmpeg concat
        </span>
      </div>
    </div>
  );
}

function RenderedVideo({
  videoUrl,
  meta,
  variantTitle,
  correction,
  onCorrectionChange,
  onRegenerate,
  onRegenerateWithCorrection,
}: {
  videoUrl: string;
  meta: {
    cached: boolean;
    duration_s: number;
    clips: number;
    endcard_appended: boolean;
    stub: boolean;
    has_audio: boolean;
  };
  variantTitle: string;
  correction: string;
  onCorrectionChange: (value: string) => void;
  onRegenerate: () => void;
  onRegenerateWithCorrection: () => void;
}) {
  return (
    <div className="space-y-4">
      {meta.stub && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200">
            One or more clips fell back to a placeholder (Scenario auth
            missing or job timed out). Add credits and click Regenerate.
          </p>
        </div>
      )}

      <div className="flex flex-col items-center">
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          autoPlay
          loop
          /* Only mute when there's no audio track — otherwise the
             user has to manually unmute every time they reload. */
          muted={!meta.has_audio}
          playsInline
          className="w-full max-w-xs rounded-xl border border-border bg-black"
          style={{ aspectRatio: "9 / 16" }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[10px]">
        <Chip>
          <Check className="mr-0.5 h-2.5 w-2.5" />
          {meta.cached ? "From cache" : "Freshly rendered"}
        </Chip>
        <Chip>{meta.clips} clips concatenated</Chip>
        <Chip>≈ {meta.duration_s.toFixed(1)}s</Chip>
        {meta.has_audio && (
          <Chip className="border-violet-500/30 bg-violet-500/10 text-violet-300">
            ♪ Audio
          </Chip>
        )}
        {meta.endcard_appended && (
          <Chip className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            + endcard
          </Chip>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <a href={videoUrl} download>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Download mp4
          </Button>
        </a>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRegenerate}
          className="gap-1.5"
        >
          Regenerate (same brief)
        </Button>
      </div>

      {/* Natural-language refinement loop. The user types a free-text
          note ("voice should sound surprised", "more saturated reds",
          "drop the music after 5s") and clicks "Refine & regenerate".
          The note flows into every per-clip prompt as the highest-priority
          directive on the next render. Cached separately from the
          un-corrected version so both stay on disk for A/B'ing. */}
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <label
          htmlFor="render-correction"
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          <Sparkles className="h-3 w-3" />
          Not quite right? Refine the next render
        </label>
        <textarea
          id="render-correction"
          value={correction}
          onChange={(e) => onCorrectionChange(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. 'voice should sound surprised', 'more saturated reds', 'drop music after 5s'"
          className="mt-1.5 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {correction.length} / 500 · sent to all 3 clip prompts
          </span>
          <Button
            size="sm"
            variant="default"
            onClick={onRegenerateWithCorrection}
            disabled={!correction.trim()}
            className="gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Refine &amp; regenerate
          </Button>
        </div>
      </div>
    </div>
  );
}

function Chip({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border bg-card px-2 py-0.5 font-medium text-muted-foreground ${
        className || "border-border"
      }`}
    >
      {children}
    </span>
  );
}

function QualityToggle({
  quality,
  onChange,
  disabled,
}: {
  quality: "fast" | "rich";
  onChange: (q: "fast" | "rich") => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center rounded-full border border-border bg-card p-0.5 ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
      role="radiogroup"
      aria-label="Audio quality"
    >
      <button
        type="button"
        role="radio"
        aria-checked={quality === "fast"}
        disabled={disabled}
        onClick={() => onChange("fast")}
        title="Kling O1 silent clips + post-hoc overlay. ~$0.30 / 5 min."
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          quality === "fast"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Zap className="h-3 w-3" />
        Fast
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={quality === "rich"}
        disabled={disabled}
        onClick={() => onChange("rich")}
        title="Kling 2.6 Pro with native audio. Diegetic SFX synced to visuals. ~$1 / 5 min."
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          quality === "rich"
            ? "bg-pink-500/20 text-pink-300 ring-1 ring-pink-500/30"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Sparkles className="h-3 w-3" />
        Rich
      </button>
    </div>
  );
}

function AudioToggle({
  label,
  icon,
  active,
  onClick,
  disabled,
  tooltip,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
        active
          ? "border-primary/40 bg-primary/10 text-primary ring-1 ring-primary/20"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span className={active ? "text-primary" : ""}>{icon}</span>
      {label}
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-primary" : "bg-muted-foreground/40"
        }`}
      />
    </button>
  );
}
