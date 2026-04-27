"""HookLens data contract.

This module is the integration contract between the three workstreams:
- Partner 1 (SensorTower) produces ``AppMetadata`` and ``list[RawCreative]``
- Edouard (Gemini analysis) consumes those and produces ``GameDNA``,
  ``list[DeconstructedCreative]``, ``list[CreativeArchetype]``, and ``list[GameFitScore]``
- Partner 2 (Scenario MCP) consumes archetypes + fit scores and produces
  ``list[CreativeBrief]`` and ``list[GeneratedVariant]``

DO NOT modify this file after the Saturday 17:00 checkpoint without explicit
3-way sign-off from all workstream owners. Schema drift mid-build is the #1
hackathon killer.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

# ---------------------------------------------------------------------------
# 1. Inputs from SensorTower (Partner 1's output)
# ---------------------------------------------------------------------------


class AppMetadata(BaseModel):
    """Subset of SensorTower /v1/{ios|android}/apps response we actually use."""

    app_id: str
    unified_app_id: str | None = None
    name: str
    publisher_name: str
    icon_url: HttpUrl
    categories: list[int | str]
    description: str
    screenshot_urls: list[HttpUrl] = Field(default_factory=list)
    rating: float | None = None
    rating_count: int | None = None
    release_date: datetime | None = None


AdType = Literal[
    "video",
    "video-rewarded",
    "video-interstitial",
    "video-other",
    "playable",
    "interactive-playable",
    "interactive-playable-rewarded",
    "image",
    "image-interstitial",
    "image-other",
    "banner",
    "full_screen",
]


class RawCreative(BaseModel):
    """One ad creative from SensorTower /ad_intel/creatives* endpoints.

    Output of Partner 1's pipeline. Input of Edouard's Gemini analysis.
    """

    creative_id: str
    ad_unit_id: str
    app_id: str
    advertiser_name: str
    network: str
    ad_type: AdType
    creative_url: HttpUrl
    thumb_url: HttpUrl | None = None
    preview_url: HttpUrl | None = None

    # Critical fields for non-obvious signal extraction:
    phashion_group: str | None = None
    share: float | None = None
    first_seen_at: datetime
    last_seen_at: datetime

    video_duration: float | None = None
    aspect_ratio: str | None = None  # "9:16" | "1:1" | "16:9" | "4:5"
    width: int | None = None
    height: int | None = None
    message: str | None = None  # ad copy as captured by SensorTower
    button_text: str | None = None  # CTA button label

    # Computed by Partner 1:
    days_active: int | None = None  # last_seen_at - first_seen_at, in days


# ---------------------------------------------------------------------------
# 2. Game DNA (Edouard's first artifact)
# ---------------------------------------------------------------------------


class ColorPalette(BaseModel):
    primary_hex: str
    secondary_hex: str
    accent_hex: str
    description: str  # human-readable summary, e.g. "warm, saturated, candy-like"


class GameDNA(BaseModel):
    """Extracted from SensorTower metadata + Gemini Vision on screenshots."""

    app_id: str
    name: str
    genre: str  # "puzzle", "merge", "idle", "casual", etc.
    sub_genre: str | None = None  # "block-puzzle", "match-3", "tile-sort"
    core_loop: str  # one-sentence description, Gemini Vision-derived
    audience_proxy: str  # "casual female 25-45", "kid-friendly", etc.
    visual_style: str  # "cartoon 3D bright", "minimalist 2D", "pixel"
    palette: ColorPalette
    key_mechanics: list[str]  # ["sorting", "stacking", "physics-tap"]
    character_present: bool
    ui_mood: str  # "calm/satisfying", "energetic/competitive"
    screenshot_signals: list[str]  # raw observations from Vision


# ---------------------------------------------------------------------------
# 3. Deconstructed creative (Edouard's main output)
# ---------------------------------------------------------------------------


EmotionalPitch = Literal[
    "satisfaction",
    "fail",
    "curiosity",
    "rage_bait",
    "tutorial",
    "asmr",
    "celebrity",
    "challenge",
    "transformation",
    "other",
]


class HookFrame(BaseModel):
    """First 3 seconds breakdown."""

    summary: str
    visual_action: str
    text_overlay: str | None = None
    voiceover_transcript: str | None = None
    emotional_pitch: EmotionalPitch


class DeconstructedCreative(BaseModel):
    """RawCreative augmented with Gemini Pro analysis."""

    raw: RawCreative
    hook: HookFrame
    scene_flow: list[str]  # 3-5 bullets describing scene progression
    on_screen_text: list[str]  # all text overlays in order
    cta_text: str | None = None
    cta_timing_seconds: float | None = None  # when CTA appears
    palette_hex: list[str]  # 3 dominant colors, hex
    visual_style: str  # "live-action-UGC" | "in-game" | "3D-render" | "mixed"
    audience_proxy: str
    deconstruction_model: str = "gemini-2.5-pro"
    deconstruction_cost_usd: float | None = None


# ---------------------------------------------------------------------------
# 4. Archetypes & signal ranking
# ---------------------------------------------------------------------------


class CreativeArchetype(BaseModel):
    """A cluster of creatives sharing a hook archetype."""

    archetype_id: str  # short slug, e.g. "asmr-sort-satisfying"
    label: str  # human-readable, e.g. "ASMR satisfying sort"
    member_creative_ids: list[str]
    centroid_hook: HookFrame  # synthesized "ideal hook" for this cluster
    palette_hex: list[str]
    common_mechanics: list[str]

    # Non-obvious signals — the differentiator vs other teams:
    velocity_score: float
    """share_last_week / share_3_weeks_ago, clipped [0.5, 5.0].
    >1.5 = ascending, <0.7 = declining, ~1.0 = stable."""

    derivative_spread: float
    """unique_advertisers_in_phashion / creatives_in_archetype, in [0, 1].
    Higher = more publishers copying = stronger market validation."""

    freshness_days: float
    """mean(today - first_seen_at) for creatives in archetype.
    <14 = breakout candidate, >60 = saturated."""

    overall_signal_score: float
    """0.4 * velocity + 0.35 * derivative_spread + 0.25 * (1 / normalized_freshness)."""

    rationale: str  # Claude-written explanation of why this archetype matters


class GameFitScore(BaseModel):
    archetype_id: str
    visual_match: int  # 0-100
    mechanic_match: int  # 0-100
    audience_match: int  # 0-100
    overall: int  # 0-100
    rationale: str  # Claude-written


# ---------------------------------------------------------------------------
# 5. Final creative output (Partner 2's deliverable)
# ---------------------------------------------------------------------------


class CreativeBrief(BaseModel):
    """Structured creative brief generated by Opus, fed to Scenario MCP."""

    archetype_id: str
    target_game_id: str
    title: str  # e.g. "Satisfying Marble Sort ASMR Hook"
    hook_3s: str  # what the first 3 seconds should be
    scene_flow: list[str]  # 3-5 scenes
    visual_direction: str  # palette, style, energy
    text_overlays: list[str]
    cta: str
    rationale: str  # why this creative for this game
    scenario_prompts: list[str]  # ready-to-paste prompts for Scenario MCP


class GeneratedVariant(BaseModel):
    brief: CreativeBrief
    hero_frame_path: str  # local path or URL
    storyboard_paths: list[str]
    test_priority: int  # 1 = test first, 3 = test last
    test_priority_rationale: str


# ---------------------------------------------------------------------------
# 6. Top-level report (what Streamlit consumes)
# ---------------------------------------------------------------------------


class MarketContext(BaseModel):
    category_id: str
    category_name: str
    countries: list[str]
    networks: list[str]
    period_start: datetime
    period_end: datetime
    num_advertisers_scanned: int
    num_creatives_analyzed: int
    num_phashion_groups: int


class HookLensReport(BaseModel):
    """The top-level object Streamlit renders."""

    target_game: GameDNA
    market_context: MarketContext
    top_archetypes: list[CreativeArchetype]
    game_fit_scores: list[GameFitScore]
    final_variants: list[GeneratedVariant]
    pipeline_duration_seconds: float
    total_cost_usd: float
    generated_at: datetime
