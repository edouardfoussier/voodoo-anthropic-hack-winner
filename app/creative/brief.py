"""Author structured creative briefs for the top archetypes via Claude Opus.

Owner: Partner 2 (creative). v1 baseline by Edouard so the Streamlit pipeline
can ship before the 17:00 checkpoint. The output ``CreativeBrief`` is exactly
what ``app.creative.scenario`` consumes downstream.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from app._cache import disk_cached
from app._paths import CACHE_DIR
from app.models import CreativeArchetype, CreativeBrief, GameDNA, GameFitScore

log = logging.getLogger(__name__)

DEFAULT_CACHE_DIR = CACHE_DIR / "briefs"
OPUS_MODEL = "claude-opus-4-7"

BRIEF_TOOL = {
    "name": "report_creative_brief",
    "description": "Author a structured creative brief tailored to a target game.",
    "input_schema": CreativeBrief.model_json_schema(),
}


# ---------------------------------------------------------------------------
# Auxiliary type — kept local to avoid touching app/models.py post-checkpoint.
# Promote to models.py at the next 3-way checkpoint if it sticks.
# ---------------------------------------------------------------------------


class PublisherBenchmark(BaseModel):
    """Snapshot of what a publisher is currently advertising on its own app.

    Fed into ``author_brief`` so Opus can produce a brief that *differentiates*
    from the publisher's existing rotation rather than rewriting one of their
    own ads. This is the "Voodoo runs hooks X+Y, the market is heating up on
    hook Z, here's a creative that brings Z onto Mob Control" angle.
    """

    publisher_name: str
    app_name: str
    creatives: list[dict[str, Any]] = Field(default_factory=list)
    """Raw rows from ``fetch_voodoo_app_creatives`` (or shape-equivalent)."""

    def to_prompt_block(self, max_rows: int = 5) -> str:
        """Render the top-N existing creatives as a compact prompt block."""
        if not self.creatives:
            return ""
        rows: list[str] = []
        for c in self.creatives[:max_rows]:
            network = c.get("network") or "?"
            first_seen = (c.get("first_seen_at") or "")[:10]
            message = (c.get("message") or "").strip().replace("\n", " ")
            if len(message) > 160:
                message = message[:160] + "…"
            cta = (c.get("button_text") or "").strip()
            ad_type = c.get("ad_type") or "video"
            rows.append(
                f"- [{network} · {ad_type} · since {first_seen}] "
                f'{message or "(no copy)"}'
                + (f' · CTA "{cta}"' if cta else "")
            )
        return (
            f"\nEXISTING CREATIVES — what {self.publisher_name} is currently "
            f"running on {self.app_name} (top {min(max_rows, len(self.creatives))} "
            f"of {len(self.creatives)}):\n" + "\n".join(rows) + "\n"
        )


def _client() -> anthropic.Anthropic:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing. Add it to .env.")
    return anthropic.Anthropic(api_key=key)


def _build_prompt(
    arch: CreativeArchetype,
    sc: GameFitScore,
    dna: GameDNA,
    benchmark: PublisherBenchmark | None = None,
) -> str:
    benchmark_block = benchmark.to_prompt_block() if benchmark else ""
    differentiation_directive = (
        f"""
DIFFERENTIATION DIRECTIVE:
The publisher is ALREADY running the creatives listed above. Your job is
NOT to rewrite one of them. The brief you author must bring a hook that's
trending in the market scan but UNDERREPRESENTED in {benchmark.publisher_name}'s
current rotation on {benchmark.app_name}. In ``rationale``, explicitly call
out the delta — e.g. "{benchmark.publisher_name} runs satisfaction-pour
hooks; this brings the freshness/UGC angle they don't yet have."
"""
        if benchmark and benchmark.creatives
        else ""
    )
    return f"""You're a creative director shipping a playable-ad concept for a mobile game.

TARGET GAME:
{dna.model_dump_json(indent=2)}

WINNING ARCHETYPE (from market scan):
- Label: {arch.label}
- Centroid hook: {arch.centroid_hook.model_dump_json()}
- Why it wins: {arch.rationale}

