/**
 * HookLens Insights — full pipeline output rendered from /api/report.
 *
 * Composition (top → bottom):
 *   - <ReportPicker />                 ← optional dropdown of cached reports
 *   - <GameDnaCard />                  ← target game identity
 *   - <ArchetypesTable />              ← THE differentiator: 3 signal bars per archetype
 *   - <GameFitGrid />                  ← Opus-scored compatibility
 *   - <BriefsGrid />                   ← creative briefs (3 variants)
 *   - <VariantsGallery />              ← Scenario MCP hero + storyboard images
 *   - <PitchStoryBlock />              ← auto-generated French demo pitch
 *
 * Empty state: when no cached report exists, point user to:
 *   `uv run python -m scripts.precache "<game_name>"`
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  DollarSign,
  Sigma,
  Sparkles,
  RefreshCw,
  History,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useReport,
  useReportList,
  useReportSourceCreatives,
} from "@/lib/api";
import { useGame } from "@/lib/game-context";
import { ArchetypesTable } from "@/components/insights/ArchetypesTable";
import { BriefsGrid } from "@/components/insights/BriefsGrid";
import { GameDnaCard } from "@/components/insights/GameDnaCard";
import { GameFitGrid } from "@/components/insights/GameFitGrid";
import { LaunchAnalysisModal } from "@/components/insights/LaunchAnalysisModal";
import { LiveAnalysisView } from "@/components/insights/LiveAnalysisView";
import { PitchStoryBlock } from "@/components/insights/PitchStoryBlock";
import { RunAnalysisDialog } from "@/components/insights/RunAnalysisDialog";
import {
  STEP_ORDER as STEP_ORDER_LABELS,
  type PipelineRunConfig,
  usePipelineRuns,
} from "@/lib/pipeline-runs-context";
import { VariantsGallery } from "@/components/insights/VariantsGallery";
import { GeneratedAdSection } from "@/components/insights/GeneratedAdSection";
import {
  fmtCurrency,
  fmtDuration,
  formatGenerated,
} from "@/components/insights/utils";

interface InsightsProps {
  /**
   * When true (set by the route from ``?launch=1``), the page auto-opens
   * the LaunchAnalysisModal on first mount. Used by the navbar's "Launch
   * new analysis" CTA so the user lands here with the modal already up.
   */
  autoLaunch?: boolean;
}

