import { AlertTriangle, ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { GeneratedVariant } from "@/types/hooklens";

interface VariantsGalleryProps {
  variants: GeneratedVariant[];
}

const PRIORITY_BADGE_CLASS: Record<number, string> = {
  1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  3: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

function isPlaceholder(url: string): boolean {
  return url.includes("picsum.photos");
}

export function VariantsGallery({ variants }: VariantsGalleryProps) {
  if (!variants?.length) {
    return (
      <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
        No generated assets available.
      </Card>
    );
  }

  // Match the BriefsGrid behaviour — top 3 max, adaptive columns so a
  // single variant doesn't sit in a narrow lane and 3 don't get cramped.
  const sorted = [...variants]
    .sort((a, b) => a.test_priority - b.test_priority)
    .slice(0, 3);
  const totalAvailable = variants.length;
  const colsClass =
    sorted.length === 1
      ? "grid-cols-1"
      : sorted.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 lg:grid-cols-3";

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Generated variants — Scenario MCP
        </span>
        <span className="text-xs text-muted-foreground">
          (top {sorted.length}
          {totalAvailable > sorted.length
            ? ` of ${totalAvailable}`
            : ""}
          )
        </span>
      </header>
      <div className={`grid gap-4 ${colsClass}`}>
        {sorted.map((v) => (
          <VariantCard
            key={v.brief.archetype_id}
            variant={v}
            isSolo={sorted.length === 1}
          />
        ))}
      </div>
    </section>
  );
}

function VariantCard({
  variant,
  isSolo,
}: {
  variant: GeneratedVariant;
  /** When true, this variant is the only one in the gallery — render its
   *  3 frames (hero + 2 storyboards) side-by-side at equal size instead
   *  of the hero-on-top + 3-storyboards-strip layout. */
  isSolo: boolean;
}) {
  const { brief, hero_frame_path, storyboard_paths, test_priority } = variant;
  const allUrls = [hero_frame_path, ...storyboard_paths];
  const hasPlaceholder = allUrls.some(isPlaceholder);
  const priorityClass =
    PRIORITY_BADGE_CLASS[test_priority] ??
    "bg-muted text-muted-foreground border-border";

  // Solo layout: hero + 2 storyboards (max) at the same width. We slice
  // the storyboards to 2 so the row stays at 3 lanes total — avoids
  // jamming when a brief was generated with 3+ storyboards.
  const soloFrames: { url: string; label: string }[] = isSolo
    ? [
        { url: hero_frame_path, label: "Hero" },
        ...storyboard_paths
          .slice(0, 2)
          .map((url, i) => ({ url, label: `Frame ${i + 2}` })),
      ]
    : [];

  return (
    <Card className="flex h-full flex-col overflow-hidden border-border bg-card p-0">
      {isSolo ? (
        // ─── Solo: 3-up grid with equally-sized frames ──────────
        <div className="grid grid-cols-3 gap-1 bg-muted/20 p-1">
          {soloFrames.map(({ url, label }, i) => (
            <div
              key={url + i}
              className="relative aspect-[9/16] overflow-hidden rounded-sm border border-border/50 bg-muted/40"
            >
              <img
                src={url}
                alt={`${label} for ${brief.title}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute left-1 top-1 rounded bg-background/80 px-1 py-0.5 text-[10px] font-medium backdrop-blur-sm">
                {label}
              </span>
              {i === 0 && (
                <span
                  className={`absolute right-1 top-1 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm ${priorityClass}`}
                >
                  #{test_priority}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Multi: hero on top + 3-up storyboard strip below. */}
          <div className="relative aspect-[9/16] w-full overflow-hidden bg-muted/40">
            <img
              src={hero_frame_path}
              alt={`Hero frame for ${brief.title}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span className="absolute left-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
              Hero
            </span>
            <span
              className={`absolute right-2 top-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm ${priorityClass}`}
            >
              #{test_priority}
            </span>
          </div>

          {storyboard_paths.length > 0 && (
            <div className="grid grid-cols-3 gap-1 bg-muted/20 p-1">
              {storyboard_paths.slice(0, 3).map((path, i) => (
                <div
                  key={path + i}
                  className="relative aspect-[9/16] overflow-hidden rounded-sm border border-border/50 bg-muted/40"
                >
                  <img
                    src={path}
                    alt={`Storyboard frame ${i + 1} for ${brief.title}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute left-1 top-1 rounded bg-background/80 px-1 py-0.5 text-[9px] font-medium backdrop-blur-sm">
                    {i + 2}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold leading-snug">
          {brief.title}
        </h3>

        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-primary">
            Hook · 0–3s
          </div>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {brief.hook_3s}
          </p>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {variant.test_priority_rationale}
        </p>

        {hasPlaceholder && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Placeholder asset (Scenario timeout or missing creds).
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
