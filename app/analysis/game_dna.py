"""Game DNA extraction: Gemini Vision on store screenshots + description."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
from google import genai
from google.genai import types

from app._cache import disk_cached
from app._paths import CACHE_DIR
from app.models import AppMetadata, GameDNA

log = logging.getLogger(__name__)

DEFAULT_CACHE_DIR = CACHE_DIR / "game_dna"
SCREENSHOT_CACHE_DIR = CACHE_DIR / "screenshots"
# Game DNA extraction is a small, high-leverage call (3 screenshots → structured
# DNA used by EVERY downstream score). Worth Pro-level reasoning, not Flash.
MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-3.1-pro-preview")

def _build_prompt(description: str) -> str:
    """Build the Game DNA prompt with a description block.

    We use an f-string-in-a-function instead of a module-level template +
    ``.format()`` because the prompt body contains literal curly braces
    (the ui_mood enum example) that would collide with format-field parsing.
    """
    return f"""You are a senior mobile-game product analyst. Looking at these in-game screenshots and the store description below, extract a precise, structured "Game DNA" matching the schema. Be specific, concrete, never hedge.

For ``palette``: pick exactly the 3 dominant hex colors of the in-game UI (not the icon).
For ``audience_proxy``: a one-sentence demographic guess (gender, age range, vibe).
For ``key_mechanics``: 3-6 short verbs (e.g. "sorting", "stacking", "physics-tap").
For ``ui_mood``: pick one of {{"calm/satisfying", "energetic/competitive", "tense/challenging", "cozy/relaxing"}}.
For ``character_present``: true if a recognizable character or avatar is visible across screenshots, false if it's purely abstract/object-based.

Store description:
\"\"\"{description[:1500]}\"\"\"
"""


def _download_screenshots(meta: AppMetadata, max_n: int = 3) -> list[Path]:
    """Download up to ``max_n`` screenshots locally; cached on disk."""
    screenshot_dir = SCREENSHOT_CACHE_DIR / meta.app_id
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    paths: list[Path] = []
    for i, url in enumerate(meta.screenshot_urls[:max_n]):
        target = screenshot_dir / f"{i:02d}.png"
        if not target.exists() or target.stat().st_size == 0:
            log.info("CACHE MISS screenshot %d for %s", i, meta.app_id)
            r = httpx.get(str(url), follow_redirects=True, timeout=30.0)
            r.raise_for_status()
            target.write_bytes(r.content)
        paths.append(target)
    return paths


def extract_game_dna(meta: AppMetadata, *, max_screenshots: int = 3) -> GameDNA:
    """Multi-image Gemini Vision call → ``GameDNA``.

    Cached on disk by ``app_id`` so re-runs on the same game are instant.
    """
    if not meta.screenshot_urls:
        raise ValueError(
            f"AppMetadata for {meta.name} has no screenshot_urls — cannot extract Game DNA."
        )

    cache_path = DEFAULT_CACHE_DIR / f"{meta.app_id}.json"
    if cache_path.exists():
        log.info("CACHE HIT game_dna %s", meta.app_id)
        return GameDNA.model_validate_json(cache_path.read_text())

    screenshot_paths = _download_screenshots(meta, max_n=max_screenshots)
    prompt = _build_prompt(meta.description)

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    image_parts = [
        types.Part.from_bytes(data=p.read_bytes(), mime_type="image/png")
        for p in screenshot_paths
    ]
    response = client.models.generate_content(
        model=MODEL,
        contents=[*image_parts, prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=GameDNA,
            temperature=0.2,
        ),
    )
    raw = response.parsed
    # Force the passthrough fields ourselves so they're never wrong.
    dna = GameDNA(
        **{**raw.model_dump(), "app_id": meta.app_id, "name": meta.name}
    )

    DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(dna.model_dump_json(indent=2))
    return dna