GAME-FIT REASONING:
- Visual: {sc.visual_match}/100, Mechanic: {sc.mechanic_match}/100, Audience: {sc.audience_match}/100
- Notes: {sc.rationale}
{benchmark_block}{differentiation_directive}
Author a CreativeBrief that adapts the archetype to {dna.name}. Specifically:
- ``hook_3s`` must be tight, sensory, on-brand for the game's palette and mood
- ``scene_flow`` 3-5 beats describing the 15-second arc
- ``visual_direction`` ties palette + style to the Game DNA
- ``text_overlays`` 3-6 short overlays in chronological order
- ``cta`` is a punchy 1-3 word CTA
- ``rationale`` 2-3 sentences, action-oriented for the UA team
- ``scenario_prompts`` are 2-3 ready-to-paste Scenario txt2img prompts for: hero frame (the strongest single still), and 1-2 storyboard frames. Each prompt MUST mention: aspect 9:16, the game palette ({dna.palette.primary_hex}, {dna.palette.secondary_hex}, {dna.palette.accent_hex}), the visual style "{dna.visual_style}", and one signature on-screen text. CRITICAL FIDELITY DIRECTIVE: the generated frame must read as an authentic in-game moment from {dna.name} — same UI chrome, same {", ".join(dna.key_mechanics) if dna.key_mechanics else "core mechanic"}, same character/asset style as the IP-Adapter reference screenshots. Avoid generic stock-game tropes; describe the {dna.name}-specific gameplay objects and HUD explicitly. If the game has no character on screen ({dna.character_present}), do not invent one in the prompt.

AUDIO DIRECTIVE (each scenario_prompt is later turned into a 5-second video clip via image-to-video models with audio support — Veo 3, Kling, Sora):
- End each scenario_prompt with a single bracketed audio cue line in the form:
  [Audio: <voiceover line if any> / <music style: 'punchy upbeat trap', 'whimsical UGC sting', 'silent', etc.> / <key SFX moments: 'whoosh on swipe', 'chime on combo', 'fail-buzzer at 1.2s'>].
- Voiceover should match the archetype's emotional pitch ({arch.centroid_hook.emotional_pitch}); when the archetype is `asmr` keep voice null and emphasise SFX.
- Music style must align with the game's UI mood ("{dna.ui_mood}") — avoid generic library music; describe BPM/intent.
- Keep the audio cue concise (under 25 words) so it fits in the prompt without overwhelming the visual instructions.

Then call the tool.
"""


def author_brief(
    arch: CreativeArchetype,
    sc: GameFitScore,
    dna: GameDNA,
    *,
    benchmark: PublisherBenchmark | None = None,
) -> CreativeBrief:
    """Generate one ``CreativeBrief`` (cached on disk by archetype × game pair).

    When ``benchmark`` is provided, the prompt instructs Opus to produce a
    creative that *differentiates* from the publisher's existing rotation.
    The cache key includes a benchmark-content hash so adding/removing a
    benchmark forces a re-roll instead of returning a stale brief.
    """
    prompt = _build_prompt(arch, sc, dna, benchmark=benchmark)

    def _call() -> CreativeBrief:
        resp = _client().messages.create(
            model=OPUS_MODEL,
            max_tokens=2500,
            tools=[BRIEF_TOOL],
            tool_choice={"type": "tool", "name": "report_creative_brief"},
            messages=[{"role": "user", "content": prompt}],
        )
        tool_block = next(b for b in resp.content if getattr(b, "type", "") == "tool_use")
        return CreativeBrief.model_validate(
            {
                **tool_block.input,
                "archetype_id": arch.archetype_id,
                "target_game_id": dna.app_id,
            }
        )

    # The benchmark hash makes the cache key sensitive to whether/which
    # existing-creatives context was injected, without storing the full body.
    bench_tag = (
        f"_bench{len(benchmark.creatives)}" if benchmark and benchmark.creatives else ""
    )
    return disk_cached(
        DEFAULT_CACHE_DIR,
        f"brief_{arch.archetype_id}_{dna.app_id}{bench_tag}",
        {"prompt": prompt},
        _call,
        parser=CreativeBrief.model_validate_json,
    )


def author_briefs(
    chosen: list[tuple[CreativeArchetype, GameFitScore]],
    dna: GameDNA,
    *,
    benchmark: PublisherBenchmark | None = None,
) -> list[CreativeBrief]:
    """Author one brief per (archetype, fit_score) pair, optionally informed
    by a publisher benchmark of currently-running creatives.
    """
    return [author_brief(arch, sc, dna, benchmark=benchmark) for (arch, sc) in chosen]