export function Insights({ autoLaunch = false }: InsightsProps = {}) {
  const { gameName, setGameName } = useGame();
  const { data: report, isLoading, error } = useReport(gameName);
  const { data: reportList = [] } = useReportList();
  // Source thumbnails per archetype (raw SensorTower creatives that were
  // clustered) — fetched in parallel with the report; lets ArchetypesTable
  // surface real ad thumbnails next to the analytical text.
  const { data: sourceCreatives = {} } = useReportSourceCreatives(gameName);

  // Configure flow stays local; the run itself lives in the global
  // PipelineRunsContext so it survives navigation / closed dialogs.
  const [configOpen, setConfigOpen] = useState(false);
  const { startRun, openDialog, run, dismissCompleted } = usePipelineRuns();

  // Navbar "Launch new analysis" → /insights?launch=1 → auto-open modal.
  useEffect(() => {
    if (autoLaunch) setConfigOpen(true);
  }, [autoLaunch]);

  // Auto-load the freshly-cached report when a run completes — this is
  // what makes the Insights view switch from empty/old to the new report
  // without the user having to click anything.
  const lastDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (run?.phase === "done" && run.doneEvent) {
      const finishedId = `${run.id}:${run.doneEvent.app_id}`;
      if (lastDoneRef.current !== finishedId) {
        lastDoneRef.current = finishedId;
        setGameName(run.doneEvent.name);
      }
    }
  }, [run?.phase, run?.id, run?.doneEvent?.app_id, run?.doneEvent?.name, setGameName]);

  const trimmedGame = gameName.trim();

  function openConfigForReRun() {
    setConfigOpen(true);
  }

  function handleLaunch(name: string, config: PipelineRunConfig) {
    setConfigOpen(false);
    startRun(name, config);
    openDialog();
  }

  // Hoisted above early returns so the modal stays mounted across
  // loading → empty → loaded transitions.
  const modals = (
    <>
      <LaunchAnalysisModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        initialGameName={trimmedGame || report?.target_game.name || ""}
        initialConfig={
          report
            ? {
                countries: report.market_context.countries,
                networks: report.market_context.networks,
              }
            : undefined
        }
        onLaunch={handleLaunch}
      />
      <RunAnalysisDialog />
    </>
  );

  // Live partial-report path. Active when:
  //   1. there is a current run in PipelineRunsContext
  //   2. its phase is still "running" (the cached report doesn't exist yet)
  //   3. the user has explicitly selected that run's game (gameName must
  //      be non-empty and match the run's gameName) — clicking
  //      "All analyses" sets gameName to "" so we fall through to the
  //      list view, even while a run is still streaming in the
  //      background. The floating pill keeps tracking it.
  const trimmedGameForLive = gameName.trim();
  const isLiveForCurrent =
    run &&
    run.phase === "running" &&
    trimmedGameForLive.length > 0 &&
    (trimmedGameForLive.toLowerCase() === run.gameName.toLowerCase() ||
      (run.doneEvent &&
        trimmedGameForLive.toLowerCase() ===
          run.doneEvent.name.toLowerCase()));
  if (isLiveForCurrent && run) {
    return (
      <>
        <LiveAnalysisView run={run} onBackToList={() => setGameName("")} />
        {modals}
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">Loading analysis…</p>
        </div>
        {modals}
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm font-medium text-destructive">
            Failed to load report: {(error as Error).message}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Check that the API server is running at{" "}
            <code>http://localhost:8000</code>.
          </p>
        </div>
        {modals}
      </>
    );
  }

  if (!report) {
    // Empty state — no game selected. The "Launch new analysis" CTA lives
    // in the navbar (always visible), so the page itself is now just the
    // Recent analyses list. Sorted most-recent first by /api/reports.
    return (
      <>
        <div className="space-y-4">
          {reportList.length > 0 ? (
            <>
              <header className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Recent analyses · {reportList.length}
                    {run && (run.phase === "running" || run.phase === "done") && (
                      <span className="ml-1 text-foreground/70">
                        + 1 active
                      </span>
                    )}
                  </span>
                </div>
                {gameName && (
                  <span className="text-xs text-muted-foreground">
                    No cached report for{" "}
                    <span className="text-foreground">"{gameName}"</span> — pick
                    one below or click{" "}
                    <span className="text-primary">Launch new analysis</span>{" "}
                    in the top right.
                  </span>
                )}
              </header>
              <div className="space-y-1.5">
                {/* Active run row — only renders when there's a live or
                    just-completed run. Sits above the cached list so the
                    PM always sees their in-flight work first. */}
                {run && (
                  <ActiveRunRow
                    run={run}
                    onOpen={() => {
                      // Click the running row → switch to the live
                      // partial report view (handled by Insights's live
                      // branch). For done runs, jump to the cached
                      // report. For errors, reopen the dialog so the
                      // user can read the error + retry.
                      if (run.phase === "running") {
                        setGameName(run.gameName);
                      } else if (run.phase === "done" && run.doneEvent) {
                        setGameName(run.doneEvent.name);
                      } else if (run.phase === "error") {
                        openDialog();
                      }
                    }}
                    onDismiss={dismissCompleted}
                  />
                )}
                {reportList.map((r) => (
                  <RecentAnalysisRow
                    key={r.app_id}
                    entry={r}
                    onPick={() => setGameName(r.name)}
                  />
                ))}
              </div>
            </>
          ) : (
            <Card className="border-border bg-card p-8 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-muted-foreground/50" />
              <h3 className="mt-3 text-base font-semibold">
                No cached analyses yet
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Click{" "}
                <span className="font-medium text-foreground">
                  Launch new analysis
                </span>{" "}
                in the top-right navbar to run the first pipeline.
              </p>
            </Card>
          )}

        </div>
        {modals}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-foreground">
              {fmtDuration(report.pipeline_duration_seconds)}
            </span>
            pipeline
          </span>
          <span className="inline-flex items-center gap-1">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="text-foreground">
              {fmtCurrency(report.total_cost_usd)}
            </span>
            spend
          </span>
          <span className="inline-flex items-center gap-1">
            <Sigma className="h-3.5 w-3.5" />
            <span className="text-foreground">
              {report.market_context.num_creatives_analyzed}
            </span>
            creatives ·{" "}
            <span className="text-foreground">
              {report.market_context.num_phashion_groups}
            </span>{" "}
            phashion groups
          </span>
          <span>· generated {formatGenerated(report.generated_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGameName("")}
            title="Back to the list of all cached analyses"
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            All analyses
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openConfigForReRun}
            title="Re-run the pipeline on this game (pre-fills its current scope)"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Re-run
          </Button>
        </div>
      </div>

      <GameDnaCard report={report} />
      <ArchetypesTable
        archetypes={report.top_archetypes}
        sourceCreatives={sourceCreatives}
      />
      <GameFitGrid
        scores={report.game_fit_scores}
        archetypes={report.top_archetypes}
      />
      <BriefsGrid variants={report.final_variants} />
      <VariantsGallery variants={report.final_variants} />
      {/* The hero output: pick a variant, click Generate, get the
          rendered ad video back inline. Lives between the static
          variant frames and the textual Summary so the report
          finishes on something the PM can actually ship. */}
      <GeneratedAdSection
        gameName={report.target_game.name}
        variants={report.final_variants}
      />
      <PitchStoryBlock report={report} />

      {modals}
    </div>
  );
}

