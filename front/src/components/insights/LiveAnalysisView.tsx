/**
 * LiveAnalysisView — progressive partial-report rendering during a run.
 *
 * When the user clicks the running ActiveRunRow on /insights, we land
 * here. The pipeline streams step payloads via SSE
 * (``pipeline-runs-context``); each step's ``data`` lands in
 * ``run.stepData[step_id]``. This component reads that buffer and
 * renders the matching report sections as they become available —
 * mirroring the "sections appear as they finish" feel the user loved
 * in the Streamlit prototype.
 *
 * Render order matches the pipeline:
 *   1. target_meta → header (icon + name + app_id)
 *   2. game_dna    → GameDnaCard
 *   3-5. top_advertisers / raw_creatives / deconstructed → progress chips
 *   6. archetypes  → ArchetypesTable
 *   7. fit_scores  → GameFitGrid
 *   8. briefs      → BriefsGrid
 *   9. variants    → VariantsGallery
 *  10. report      → final HookLensReport, replaces everything
 *
 * On done/error, falls back to the cached report path (the parent
 * Insights component re-routes via setGameName).
 */
import { useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArchetypesTable } from "./ArchetypesTable";
import { BriefsGrid } from "./BriefsGrid";
import { GameDnaCard } from "./GameDnaCard";
import { GameFitGrid } from "./GameFitGrid";
import { VariantsGallery } from "./VariantsGallery";
import {
  STEP_ORDER,
  buildPartialReport,
  summarizeSteps,
  usePipelineRuns,
  type ActiveRun,
  type StepState,
} from "@/lib/pipeline-runs-context";
import type {
  CreativeArchetype,
  GameFitScore,
  GeneratedVariant,
  HookLensReport,
} from "@/types/hooklens";

interface LiveAnalysisViewProps {
  /** The active run (already verified by parent to be live for this view). */
  run: ActiveRun;
  /** Called when user clicks "← All analyses" — clears gameName. */
  onBackToList: () => void;
}

