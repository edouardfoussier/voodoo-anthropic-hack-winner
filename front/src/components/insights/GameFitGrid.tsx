import { useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CreativeArchetype, GameFitScore } from "@/types/hooklens";

interface GameFitGridProps {
  scores: GameFitScore[];
  archetypes: CreativeArchetype[];
}

interface FitRow {
  score: GameFitScore;
  archetype: CreativeArchetype | null;
  rank: number;
}

export function GameFitGrid({ scores, archetypes }: GameFitGridProps) {
  const [showAll, setShowAll] = useState(false);

  if (!scores?.length) {
    return (
      <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
        No game-fit scores available.
      </Card>
    );
  }

  // ⚠️ Sort order is INTENTIONALLY DIFFERENT from the archetypes table.
  // Archetypes are ranked by overall_signal_score (market momentum). Here
  // we re-rank the SAME archetypes by per-game compatibility — the top
  // archetype overall might score poorly against this specific game's
  // DNA and slide down in this view. That's the whole point of the
  // step: market signal + game fit together pick the winning brief.
  const archMap = new Map(archetypes.map((a) => [a.archetype_id, a]));
  const sorted: FitRow[] = [...scores]
    .sort((a, b) => b.overall - a.overall)
    .map((score, i) => ({
      score,
      archetype: archMap.get(score.archetype_id) ?? null,
      rank: i + 1,
    }));

  const TOP_N = 3;
  const visible = showAll ? sorted : sorted.slice(0, TOP_N);
  const hiddenCount = Math.max(0, sorted.length - TOP_N);

  return (
    <section>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Target className="h-3.5 w-3.5" /> Game-fit scoring
          </div>
          <h3 className="mt-0.5 text-base font-semibold">
            Archetype × Game DNA compatibility
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Same clusters as above, <b>re-ranked</b> by how well each one
            adapts to this specific game (Opus 4.7 scores 0–100 on visual,
            mechanic and audience compatibility). A top market signal can
            slide down here if it doesn't match the Game DNA — that's the
            point.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ score, archetype, rank }) => (
          <FitCard
            key={score.archetype_id}
            score={score}
            archetype={archetype}
            rank={rank}
            highlighted={rank <= 3}
          />
        ))}
      </div>

      {hiddenCount > 0 && (
        <div className="mt-3 flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAll((v) => !v)}
            className="gap-1.5"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${
                showAll ? "rotate-180" : ""
              }`}
            />
            {showAll
              ? `Hide ${hiddenCount} lower-ranked`
              : `See ${hiddenCount} more`}
          </Button>
        </div>
      )}
    </section>
  );
}

function FitCard({
  score,
  archetype,
  rank,
  highlighted,
}: {
  score: GameFitScore;
  archetype: CreativeArchetype | null;
  rank: number;
  highlighted: boolean;
}) {
  const axes: { key: "visual" | "mechanic" | "audience" | "overall"; label: string; value: number }[] = [
    { key: "visual", label: "Visual", value: score.visual_match },
    { key: "mechanic", label: "Mechanic", value: score.mechanic_match },
    { key: "audience", label: "Audience", value: score.audience_match },
    { key: "overall", label: "Overall", value: score.overall },
  ];
  const max = Math.max(score.visual_match, score.mechanic_match, score.audience_match);

  return (
    <Card
      className={`relative flex h-full flex-col gap-3 border-border bg-card p-4 ${
        highlighted ? "ring-1 ring-primary/40" : ""
      }`}
    >
      {highlighted && (
        <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Top {rank}
        </span>
      )}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Archetype
        </div>
        <h4 className="mt-0.5 line-clamp-2 pr-12 text-sm font-semibold leading-tight">
          {archetype?.label ?? score.archetype_id}
        </h4>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          {score.archetype_id}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {axes.map((a) => {
          const isOverall = a.key === "overall";
          const isMaxAxis = !isOverall && a.value === max && a.value > 0;
          return (
            <div
              key={a.key}
              className={`rounded-md border p-2 text-center ${
                isOverall
                  ? "border-primary/40 bg-primary/10"
                  : isMaxAxis
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-border bg-background/40"
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-wider ${
                  isOverall ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {a.label}
              </div>
              <div
                className={`mt-0.5 text-lg font-semibold tabular-nums ${
                  isOverall
                    ? "text-primary"
                    : isMaxAxis
                      ? "text-emerald-300"
                      : "text-foreground"
                }`}
              >
                {a.value}
              </div>
            </div>
          );
        })}
      </div>

      {score.rationale && <RationaleBlock rationale={score.rationale} />}
    </Card>
  );
}

/** Click-to-expand rationale. Shows a 4-line clamp by default with a
 *  chevron toggle so the full Opus reasoning is always one click away
 *  but doesn't dominate the card. */
function RationaleBlock({ rationale }: { rationale: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="text-xs leading-relaxed text-muted-foreground">
      <p className={expanded ? "" : "line-clamp-4"}>{rationale}</p>
      {rationale.length > 240 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary/80 hover:text-primary"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
          {expanded ? "Show less" : "Show full rationale"}
        </button>
      )}
    </div>
  );
}