interface RecentAnalysisRowProps {
  entry: {
    app_id: string;
    name: string;
    num_archetypes: number;
    num_variants: number;
    total_cost_usd: number;
    duration_seconds: number;
    generated_at: string | null;
    icon_url?: string | null;
    publisher?: string | null;
  };
  onPick: () => void;
}

/**
 * One wide row in the "Recent analyses" list on the Insights landing.
 *
 * Layout (left → right): app icon · game name + publisher · generated
 * date + relative age · archetypes/variants/cost/runtime chips · chevron.
 * Clicking anywhere loads the cached report into the Insights view.
 */
function RecentAnalysisRow({ entry, onPick }: RecentAnalysisRowProps) {
  const [iconErr, setIconErr] = useState(false);
  const generated = entry.generated_at
    ? new Date(entry.generated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const ageMs = entry.generated_at
    ? Date.now() - new Date(entry.generated_at).getTime()
    : null;
  const ageLabel = formatRelativeAge(ageMs);
  const showIcon = entry.icon_url && !iconErr;

  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex w-full items-center gap-4 rounded-md border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-card/80"
    >
      {/* Icon */}
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border">
        {showIcon ? (
          <img
            src={entry.icon_url ?? undefined}
            alt={entry.name}
            loading="lazy"
            onError={() => setIconErr(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground/40">
            <Sparkles className="h-4 w-4" />
          </div>
        )}
      </div>

      {/* Name + publisher */}
      <div className="min-w-0 flex-shrink-0 sm:w-56">
        <div className="truncate text-sm font-semibold leading-tight">
          {entry.name}
        </div>
        {entry.publisher && (
          <div className="truncate text-[11px] text-muted-foreground">
            by {entry.publisher}
          </div>
        )}
      </div>

      {/* Generated date */}
      <div className="hidden min-w-0 flex-shrink-0 text-[11px] text-muted-foreground md:block md:w-48">
        <div className="truncate tabular-nums">{generated}</div>
        {ageLabel && (
          <div className="truncate text-muted-foreground/70">{ageLabel}</div>
        )}
      </div>

      {/* Stats chips */}
      <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5 text-[10px]">
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground">
          {entry.num_archetypes} archetypes
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground">
          {entry.num_variants} variants
        </span>
        {entry.total_cost_usd > 0 && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground">
            ${entry.total_cost_usd.toFixed(2)}
          </span>
        )}
        {entry.duration_seconds > 0 && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground">
            {Math.round(entry.duration_seconds / 60)}m{" "}
            {Math.round(entry.duration_seconds % 60)}s
          </span>
        )}
      </div>

      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </button>
  );
}

