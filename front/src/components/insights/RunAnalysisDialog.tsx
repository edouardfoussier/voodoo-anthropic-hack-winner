/**
 * RunAnalysisDialog — rich progress view for the active pipeline run.
 *
 * **No longer owns the EventSource.** All run state lives in
 * ``PipelineRunsContext`` (see ``front/src/lib/pipeline-runs-context.tsx``).
 * This component is a pure view that:
 *   - opens/closes via ``isDialogOpen`` from context
 *   - renders the 10 step rows from ``run.steps``
 *   - exposes a "Run in background" button that simply closes the
 *     dialog (the run keeps executing — the floating pill takes over)
 *
 * On done, the parent Insights view auto-loads the report (it watches
 * ``run.phase === "done"`` and calls ``setGameName(doneEvent.name)``).
 *
 * Re-export of ``PipelineRunConfig`` is preserved here so existing
 * imports from this module keep working.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  CircleDashed,
  DollarSign,
  Loader2,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/game-context";
import {
  STEP_ORDER,
  type StepState,
  usePipelineRuns,
} from "@/lib/pipeline-runs-context";

export type { PipelineRunConfig } from "@/lib/pipeline-runs-context";

export function RunAnalysisDialog() {
  const { run, isDialogOpen, closeDialog, startRun, cancelRun } =
    usePipelineRuns();
  const { setGameName } = useGame();
  const navigate = useNavigate();

  /**
   * "Run in background" / Close button. Closing the dialog mid-run is a
   * common path during the demo — the user wants to see the live list
   * view (with the running analysis as the first row), not stay on the
   * page they were on. So we explicitly land them on /insights with no
   * game selected, which renders the list. The pipeline keeps running
   * via PipelineRunsContext; the floating pill takes over on other
   * routes if the user navigates away later.
   */
  function handleClose() {
    closeDialog();
    if (run?.phase === "running") {
      setGameName("");
      void navigate({ to: "/insights" });
    }
  }

  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (run?.phase !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [run?.phase]);

  if (!run) return null;

  const completedSteps = STEP_ORDER.filter(
    (s) => run.steps[s.step_id]?.status === "done",
  ).length;
  const totalSteps = STEP_ORDER.length;
  const pct = Math.round((completedSteps / totalSteps) * 100);

  const elapsedS = Math.round((now - run.startedAt) / 1000);
  const elapsedLabel =
    elapsedS < 60
      ? `${elapsedS}s`
      : `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`;

  return (
    <Dialog
      open={isDialogOpen}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="truncate">Analyze {run.gameName}</span>
          </DialogTitle>
          <DialogDescription>
            Running the full pipeline (10 steps · ~3–5 min · ~$0.05–1
            in API calls). Closing this dialog keeps the run going in the
            background — a small pill in the bottom-right will track progress.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Step{" "}
              {Math.min(
                completedSteps + (run.phase === "running" ? 1 : 0),
                totalSteps,
              )}{" "}
              / {totalSteps}
            </span>
            <span className="tabular-nums">
              {pct}% · {elapsedLabel}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <ol className="mt-4 space-y-1.5">
          {STEP_ORDER.map((s, i) => (
            <StepRow
              key={s.step_id}
              idx={i + 1}
              label={s.label}
              state={run.steps[s.step_id]}
            />
          ))}
        </ol>

        {run.phase === "done" && run.doneEvent && (
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <p className="font-medium text-emerald-300">
              ✓ Report ready for {run.doneEvent.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Total runtime {Math.round(run.doneEvent.duration_s)}s · estimated
              cost{" "}
              <DollarSign className="-mt-0.5 inline h-3 w-3" />
              {run.doneEvent.cost_usd.toFixed(4)}. The Insights view has loaded
              the result.
            </p>
          </div>
        )}

        {run.phase === "error" && run.errorMsg && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">Pipeline failed</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {run.errorMsg}
            </p>
          </div>
        )}

        <DialogFooter className="mt-2">
          {run.phase === "error" && (
            <Button
              onClick={() => startRun(run.gameName, run.config)}
              variant="default"
            >
              <PlayCircle className="mr-1.5 h-4 w-4" /> Retry
            </Button>
          )}
          {run.phase === "running" && (
            <Button onClick={cancelRun} variant="ghost">
              Cancel run
            </Button>
          )}
          <Button
            variant={run.phase === "done" ? "default" : "outline"}
            onClick={handleClose}
          >
            {run.phase === "running" ? "Run in background" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StepRowProps {
  idx: number;
  label: string;
  state: StepState | undefined;
}

function StepRow({ idx, label, state }: StepRowProps) {
  const status = state?.status ?? "pending";
  const summaryText =
    status === "done" && state?.summary ? formatSummary(state.summary) : "";

  return (
    <li className="flex w-full items-center gap-3 overflow-hidden rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors">
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {status === "pending" && (
          <CircleDashed className="h-4 w-4 text-muted-foreground/60" />
        )}
        {status === "running" && (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        {status === "done" && (
          <Check className="h-4 w-4 text-emerald-400" strokeWidth={3} />
        )}
        {status === "error" && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </span>
      <span className="flex-shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {String(idx).padStart(2, "0")}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span
          className={`flex-shrink-0 ${
            status === "running"
              ? "font-medium text-foreground"
              : status === "done"
                ? "text-foreground"
                : "text-muted-foreground"
          }`}
        >
          {label}
        </span>
        {summaryText && (
          <span
            className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80"
            title={summaryText}
          >
            · {summaryText}
          </span>
        )}
      </div>
      {status === "done" && state?.duration_s != null && (
        <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {state.duration_s.toFixed(1)}s
        </span>
      )}
    </li>
  );
}

function formatSummary(summary: Record<string, unknown>): string {
  const chips: string[] = [];
  if (typeof summary.count === "number") chips.push(`${summary.count}`);
  if (typeof summary.name === "string") chips.push(summary.name);
  if (typeof summary.genre === "string") chips.push(summary.genre);
  if (Array.isArray(summary.labels)) {
    const labs = (summary.labels as string[]).slice(0, 2);
    if (labs.length)
      chips.push(
        labs.join(", ") + (summary.labels.length > 2 ? "…" : ""),
      );
  }
  if (Array.isArray(summary.titles)) {
    const titles = (summary.titles as string[]).slice(0, 1);
    if (titles[0]) chips.push(`"${titles[0].slice(0, 28)}…"`);
  }
  return chips.join(" · ");
}