export function LiveAnalysisView({ run, onBackToList }: LiveAnalysisViewProps) {
  const { openDialog } = usePipelineRuns();
  const partial = useMemo(
    () => buildPartialReport(run.stepData),
    [run.stepData],
  );
  const { completed, total, pct } = summarizeSteps(run.steps);

  // Each section renders only when its data has arrived. Cast where
  // needed — the runtime shape is enforced by Pydantic on the backend.
  const targetGame = partial.target_game as
    | HookLensReport["target_game"]
    | undefined;
  const archetypes = partial.top_archetypes as
    | CreativeArchetype[]
    | undefined;
  const fitScores = partial.game_fit_scores as GameFitScore[] | undefined;
  const variants = partial.final_variants as GeneratedVariant[] | undefined;

  // Best-effort minimal report shim for components that demand a full
  // HookLensReport prop (GameDnaCard, GameFitGrid). Only used when
  // target_game has landed.
  const minimalReport = targetGame
    ? ({
        target_game: targetGame,
        market_context: {
          category_id: "",
          category_name: "",
          countries: run.config?.countries ?? [],
          networks: run.config?.networks ?? [],
          period_start: "",
          period_end: "",
          num_advertisers_scanned: 0,
          num_creatives_analyzed: 0,
          num_phashion_groups: 0,
        },
        top_archetypes: archetypes ?? [],
        game_fit_scores: fitScores ?? [],
        final_variants: variants ?? [],
        pipeline_duration_seconds: 0,
        total_cost_usd: 0,
        generated_at: "",
      } as HookLensReport)
    : null;

  return (
    <div className="space-y-5">
      {/* Header — wide live status banner. Click "View progress" to
          reopen the step-by-step dialog. */}
      <Card
        className={`border p-4 ring-1 ${
          run.phase === "running"
            ? "border-primary/40 bg-primary/5 ring-primary/20"
            : run.phase === "done"
              ? "border-emerald-500/40 bg-emerald-500/5 ring-emerald-500/20"
              : "border-destructive/40 bg-destructive/5 ring-destructive/20"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-card ring-1 ring-border">
            {run.phase === "running" && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            {run.phase === "done" && (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            )}
            {run.phase === "error" && (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">
                Analyzing {run.gameName}
              </span>
              <span
                className={`rounded-full bg-card px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${
                  run.phase === "running"
                    ? "text-primary ring-primary/30"
                    : run.phase === "done"
                      ? "text-emerald-300 ring-emerald-500/30"
                      : "text-destructive ring-destructive/30"
                }`}
              >
                {run.phase === "running"
                  ? "Live"
                  : run.phase === "done"
                    ? "Completed"
                    : "Failed"}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              Step {Math.min(completed + 1, total)} / {total} · {pct}%
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all duration-500 ${
                  run.phase === "error" ? "bg-destructive" : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={openDialog}>
              View step-by-step
            </Button>
            <Button size="sm" variant="ghost" onClick={onBackToList}>
              All analyses
            </Button>
          </div>
        </div>
      </Card>

      {/* Section 1 — Game DNA. First non-trivial piece of content. */}
      {minimalReport ? (
        <GameDnaCard report={minimalReport} />
      ) : (
        <SkeletonSection
          title="Game DNA"
          subtitle="Extracting genre, palette, mechanics from SensorTower screenshots…"
          stepLabel={
            STEP_ORDER.find((s) => run.steps[s.step_id]?.status === "running")
              ?.label
          }
        />
      )}

      {/* Sections 2-3 — top advertisers + raw creatives discovery
          (no dedicated component — show inline progress chips so the
          PM sees real numbers landing). */}
      <DiscoveryStripe run={run} />

      {/* Section 4 — Archetypes. The differentiator card. */}
      {archetypes && archetypes.length > 0 ? (
        <ArchetypesTable archetypes={archetypes} sourceCreatives={{}} />
      ) : run.steps["archetypes"]?.status === "running" ||
        (run.steps["deconstructed"]?.status === "done" &&
          run.steps["archetypes"]?.status !== "done") ? (
        <SkeletonSection
          title="Creative archetypes"
          subtitle="Clustering deconstructed videos into hook archetypes (Gemini → Sonnet)…"
        />
      ) : null}

      {/* Section 5 — Game-fit scores. */}
      {minimalReport && fitScores && fitScores.length > 0 ? (
        <GameFitGrid
          scores={fitScores}
          archetypes={archetypes ?? []}
        />
      ) : run.steps["fit_scores"]?.status === "running" ? (
        <SkeletonSection
          title="Game-fit scores"
          subtitle="Scoring each archetype against the target game (Opus)…"
        />
      ) : null}

      {/* Section 6 — Briefs. Don't render BriefsGrid until variants land
          since variants are what carry the brief inside, but show a
          status hint while briefs are being authored. */}
      {variants && variants.length > 0 ? (
        <BriefsGrid variants={variants} />
      ) : run.steps["briefs"]?.status === "running" ||
        (run.steps["briefs"]?.status === "done" &&
          run.steps["variants"]?.status !== "done") ? (
        <SkeletonSection
          title="Creative briefs"
          subtitle="Authoring per-archetype briefs adapted to the game (Opus)…"
        />
      ) : null}

      {/* Section 7 — Variants gallery (visuals). */}
      {variants && variants.length > 0 ? (
        <VariantsGallery variants={variants} />
      ) : run.steps["variants"]?.status === "running" ? (
        <SkeletonSection
          title="Visual variants"
          subtitle="Generating hero frames + storyboards via Scenario…"
        />
      ) : null}
    </div>
  );
}

/** Tiny placeholder card shown for sections whose pipeline step is in
 *  flight or about to start. Prevents a jumpy layout. */
function SkeletonSection({
  title,
  subtitle,
  stepLabel,
}: {
  title: string;
  subtitle?: string;
  stepLabel?: string;
}) {
  return (
    <Card className="border-dashed border-border bg-card/40 p-5">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground/70" />
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground/80">
              {subtitle}
            </p>
          )}
          {stepLabel && (
            <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Currently: {stepLabel}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Market discovery card — three stat cells (top advertisers, creatives
 * pulled, deconstructed) plus expandable inline tables that show the
 * actual rows feeding each count, mirroring the Streamlit prototype's
 * "data appears as tables" feel.
 *
 * Source data comes from the rich SSE event payloads stored in
 * ``run.stepData[step_id]`` — the backend's _full_step_payload ships
 * the full advertiser/creative lists so we can render real rows here.
 */
function DiscoveryStripe({ run }: { run: ActiveRun }) {
  const advData = run.stepData["top_advertisers"] as
    | Array<Record<string, unknown>>
    | undefined;
  const rawData = run.stepData["raw_creatives"] as
    | Array<Record<string, unknown>>
    | undefined;
  const decData = run.stepData["deconstructed"] as
    | Array<Record<string, unknown>>
    | undefined;

  const cells: {
    key: "advertisers" | "creatives" | "deconstructed";
    label: string;
    value: number | null;
    state: StepState;
    rows: Array<Record<string, unknown>> | undefined;
  }[] = [
    {
      key: "advertisers",
      label: "Top advertisers",
      value: advData?.length ?? null,
      state: run.steps["top_advertisers"],
      rows: advData,
    },
    {
      key: "creatives",
      label: "Creatives pulled",
      value: rawData?.length ?? null,
      state: run.steps["raw_creatives"],
      rows: rawData,
    },
    {
      key: "deconstructed",
      label: "Deconstructed",
      value: decData?.length ?? null,
      state: run.steps["deconstructed"],
      rows: decData,
    },
  ];

  // Local state — which cell is expanded. Single-select keeps focus.
  const [openKey, setOpenKey] = useState<
    "advertisers" | "creatives" | "deconstructed" | null
  >(null);

  const anyActive = cells.some(
    (c) => c.state?.status === "running" || c.state?.status === "done",
  );
  if (!anyActive) return null;

  return (
    <Card className="border-border bg-card/60 p-4">
      <header className="mb-3 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary/70" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Market discovery
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">
          Click a cell to expand the table
        </span>
      </header>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((cell) => {
          const isOpen = openKey === cell.key;
          const clickable = (cell.rows?.length ?? 0) > 0;
          return (
            <button
              key={cell.label}
              type="button"
              onClick={() =>
                clickable ? setOpenKey(isOpen ? null : cell.key) : undefined
              }
              disabled={!clickable}
              className={`rounded-md border bg-card px-3 py-2 text-left transition-colors ${
                isOpen
                  ? "border-primary/40 ring-1 ring-primary/20"
                  : clickable
                    ? "border-border hover:border-primary/40 cursor-pointer"
                    : "border-border cursor-default"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {cell.label}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">
                  {cell.value ?? "—"}
                </span>
                {cell.state?.status === "running" && (
                  <Loader2 className="h-3 w-3 animate-spin text-primary/70" />
                )}
                {cell.state?.status === "done" && (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400/70" />
                )}
                {clickable && (
                  <ChevronDown
                    className={`ml-auto h-3 w-3 text-muted-foreground/60 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {openKey === "advertisers" && advData && advData.length > 0 && (
        <AdvertisersTable rows={advData} />
      )}
      {openKey === "creatives" && rawData && rawData.length > 0 && (
        <CreativesTable rows={rawData} />
      )}
      {openKey === "deconstructed" && decData && decData.length > 0 && (
        <DeconstructedTable rows={decData} />
      )}
    </Card>
  );
}

/** Top advertisers expander — icon + name + publisher + sov + rank chip. */
function AdvertisersTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const sorted = [...rows].sort(
    (a, b) => (Number(b.sov) || 0) - (Number(a.sov) || 0),
  );
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-card/80">
      <div className="grid grid-cols-[auto_2fr_auto_auto] gap-3 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>#</span>
        <span>Advertiser</span>
        <span className="text-right">Share of voice</span>
        <span className="text-right">App ID</span>
      </div>
      <div className="divide-y divide-border/60">
        {sorted.slice(0, 10).map((row, i) => {
          const name =
            (row.name as string) ??
            (row.app_name as string) ??
            "Unknown";
          const sov =
            typeof row.sov === "number"
              ? row.sov
              : typeof row.share === "number"
                ? row.share
                : 0;
          const appId =
            (row.app_id as string) ??
            (row.unified_app_id as string) ??
            "";
          // SensorTower returns icon_url either at the top level or
          // nested under app_info — handle both shapes.
          const iconUrl =
            (row.icon_url as string | undefined) ??
            ((row.app_info as Record<string, unknown> | undefined)
              ?.icon_url as string | undefined);
          const publisher =
            (row.publisher_name as string | undefined) ??
            ((row.app_info as Record<string, unknown> | undefined)
              ?.publisher_name as string | undefined);
          return (
            <div
              key={`${appId}-${i}`}
              className="grid grid-cols-[auto_2fr_auto_auto] items-center gap-3 px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt={name}
                    loading="lazy"
                    className="h-7 w-7 rounded-md ring-1 ring-border"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-md bg-muted ring-1 ring-border" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{name}</div>
                {publisher && (
                  <div className="truncate text-[10px] text-muted-foreground">
                    by {publisher}
                  </div>
                )}
              </div>
              <span className="text-right tabular-nums text-foreground/85">
                {(sov * 100).toFixed(1)}%
              </span>
              <span className="text-right font-mono text-[10px] text-muted-foreground">
                {appId.slice(0, 12) || "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Top creatives expander — thumbnail + advertiser + network + ad_type + first_seen. */
function CreativesTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-card/80">
      <div className="grid grid-cols-[auto_2fr_auto_auto_auto] gap-3 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span></span>
        <span>Advertiser</span>
        <span>Network</span>
        <span>Type</span>
        <span className="text-right">First seen</span>
      </div>
      <div className="divide-y divide-border/60">
        {rows.slice(0, 10).map((row, i) => (
          <div
            key={`${row.creative_id ?? i}`}
            className="grid grid-cols-[auto_2fr_auto_auto_auto] items-center gap-3 px-3 py-1.5 text-xs"
          >
            {row.thumb_url ? (
              <img
                src={row.thumb_url as string}
                alt="ad thumbnail"
                loading="lazy"
                className="h-12 w-7 flex-shrink-0 rounded-sm object-cover ring-1 ring-border"
                style={{ aspectRatio: "9 / 16" }}
              />
            ) : (
              <div
                className="h-12 w-7 flex-shrink-0 rounded-sm bg-muted ring-1 ring-border"
                style={{ aspectRatio: "9 / 16" }}
              />
            )}
            <span className="truncate font-medium">
              {(row.advertiser_name as string) ?? "Unknown"}
            </span>
            <span className="text-foreground/85">
              {(row.network as string) ?? "—"}
            </span>
            <span className="text-foreground/85">
              {(row.ad_type as string) ?? "—"}
            </span>
            <span className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">
              {(row.first_seen_at as string)?.slice(0, 10) ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Deconstructed expander — emotional pitch + first scene_flow line. */
function DeconstructedTable({
  rows,
}: {
  rows: Array<Record<string, unknown>>;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-card/80">
      <div className="grid grid-cols-[auto_2fr] gap-3 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Pitch</span>
        <span>Hook summary</span>
      </div>
      <div className="divide-y divide-border/60">
        {rows.slice(0, 10).map((row, i) => {
          const hook = (row.hook as Record<string, unknown>) ?? {};
          const pitch = (hook.emotional_pitch as string) ?? "—";
          const summary = (hook.summary as string) ?? "—";
          return (
            <div
              key={i}
              className="grid grid-cols-[auto_2fr] items-baseline gap-3 px-3 py-1.5 text-xs"
            >
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {pitch}
              </span>
              <span className="line-clamp-2 leading-relaxed text-foreground/85">
                {summary}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
