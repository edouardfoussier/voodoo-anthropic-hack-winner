"""Gemini 2.5 Pro video deconstruction.

Downloads each creative's video, uploads it to the Gemini Files API, asks
Gemini Pro to fill a structured analysis schema, then wraps the output with
the original ``RawCreative`` to produce a ``DeconstructedCreative`` matching
the data contract in ``app.models``.

Designed to be called from an asyncio pool with concurrency capped by a
semaphore so we respect Gemini rate limits and don't blow up the API budget.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Literal

import httpx
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential

from app._paths import CACHE_DIR
from app.models import DeconstructedCreative, HookFrame, RawCreative

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MODEL = os.environ.get("GEMINI_VIDEO_MODEL", "gemini-3-flash-preview")
"""Gemini model used for ad-video deconstruction.

Default: ``gemini-3-flash-preview`` — released Q1 2026, Pro-level intelligence
at Flash speed/cost ($0.50/M input vs $2/M for Pro). Plenty for hook + scene
extraction tasks. Override via env var ``GEMINI_VIDEO_MODEL`` to e.g.
``gemini-3.1-pro-preview`` for max quality (4× the cost).
"""

DEFAULT_VIDEO_CACHE_DIR = CACHE_DIR / "videos"
DEFAULT_DECONSTRUCT_CACHE_DIR = CACHE_DIR / "deconstruct"

# Gemini 3 Flash pricing (April 2026): $0.50/M input, $3/M output.
# Override defaults via env if you switch model.
COST_INPUT_PER_1M_TOKENS = float(os.environ.get("GEMINI_INPUT_USD_PER_1M", "0.50"))
COST_OUTPUT_PER_1M_TOKENS = float(os.environ.get("GEMINI_OUTPUT_USD_PER_1M", "3.00"))
VIDEO_TOKENS_PER_SECOND = 70  # Gemini 3 with media_resolution_low/medium


# ---------------------------------------------------------------------------
# Internal Gemini schema
# ---------------------------------------------------------------------------


VisualStyle = Literal["live-action-UGC", "in-game", "3D-render", "mixed", "animation"]


class _GeminiAnalysis(BaseModel):
    """Subset of ``DeconstructedCreative`` that Gemini fills.

    We don't ask Gemini to reconstruct the ``RawCreative`` envelope (it has
    SensorTower IDs Gemini doesn't know). We just ask for the analysis fields,
    then merge with the input ``RawCreative`` on the Python side.
    """

    hook: HookFrame
    scene_flow: list[str] = Field(min_length=2, max_length=6)
    on_screen_text: list[str]
    cta_text: str | None = None
    cta_timing_seconds: float | None = None
    palette_hex: list[str] = Field(
        min_length=3,
        max_length=3,
        description="Exactly 3 dominant hex colors with leading '#'.",
    )
    visual_style: VisualStyle
    audience_proxy: str = Field(
        description="One-sentence implied audience, e.g. 'casual women 25-45'."
    )


DECONSTRUCT_PROMPT = """You are a senior mobile-game UA strategist.

Deconstruct this short ad creative into a strictly structured analysis.

Focus rigorously on:
- HOOK (first 3 seconds): the visual + verbal pattern that decides whether
  the user keeps watching. Identify the emotional pitch from this set:
  satisfaction, fail, curiosity, rage_bait, tutorial, asmr, celebrity,
  challenge, transformation, other.
  Inside the HOOK object also fill `voiceover_transcript` with the exact
  spoken words in the first 3 seconds (or null if there is no voice). The
  brief writer relies on this to mirror the audio cadence.
- SCENE FLOW: 3-5 bullets describing the narrative arc from start to end.
- ON-SCREEN TEXT: every readable text overlay, in chronological order.
- CTA: the call-to-action text and approximately when it first appears (in
  seconds from the start of the ad).
