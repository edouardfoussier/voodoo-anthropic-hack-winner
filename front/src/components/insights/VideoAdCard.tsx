import { Video, Sparkles, AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useVideoBrief, useGenerateVideo } from "@/lib/api";

interface VideoAdCardProps {
  gameName: string;
}

export function VideoAdCard({ gameName }: VideoAdCardProps) {
  const { data: concept, isLoading: conceptLoading, error: conceptError } = useVideoBrief(gameName);
  const [generateTriggered, setGenerateTriggered] = useState(false);

  const {
    data: result,
    isLoading: videoLoading,
    error: videoError,
  } = useGenerateVideo(gameName, generateTriggered);

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <Video className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Brainrot video ad
        </span>
        <Badge className="bg-pink-500/15 text-pink-300 border border-pink-500/30 shadow-none text-[10px]">
          🔥 Trending format 2026
        </Badge>
      </header>

      {conceptLoading && (
        <Card className="border-border bg-card p-6">
          <p className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating concept…
          </p>
        </Card>
      )}

      {conceptError && (
        <Card className="border-destructive/30 bg-destructive/5 p-6">
          <p className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {(conceptError as Error).message}
          </p>
        </Card>
      )}

      {concept && (
        <Card className="border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="border-b border-border bg-muted/20 px-5 py-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold leading-tight">{concept.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{concept.gameplay_hook}</p>
              <p className="mt-1.5 text-xs text-foreground/70 leading-relaxed max-w-xl">{concept.concept}</p>
            </div>
            <div className="flex flex-wrap gap-1 justify-end shrink-0">
              {concept.style_tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 text-[10px] text-pink-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Video area */}
          <div className="p-5">
            {/* Not yet triggered */}
            {!generateTriggered && !result && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 py-10">
                <p className="text-xs text-muted-foreground text-center max-w-xs">
                  The video is generated via Scenario (Veo 3 model) from the concept above.
                  <br />Generation takes ~2–5 minutes.
                </p>
                <Button
                  onClick={() => setGenerateTriggered(true)}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate video with Scenario
                </Button>
              </div>
            )}

            {/* Generating */}
            {generateTriggered && videoLoading && !result && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/10 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground animate-pulse">
                  Scenario (Veo 3) is rendering your brainrot video… this takes 2–5 min
                </p>
              </div>
            )}

            {/* Error */}
            {videoError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-xs text-destructive">{(videoError as Error).message}</p>
              </div>
            )}

            {/* Done */}
            {result && (
              <div className="space-y-3">
                {result.stub && (
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Scenario credentials missing or job timed out — showing placeholder video.
                    Add SCENARIO_PROJECT_ID to .env and retry.
                  </p>
                )}
                <video
                  src={result.video_url}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full max-w-xs mx-auto rounded-xl border border-border"
                  style={{ aspectRatio: "9/16" }}
                />
                {result.job_id && (
                  <p className="text-center text-[10px] text-muted-foreground font-mono">
                    job_id: {result.job_id}
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
