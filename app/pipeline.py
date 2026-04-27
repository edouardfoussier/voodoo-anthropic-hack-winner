"""End-to-end HookLens pipeline orchestrator.

Wires every workstream's module into a single ``run_pipeline`` function and
calls a user-supplied ``on_step`` callback after each step so callers (the
Streamlit app, scripts/precache.py, etc.) can show progress in real time.

If you want a streaming generator instead of a callback, wrap this in
``run_pipeline_streaming`` below (yields the same payloads).
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from app._paths import CACHE_DIR
from app.analysis.archetypes import compute_archetypes
from app.analysis.deconstruct import deconstruct_batch
from app.analysis.game_dna import extract_game_dna
from app.analysis.game_fit import score_all
from app.creative.brief import author_briefs
from app.creative.scenario import generate_variants
from app.models import (
    AppMetadata,
    CreativeArchetype,
    CreativeBrief,
    DeconstructedCreative,
    GameDNA,
    GameFitScore,
    GeneratedVariant,
    HookLensReport,
    MarketContext,
    RawCreative,
)
from app.sources.sensortower import (
    fetch_top_advertisers,
    fetch_top_creatives,
    resolve_game,
)

log = logging.getLogger(__name__)

REPORT_CACHE_DIR = CACHE_DIR / "reports"


# ---------------------------------------------------------------------------
# Config & state
# ---------------------------------------------------------------------------


# Curated worldwide expansion lists used when the caller asks for "all".
# We deliberately limit the breadth — we want diverse signal, not a 50× cost
# explosion. Pick the markets / networks that matter most for mobile gaming
# user-acquisition spend in 2026.
ALL_COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "KR"]
ALL_NETWORKS = ["TikTok", "Facebook", "Instagram"]
# SensorTower /v1/unified/ad_intel/creatives/top rejects Google + ironSource
# with HTTP 422 — exclude them from the worldwide loop. They're available via
# advertiser-level queries but not creative-level for the filters we use.


def _expand_all(values: list[str], expansion: list[str]) -> list[str]:
    """If ``values`` is empty or contains the sentinel ``"all"``, return the
    full ``expansion``. Otherwise keep the user-supplied list as-is.
    """
    if not values or any(v.strip().lower() == "all" for v in values):
        return list(expansion)
    return values


@dataclass
class PipelineConfig:
    game_name: str
    # Worldwide-by-default: pass ``["all"]`` (or omit) to query every curated
    # market / network. Single-value lists keep the original narrow behaviour
    # (e.g. ``["US"]`` + ``["TikTok"]`` for the focused Streamlit demo path).
    countries: list[str] = field(default_factory=lambda: ["US"])
    networks: list[str] = field(default_factory=lambda: ["TikTok"])
    category_id: int = 7012  # iOS Puzzle (see docs/sensortower-api.md §9.1)
    period: str = "month"  # week | month | quarter
    period_date: str = "2026-04-01"
    max_top_advertisers: int = 10
    max_creatives: int = 8  # final cap AFTER cross-market dedupe
    deconstruct_concurrency: int = 5
    top_k_archetypes: int = 5
    top_k_variants: int = 3


@dataclass
class PrototypeInput:
    """Inputs for the 'unreleased game' use case.

    Replaces SensorTower steps 1-2: instead of looking up an existing app, we
    build a synthetic AppMetadata from PM-provided assets. Pipeline steps 3-10
    run identically afterwards.
    """

    name: str
    description: str
    screenshot_paths: list[Path]  # local paths to PM-uploaded mockups/screenshots
    target_category_id: int  # iOS category id for the market scan (e.g. 7012 Puzzle)
    target_audience_proxy: str | None = None  # optional hint, not used yet


@dataclass
class PipelineState:
    config: PipelineConfig
    target_meta: AppMetadata | None = None
    game_dna: GameDNA | None = None
    top_advertisers: list[dict] = field(default_factory=list)
    raw_creatives: list[RawCreative] = field(default_factory=list)
    deconstructed: list[DeconstructedCreative] = field(default_factory=list)
    archetypes: list[CreativeArchetype] = field(default_factory=list)
    top_archetypes: list[CreativeArchetype] = field(default_factory=list)
    fit_scores: list[GameFitScore] = field(default_factory=list)
    chosen: list[tuple[CreativeArchetype, GameFitScore]] = field(default_factory=list)
    briefs: list[CreativeBrief] = field(default_factory=list)
    variants: list[GeneratedVariant] = field(default_factory=list)
    report: HookLensReport | None = None
    step_durations_s: dict[str, float] = field(default_factory=dict)
    # Resolved (post-``all`` expansion) markets/networks. Filled at step start
    # so the final MarketContext reflects what was actually scanned.
    resolved_countries: list[str] = field(default_factory=list)
    resolved_networks: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Step definitions
# ---------------------------------------------------------------------------


@dataclass
class StepDef:
    step_id: str
    label: str
    runner: Callable[[PipelineState], Any]


def _step_resolve_game(state: PipelineState) -> AppMetadata:
    # Resolve "all" sentinels once, here, so every downstream step uses the
    # same expanded list. ``resolve_game`` itself only needs one country (it's
    # just a name → SensorTower app metadata lookup); we use the first
    # resolved country as the canonical one for store metadata.
    state.resolved_countries = _expand_all(state.config.countries, ALL_COUNTRIES)
    state.resolved_networks = _expand_all(state.config.networks, ALL_NETWORKS)
    primary_country = state.resolved_countries[0] if state.resolved_countries else "US"

    # Voodoo-catalog short-circuit: if the user picked a Voodoo title from
    # the modal autocomplete, we already have its canonical AppMetadata in
    # the cached catalog. Skip the SensorTower search (which sometimes hits
    # the web/Steam version of the brand and errors with "No iOS variant",
    # e.g. "aquapark.io" → Poki) and use the catalog entry directly.
    voodoo_match = _resolve_via_voodoo_catalog(state.config.game_name)
    if voodoo_match is not None:
        log.info(
            "resolve_game: Voodoo catalog hit for %r → %s",
            state.config.game_name,
            voodoo_match.app_id,
        )
        state.target_meta = voodoo_match
        return state.target_meta

    state.target_meta = resolve_game(state.config.game_name, country=primary_country)
    return state.target_meta


def _resolve_via_voodoo_catalog(game_name: str) -> AppMetadata | None:
    """Match the user's input (case-insensitive) against the Voodoo catalog."""
    try:
        from app.sources.voodoo import fetch_voodoo_catalog
    except ImportError:
        return None
    needle = game_name.strip().casefold()
    if not needle:
        return None
    for app in fetch_voodoo_catalog():
        if app.name.casefold() == needle:
            return app
    return None


