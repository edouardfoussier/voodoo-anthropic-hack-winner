"""Score each archetype against the target Game DNA via Claude Opus tool use.

We use Anthropic's native tool_use feature with ``tool_choice`` forcing the
model to call our typed tool — this gives us strict Pydantic-validated output
without parsing JSON fences.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import anthropic

from app._cache import disk_cached
from app._paths import CACHE_DIR
from app.models import CreativeArchetype, GameDNA, GameFitScore

log = logging.getLogger(__name__)

DEFAULT_CACHE_DIR = CACHE_DIR / "game_fit"
OPUS_MODEL = "claude-opus-4-7"  # adjust if your SDK rejects the alias

GAMEFIT_TOOL = {
    "name": "report_game_fit",
    "description": "Score how well a creative archetype fits the target game.",
    "input_schema": GameFitScore.model_json_schema(),
}


def _client() -> anthropic.Anthropic:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing. Add it to .env.")
    return anthropic.Anthropic(api_key=key)


def _build_prompt(arch: CreativeArchetype, dna: GameDNA) -> str:
    return f"""You're a senior mobile-game UA strategist scoring whether a market creative archetype fits a specific target game.

TARGET GAME DNA:
{dna.model_dump_json(indent=2)}

CREATIVE ARCHETYPE:
- Label: {arch.label}
- Centroid hook (first 3 seconds): {arch.centroid_hook.model_dump_json()}
- Member palette: {arch.palette_hex}
- Signals: velocity={arch.velocity_score}, derivative_spread={arch.derivative_spread}, freshness={arch.freshness_days:.0f}d
- Cluster rationale: {arch.rationale}

Score 0-100 on three axes (be honest, never default to 70):
- visual_match: palette + character + style compatibility with the game DNA
- mechanic_match: does this hook concept work for the game's core loop?
- audience_match: does the implied audience overlap with the game's audience?
- overall: weighted summary, not a flat average

Provide a 2-3 sentence rationale that the publishing team would actually act on. Call out frictions explicitly. Then call the tool.
"""


def score_archetype(arch: CreativeArchetype, dna: GameDNA) -> GameFitScore:
    """Single archetype × game DNA scoring with disk cache."""
    prompt = _build_prompt(arch, dna)

    def _call() -> GameFitScore:
        resp = _client().messages.create(
            model=OPUS_MODEL,
            max_tokens=1500,
            tools=[GAMEFIT_TOOL],
            tool_choice={"type": "tool", "name": "report_game_fit"},
            messages=[{"role": "user", "content": prompt}],
        )
        tool_block = next(b for b in resp.content if getattr(b, "type", "") == "tool_use")
        return GameFitScore.model_validate(
            {**tool_block.input, "archetype_id": arch.archetype_id}
        )

    return disk_cached(
        DEFAULT_CACHE_DIR,
        f"fit_{arch.archetype_id}_{dna.app_id}",
        {"prompt": prompt},
        _call,
        parser=GameFitScore.model_validate_json,
    )


def score_all(
    archetypes: list[CreativeArchetype], dna: GameDNA
) -> list[GameFitScore]:
    """Score every archetype against the target Game DNA, sequentially.

    Sequential is fine: ~5 calls × ~10s each = under a minute, and Opus rate
    limits are tight enough that parallelism isn't worth the risk.
    """
    return [score_archetype(a, dna) for a in archetypes]