interface ActiveRunRowProps {
  run: NonNullable<ReturnType<typeof usePipelineRuns>["run"]>;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * One wide row representing the current/just-finished pipeline run.
 *
 * Mirrors the layout of RecentAnalysisRow but with a live progress
 * indicator and tier-coloured status badge instead of static stat chips.
 * The X button on the right dismisses the row once the run is finished
 * (does nothing while running — to cancel use the dialog's Cancel button).
 */
function ActiveRunRow({ run, onOpen, onDismiss }: ActiveRunRowProps) {
  const { steps, phase, gameName, doneEvent } = run;
  const completed = STEP_ORDER_LABELS.filter(
    (s) => steps[s.step_id]?.status === "done",
  ).length;
  const total = STEP_ORDER_LABELS.length;
  const pct = Math.round((completed / total) * 100);
  const currentStep = STEP_ORDER_LABELS.find(
    (s) => steps[s.step_id]?.status === "running",
  );

  // Visuals per phase
  const tone =
    phase === "running"
      ? {
          ring: "ring-primary/30 border-primary/40 bg-primary/5",
          icon: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
          status: "Running",
          statusCls: "text-primary",
        }
      : phase === "done"
        ? {
            ring: "ring-emerald-500/30 border-emerald-500/40 bg-emerald-500/5",
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
            status: "Completed",
            statusCls: "text-emerald-300",
          }
        : {
            ring: "ring-destructive/30 border-destructive/40 bg-destructive/5",
            icon: <AlertCircle className="h-4 w-4 text-destructive" />,
            status: "Failed",
            statusCls: "text-destructive",
          };

  const displayName = doneEvent?.name ?? gameName;

  return (
    <div
      className={`group flex w-full items-center gap-4 rounded-md border px-4 py-3 ring-1 ${tone.ring}`}
    >
      {/* Status icon */}
      <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-card/80 ring-1 ring-border">
        {tone.icon}
      </div>

      {/* Name + phase label */}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold leading-tight">
            {displayName}
          </span>
          <span
            className={`rounded-full bg-card px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-current/30 ${tone.statusCls}`}
          >
            {tone.status}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {phase === "running" && (
            <>
              <span className="tabular-nums">
                Step {Math.min(completed + 1, total)} / {total}
              </span>
              {currentStep && (
                <span className="ml-1.5">· {currentStep.label}…</span>
              )}
            </>
          )}
          {phase === "done" && doneEvent && (
            <>
              <span className="tabular-nums">
                {Math.round(doneEvent.duration_s)}s
              </span>{" "}
              ·{" "}
              <span className="tabular-nums">
                ${doneEvent.cost_usd.toFixed(3)}
              </span>{" "}
              · click to view report →
            </>
          )}
          {phase === "error" && (
            <span className="text-destructive/80">
              {run.errorMsg ?? "Pipeline failed"} · click to retry
            </span>
          )}
        </div>

        {/* Live progress bar (only when running) */}
        {phase === "running" && (
          <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </button>

      {/* Dismiss / progress percentage */}
      {phase === "running" ? (
        <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
          {pct}%
        </span>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function formatRelativeAge(ms: number | null): string {
  if (ms == null) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}