def _step_game_dna(state: PipelineState) -> GameDNA:
    assert state.target_meta is not None
    state.game_dna = extract_game_dna(state.target_meta)
    return state.game_dna


def _step_top_advertisers(state: PipelineState) -> list[dict]:
    """Top advertisers per (country) for the configured category, deduped by
    app_id. We use ``network='All Networks'`` (the only top_apps endpoint that
    accepts it) so a single request per country is enough.
    """
    seen_ids: set[str] = set()
    merged: list[dict] = []

    for country in state.resolved_countries:
        try:
            advs = fetch_top_advertisers(
                category_id=state.config.category_id,
                country=country,
                period=state.config.period,
                period_date=state.config.period_date,
                limit=state.config.max_top_advertisers,
            )
        except Exception:
            log.exception("fetch_top_advertisers failed for country=%s", country)
            continue
        for adv in advs:
            aid = str(adv.get("app_id") or adv.get("name") or "")
            if not aid or aid in seen_ids:
                continue
            seen_ids.add(aid)
            merged.append(adv)

    state.top_advertisers = merged[: state.config.max_top_advertisers]
    return state.top_advertisers


def _step_top_creatives(state: PipelineState) -> list[RawCreative]:
    """Fan out across (network × country) combos and merge, deduped by
    creative_id. ``creatives/top`` does not accept ``All Networks``, so we
    must loop. Per-combo budget is sized so that total fetched across combos
    ≈ ``max_creatives × 1.5`` (buffer for dedupe). We stop early once
    ``max_creatives`` distinct creatives are collected.
    """
    networks = state.resolved_networks
    countries = state.resolved_countries
    target = state.config.max_creatives
    num_combos = max(1, len(networks) * len(countries))
    per_combo = max(2, (target * 3 // 2) // num_combos)

    seen_ids: set[str] = set()
    merged: list[RawCreative] = []

    for network in networks:
        for country in countries:
            if len(merged) >= target:
                break
            try:
                creatives = fetch_top_creatives(
                    category_id=state.config.category_id,
                    country=country,
                    network=network,
                    period=state.config.period,
                    period_date=state.config.period_date,
                    max_creatives=per_combo,
                )
            except Exception:
                # SensorTower 422 is common for some network × filter combos
                # (e.g. Google, ironSource). Log + skip; other combos still
                # contribute.
                log.exception(
                    "fetch_top_creatives failed for network=%s country=%s",
                    network,
                    country,
                )
                continue
            for c in creatives:
                if c.creative_id in seen_ids:
                    continue
                seen_ids.add(c.creative_id)
                merged.append(c)
                if len(merged) >= target:
                    break
        if len(merged) >= target:
            break

    state.raw_creatives = merged[:target]
    return state.raw_creatives


def _step_deconstruct(state: PipelineState) -> list[DeconstructedCreative]:
    if not state.raw_creatives:
        log.warning("No raw creatives to deconstruct.")
        return []
    results = asyncio.run(
        deconstruct_batch(
            state.raw_creatives,
            concurrency=state.config.deconstruct_concurrency,
        )
    )
    state.deconstructed = [
        r for (r, _lat) in results if isinstance(r, DeconstructedCreative)
    ]
    return state.deconstructed


def _step_archetypes(state: PipelineState) -> list[CreativeArchetype]:
    # Anchor the SoV velocity window's end_date on the same period_date
    # the rest of the pipeline used (top_advertisers / creatives_top).
    # Otherwise compute_archetypes defaults to today's date, which can
    # silently desync the velocity numbers from the SensorTower window
    # we actually queried — gives jurors a target for "your numbers
    # don't match the data you're showing".
    state.archetypes = compute_archetypes(
        state.deconstructed,
        period_date=state.config.period_date,
    )
    state.top_archetypes = state.archetypes[: state.config.top_k_archetypes]
    return state.top_archetypes


def _step_game_fit(state: PipelineState) -> list[GameFitScore]:
    assert state.game_dna is not None
    state.fit_scores = score_all(state.top_archetypes, state.game_dna)
    ranked = sorted(
        zip(state.top_archetypes, state.fit_scores, strict=True),
        key=lambda x: x[1].overall,
        reverse=True,
    )
    state.chosen = ranked[: state.config.top_k_variants]
    return state.fit_scores


def _step_briefs(state: PipelineState) -> list[CreativeBrief]:
    assert state.game_dna is not None
    benchmark = _build_publisher_benchmark(state)
    state.briefs = author_briefs(state.chosen, state.game_dna, benchmark=benchmark)
    return state.briefs


def _build_publisher_benchmark(state: PipelineState):
    """Best-effort: look up the target's existing creatives in our Voodoo
    catalog. Returns ``None`` for non-Voodoo apps or on any lookup failure.

    When the target IS a Voodoo title, we feed Opus the list of creatives
    Voodoo is currently running so the brief explicitly aims at an
    underrepresented hook — the "delta" pitch.
    """
    if state.target_meta is None or state.game_dna is None:
        return None
    try:
        from app.creative.brief import PublisherBenchmark
        from app.sources.voodoo import (
            VOODOO_PUBLISHER_NAME,
            fetch_voodoo_app_creatives,
            is_voodoo_app,
        )
    except ImportError:
        return None

    app_id = state.target_meta.app_id
    if not is_voodoo_app(app_id):
        return None

    try:
        creatives = fetch_voodoo_app_creatives(app_id, limit=15)
    except Exception:
        log.exception("Voodoo benchmark fetch failed for %s", app_id)
        return None

    if not creatives:
        log.info(
            "Target %s is a Voodoo app but has no recent ad activity; "
            "skipping benchmark.",
            app_id,
        )
        return None

    return PublisherBenchmark(
        publisher_name=VOODOO_PUBLISHER_NAME,
        app_name=state.game_dna.name,
        creatives=creatives,
    )


def _step_visuals(state: PipelineState) -> list[GeneratedVariant]:
    # Use the target game's downloaded screenshots as visual references for
    # IP-Adapter generation — this anchors the generated ad to the game's
    # actual palette/characters/UI and prevents "deceptive ad" syndrome (a
    # player downloading the game shouldn't feel bait-and-switched).
    #
    # Bumped from 3 → 6 references per Edouard's feedback that current
    # generated visuals weren't faithful enough to gameplay. More refs = more
    # IP-Adapter signal = output stays closer to the actual UI/character.
    # Scenario's IP-Adapter accepts up to 6 refs cleanly (cf. their docs).
    from app.analysis.game_dna import SCREENSHOT_CACHE_DIR

    MAX_IP_ADAPTER_REFS = 6

    reference_paths: list[Path] = []
    if state.target_meta is not None:
        screenshot_dir = SCREENSHOT_CACHE_DIR / state.target_meta.app_id
        if screenshot_dir.exists():
            reference_paths = sorted(screenshot_dir.glob("*.png"))[
                :MAX_IP_ADAPTER_REFS
            ]
        if reference_paths:
            log.info(
                "Step 9 — using %d game screenshot(s) as IP-Adapter reference",
                len(reference_paths),
            )

    state.variants = generate_variants(
        state.chosen,
        state.briefs,
        reference_image_paths=reference_paths,
    )
    return state.variants


def _step_compose_report(state: PipelineState) -> HookLensReport:
    assert state.game_dna is not None

    period_dt = datetime.fromisoformat(state.config.period_date).replace(
        tzinfo=timezone.utc
    )

    state.report = HookLensReport(
        target_game=state.game_dna,
        market_context=MarketContext(
            category_id=str(state.config.category_id),
            category_name="Puzzle" if state.config.category_id == 7012 else "Other",
            countries=state.resolved_countries or [state.config.countries[0]],
            networks=state.resolved_networks or [state.config.networks[0]],
            period_start=period_dt,
            period_end=period_dt,
            num_advertisers_scanned=len(state.top_advertisers),
            num_creatives_analyzed=len(state.deconstructed),
            num_phashion_groups=len(
                {d.raw.phashion_group for d in state.deconstructed if d.raw.phashion_group}
            ),
        ),
        top_archetypes=state.top_archetypes,
        game_fit_scores=state.fit_scores,
        final_variants=state.variants,
        pipeline_duration_seconds=sum(state.step_durations_s.values()),
        total_cost_usd=sum(
            d.deconstruction_cost_usd or 0 for d in state.deconstructed
        ),
        generated_at=datetime.now(timezone.utc),
    )

    REPORT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORT_CACHE_DIR / f"{state.game_dna.app_id}_e2e.json"
    out_path.write_text(state.report.model_dump_json(indent=2))
    log.info("HookLensReport saved → %s", out_path)

    return state.report


# Order matters — each step depends on previous state.
STEPS: list[StepDef] = [
    StepDef("target_meta", "Resolve target game", _step_resolve_game),
    StepDef("game_dna", "Extract Game DNA", _step_game_dna),
    StepDef("top_advertisers", "Discover top advertisers", _step_top_advertisers),
    StepDef("raw_creatives", "Pull top creatives", _step_top_creatives),
    StepDef("deconstructed", "Deconstruct videos (Gemini Pro)", _step_deconstruct),
    StepDef("archetypes", "Cluster archetypes + signals", _step_archetypes),
    StepDef("fit_scores", "Score game-fit (Opus)", _step_game_fit),
    StepDef("briefs", "Author creative briefs (Opus)", _step_briefs),
    StepDef("variants", "Generate visuals (Scenario)", _step_visuals),
    StepDef("report", "Compose final report", _step_compose_report),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def run_pipeline(
    config: PipelineConfig,
    *,
    on_step: Callable[[str, str, int, Any, float], None] | None = None,
) -> HookLensReport:
    """Run the full pipeline. Calls ``on_step(step_id, label, idx, payload, duration_s)``
    after each step completes so the caller can render progress.
    """
    state = PipelineState(config=config)

    for idx, step in enumerate(STEPS, start=1):
        log.info("Step %d/%d · %s", idx, len(STEPS), step.label)
        t0 = time.perf_counter()
        try:
            payload = step.runner(state)
        except Exception:
            log.exception("Step %s failed", step.step_id)
            raise
        elapsed = time.perf_counter() - t0
        state.step_durations_s[step.step_id] = elapsed

        if on_step is not None:
            on_step(step.step_id, step.label, idx, payload, elapsed)

    assert state.report is not None
    return state.report


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "proto"


def run_pipeline_prototype(
    proto: PrototypeInput,
    config: PipelineConfig,
    *,
    on_step: Callable[[str, str, int, Any, float], None] | None = None,
) -> HookLensReport:
    """Run the pipeline on an unreleased game prototype.

    Skips SensorTower steps 1-2 (no app to resolve) and instead synthesizes
    an ``AppMetadata`` from PM inputs. Steps 3-10 run unchanged.

    The PM-uploaded screenshots are copied into the Game DNA cache directory
    using the canonical naming scheme so ``app.analysis.game_dna.extract_game_dna``
    finds them locally and skips its HTTP download path.
    """
    from app.analysis.game_dna import SCREENSHOT_CACHE_DIR

    if not proto.screenshot_paths:
        raise ValueError("Prototype mode requires at least 1 screenshot.")
    if not proto.description or len(proto.description) < 30:
        raise ValueError(
            "Prototype description must be at least 30 characters — "
            "Gemini Vision needs context to generate a meaningful Game DNA."
        )

    proto_app_id = f"proto_{_slug(proto.name)}"

    # Pre-populate the screenshot cache so extract_game_dna treats this as a
    # cache hit and never calls httpx.
    screenshot_dir = SCREENSHOT_CACHE_DIR / proto_app_id
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    for i, src in enumerate(proto.screenshot_paths):
        target = screenshot_dir / f"{i:02d}.png"
        if (
            not target.exists()
            or target.stat().st_size == 0
            or src.stat().st_mtime > target.stat().st_mtime
        ):
            shutil.copy(src, target)

    # Build a synthetic AppMetadata. We fill screenshot_urls with valid HttpUrl
    # placeholders (Picsum) — the URLs are never hit because the cache files
    # already exist with the canonical names extract_game_dna looks for.
    synthetic_meta = AppMetadata(
        app_id=proto_app_id,
        unified_app_id=None,
        name=proto.name,
        publisher_name="(prototype)",
        icon_url="https://picsum.photos/seed/proto_icon/256",
        categories=[proto.target_category_id],
        description=proto.description,
        screenshot_urls=[
            f"https://picsum.photos/seed/{proto_app_id}_{i}/640/1136"
            for i in range(len(proto.screenshot_paths))
        ],
        rating=None,
        rating_count=None,
    )

    # Force the config category to the prototype's target so step 4 (advertisers)
    # and step 5 (creatives) scan the right segment of the market.
    config.category_id = proto.target_category_id

    state = PipelineState(config=config)
    state.target_meta = synthetic_meta
    # Resolve the "all" sentinels here too — prototype mode skips
    # _step_resolve_game where the live path performs this expansion.
    state.resolved_countries = _expand_all(config.countries, ALL_COUNTRIES)
    state.resolved_networks = _expand_all(config.networks, ALL_NETWORKS)

    # Synthetically yield step 1 (resolve_game) so the UI gets a "Step 1/10
    # done" event with the synthetic metadata payload — keeps the React
    # progress bar at 10 events whether we're in prototype or live mode.
    if on_step is not None:
        on_step("target_meta", "Resolve target game (prototype)", 1, synthetic_meta, 0.0)
    state.step_durations_s["target_meta"] = 0.0

    # Run the rest of the steps starting from step 2 (game_dna).
    remaining = [s for s in STEPS if s.step_id != "target_meta"]
    for offset, step in enumerate(remaining, start=2):
        log.info("Step %d/%d · %s", offset, len(STEPS), step.label)
        t0 = time.perf_counter()
        try:
            payload = step.runner(state)
        except Exception:
            log.exception("Step %s failed", step.step_id)
            raise
        elapsed = time.perf_counter() - t0
        state.step_durations_s[step.step_id] = elapsed
        if on_step is not None:
            on_step(step.step_id, step.label, offset, payload, elapsed)

    assert state.report is not None
    return state.report


def run_pipeline_streaming(config: PipelineConfig) -> Iterator[tuple[str, str, int, Any, float]]:
    """Generator variant — yields ``(step_id, label, idx, payload, duration_s)``.

    Useful for callers that prefer a ``for`` loop over a callback.
    """
    queue: list[tuple[str, str, int, Any, float]] = []

    def _capture(step_id: str, label: str, idx: int, payload: Any, dur: float) -> None:
        queue.append((step_id, label, idx, payload, dur))

    # We run the pipeline synchronously and yield events in order. This is
    # simpler than a true async generator for our 10-step linear pipeline.
    run_pipeline(config, on_step=_capture)
    yield from queue
