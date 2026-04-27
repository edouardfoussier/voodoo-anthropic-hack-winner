/**
 * FloatingRunPill — persistent bottom-right indicator for the active
 * pipeline run. Rendered at app root so it survives navigation.
 *
 * Visibility rules:
 *   - run is null              → hidden
 *   - dialog is open           → hidden (the dialog already shows progress)
 *   - phase === "running"      → spinner pill with current step + progress
 *   - phase === "done"         → success pill with "View report" CTA
 *   - phase === "error"        → error pill with "Retry" CTA
 *
 * Clicking the pill (anywhere on the running/done/error variants) opens
 * the full dialog. The X dismisses for done/error. For running runs the X
 * is a "Cancel run" with confirmation.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PlayCircle,
  Sparkles,
  X,
} from "lucide-react";
import {
  summarizeSteps,
  usePipelineRuns,
} from "@/lib/pipeline-runs-context";
import { useGame } from "@/lib/game-context";

export function FloatingRunPill() {
  const {
    run,
    isDialogOpen,
    openDialog,
    cancelRun,
    dismissCompleted,
    startRun,
  } = usePipelineRuns();
  const { setGameName } = useGame();
  const navigate = useNavigate();

  if (!run || isDialogOpen) return null;

  const { completed, total, pct, currentLabel } = summarizeSteps(run.steps);

  // ─── RUNNING ──────────────────────────────────────────────────────────
  if (run.phase === "running") {
    return (
      <Wrapper>
        <button
          type="button"
          onClick={openDialog}
          className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-card/80"
        >
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span className="truncate">Analyzing {run.gameName}</span>
              <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                · {pct}%
              </span>
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {currentLabel
                ? `${currentLabel}…`
                : `Step ${completed} / ${total}`}
            </div>
            {/* mini progress bar */}
            <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </button>
        <DismissButton
          label="Cancel run"
          onClick={() => {
            if (
              window.confirm(
                "Cancel the pipeline run? The backend will keep running and cache the result, but progress will stop streaming.",
              )
            ) {
              cancelRun();
            }
          }}
        />
      </Wrapper>
    );
  }

  // ─── DONE ─────────────────────────────────────────────────────────────
  if (run.phase === "done" && run.doneEvent) {
    const game = run.doneEvent.name;
    return (
      <Wrapper variant="success">
        <button
          type="button"
          onClick={() => {
            setGameName(game);
            void navigate({ to: "/insights" });
            dismissCompleted();
          }}
          className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-emerald-500/10"
        >
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
          <div className="min-w-0 text-left">
            <div className="truncate text-xs font-medium">
              Report ready · {game}
            </div>
            <div className="truncate text-[10px] text-emerald-300/80">
              <Sparkles className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />
              View analysis →
            </div>
          </div>
        </button>
        <DismissButton onClick={dismissCompleted} />
      </Wrapper>
    );
  }

  // ─── ERROR ────────────────────────────────────────────────────────────
  if (run.phase === "error") {
    return (
      <Wrapper variant="error">
        <button
          type="button"
          onClick={() => startRun(run.gameName, run.config)}
          className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-destructive/10"
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
          <div className="min-w-0 text-left">
            <div className="truncate text-xs font-medium">
              Pipeline failed · {run.gameName}
            </div>
            <div className="truncate text-[10px] text-destructive/80">
              <PlayCircle className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />
              Retry
            </div>
          </div>
        </button>
        <DismissButton onClick={dismissCompleted} />
      </Wrapper>
    );
  }

  return null;
}

function Wrapper({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "error";
}) {
  const ring =
    variant === "success"
      ? "border-emerald-500/40 ring-emerald-500/10"
      : variant === "error"
        ? "border-destructive/40 ring-destructive/10"
        : "border-border ring-primary/10";
  return (
    <div
      className={`fixed bottom-4 right-4 z-[60] flex w-[22rem] max-w-[calc(100vw-2rem)] items-stretch overflow-hidden rounded-lg border bg-card shadow-lg ring-1 ${ring} animate-in slide-in-from-bottom-2 fade-in`}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

function DismissButton({
  onClick,
  label = "Dismiss",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid w-10 flex-shrink-0 place-items-center self-stretch border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
