import { FileText, Lightbulb, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { GeneratedVariant } from "@/types/hooklens";

interface BriefsGridProps {
  variants: GeneratedVariant[];
}

export function BriefsGrid({ variants }: BriefsGridProps) {
  if (!variants?.length) {
    return (
      <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
        No creative briefs were generated.
      </Card>
    );
  }

  // Always show at most 3 briefs (the top test priorities). 4+ would
  // shrink each card too aggressively and dilute the "tested in order"
  // narrative — the PM only ships 1-3 variants per game anyway.
  const sorted = [...variants]
    .sort((a, b) => a.test_priority - b.test_priority)
    .slice(0, 3);
  const totalAvailable = variants.length;

  // Adaptive grid: 1 → full width, 2 → halves, 3+ → thirds. Keeps a
  // single brief from feeling abandoned in a narrow column and prevents
  // a 5-variant report from cramming too tightly.
  const colsClass =
    sorted.length === 1
      ? "grid-cols-1"
      : sorted.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 lg:grid-cols-3";

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Creative briefs
        </span>
        <span className="text-xs text-muted-foreground">
          (top {sorted.length} variant{sorted.length === 1 ? "" : "s"}
          {totalAvailable > sorted.length
            ? ` of ${totalAvailable} generated`
            : ""}
          )
        </span>
      </header>
      <div className={`grid gap-4 ${colsClass}`}>
        {sorted.map((v) => (
          <BriefCard key={v.brief.archetype_id} variant={v} />
        ))}
      </div>
    </section>
  );
}

function exportBriefPdf(variant: GeneratedVariant) {
  const { brief } = variant;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${brief.title}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;color:#1e293b;line-height:1.6}
  h1{font-size:1.4rem;font-weight:700;margin-bottom:4px}
  .meta{font-size:.75rem;color:#64748b;margin-bottom:24px}
  .section{margin-bottom:20px}
  .label{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:600;margin-bottom:4px}
  .hook{background:#eef2ff;border-left:3px solid #6366f1;padding:10px 14px;border-radius:4px;font-size:.9rem}
  ol{padding-left:1.2em;margin:0}li{margin-bottom:4px;font-size:.85rem}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{border:1px solid #e2e8f0;border-radius:999px;padding:2px 10px;font-size:.75rem;color:#475569}
  .footer{margin-top:40px;font-size:.7rem;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
  @media print{body{margin:20px}}
</style></head><body>
<h1>${brief.title}</h1>
<div class="meta">Priority #${variant.test_priority} · ${brief.archetype_id} · CTA: <strong>${brief.cta}</strong></div>
<div class="section"><div class="label">Hook · 0–3s</div><div class="hook">${brief.hook_3s}</div></div>
${brief.scene_flow.length ? `<div class="section"><div class="label">Scene flow</div><ol>${brief.scene_flow.map(s => `<li>${s}</li>`).join("")}</ol></div>` : ""}
${brief.text_overlays.length ? `<div class="section"><div class="label">Text overlays</div><div class="chips">${brief.text_overlays.map(t => `<span class="chip">${t}</span>`).join("")}</div></div>` : ""}
<div class="section"><div class="label">Visual direction</div><p style="font-size:.85rem;margin:0">${brief.visual_direction}</p></div>
<div class="section"><div class="label">Rationale</div><p style="font-size:.85rem;margin:0">${brief.rationale}</p></div>
<div class="footer">VoodRadar by Voodoo · Generated ${new Date().toLocaleDateString()}</div>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

function BriefCard({ variant }: { variant: GeneratedVariant }) {
  const { brief } = variant;

  return (
    <Card className="flex h-full flex-col gap-4 border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            #{variant.test_priority} test priority
          </div>
          <h3 className="mt-0.5 text-base font-semibold leading-snug">
            {brief.title}
          </h3>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            {brief.archetype_id}
          </div>
        </div>
        <Badge
          className="shrink-0 bg-violet-500 text-white shadow-none hover:bg-violet-500/90"
          aria-label={`Call to action ${brief.cta}`}
        >
          {brief.cta}
        </Badge>
      </div>

      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
          <Lightbulb className="h-3 w-3" /> Hook · 0–3s
        </div>
        <p className="mt-1 text-sm leading-relaxed text-foreground">
          {brief.hook_3s}
        </p>
      </div>

      {brief.scene_flow.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Scene flow
          </div>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-foreground/85">
            {brief.scene_flow.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      )}

      {brief.text_overlays.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Text overlays
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {brief.text_overlays.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="inline-flex items-center rounded-md border border-border bg-background/60 px-2 py-0.5 text-[11px] text-foreground/90"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <details className="rounded-md border border-border bg-background/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          Visual direction & rationale
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-foreground/85">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Visual direction
            </div>
            <p className="mt-1">{brief.visual_direction}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Rationale
            </div>
            <p className="mt-1">{brief.rationale}</p>
          </div>
        </div>
      </details>

      <details className="rounded-md border border-border bg-background/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          Scenario prompts ({brief.scenario_prompts.length})
        </summary>
        <div className="mt-2 space-y-2">
          {brief.scenario_prompts.map((p, i) => (
            <pre
              key={i}
              className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-foreground/80"
            >
              {p}
            </pre>
          ))}
        </div>
      </details>

      <div className="mt-auto pt-1">
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2"
          onClick={() => exportBriefPdf(variant)}
        >
          <Printer className="h-3.5 w-3.5" />
          Export brief (PDF)
        </Button>
      </div>
    </Card>
  );
}
