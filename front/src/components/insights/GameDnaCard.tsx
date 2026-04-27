import { useState } from "react";
import {
  Sparkles,
  Users,
  Palette as PaletteIcon,
  Image as ImageIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useGameScreenshots } from "@/lib/api";
import type { HookLensReport } from "@/types/hooklens";

interface GameDnaCardProps {
  report: HookLensReport;
}

export function GameDnaCard({ report }: GameDnaCardProps) {
  const dna = report.target_game;
  const { data: screenshots } = useGameScreenshots(dna?.name ?? "");
  if (!dna) return null;

  const swatches: { label: string; hex: string }[] = [
    { label: "Primary", hex: dna.palette.primary_hex },
    { label: "Secondary", hex: dna.palette.secondary_hex },
    { label: "Accent", hex: dna.palette.accent_hex },
  ];

  return (
    <Card className="border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Game DNA
          </div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {dna.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-medium">
              {dna.genre}
            </Badge>
            {dna.sub_genre && (
              <Badge variant="outline" className="font-medium">
                {dna.sub_genre}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              app_id <span className="font-mono">{dna.app_id}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            <PaletteIcon className="h-3.5 w-3.5" /> Brand palette
          </div>
          <div className="flex items-center gap-2">
            {swatches.map((s) => (
              <div key={s.label} className="flex flex-col items-center">
                <span
                  className="h-9 w-9 rounded-md border border-border shadow-inner"
                  style={{ background: s.hex }}
                  title={`${s.label}: ${s.hex}`}
                  aria-label={`${s.label} ${s.hex}`}
                />
                <span className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {s.hex}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-xs italic text-muted-foreground">
        {dna.palette.description}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Core loop
          </div>
          <blockquote className="mt-1 rounded-md border-l-2 border-primary/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed text-foreground">
            {dna.core_loop}
          </blockquote>

          <div className="mt-4 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Audience proxy
          </div>
          <p className="mt-1 text-sm italic text-foreground/90">
            {dna.audience_proxy}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Visual style
            </div>
            <span className="mt-1 inline-flex rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300">
              {dna.visual_style}
            </span>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              UI mood
            </div>
            <span className="mt-1 inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300">
              {dna.ui_mood}
            </span>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Character on screen
            </div>
            <span className="mt-1 text-xs font-medium">
              {dna.character_present ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </div>

      {dna.key_mechanics.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Key mechanics
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dna.key_mechanics.map((m) => (
              <Badge key={m} variant="outline" className="font-mono text-[11px]">
                {m}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {screenshots?.screenshot_urls && screenshots.screenshot_urls.length > 0 && (
        <details className="group mt-5 rounded-md border border-border bg-background/40 px-3 py-2" open>
          <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              App Store screenshots ({screenshots.screenshot_urls.length}) — what
              the game actually looks like
            </span>
          </summary>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {screenshots.screenshot_urls.slice(0, 8).map((url, i) => (
              <ScreenshotThumb key={url + i} url={url} alt={`${dna.name} screenshot ${i + 1}`} />
            ))}
          </div>
        </details>
      )}

      {dna.screenshot_signals.length > 0 && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Screenshot signals
            </div>
            <span
              className="text-[10px] text-muted-foreground/70"
              title="Concrete visual cues Gemini Vision extracted from the App Store screenshots above — used as inputs to the brief and visual generation."
            >
              {dna.screenshot_signals.length} signals · from Gemini Vision
            </span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {dna.screenshot_signals.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5"
              >
                <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="text-xs leading-snug text-foreground/85">
                  {s}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

interface ScreenshotThumbProps {
  url: string;
  alt: string;
}

function ScreenshotThumb({ url, alt }: ScreenshotThumbProps) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div className="grid h-44 w-[88px] flex-shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground/40">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group/ss relative h-44 w-[88px] flex-shrink-0 overflow-hidden rounded-md border border-border bg-muted/40 transition-all hover:border-primary/50"
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setErrored(true)}
        className="h-full w-full object-cover transition-transform group-hover/ss:scale-105"
      />
    </a>
  );
}