- PALETTE: exactly 3 dominant hex colors (#RRGGBB) covering the majority of
  the frame area on average across the ad.
- VISUAL STYLE: pick the closest single label from
  {live-action-UGC, in-game, 3D-render, mixed, animation}.
- AUDIENCE PROXY: a one-sentence guess of the implied audience (e.g.
  'casual women 25-45 who enjoy satisfying puzzles').

Audio is part of the hook on TikTok / Reels — pay attention to:
voiceover (UGC, AI-narrator, none?), music (trending track, original score,
silence?), sfx beats (whoosh, pop, chime, fail-buzzer?). Capture this in
`voiceover_transcript` for the verbal layer; the brief writer infers the
rest from `scene_flow` text.

Be specific, be concrete, never hedge. Return ONLY the JSON matching the
provided schema, with no commentary or markdown fence.
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def estimate_cost_usd(video_seconds: float, output_tokens: int = 500) -> float:
    """Rough USD cost estimate for a single deconstruction call."""
    input_tokens = video_seconds * VIDEO_TOKENS_PER_SECOND + 200  # +prompt overhead
    return (
        input_tokens * COST_INPUT_PER_1M_TOKENS / 1_000_000
        + output_tokens * COST_OUTPUT_PER_1M_TOKENS / 1_000_000
    )


def get_client() -> genai.Client:
    """Build a Gemini client from the GEMINI_API_KEY env var."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY missing. Copy .env.example to .env and fill it in."
        )
    return genai.Client(api_key=api_key)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
async def ensure_local_video(
    creative: RawCreative,
    cache_dir: Path = DEFAULT_VIDEO_CACHE_DIR,
) -> Path:
    """Download the creative's video to disk if not already cached."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{creative.creative_id}.mp4"
    if target.exists() and target.stat().st_size > 0:
        return target

    log.info(
        "CACHE MISS: downloading %s from %s",
        creative.creative_id,
        creative.creative_url,
    )
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as http:
        async with http.stream("GET", str(creative.creative_url)) as response:
            response.raise_for_status()
            with open(target, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                    f.write(chunk)
    return target


async def _wait_for_file_active(
    client: genai.Client,
    file: types.File,
    max_wait_s: float = 60.0,
) -> types.File:
    """Block until an uploaded file is ACTIVE (Gemini done processing)."""
    waited = 0.0
    while file.state.name == "PROCESSING":
        if waited > max_wait_s:
            raise TimeoutError(f"Gemini file {file.name} stuck in PROCESSING")
        await asyncio.sleep(2)
        waited += 2
        file = await asyncio.to_thread(client.files.get, name=file.name)
    if file.state.name == "FAILED":
        raise RuntimeError(f"Gemini file {file.name} processing FAILED")
    return file


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def deconstruct_one(
    creative: RawCreative,
    client: genai.Client | None = None,
) -> tuple[DeconstructedCreative, float]:
    """Deconstruct one creative end-to-end.

    Returns ``(DeconstructedCreative, elapsed_seconds)``.

    Disk-cached at ``data/cache/deconstruct/{creative_id}.json`` — once
    a creative has been Gemini-analysed, every subsequent pipeline run
    (across games, weeks, sessions) skips the Gemini call and rehydrates
    from disk in <10ms. This is the "knowledge base" that lets the
    weekly-report flow + cross-game analyses scale without re-billing.
    """
    DEFAULT_DECONSTRUCT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = DEFAULT_DECONSTRUCT_CACHE_DIR / f"{creative.creative_id}.json"

    # 0. Cache hit — rehydrate the DeconstructedCreative from disk.
    if cache_path.exists() and cache_path.stat().st_size > 0:
        try:
            cached = json.loads(cache_path.read_text())
            return DeconstructedCreative.model_validate(cached), 0.0
        except Exception:
            log.warning(
                "deconstruct: corrupted cache for %s — re-running Gemini",
                creative.creative_id,
            )

    client = client or get_client()
    t0 = time.perf_counter()

    # 1. Download video locally (cached)
    video_path = await ensure_local_video(creative)

    # 2. Upload to Gemini Files API and wait for ACTIVE
    file = await asyncio.to_thread(client.files.upload, file=str(video_path))
    file = await _wait_for_file_active(client, file)

    # 3. Generate structured analysis
    response = await asyncio.to_thread(
        client.models.generate_content,
        model=MODEL,
        contents=[file, DECONSTRUCT_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_GeminiAnalysis,
            temperature=0.2,
        ),
    )
    elapsed = time.perf_counter() - t0

    # ``response.parsed`` is already a ``_GeminiAnalysis`` instance (Pydantic).
    analysis: _GeminiAnalysis = response.parsed

    output_tokens = (
        response.usage_metadata.candidates_token_count
        if response.usage_metadata is not None
        else 500
    )

    # 4. Compose the public ``DeconstructedCreative``
    result = DeconstructedCreative(
        raw=creative,
        hook=analysis.hook,
        scene_flow=analysis.scene_flow,
        on_screen_text=analysis.on_screen_text,
        cta_text=analysis.cta_text,
        cta_timing_seconds=analysis.cta_timing_seconds,
        palette_hex=analysis.palette_hex,
        visual_style=analysis.visual_style,
        audience_proxy=analysis.audience_proxy,
        deconstruction_model=MODEL,
        deconstruction_cost_usd=estimate_cost_usd(
            creative.video_duration or 15.0,
            output_tokens,
        ),
    )

    # 5. Persist for future runs (cross-game, cross-week, cross-machine)
    try:
        cache_path.write_text(result.model_dump_json(indent=2))
    except OSError as e:
        log.warning("deconstruct: failed to cache %s: %s", creative.creative_id, e)

    return result, elapsed


async def deconstruct_batch(
    creatives: list[RawCreative],
    concurrency: int = 5,
) -> list[tuple[DeconstructedCreative | Exception, float]]:
    """Run ``deconstruct_one`` over a batch with bounded concurrency.

    Returns a list aligned with ``creatives``. Each entry is either a
    ``(DeconstructedCreative, elapsed_seconds)`` tuple on success, or an
    ``(Exception, 0.0)`` tuple on failure. Failures are logged but do not
    abort the batch.
    """
    client = get_client()
    sem = asyncio.Semaphore(concurrency)

    async def _bounded(c: RawCreative) -> tuple[DeconstructedCreative | Exception, float]:
        async with sem:
            try:
                return await deconstruct_one(c, client)
            except Exception as exc:  # noqa: BLE001 — we want to keep going
                log.exception("deconstruct failed for %s", c.creative_id)
                return (exc, 0.0)

    return await asyncio.gather(*[_bounded(c) for c in creatives])
