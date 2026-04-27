import { Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { HookLensReport } from "@/types/hooklens";

interface PitchStoryBlockProps {
  report: HookLensReport;
}

/**
 * Auto-generated English summary that frames every report — same
 * narrative arc as the demo voiceover (market scan → breakout hook →
 * game-fit score → tailored variant). Splits each paragraph on
 * ``**...**`` so we can render markdown bold inline without pulling
 * in a parser.
 *
 * (Was previously titled "Demo pitch · auto-generated" in French. The
 * jury reads English, the PM team reads English, the data is in
 * English — keeping the prose monolingual avoids a code-switch
 * mid-report.)
 */
export function PitchStoryBlock({ report }: PitchStoryBlockProps) {
  const ctx = report.market_context;
  const top = [...report.top_archetypes].sort(
    (a, b) => b.overall_signal_score - a.overall_signal_score,
  )[0];
  const bestFit = [...report.game_fit_scores].sort(
    (a, b) => b.overall - a.overall,
  )[0];
  const chosenVariant = [...report.final_variants].sort(
    (a, b) => a.test_priority - b.test_priority,
  )[0];

  if (!top || !bestFit || !chosenVariant) {
    return null;
  }

  const palette = report.target_game.palette;
  const network = ctx.networks[0] ?? "TikTok";
  const country = ctx.countries[0] ?? "US";

  const paragraphs: string[] = [
    `On **${report.target_game.name}**, we scanned **${ctx.num_advertisers_scanned} advertisers** in ${ctx.category_name} on ${network} (${country}) and deconstructed **${ctx.num_creatives_analyzed} creatives** with Gemini 2.5 Pro.`,
    `The current breakout is **"${top.label}"**: ${top.member_creative_ids.length} ad${top.member_creative_ids.length === 1 ? "" : "s"}, ${Math.round(top.derivative_spread * 100)}% unique advertisers, average age **${Math.round(top.freshness_days)} days** — this is the hook that's being copied right now, not an established hit.`,
    `We scored that hook against **${report.target_game.name}**'s Game DNA with Claude Opus 4.7 → **${bestFit.overall}/100** (visual=${bestFit.visual_match}, mechanic=${bestFit.mechanic_match}, audience=${bestFit.audience_match}). Here's the tailored variant Scenario produced: **"${chosenVariant.brief.title}"** — palette \`${palette.primary_hex}\`/\`${palette.secondary_hex}\`, CTA **"${chosenVariant.brief.cta}"**.`,
    `Test priority #${chosenVariant.test_priority}, ready to ship to Meta Ads / TikTok on Monday morning.`,
  ];

  return (
    <Card className="overflow-hidden border-border border-l-4 border-l-primary bg-card p-6">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-primary" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Summary
        </span>
      </div>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">
        {paragraphs.map((p, i) => (
          <p key={i}>
            <RenderRichText text={p} />
          </p>
        ))}
      </div>
    </Card>
  );
}

/**
 * Tiny inline parser: alternates plain text with `**bold**` segments and
 * inline `\`code\`` segments. No nested markdown, no escaping — that's
 * fine for our deterministic template.
 */
function RenderRichText({ text }: { text: string }) {
  const tokens = tokenize(text);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "bold") {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {tok.value}
            </strong>
          );
        }
        if (tok.kind === "code") {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground"
            >
              {tok.value}
            </code>
          );
        }
        return <span key={i}>{tok.value}</span>;
      })}
    </>
  );
}

type Token =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "code"; value: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: "bold", value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: "code", value: match[2] });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}
