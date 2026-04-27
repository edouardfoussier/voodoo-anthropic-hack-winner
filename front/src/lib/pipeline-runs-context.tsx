/**
 * PipelineRunsContext — global owner of the active HookLens pipeline run.
 *
 * Why this lives outside any single component:
 * the pipeline takes 3-5 minutes; the user often wants to navigate to
 * Ad Library / Voodoo Portfolio / Geo Map mid-run. The previous
 * implementation embedded the EventSource inside RunAnalysisDialog, so
 * closing the modal killed the live progress stream and lost any
 * mid-flight state.
 *
 * This context owns a SINGLE in-flight run. Multiple consumers read it:
 *   - RunAnalysisDialog — the rich progress view (10 step rows)
 *   - FloatingRunPill   — small persistent pill bottom-right
 *   - Insights view     — auto-loads the freshly cached report on done
 *
 * Backend SSE contract (unchanged): /api/report/run/stream emits
 *   { type: "started" | "step" | "done" | "error" | "heartbeat" }
 *
 * Lifecycle:
 *   idle → startRun() → running → (done | error) → dismissCompleted() → idle
 *
 * Backend keeps writing the cached report regardless of frontend state,
 * so a closed pill / closed dialog never loses work.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

/**
 * The 10 steps in display order — kept in sync with `app/pipeline.py STEPS`.
 * step_id is the canonical key the backend emits.
 */
export const STEP_ORDER: { step_id: string; label: string }[] = [
  { step_id: "target_meta", label: "Resolve target game" },
  { step_id: "game_dna", label: "Extract Game DNA" },
  { step_id: "top_advertisers", label: "Discover top advertisers" },
  { step_id: "raw_creatives", label: "Pull top creatives" },
  { step_id: "deconstructed", label: "Deconstruct videos (Gemini)" },
  { step_id: "archetypes", label: "Cluster archetypes + signals" },
  { step_id: "fit_scores", label: "Score game-fit (Opus)" },
  { step_id: "briefs", label: "Author creative briefs (Opus)" },
  { step_id: "variants", label: "Generate visuals (Scenario)" },
  { step_id: "report", label: "Compose final report" },
];

export type StepStatus = "pending" | "running" | "done" | "error";

export interface StepState {
  status: StepStatus;
  duration_s?: number;
  summary?: Record<string, unknown>;
}

export interface DoneEvent {
  type: "done";
  app_id: string;
  name: string;
  duration_s: number;
  cost_usd: number;
}

export interface PipelineRunConfig {
  countries: string[]; // ["all"] or ["US", "JP", ...]
  networks: string[]; // ["all"] or ["TikTok", "Facebook", ...]
  maxCreatives?: number;
  topKArchetypes?: number;
  topKVariants?: number;
}

export type RunPhase = "idle" | "running" | "done" | "error";

export interface ActiveRun {
  id: string; // UUID — used as React key for toast notifications
  gameName: string;
  config?: PipelineRunConfig;
  steps: Record<string, StepState>;
  phase: RunPhase;
  doneEvent: DoneEvent | null;
  errorMsg: string | null;
  startedAt: number;
  finishedAt: number | null;
  /**
   * Per-step ``data`` payloads received from the SSE stream — keyed by
   * ``step_id`` (e.g. ``game_dna``, ``archetypes``, ``briefs``,
   * ``variants``). Lets the live partial report view render real
   * sections progressively as the pipeline emits them, mirroring the
   * old Streamlit "sections appear as they finish" experience.
   */
  stepData: Record<string, unknown>;
}

interface PipelineRunsContextValue {
  /** Current/last run. Cleared by ``dismissCompleted`` once user
   * acknowledges a finished run. */
  run: ActiveRun | null;

  /** True when run.phase === "running" — convenience for consumers
   * that don't care about done/error states. */
  isRunning: boolean;

  /** Start a new run. Cancels any in-flight run first. */
  startRun: (gameName: string, config?: PipelineRunConfig) => void;
  /** Hard-stop the current run (closes EventSource, marks phase as
   * "error" with a "Cancelled" message). The backend keeps running
   * and caches its result regardless. */
  cancelRun: () => void;
  /** Hide the post-completion pill / toast. Idempotent. */
  dismissCompleted: () => void;

  /** Dialog open state lives in the context too so the floating pill
   * can re-open the dialog when clicked. */
  isDialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

const Ctx = createContext<PipelineRunsContextValue | null>(null);

function emptySteps(): Record<string, StepState> {
  return Object.fromEntries(
    STEP_ORDER.map((s) => [s.step_id, { status: "pending" } as StepState]),
  );
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function PipelineRunsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  const [run, setRun] = useState<ActiveRun | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const startRun = useCallback(
    (gameName: string, config?: PipelineRunConfig) => {
      closeStream();
      const id = uuid();
      const seedSteps = emptySteps();
      seedSteps[STEP_ORDER[0].step_id] = { status: "running" };

      setRun({
        id,
        gameName,
        config,
        steps: seedSteps,
        phase: "running",
        doneEvent: null,
        errorMsg: null,
        startedAt: Date.now(),
        finishedAt: null,
        stepData: {},
      });

      const url = new URL("/api/report/run/stream", API_BASE);
      url.searchParams.set("game_name", gameName);
      if (config) {
        if (config.countries?.length) {
          url.searchParams.set("countries", config.countries.join(","));
        }
        if (config.networks?.length) {
          url.searchParams.set("networks", config.networks.join(","));
        }
        if (config.maxCreatives) {
          url.searchParams.set("max_creatives", String(config.maxCreatives));
        }
        if (config.topKArchetypes) {
          url.searchParams.set(
            "top_k_archetypes",
            String(config.topKArchetypes),
          );
        }
        if (config.topKVariants) {
          url.searchParams.set("top_k_variants", String(config.topKVariants));
        }
      }

      const es = new EventSource(url.toString());
      esRef.current = es;

      es.onmessage = (e) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }

        if (event.type === "heartbeat" || event.type === "started") return;

        if (event.type === "step") {
          const step_id = event.step_id as string;
          const idx = event.idx as number;
          const duration_s = event.duration_s as number | undefined;
          const summary = event.summary as
            | Record<string, unknown>
            | undefined;
          // Backend ships the rich per-step payload under ``data`` (see
          // api/main.py:_full_step_payload). null when there's nothing
          // useful to render for the step.
          const data = event.data as unknown;
          setRun((prev) => {
            if (!prev || prev.id !== id) return prev;
            const steps = { ...prev.steps };
            steps[step_id] = { status: "done", duration_s, summary };
            const nextStep = STEP_ORDER[idx]; // idx is 1-based → next step
            if (nextStep && steps[nextStep.step_id]?.status === "pending") {
              steps[nextStep.step_id] = { status: "running" };
            }
            const stepData = { ...prev.stepData };
            if (data !== undefined && data !== null) {
              stepData[step_id] = data;
            }
            return { ...prev, steps, stepData };
          });
          return;
        }

        if (event.type === "done") {
          const doneEvent = event as unknown as DoneEvent;
          setRun((prev) =>
            prev && prev.id === id
              ? {
                  ...prev,
                  phase: "done",
                  doneEvent,
                  finishedAt: Date.now(),
                }
              : prev,
          );
          closeStream();
          queryClient.invalidateQueries({ queryKey: ["report"] });
          queryClient.invalidateQueries({ queryKey: ["reports"] });
          return;
        }

        if (event.type === "error") {
          const message =
            (event as { message?: string }).message ?? "Unknown error";
          setRun((prev) =>
            prev && prev.id === id
              ? {
                  ...prev,
                  phase: "error",
                  errorMsg: message,
                  finishedAt: Date.now(),
                }
              : prev,
          );
          closeStream();
        }
      };

      es.onerror = () => {
        // Browser closes EventSource silently on network drop. Distinguish
        // "stream completed normally" (we already moved to done/error) vs
        // an unexpected drop.
        setRun((prev) => {
          if (!prev || prev.id !== id) return prev;
          if (prev.phase !== "running") return prev;
          return {
            ...prev,
            phase: "error",
            errorMsg: "Connection to backend lost. Check the API server logs.",
            finishedAt: Date.now(),
          };
        });
        closeStream();
      };
    },
    [closeStream, queryClient],
  );

  const cancelRun = useCallback(() => {
    closeStream();
    setRun((prev) =>
      prev && prev.phase === "running"
        ? {
            ...prev,
            phase: "error",
            errorMsg: "Cancelled by user. Backend run kept executing in background.",
            finishedAt: Date.now(),
          }
        : prev,
    );
  }, [closeStream]);

  const dismissCompleted = useCallback(() => {
    setRun((prev) => (prev && prev.phase !== "running" ? null : prev));
  }, []);

  const openDialog = useCallback(() => setIsDialogOpen(true), []);
  const closeDialog = useCallback(() => setIsDialogOpen(false), []);

  // Cleanup EventSource on unmount.
  useEffect(() => closeStream, [closeStream]);

  const value = useMemo<PipelineRunsContextValue>(
    () => ({
      run,
      isRunning: run?.phase === "running",
      startRun,
      cancelRun,
      dismissCompleted,
      isDialogOpen,
      openDialog,
      closeDialog,
    }),
    [
      run,
      startRun,
      cancelRun,
      dismissCompleted,
      isDialogOpen,
      openDialog,
      closeDialog,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePipelineRuns(): PipelineRunsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "usePipelineRuns must be used inside <PipelineRunsProvider>",
    );
  }
  return ctx;
}

/**
 * Assemble a partial ``HookLensReport``-shaped object from the per-step
 * payloads accumulated during a run. Every field is optional — the
 * caller (LiveAnalysisView) renders each section only when its data is
 * present, so the page progressively populates as the pipeline streams.
 *
 * Mapping (pipeline step_id → report field):
 *   game_dna       → target_game
 *   archetypes     → top_archetypes
 *   fit_scores     → game_fit_scores
 *   variants       → final_variants
 *   report         → all of the above + market_context + meta
 *
 * The ``report`` step lands last and overrides everything with the
 * canonical, fully-populated HookLensReport.
 */
export function buildPartialReport(
  stepData: Record<string, unknown>,
): Record<string, unknown> {
  // The final 'report' step ships the full payload — short-circuit.
  const finalReport = stepData["report"];
  if (finalReport && typeof finalReport === "object") {
    return finalReport as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  if (stepData["game_dna"]) out.target_game = stepData["game_dna"];
  if (stepData["archetypes"]) out.top_archetypes = stepData["archetypes"];
  if (stepData["fit_scores"]) out.game_fit_scores = stepData["fit_scores"];
  if (stepData["variants"]) out.final_variants = stepData["variants"];
  return out;
}

/**
 * Compute completed step count + percent for any external consumer.
 */
export function summarizeSteps(steps: Record<string, StepState>): {
  completed: number;
  total: number;
  pct: number;
  currentLabel: string | null;
} {
  const completed = STEP_ORDER.filter(
    (s) => steps[s.step_id]?.status === "done",
  ).length;
  const total = STEP_ORDER.length;
  const current = STEP_ORDER.find(
    (s) => steps[s.step_id]?.status === "running",
  );
  return {
    completed,
    total,
    pct: Math.round((completed / total) * 100),
    currentLabel: current?.label ?? null,
  };
}
