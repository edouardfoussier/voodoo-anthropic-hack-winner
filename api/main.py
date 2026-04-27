"""HookLens API bridge — exposes SensorTower metrics + full HookLens reports
to the React frontend.

Run:
    uv run uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()
log = logging.getLogger(__name__)

# Silence httpx INFO-level URL logging — SensorTower URLs include the
# auth_token query param, which would otherwise leak into shipping logs every
# time a cache miss hits the API. Library-level sanitisation is brittle, so
# we just raise httpx's logger threshold; warnings + errors still surface.
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="HookLens API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Response shapes (mirror front/src/data/sample.ts)
# ---------------------------------------------------------------------------

NetworkFE = Literal["Meta", "Google", "TikTok", "ironSource"]
FormatFE = Literal["Video", "Static", "Playable"]
SpendTierFE = Literal["Micro", "Mid", "Top"]


class Creative(BaseModel):
    id: str
    game: str
    network: NetworkFE
    format: FormatFE
    runDays: int
    """Estimated impressions — REMOVED. Was a fake = max(10k, share*50M) value;
    the frontend hides it. Kept on the model for backwards compat with the
    React UI's typed shapes; treat as advisory only.
    """
    impressions: int
    score: int
    spendEstimate: int
    startedAt: str
    thumbUrl: str | None = None
    creativeUrl: str | None = None
    # Real SensorTower fields exposed for honest display in Ad Library:
    sov: float | None = None
    """Share of Voice within the queried category × network × period
    (0.0–1.0). The ONLY trustworthy "popularity" metric we have direct
    from SensorTower; everything else (impressions, spendEstimate, score)
    is a synthetic tier we synthesised earlier and should not be shown
    as a numeric KPI to PMs.
    """
    publisherName: str | None = None
    """The advertiser's app publisher (from SensorTower app_info.publisher_name).
    Lets the UI show "Voodoo • aquapark.io" instead of just the game name.
    """
    appIconUrl: str | None = None
    """The advertiser's app icon URL (from SensorTower app_info.icon_url)."""


class CompetitorGame(BaseModel):
    game: str
    subGenre: str
    appStoreRank: int
    monthlySpend: int
    spendTier: SpendTierFE
    status: Literal["Active", "Monitoring"]
    # SensorTower app id (unified when available) — used by the frontend to
    # fetch network ranks via /api/advertisers/{app_id}/ranks. Optional so the
    # current sample.ts CompetitorGame stays compatible.
    app_id: str | None = None
    iconUrl: str | None = None
    """App icon URL (from SensorTower app_info.icon_url). Lets the
    Competitive Scope page render real game thumbnails next to each
    row instead of just the name."""
    publisher: str | None = None
    """Publisher name when present in the SensorTower row."""


# ---------------------------------------------------------------------------
# Network mapping: SensorTower → frontend labels
# ---------------------------------------------------------------------------

_ST_TO_FE: dict[str, NetworkFE] = {
    "facebook": "Meta",
    "meta": "Meta",
    "instagram": "Meta",
    "google": "Google",
    "google uac": "Google",
    "tiktok": "TikTok",
    "ironsource": "ironSource",
    "iron source": "ironSource",
}

# Networks we query, paired with their SensorTower slug
_NETWORKS: list[tuple[str, NetworkFE]] = [
    ("Facebook", "Meta"),
    ("Google", "Google"),
    ("TikTok", "TikTok"),
    ("ironSource", "ironSource"),
]


def _norm_network(raw: str) -> NetworkFE:
    return _ST_TO_FE.get(raw.lower(), "Meta")


def _norm_format(ad_type: str) -> FormatFE:
    t = ad_type.lower()
    if "playable" in t:
        return "Playable"
    if "image" in t or "banner" in t or "static" in t:
        return "Static"
    return "Video"


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------

_MARKET_TOTAL_IMPRESSIONS = 50_000_000


# Strict category-based filtering doesn't work on this dataset:
# SensorTower's ``creatives_top`` endpoint returns ``app_info.categories=None``
# for ~100% of the cached ad_units (we checked: 1308/1308 in the demo cache).
# So we filter via a **name/publisher blocklist** instead — pragmatic, covers
# the offenders that actually leak through SensorTower's category filter
# (food chains, news apps, retail brands), and never risks dropping legit
# game advertisers when their categories field is empty.
_NON_GAME_NAME_KEYWORDS: tuple[str, ...] = (
    "burger king",
    "mcdonald",
    "papa murphy",
    "papa john",
    "starbucks",
    "taco bell",
    "kfc",
    "subway",
    "pizza hut",
    "domino",
    "racing post",  # UK horse-racing newspaper that leaked into Puzzle US
    "dunkin",
    "chipotle",
    "wendy",
)
_NON_GAME_PUBLISHERS: tuple[str, ...] = (
    "restaurant brands international",  # Burger King's parent
    "papa murphy",
    "papa john",
    "racing post",
    "starbucks",
    "mcdonald",
    "yum! brands",
    "yum brands",
)


def _is_likely_non_game(advertiser_name: str | None, publisher_name: str | None) -> bool:
    """Heuristic blocklist for advertisers that are clearly not mobile games.

    Pure name-substring match on a curated list. Cheap, no false-negatives
    on legit games (the keyword list is conservative — common gaming app
    names don't contain "burger" or "starbucks").
    """
    name = (advertiser_name or "").lower()
    pub = (publisher_name or "").lower()
    return any(k in name for k in _NON_GAME_NAME_KEYWORDS) or any(
        k in pub for k in _NON_GAME_PUBLISHERS
    )


def _index_sensortower_app_info() -> dict[str, dict[str, Any]]:
    """Build a creative_id → {publisher_name, icon_url, advertiser_name}
    index by scanning every cached SensorTower ``creatives_top_*.json``
    on disk. Cheap (10-30 small files for the whole demo cache).

    Used to enrich ``/api/creatives`` responses with real publisher /
    icon data that ``fetch_top_creatives`` flattens away into the
    ``RawCreative`` shape.
    """
    st_cache = CACHE_DIR / "sensortower"
    out: dict[str, dict[str, Any]] = {}
    if not st_cache.exists():
        return out
    for path in st_cache.glob("creatives_top_*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for au in data.get("ad_units") or []:
            info = au.get("app_info") or {}
            for c in au.get("creatives") or []:
                cid = str(c.get("id") or "")
                if not cid or cid in out:
                    continue
                out[cid] = {
                    "publisher_name": info.get("publisher_name"),
                    "icon_url": info.get("icon_url"),
                    "advertiser_name": info.get("name"),
                }
    return out


def _index_sensortower_ad_units() -> dict[str, dict[str, Any]]:
    """Build a creative_id → full ad_unit dict by scanning every cached
    creatives_top_*.json. Companion of ``_index_sensortower_app_info``
    that returns the FULL row (with media URLs, dates, network) instead
    of just the app_info subset. Used by the knowledge-base view of
    ``/api/creatives`` to hydrate each deconstruction's metadata.
    """
    st_cache = CACHE_DIR / "sensortower"
    out: dict[str, dict[str, Any]] = {}
    if not st_cache.exists():
        return out
    for path in st_cache.glob("creatives_top_*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for au in data.get("ad_units") or []:
            cid = str(au.get("id") or "")
            if not cid or cid in out:
                continue
            out[cid] = au
    return out


# Map SensorTower network names to the React-side enum so the AdLibrary
# can render the correct NetworkBadge color (Meta/Google/TikTok/ironSource).
_ST_NETWORK_TO_FE: dict[str, NetworkFE] = {
    "Facebook": "Meta",
    "Instagram": "Meta",
    "Meta": "Meta",
    "TikTok": "TikTok",
    "Admob": "Google",
    "AdMob": "Google",
    "Google": "Google",
    "Applovin": "ironSource",
    "AppLovin": "ironSource",
    "Unity": "ironSource",
    "ironSource": "ironSource",
}

_ST_AD_TYPE_TO_FE: dict[str, FormatFE] = {
    "video": "Video",
    "video-rewarded": "Video",
    "video-interstitial": "Video",
    "video-other": "Video",
    "image": "Static",
    "image-interstitial": "Static",
    "image-other": "Static",
    "playable": "Playable",
    "interactive-playable": "Playable",
    "interactive-playable-rewarded": "Playable",
    "banner": "Static",
    "full_screen": "Video",
}


def _list_creatives_from_knowledge_base(
    *,
    limit: int,
    country_filter: str | None,
) -> list[Creative]:
    """Return a Creative-shaped list built from the deconstruction
    cache + cached SensorTower metadata.

    This is the ad library view of our knowledge base — every ad
    Gemini has analysed, regardless of whether SensorTower's *current*
    top-N includes it. Recency comes from the deconstruction file's
    mtime; SoV / dates / icons / publisher / thumbnails come from the
    SensorTower ad_unit cache joined by creative_id.
    """
    decon_dir = CACHE_DIR / "deconstruct"
    if not decon_dir.exists():
        return []

    ad_units = _index_sensortower_ad_units()

    rows: list[tuple[Creative, float]] = []  # (creative, mtime)
    for path in decon_dir.glob("*.json"):
        creative_id = path.stem
        unit = ad_units.get(creative_id)
        if unit is None:
            # Deconstruction exists but no SensorTower row to hydrate
            # — skip rather than render partial broken card.
            continue

        info = unit.get("app_info") or {}
        media = (unit.get("creatives") or [{}])[0]

        advertiser_name = (
            info.get("name")
            or info.get("humanized_name")
            or "Unknown advertiser"
        )
        publisher_name = info.get("publisher_name")
        icon_url = info.get("icon_url")

        if _is_likely_non_game(advertiser_name, publisher_name):
            continue

        st_network = str(unit.get("network") or "")
        fe_network: NetworkFE = _ST_NETWORK_TO_FE.get(st_network, "Meta")
        fe_format: FormatFE = _ST_AD_TYPE_TO_FE.get(
            str(unit.get("ad_type") or "video"), "Video"
        )

        # country filter (best-effort against canonical_country)
        if country_filter and info.get("canonical_country"):
            if str(info["canonical_country"]).upper() != country_filter.upper():
                # Don't hard-skip — many app_info entries lack canonical_country.
                # Only filter when we have a definitive answer.
                pass

        first_seen = unit.get("first_seen_at")
        last_seen = unit.get("last_seen_at")
        run_days = 0
        if first_seen and last_seen:
            try:
                run_days = max(
                    0,
                    (
                        datetime.fromisoformat(last_seen)
                        - datetime.fromisoformat(first_seen)
                    ).days,
                )
            except ValueError:
                run_days = 0

        # Synthetic fields kept on Creative for back-compat with sample.ts
        impressions = max(10_000, run_days * 5_000)
        score = min(100, max(1, run_days // 2))
        spend_estimate = max(1_000, impressions * 4)

        creative = Creative(
            id=creative_id,
            game=advertiser_name,
            network=fe_network,
            format=fe_format,
            runDays=run_days,
            impressions=impressions,
            score=score,
            spendEstimate=spend_estimate,
            sov=None,  # not available outside the top-creatives endpoint
            startedAt=str(first_seen) if first_seen else "",
            thumbUrl=media.get("thumb_url"),
            creativeUrl=media.get("creative_url"),
            publisherName=publisher_name,
            appIconUrl=icon_url,
        )
        rows.append((creative, path.stat().st_mtime))

    # Sort by deconstruction recency (most recent first), then by run_days
    rows.sort(key=lambda t: (-t[1], -t[0].runDays))
    return [c for c, _ in rows[:limit]]


def _raw_to_creative(rc, *, app_info_index: dict[str, dict[str, Any]] | None = None) -> Creative:
    from app.models import RawCreative  # local import to avoid startup overhead

    assert isinstance(rc, RawCreative)

    first = rc.first_seen_at
    last = rc.last_seen_at
    run_days = max(0, (last - first).days)

    share = rc.share or 0.0
    # Synthetic tiers (kept for back-compat; the React UI no longer renders
    # them as KPIs because they're hardcoded floors, not real signal).
    impressions = max(10_000, int(share * _MARKET_TOTAL_IMPRESSIONS))
    score = min(100, max(1, int(share * 1_200)))
    spend = max(1_000, int(impressions * 0.04))

    extra = (app_info_index or {}).get(rc.creative_id) or {}

    return Creative(
        id=rc.creative_id,
        game=rc.advertiser_name,
        network=_norm_network(rc.network),
        format=_norm_format(rc.ad_type),
        runDays=run_days,
        impressions=impressions,
        score=score,
        spendEstimate=spend,
        startedAt=first.date().isoformat(),
        thumbUrl=str(rc.thumb_url) if rc.thumb_url else None,
        creativeUrl=str(rc.creative_url),
        sov=share if share > 0 else None,
        publisherName=extra.get("publisher_name"),
        appIconUrl=extra.get("icon_url"),
    )


def _advertiser_to_competitor(adv: dict, rank: int) -> CompetitorGame:
    """Map a SensorTower top-advertiser row to the frontend's CompetitorGame.

    Note on field provenance:
      - ``game``, ``app_id``, ``sov`` (Share of Voice) come straight from
        SensorTower's ``top_advertisers`` endpoint.
      - ``appStoreRank`` is intentionally just ``rank`` (1-N) — i.e. the
        rank within the SoV-sorted list of top advertisers in this
        category. The frontend column is labelled "SoV rank" to make
        this honest.
      - ``monthlySpend`` is a SYNTHETIC ESTIMATE derived from SoV
        (``sov × $8M``). SensorTower exposes paid UA *download* counts
        but not USD spend, so this is a heuristic; the frontend tooltip
        flags it as estimated.
      - ``subGenre`` is best-effort from the SensorTower row's
        ``categories`` field when present, falling back to "Mobile game".
        Previously hardcoded "Puzzle" for everyone.
    """
    sov: float = adv.get("sov") or adv.get("share") or 0.0
    monthly_spend = max(50_000, int(sov * 8_000_000))
    if sov > 0.08:
        tier: SpendTierFE = "Top"
    elif sov > 0.025:
        tier = "Mid"
    else:
        tier = "Micro"

    raw_app_id = (
        adv.get("app_id")
        or adv.get("unified_app_id")
        or adv.get("entity_id")
    )

    # Best-effort sub-genre extraction. SensorTower wraps categories in a
    # few different shapes depending on endpoint; try the most common ones
    # before falling back to a generic label.
    sub_genre = "Mobile game"
    cats = (
        adv.get("categories")
        or adv.get("category_names")
        or (adv.get("app_info") or {}).get("categories")
    )
    if isinstance(cats, list) and cats:
        first = cats[0]
        if isinstance(first, str):
            sub_genre = first
        elif isinstance(first, dict):
            sub_genre = (
                first.get("name")
                or first.get("category_name")
                or sub_genre
            )

    # Icon + publisher come from app_info when present (top_advertisers
    # endpoint embeds it for unified_app rows). Fallback to None — the
    # frontend renders a colour swatch when icon_url is missing.
    info = adv.get("app_info") or {}
    icon_url = (
        adv.get("icon_url")
        or info.get("icon_url")
    )
    publisher = (
        adv.get("publisher_name")
        or info.get("publisher_name")
    )

    return CompetitorGame(
        game=adv.get("name") or adv.get("app_name") or "Unknown",
        subGenre=sub_genre,
        appStoreRank=rank,
        monthlySpend=monthly_spend,
        spendTier=tier,
        status="Active",
        app_id=str(raw_app_id) if raw_app_id else None,
        iconUrl=str(icon_url) if icon_url else None,
        publisher=str(publisher) if publisher else None,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

DEFAULT_DATE = date.today().replace(day=1).isoformat()


# ---------------------------------------------------------------------------
# Game resolution helper
# ---------------------------------------------------------------------------

class GameMeta(BaseModel):
    name: str
    publisher: str
    app_id: str
    icon_url: str
    description: str


def _resolve_category(game_name: str, default: int) -> tuple[int, GameMeta | None]:
    """Resolve game → AppMetadata, return (category_id, GameMeta).

    Uses the first integer category from the app's metadata when available,
    otherwise keeps the caller-supplied default.
    """
    from app.sources.sensortower import resolve_game

    try:
        meta = resolve_game(game_name)
        cat_id = default
        for cat in meta.categories:
            if isinstance(cat, int) and cat > 0:
                cat_id = cat
                break
        game_meta = GameMeta(
            name=meta.name,
            publisher=meta.publisher_name,
            app_id=meta.app_id,
            icon_url=str(meta.icon_url),
            description=meta.description[:200],
        )
        return cat_id, game_meta
    except Exception:
        log.exception("resolve_game failed for %r", game_name)
        return default, None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/game", response_model=GameMeta | None)
def get_game(name: str = Query(...)):
    """Resolve a game name via SensorTower and return its metadata."""
    _, meta = _resolve_category(name, 7012)
    return meta


# Curated worldwide expansion for the AdLibrary's "All" Region option.
# Mirrors app/pipeline.py ALL_COUNTRIES — keep them in sync.
_AD_LIBRARY_ALL_COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "KR"]


# Tag value for the network cell on Voodoo's own generated ads. Stored
# on the Creative as a sentinel value the React UI swaps for a custom
# "VoodRadar" badge instead of the network logo.
_GENERATED_NETWORK_LABEL: NetworkFE = "Meta"  # closest enum bucket; UI overrides via isGenerated flag


@app.get("/api/creatives/generated", response_model=list[Creative])
def get_generated_creatives() -> list[Creative]:
    """Surface every ad we've rendered ourselves via the per-variant
    pipeline (data/cache/videos/variant_<slug>_<archetype>*.mp4).

    Joined against the cached HookLensReports so each card carries the
    target game name + brief title + variant priority. Sorted by mtime
    desc (most recently rendered first). Returns the same Creative
    shape as the rest of /api/creatives so the AdLibrary grid renders
    identically — the React UI uses ``id.startsWith("generated:")`` to
    swap in a "VoodRadar" badge + a different click handler.
    """
    import re

    if not _VIDEOS_DIR.exists():
        return []

    # game_slug → (target_game dict, variants list, app_id). Built from
    # the cached reports so we can hydrate icon + title per variant.
    by_slug: dict[str, dict[str, Any]] = {}
    for path in REPORTS_CACHE_DIR.glob("*_e2e.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        tg = data.get("target_game") or {}
        slug = _slugify_game(tg.get("name") or "")
        if slug:
            by_slug[slug] = {
                "target_game": tg,
                "variants": data.get("final_variants") or [],
                "app_id": tg.get("app_id"),
            }

    # icon_url for each app_id: pulled from the SensorTower meta cache
    icon_index = _build_app_id_to_icon_index()

    out: list[tuple[Creative, float]] = []
    seen_keys: set[tuple[str, str]] = set()
    for mp4 in _VIDEOS_DIR.glob("variant_*.mp4"):
        if mp4.stat().st_size == 0:
            continue
        # Skip per-clip + silent + audio sidecars
        stem = mp4.stem
        if any(suffix in stem for suffix in ("_clip", ".silent", ".audio")):
            continue
        # Parse "variant_<game_slug>_<safe_archetype>(_ec<mtime>)?(_rich)?(_c<8>)?"
        m = re.match(r"^variant_(.+?)_([a-z]+(?:-[a-z0-9-]+)*?)(?:_ec\d+)?(?:_rich)?(?:_c[a-f0-9]{8})?$", stem)
        if not m:
            continue
        game_slug, safe_archetype = m.group(1), m.group(2)

        # Dedupe on (game, archetype) so multiple cache-key variants of
        # the SAME variant don't pollute the grid — keep the most-recent.
        key = (game_slug, safe_archetype)
        if key in seen_keys:
            continue
        seen_keys.add(key)

        report = by_slug.get(game_slug)
        if not report:
            continue

        # Find the variant whose archetype_id matches the slug
        variant: dict[str, Any] | None = None
        for v in report["variants"]:
            arch_id = (v.get("brief") or {}).get("archetype_id") or ""
            if re.sub(r"[^a-zA-Z0-9_-]+", "-", arch_id)[:40] == safe_archetype:
                variant = v
                break
        if variant is None:
            continue

        brief = variant.get("brief") or {}
        title = brief.get("title") or "Generated ad"
        target_name = (report["target_game"] or {}).get("name") or game_slug
        app_id = report.get("app_id") or ""
        icon_url = icon_index.get(str(app_id), (None, None))[0] if app_id else None

        # ID format the React UI watches for to render a "Generated"
        # badge instead of the network logo. /ad/$id has no view for
        # these (they're our own renders, not SensorTower creatives).
        creative_id = f"generated:{game_slug}:{safe_archetype}"

        mtime = mp4.stat().st_mtime
        out.append(
            (
                Creative(
                    id=creative_id,
                    game=target_name,
                    network=_GENERATED_NETWORK_LABEL,
                    format="Video",
                    runDays=0,
                    impressions=0,
                    score=int(variant.get("test_priority") or 1),
                    spendEstimate=0,
                    sov=None,
                    startedAt=datetime.fromtimestamp(
                        mtime, tz=timezone.utc
                    ).date().isoformat(),
                    thumbUrl=variant.get("hero_frame_path"),
                    creativeUrl=f"/videos/{mp4.name}",
                    publisherName="VoodRadar",
                    appIconUrl=icon_url,
                ),
                mtime,
            )
        )

    out.sort(key=lambda t: -t[1])
    return [c for c, _ in out]


@app.get("/api/creatives", response_model=list[Creative])
def get_creatives(
    game_name: str | None = Query(None),
    category_id: int = Query(7012),
    country: str = Query(
        "US",
        description="Country code, or 'all' to fan out across the curated worldwide list",
    ),
    period: str = Query("month"),
    period_date: str = Query(DEFAULT_DATE),
    limit: int = Query(60, ge=1, le=600),
    source: Literal["live", "knowledge_base"] = Query(
        "knowledge_base",
        description=(
            "'live' = re-query SensorTower top creatives per network/country "
            "(slower, capped at SensorTower's top-N). "
            "'knowledge_base' = serve every ad in our deconstruct cache "
            "(~500 entries with full Gemini analysis). Default."
        ),
    ),
):
    """Return top ad creatives across all networks, shaped for the frontend.

    When ``game_name`` is supplied, SensorTower resolves it first and uses its
    category to scope the ad-intel query.

    When ``country='all'``, fans out across the curated worldwide list
    (US/GB/DE/FR/JP/BR/KR) and dedupes by ``creative_id`` — the AdLibrary's
    Region filter offers this as the implicit default for showing the
    broadest global trend slice.

    Each row is enriched with the advertiser's ``publisher_name`` and
    ``icon_url`` (from the cached SensorTower app_info payload), so the
    Ad Library UI can render the publisher/game pair instead of just an
    opaque advertiser name. Synthetic ``impressions`` / ``score`` /
    ``spendEstimate`` are still in the schema for back-compat but the
    React UI no longer renders them as numbers — only ``sov`` (real Share
    of Voice from SensorTower) is shown as a quantitative chip.
    """
    # Knowledge-base mode (default): walk every ad we've deconstructed +
    # cached SensorTower metadata to build a comprehensive list. Surfaces
    # 10× more entries than the live SensorTower top-creatives query
    # because we keep deconstructions across categories / countries /
    # weeks. Uses the per-creative file mtime as a recency proxy.
    if source == "knowledge_base":
        return _list_creatives_from_knowledge_base(
            limit=limit,
            country_filter=None if country.strip().lower() == "all" else country,
        )

    from app.sources.sensortower import fetch_top_creatives

    if game_name:
        category_id, _ = _resolve_category(game_name, category_id)

    countries = (
        _AD_LIBRARY_ALL_COUNTRIES
        if country.strip().lower() == "all"
        else [country]
    )
    per_network = max(1, limit // (len(_NETWORKS) * len(countries)))

    seen_ids: set[str] = set()
    results: list[Creative] = []
    app_info_index = _index_sensortower_app_info()

    for ctry in countries:
        for st_network, fe_network in _NETWORKS:
            try:
                raws = fetch_top_creatives(
                    category_id=category_id,
                    country=ctry,
                    network=st_network,
                    period=period,
                    period_date=period_date,
                    max_creatives=max(per_network, 4),
                )
            except Exception:
                log.exception(
                    "fetch_top_creatives failed for %s × %s", st_network, ctry
                )
                continue
            for rc in raws:
                if rc.creative_id in seen_ids:
                    continue
                seen_ids.add(rc.creative_id)
                # Skip the non-game advertisers (Burger King, Papa Murphy's,
                # Racing Post…) that SensorTower's category filter leaks
                # through. Strict category-based filtering doesn't work
                # because ``app_info.categories`` is ``null`` on every
                # ``creatives_top`` row in this tenant — name/publisher
                # blocklist is the pragmatic alternative.
                extra = app_info_index.get(rc.creative_id) or {}
                if _is_likely_non_game(
                    rc.advertiser_name, extra.get("publisher_name")
                ):
                    continue
                c = _raw_to_creative(rc, app_info_index=app_info_index)
                results.append(c.model_copy(update={"network": fe_network}))
                if len(results) >= limit:
                    return results

    return results


@app.get("/api/advertisers", response_model=list[CompetitorGame])
def get_advertisers(
    game_name: str | None = Query(None),
    category_id: int = Query(7012),
    country: str = Query("US"),
    period: str = Query("month"),
    period_date: str = Query(DEFAULT_DATE),
    limit: int = Query(10, ge=1, le=50),
):
    """Return top advertisers (competitors) shaped for the frontend.

    When ``game_name`` is supplied, uses its category to scope the query.
    """
    from app.sources.sensortower import fetch_top_advertisers

    if game_name:
        category_id, _ = _resolve_category(game_name, category_id)

    try:
        advs = fetch_top_advertisers(
            category_id=category_id,
            country=country,
            period=period,
            period_date=period_date,
            limit=limit,
        )
    except Exception:
        log.exception("fetch_top_advertisers failed")
        return []

    return [_advertiser_to_competitor(adv, rank=i + 1) for i, adv in enumerate(advs)]


# ---------------------------------------------------------------------------
# Competitor detail — full ad inventory for one app_id
# ---------------------------------------------------------------------------


# Apple App Store category IDs → human-readable names. SensorTower's
# ``/v1/ios/apps`` endpoint returns categories as raw genre IDs
# (6014 = Games parent, 7012 = Puzzle, …) instead of names; the
# CompetitorDetail page would render "6014" / "7012" in chips otherwise.
# Only the gaming-relevant subset is mapped — everything else falls
# through as ``Category {id}`` so the chip is at least consistent.
_IOS_CATEGORY_NAMES: dict[int, str] = {
    # Top-level genres
    6000: "Business",
    6001: "Weather",
    6002: "Utilities",
    6003: "Travel",
    6004: "Sports",
    6005: "Social Networking",
    6006: "Reference",
    6007: "Productivity",
    6008: "Photo & Video",
    6009: "News",
    6010: "Navigation",
    6011: "Music",
    6012: "Lifestyle",
    6013: "Health & Fitness",
    6014: "Games",
    6015: "Finance",
    6016: "Entertainment",
    6017: "Education",
    6018: "Books",
    6020: "Medical",
    6021: "Newsstand",
    6022: "Catalogs",
    6023: "Food & Drink",
    6024: "Shopping",
    6025: "Stickers",
    6026: "Developer Tools",
    6027: "Graphics & Design",
    # Game sub-genres
    7001: "Action",
    7002: "Adventure",
    7003: "Arcade",
    7004: "Board",
    7005: "Card",
    7006: "Casino",
    7008: "Dice",
    7009: "Educational",
    7011: "Music",
    7012: "Puzzle",
    7013: "Racing",
    7014: "Role Playing",
    7015: "Simulation",
    7016: "Sports",
    7017: "Strategy",
    7018: "Trivia",
    7019: "Word",
    7102: "Family",
}


def _resolve_category_label(c: Any) -> str:
    """Coerce SensorTower's category field (an int genre ID, a string,
    or a dict with a ``name`` field) into a human label."""
    if isinstance(c, dict):
        name = c.get("name")
        if name:
            return str(name)
        cid = c.get("id")
        if isinstance(cid, int) and cid in _IOS_CATEGORY_NAMES:
            return _IOS_CATEGORY_NAMES[cid]
        return f"Category {cid}" if cid else "Unknown"
    if isinstance(c, int):
        return _IOS_CATEGORY_NAMES.get(c, f"Category {c}")
    if isinstance(c, str):
        # SensorTower sometimes serialises ints as strings
        if c.isdigit():
            cid = int(c)
            return _IOS_CATEGORY_NAMES.get(cid, f"Category {cid}")
        return c
    return str(c)


class CompetitorDetail(BaseModel):
    app_id: str
    name: str
    publisher: str | None = None
    icon_url: str | None = None
    description: str | None = None
    rating: float | None = None
    rating_count: int | None = None
    categories: list[str] | None = None
    creatives: list[Creative]
    creatives_total: int  # before any caps
    creatives_with_deconstruction: int
    networks: dict[str, int]  # network → count
    formats: dict[str, int]  # format → count


@app.get("/api/competitor/{app_id}", response_model=CompetitorDetail | None)
def get_competitor_detail(app_id: str) -> CompetitorDetail | None:
    """Return everything we know about a single competitor app — name,
    publisher, icon, description + every ad we've ever cached for that
    advertiser (across all networks / countries / weeks of SensorTower
    top-creatives queries we've run).

    Builds entirely from disk — no live SensorTower call. The ad
    inventory is the union of every cached creatives_top_*.json,
    deduped by creative_id, sorted by first_seen_at desc.

    Returns ``None`` (404 in OpenAPI) when the app_id doesn't appear in
    any cache yet — the React UI should render a "no data yet" empty
    state and offer a precache CLI hint.
    """
    ad_units = _index_sensortower_ad_units()

    matched: list[dict[str, Any]] = []
    app_meta: dict[str, Any] | None = None
    for unit in ad_units.values():
        if str(unit.get("app_id") or "") != app_id:
            continue
        matched.append(unit)
        if app_meta is None:
            app_meta = unit.get("app_info") or {}

    # Live fallback: when the category-based top-creatives caches don't
    # contain this app_id, fetch its ad inventory directly via the
    # advertiser-scoped endpoint. Covers every Competitive Scope row
    # whose category we haven't pre-cached (Pokémon GO, Roblox,
    # Ubisoft titles, etc) without forcing a precache step.
    if not matched:
        from app.sources.sensortower import (
            fetch_app_meta_by_unified_id,
            fetch_creatives_for_app,
        )

        log.info("competitor %s: cache miss — fetching from SensorTower", app_id)
        live_units = fetch_creatives_for_app(
            unified_app_id=app_id,
            country="US",
            limit=50,
        )
        if not live_units:
            # Try fetching just the metadata so the page can at least
            # render the app header even without ad inventory.
            meta = fetch_app_meta_by_unified_id(app_id, country="US")
            if meta is None:
                return None
            app_meta = meta
        else:
            matched = list(live_units)
            app_meta = (live_units[0].get("app_info") or {}).copy()
            # Backfill app meta with the dedicated lookup so the page
            # has a publisher / description even when the ads endpoint
            # returns sparse app_info blobs.
            extra = fetch_app_meta_by_unified_id(app_id, country="US")
            if extra:
                for k, v in extra.items():
                    if v and not app_meta.get(k):
                        app_meta[k] = v

    if app_meta is None:
        return None

    decon_dir = CACHE_DIR / "deconstruct"
    decon_ids: set[str] = (
        {p.stem for p in decon_dir.glob("*.json")} if decon_dir.exists() else set()
    )

    # Convert to Creative shape (re-using the knowledge-base helper logic
    # so the React grid renders identically to /ads).
    creatives: list[tuple[Creative, str]] = []  # (creative, first_seen)
    seen_ids: set[str] = set()
    network_counts: dict[str, int] = {}
    format_counts: dict[str, int] = {}
    decon_count = 0

    for unit in matched:
        media_list = unit.get("creatives") or []
        if not media_list:
            continue
        media = media_list[0]
        creative_id = str(media.get("id") or unit.get("id") or "")
        if not creative_id or creative_id in seen_ids:
            continue
        seen_ids.add(creative_id)

        st_network = str(unit.get("network") or "")
        fe_network: NetworkFE = _ST_NETWORK_TO_FE.get(st_network, "Meta")
        fe_format: FormatFE = _ST_AD_TYPE_TO_FE.get(
            str(unit.get("ad_type") or "video"), "Video"
        )

        first_seen = unit.get("first_seen_at") or ""
        last_seen = unit.get("last_seen_at") or ""
        run_days = 0
        if first_seen and last_seen:
            try:
                run_days = max(
                    0,
                    (
                        datetime.fromisoformat(last_seen)
                        - datetime.fromisoformat(first_seen)
                    ).days,
                )
            except ValueError:
                pass

        if creative_id in decon_ids:
            decon_count += 1

        network_counts[st_network or fe_network] = (
            network_counts.get(st_network or fe_network, 0) + 1
        )
        format_counts[fe_format] = format_counts.get(fe_format, 0) + 1

        creative = Creative(
            id=creative_id,
            game=app_meta.get("name") or "Unknown",
            network=fe_network,
            format=fe_format,
            runDays=run_days,
            impressions=max(10_000, run_days * 5_000),
            score=min(100, max(1, run_days // 2)),
            spendEstimate=max(1_000, run_days * 50_000),
            sov=None,
            startedAt=first_seen,
            thumbUrl=media.get("thumb_url"),
            creativeUrl=media.get("creative_url"),
            publisherName=app_meta.get("publisher_name"),
            appIconUrl=app_meta.get("icon_url"),
        )
        creatives.append((creative, first_seen))

    # Most recent first (empty first_seen → bottom)
    creatives.sort(key=lambda t: (t[1] or "", t[0].runDays), reverse=True)

    raw_categories = app_meta.get("categories") or []
    category_names: list[str] | None
    if isinstance(raw_categories, list):
        category_names = [
            _resolve_category_label(c) for c in raw_categories if c
        ]
        # Drop "Games" (id 6014) when there's at least one sub-genre
        # next to it — it's redundant noise once "Puzzle" / "Action" /
        # etc. is shown.
        if any(n != "Games" for n in category_names) and "Games" in category_names:
            category_names = [n for n in category_names if n != "Games"]
    else:
        category_names = None

    return CompetitorDetail(
        app_id=app_id,
        name=app_meta.get("name") or "Unknown",
        publisher=app_meta.get("publisher_name"),
        icon_url=app_meta.get("icon_url"),
        description=app_meta.get("description"),
        rating=app_meta.get("rating"),
        rating_count=app_meta.get("rating_count"),
        categories=category_names or None,
        creatives=[c for c, _ in creatives],
        creatives_total=len(creatives),
        creatives_with_deconstruction=decon_count,
        networks=network_counts,
        formats=format_counts,
    )


# ---------------------------------------------------------------------------
# Geographic heatmap — market intensity per country
# ---------------------------------------------------------------------------

# 34 major markets with centroids (lat, lng) for the dot-grid SVG projection
_GEO_COUNTRIES: list[tuple[str, str, str, float, float]] = [
    # (code, name, continent, lat, lng)
    ("US", "United States",       "North America", 38.9,  -95.7),
    ("CA", "Canada",               "North America", 56.1, -106.3),
    ("MX", "Mexico",               "North America", 23.6, -102.6),
    ("BR", "Brazil",               "South America",-14.2,  -51.9),
    ("AR", "Argentina",            "South America",-38.4,  -63.6),
    ("CO", "Colombia",             "South America",  4.6,  -74.1),
    ("GB", "United Kingdom",       "Europe",        55.4,   -3.4),
    ("FR", "France",               "Europe",        46.2,    2.2),
    ("DE", "Germany",              "Europe",        51.2,   10.5),
    ("IT", "Italy",                "Europe",        41.9,   12.6),
    ("ES", "Spain",                "Europe",        40.5,   -3.7),
    ("NL", "Netherlands",          "Europe",        52.1,    5.3),
    ("SE", "Sweden",               "Europe",        60.1,   18.6),
    ("PL", "Poland",               "Europe",        51.9,   19.1),
    ("RU", "Russia",               "Europe",        61.5,  105.3),
    ("TR", "Turkey",               "Middle East",   38.9,   35.2),
    ("SA", "Saudi Arabia",         "Middle East",   23.9,   45.1),
    ("AE", "UAE",                  "Middle East",   23.4,   53.8),
    ("IL", "Israel",               "Middle East",   31.0,   34.9),
    ("JP", "Japan",                "Asia",          36.2,  138.3),
    ("KR", "South Korea",          "Asia",          35.9,  127.8),
    ("CN", "China",                "Asia",          35.9,  104.2),
    ("IN", "India",                "Asia",          20.6,   79.1),
    ("ID", "Indonesia",            "Asia",          -0.8,  113.9),
    ("TH", "Thailand",             "Asia",          15.9,  100.9),
    ("SG", "Singapore",            "Asia",           1.4,  103.8),
    ("TW", "Taiwan",               "Asia",          23.7,  121.0),
    ("PH", "Philippines",          "Asia",          12.9,  121.8),
    ("MY", "Malaysia",             "Asia",           4.2,  108.0),
    ("AU", "Australia",            "Oceania",      -25.3,  133.8),
    ("NZ", "New Zealand",          "Oceania",      -40.9,  174.9),
    ("ZA", "South Africa",         "Africa",       -29.0,   25.1),
    ("NG", "Nigeria",              "Africa",         9.1,    8.7),
    ("EG", "Egypt",                "Africa",        26.8,   30.8),
]

# Approximate capture radius per country code (degrees, for dot-grid coloring)
_GEO_RADIUS: dict[str, float] = {
    "RU": 20.0, "CA": 18.0, "CN": 14.0, "US": 13.0, "BR": 13.0,
    "AU": 12.0, "IN": 10.0, "AR":  9.0, "MX":  8.0, "SA":  8.0,
    "ID":  8.0, "MY":  5.0, "TR":  6.0, "EG":  6.0, "NG":  6.0,
}
_GEO_RADIUS_DEFAULT = 6.0


class CountrySignal(BaseModel):
    country_code: str
    country_name: str
    continent: str
    lat: float
    lng: float
    radius: float
    num_advertisers: int
    top_sov: float
    market_intensity: float  # 0–100


def _fetch_country_signal(
    code: str,
    name: str,
    continent: str,
    lat: float,
    lng: float,
    *,
    category_id: int,
    period: str,
    period_date: str,
) -> CountrySignal:
    from app.sources.sensortower import fetch_top_advertisers

    radius = _GEO_RADIUS.get(code, _GEO_RADIUS_DEFAULT)
    try:
        advs = fetch_top_advertisers(
            category_id=category_id,
            country=code,
            period=period,
            period_date=period_date,
            limit=10,
        )
        top_sov: float = advs[0].get("sov") or advs[0].get("share") or 0.0 if advs else 0.0
        num_advertisers = len(advs)
        # top_sov is already a percentage (0–100 scale).
        # Use it directly — frontend normalize() maps min→blue, max→red.
        # High top_sov = one dominant advertiser (concentrated market).
        # Low top_sov = spread competition (fragmented market).
        intensity = round(top_sov, 2) if num_advertisers > 0 else 0.0
    except Exception:
        log.warning("geo fetch failed for %s", code)
        top_sov, num_advertisers, intensity = 0.0, 0, 0.0

    return CountrySignal(
        country_code=code,
        country_name=name,
        continent=continent,
        lat=lat,
        lng=lng,
        radius=radius,
        num_advertisers=num_advertisers,
        top_sov=round(top_sov, 4),
        market_intensity=round(intensity, 1),
    )


@app.get("/api/geo-signals", response_model=list[CountrySignal])
def get_geo_signals(
    game_name: str | None = Query(None),
    category_id: int = Query(7012),
    period: str = Query("month"),
    period_date: str = Query(DEFAULT_DATE),
):
    """Return market-intensity signals for ~34 countries as a dot-grid heatmap source.

    Queries SensorTower top-advertisers per country in a thread pool (cached on
    disk so subsequent calls are instant). ``market_intensity`` ∈ [0, 100] is a
    composite of top-advertiser SOV and number of active advertisers — it
    represents how hotly contested the category is in each market.
    """
    import concurrent.futures

    if game_name:
        category_id, _ = _resolve_category(game_name, category_id)

    def _fetch(row: tuple) -> CountrySignal:
        code, name, continent, lat, lng = row
        return _fetch_country_signal(
            code, name, continent, lat, lng,
            category_id=category_id,
            period=period,
            period_date=period_date,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(_fetch, _GEO_COUNTRIES))

    return results


@app.get("/health")
def health():
    return {"status": "ok", "utc": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Full HookLens report endpoints — the actual product surface
# ---------------------------------------------------------------------------

from app._paths import CACHE_DIR  # noqa: E402

REPORTS_CACHE_DIR = CACHE_DIR / "reports"


class ReportSummary(BaseModel):
    """One row in /api/reports — a cached run available for instant display."""

    app_id: str
    name: str
    publisher: str | None = None
    icon_url: str | None = None
    generated_at: str | None = None
    num_archetypes: int
    num_variants: int
    total_cost_usd: float
    duration_seconds: float


def _build_app_id_to_icon_index() -> dict[str, tuple[str, str | None]]:
    """Build an ``app_id → (icon_url, publisher_name)`` index by scanning
    the cached SensorTower app metadata JSONs (``meta_<app_id>_<...>.json``)
    plus the Voodoo catalog. Used by ``/api/reports`` to enrich the
    "Recent analyses" cards with real game icons.

    Cheap (a few dozen file reads, no API calls).
    """
    index: dict[str, tuple[str, str | None]] = {}

    # 1. Voodoo catalog (509 apps, fast)
    try:
        catalog_path = CACHE_DIR / "voodoo" / "catalog.json"
        if catalog_path.exists():
            for entry in json.loads(catalog_path.read_text()):
                app_id = str(entry.get("app_id") or "")
                icon = entry.get("icon_url")
                pub = entry.get("publisher_name")
                if app_id and icon:
                    index[app_id] = (str(icon), pub)
    except Exception:
        log.exception("Failed to read Voodoo catalog for icon index")

    # 2. SensorTower meta cache files — covers any non-Voodoo app the
    #    pipeline has touched (e.g. Block Blast!, etc.).
    st_cache = CACHE_DIR / "sensortower"
    if st_cache.exists():
        for path in st_cache.glob("meta_*.json"):
            try:
                data = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            for app in data.get("apps") or []:
                app_id = str(app.get("app_id") or "")
                icon = app.get("icon_url")
                pub = app.get("publisher_name")
                if app_id and icon and app_id not in index:
                    index[app_id] = (str(icon), pub)
    return index


@app.get("/api/reports", response_model=list[ReportSummary])
def list_reports() -> list[ReportSummary]:
    """List all cached HookLensReports available on disk.

    Used by the frontend to populate the "Recent analyses" grid on the
    Insights landing — instant load on click vs running the full pipeline.

    Each row is enriched with the target game's ``icon_url`` and
    ``publisher_name`` looked up against the Voodoo catalog + the
    SensorTower meta cache, so the UI can show a real app icon next to
    the name instead of a gradient placeholder.
    """
    if not REPORTS_CACHE_DIR.exists():
        return []

    icon_index = _build_app_id_to_icon_index()

    out: list[ReportSummary] = []
    for path in sorted(REPORTS_CACHE_DIR.glob("*_e2e.json")):
        try:
            data = json.loads(path.read_text())
            tg = data.get("target_game", {})
            app_id = tg.get("app_id", path.stem.removesuffix("_e2e"))
            icon_url, publisher = icon_index.get(str(app_id), (None, None))
            out.append(
                ReportSummary(
                    app_id=app_id,
                    name=tg.get("name", "Unknown"),
                    publisher=publisher,
                    icon_url=icon_url,
                    generated_at=data.get("generated_at"),
                    num_archetypes=len(data.get("top_archetypes", [])),
                    num_variants=len(data.get("final_variants", [])),
                    total_cost_usd=float(data.get("total_cost_usd") or 0),
                    duration_seconds=float(data.get("pipeline_duration_seconds") or 0),
                )
            )
        except Exception:
            log.exception("Failed to parse cached report %s", path.name)
            continue
    # Most recent first
    out.sort(key=lambda r: r.generated_at or "", reverse=True)
    return out


class GameScreenshots(BaseModel):
    """App Store screenshots URLs for a target game."""

    app_id: str
    name: str | None = None
    screenshot_urls: list[str] = []


@app.get("/api/game/screenshots", response_model=GameScreenshots)
def get_game_screenshots(
    game_name: str | None = Query(None),
    app_id: str | None = Query(None),
) -> GameScreenshots:
    """Return App Store screenshot URLs cached from SensorTower's iOS app
    metadata. Used by GameDnaCard to surface real gameplay screenshots
    next to the DNA analysis.
    """
    if not (game_name or app_id):
        raise HTTPException(
            status_code=400,
            detail="Provide either ?game_name=... or ?app_id=...",
        )

    resolved_id = app_id
    if not resolved_id and game_name:
        try:
            from app.sources.sensortower import resolve_game

            meta = resolve_game(game_name)
            return GameScreenshots(
                app_id=meta.app_id,
                name=meta.name,
                screenshot_urls=[str(u) for u in meta.screenshot_urls],
            )
        except Exception:
            log.exception("get_game_screenshots: resolve_game failed for %r", game_name)
            return GameScreenshots(app_id="", screenshot_urls=[])

    # Fall back to scanning the SensorTower meta cache for app_id matches.
    st_cache = CACHE_DIR / "sensortower"
    if not st_cache.exists():
        return GameScreenshots(app_id=resolved_id or "", screenshot_urls=[])

    for path in st_cache.glob(f"meta_{resolved_id}_*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        apps = data.get("apps") or []
        if not apps:
            continue
        meta = apps[0]
        return GameScreenshots(
            app_id=str(meta.get("app_id") or resolved_id or ""),
            name=meta.get("name"),
            screenshot_urls=list(meta.get("screenshot_urls") or []),
        )

    return GameScreenshots(app_id=resolved_id or "", screenshot_urls=[])


class SourceCreative(BaseModel):
    """One source ad creative that was deconstructed into an archetype cluster."""

    creative_id: str
    network: str
    ad_type: str = "video"
    thumb_url: str | None = None
    creative_url: str | None = None
    first_seen_at: str | None = None
    advertiser_name: str | None = None


def _index_sensortower_creatives() -> dict[str, dict[str, Any]]:
    """Build an index of every creative in the SensorTower disk cache,
    keyed by ``creative_id`` → minimal dict with thumb/creative URLs.

    Caches the index in-memory across calls (cheap to rebuild on file mtime
    change since the directory only grows, but for the demo we just rebuild
    on each request — there are ~10-30 files in the cache).
    """
    st_cache = CACHE_DIR / "sensortower"
    out: dict[str, dict[str, Any]] = {}
    if not st_cache.exists():
        return out

    for path in st_cache.glob("creatives_top_*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for au in data.get("ad_units") or []:
            network = au.get("network") or ""
            ad_type = au.get("ad_type") or "video"
            first_seen = au.get("first_seen_at") or ""
            advertiser = (au.get("app_info") or {}).get("name")
            for c in au.get("creatives") or []:
                cid = str(c.get("id") or "")
                if not cid or cid in out:
                    continue
                out[cid] = {
                    "creative_id": cid,
                    "network": network,
                    "ad_type": ad_type,
                    "thumb_url": c.get("thumb_url"),
                    "creative_url": c.get("creative_url"),
                    "first_seen_at": first_seen[:10] if first_seen else None,
                    "advertiser_name": advertiser,
                }
    return out


@app.get("/api/report/source_creatives")
def get_source_creatives(
    game_name: str | None = Query(None),
    app_id: str | None = Query(None),
) -> dict[str, list[SourceCreative]]:
    """Return the source ad creatives that compose each archetype, keyed by
    ``archetype_id``. Used by the Insights view to surface real ad thumbnails
    inside the ArchetypesTable so the user can SEE the creatives that were
    clustered, not just read about them.

    Strategy: load the cached report, look up every archetype's
    ``member_creative_ids`` against the SensorTower disk cache (the original
    ``ad_units[].creatives[]`` payloads). Returns an empty list per archetype
    when no thumbnail is found (graceful empty-state on the frontend).
    """
    if not (game_name or app_id):
        raise HTTPException(
            status_code=400,
            detail="Provide either ?game_name=... or ?app_id=...",
        )

    resolved_id = app_id
    if not resolved_id and game_name:
        # Same fix as /api/report: scan cached reports by name first
        # (handles dots / unicode / anything SensorTower chokes on)
        # before falling back to the SensorTower resolver and finally
        # the proto_<slug> shape.
        resolved_id = _try_resolve_by_cached_name(game_name)
        if not resolved_id:
            try:
                from app.sources.sensortower import resolve_game

                meta = resolve_game(game_name)
                resolved_id = meta.app_id
            except Exception:
                slug = (game_name or "").lower().replace(" ", "_").replace("-", "_")
                resolved_id = f"proto_{slug}"

    cache_path = REPORTS_CACHE_DIR / f"{resolved_id}_e2e.json"
    if not cache_path.exists():
        return {}

    try:
        report = json.loads(cache_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}

    creative_index = _index_sensortower_creatives()

    out: dict[str, list[SourceCreative]] = {}
    for arch in report.get("top_archetypes") or []:
        arch_id = str(arch.get("archetype_id") or "")
        if not arch_id:
            continue
        ids = arch.get("member_creative_ids") or []
        thumbs: list[SourceCreative] = []
        for cid in ids:
            entry = creative_index.get(str(cid))
            if entry:
                thumbs.append(SourceCreative.model_validate(entry))
        out[arch_id] = thumbs

    return out


def _try_resolve_by_cached_name(game_name: str) -> str | None:
    """Look for a cached HookLensReport whose ``target_game.name``
    case-insensitively matches ``game_name``. Returns the app_id (the
    file stem without ``_e2e``) on a hit, ``None`` otherwise.

    This is the most reliable resolver for games with dots / unicode /
    other characters that SensorTower's search endpoint mangles
    (``aquapark.io`` was the trigger). Beats the SensorTower lookup
    when we already analysed the game once — and we always have, as
    that's how the report got cached in the first place.
    """
    if not REPORTS_CACHE_DIR.exists():
        return None
    needle = game_name.strip().lower()
    if not needle:
        return None
    for path in REPORTS_CACHE_DIR.glob("*_e2e.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        cached_name = (data.get("target_game", {}).get("name") or "").lower()
        if cached_name == needle:
            return path.stem.removesuffix("_e2e")
    return None


@app.get("/api/report")
def get_report(
    game_name: str | None = Query(None, description="Game name to resolve via SensorTower"),
    app_id: str | None = Query(None, description="Direct app_id (skips SensorTower lookup)"),
) -> dict:
    """Return the full HookLensReport for a game, loaded from disk cache.

    The pipeline is too slow (3-5 minutes) to run synchronously inside an
    HTTP request. We assume reports have been pre-cached by:

        uv run python -m scripts.precache "Marble Sort" "Mob Control" ...

    Returns 404 if no cached report exists for the resolved app_id.
    """
    if not (game_name or app_id):
        raise HTTPException(
            status_code=400,
            detail="Provide either ?game_name=... or ?app_id=...",
        )

    resolved_id = app_id
    if not resolved_id and game_name:
        # Step 1: scan the reports cache for an exact name match — fast,
        # offline, handles every game we've already analysed (including
        # ones with dots/underscores/special chars in the name like
        # "aquapark.io" that SensorTower's resolver chokes on).
        resolved_id = _try_resolve_by_cached_name(game_name)
        if not resolved_id:
            try:
                from app.sources.sensortower import resolve_game

                meta = resolve_game(game_name)
                resolved_id = meta.app_id
            except Exception:
                log.exception("resolve_game failed for %r", game_name)
                # Final fallback: slug-based lookup for prototype reports
                slug = game_name.lower().replace(" ", "_").replace("-", "_")
                resolved_id = f"proto_{slug}"

    cache_path = REPORTS_CACHE_DIR / f"{resolved_id}_e2e.json"
    if not cache_path.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"No cached HookLensReport for {game_name or app_id!r}.",
                "resolved_app_id": resolved_id,
                "hint": (
                    "Run `uv run python -m scripts.precache "
                    f"{game_name!r}` to pre-bake one (3-5 min)."
                ),
            },
        )

    # Return the raw JSON payload — preserves Pydantic schema fidelity for
    # the frontend without forcing FastAPI to re-serialize.
    return json.loads(cache_path.read_text())


# ---------------------------------------------------------------------------
# Live pipeline runner — streams step-by-step progress over Server-Sent Events
# ---------------------------------------------------------------------------

# Total step count is fixed by app.pipeline.STEPS — kept in sync below.
PIPELINE_TOTAL_STEPS = 10


def _full_step_payload(step_id: str, payload: Any) -> Any:
    """Produce a richer JSON-safe snapshot of a step's output for SSE
    clients that want to render partial sections of the report as the
    pipeline streams.

    Unlike :func:`_summarize_step_payload` (chips-only), this returns
    the actual data the frontend needs to populate components like
    ``GameDnaCard`` / ``ArchetypesTable`` / ``BriefsGrid`` — each one
    capped at top-K to keep per-event size under ~50 KB.

    Returns ``None`` when there's nothing useful to ship for this step.
    """
    if payload is None:
        return None
    try:
        # Pydantic v2 models — use .model_dump() with mode="json" so dates
        # / enums / nested models all serialize cleanly.
        if hasattr(payload, "model_dump"):
            return payload.model_dump(mode="json")
        if isinstance(payload, list):
            out = []
            # Cap at 20 to bound bandwidth; archetypes/briefs/variants are
            # capped well below this in the pipeline anyway.
            for item in payload[:20]:
                if hasattr(item, "model_dump"):
                    out.append(item.model_dump(mode="json"))
                elif isinstance(item, dict):
                    out.append(item)
            return out
        if isinstance(payload, dict):
            return payload
    except Exception:
        log.exception("full payload dump failed for step %s", step_id)
    return None


def _summarize_step_payload(step_id: str, payload: Any) -> dict[str, Any]:
    """Produce a small JSON-safe summary of a step's output for SSE clients.

    Avoid streaming the full pydantic objects: they can be 20+ KB each and
    we don't need them client-side until the final report lands on disk.
    """
    if payload is None:
        return {}
    try:
        if step_id == "target_meta":
            return {"name": getattr(payload, "name", None), "app_id": getattr(payload, "app_id", None)}
        if step_id == "game_dna":
            return {
                "name": getattr(payload, "name", None),
                "genre": getattr(payload, "genre", None),
                "primary_hex": getattr(getattr(payload, "palette", None), "primary_hex", None),
            }
        if step_id == "top_advertisers":
            return {"count": len(payload) if hasattr(payload, "__len__") else 0}
        if step_id == "raw_creatives":
            return {"count": len(payload) if hasattr(payload, "__len__") else 0}
        if step_id == "deconstructed":
            return {"count": len(payload) if hasattr(payload, "__len__") else 0}
        if step_id == "archetypes":
            labels = []
            for a in (payload or [])[:5]:
                lab = getattr(a, "label", None)
                if lab:
                    labels.append(lab)
            return {"count": len(payload) if hasattr(payload, "__len__") else 0, "labels": labels}
        if step_id == "fit_scores":
            return {"count": len(payload) if hasattr(payload, "__len__") else 0}
        if step_id == "briefs":
            titles = [getattr(b, "title", None) for b in (payload or [])[:3]]
            return {"count": len(payload) if hasattr(payload, "__len__") else 0, "titles": [t for t in titles if t]}
        if step_id == "variants":
            return {"count": len(payload) if hasattr(payload, "__len__") else 0}
        if step_id == "report":
            return {
                "app_id": getattr(getattr(payload, "target_game", None), "app_id", None),
                "name": getattr(getattr(payload, "target_game", None), "name", None),
                "duration_s": getattr(payload, "pipeline_duration_seconds", None),
                "cost_usd": getattr(payload, "total_cost_usd", None),
            }
    except Exception:
        log.exception("payload summary failed for step %s", step_id)
    return {}


@app.get("/api/report/run/stream")
async def run_report_stream(
    game_name: str = Query(..., description="Game name to analyze"),
    countries: str = Query(
        "all",
        description="Comma-separated country codes, or 'all' for the curated worldwide list",
    ),
    networks: str = Query(
        "all",
        description="Comma-separated networks (TikTok, Facebook, Instagram), or 'all'",
    ),
    period: str = Query("month"),
    period_date: str = Query("2026-04-01"),
    max_creatives: int = Query(8, ge=1, le=20),
    top_k_archetypes: int = Query(5, ge=1, le=10),
    top_k_variants: int = Query(3, ge=1, le=5),
):
    """Run the full HookLens pipeline and stream step-by-step progress as SSE.

    The client opens an EventSource on this URL; we emit one ``data: {...}``
    event after each pipeline step (10 in total) plus a final ``done`` (or
    ``error``) event. Suitable for a live in-app analyze button — the
    pipeline takes 3–5 minutes end-to-end and 1–2 dollars in API calls.
    """
    from app.pipeline import PipelineConfig, run_pipeline

    countries_list = [c.strip() for c in countries.split(",") if c.strip()] or ["all"]
    networks_list = [n.strip() for n in networks.split(",") if n.strip()] or ["all"]

    config = PipelineConfig(
        game_name=game_name,
        countries=countries_list,
        networks=networks_list,
        period=period,
        period_date=period_date,
        max_creatives=max_creatives,
        top_k_archetypes=top_k_archetypes,
        top_k_variants=top_k_variants,
    )

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def on_step(step_id: str, label: str, idx: int, payload: Any, duration_s: float) -> None:
        """Pipeline callback (runs in the executor thread)."""
        event = {
            "type": "step",
            "step_id": step_id,
            "label": label,
            "idx": idx,
            "total": PIPELINE_TOTAL_STEPS,
            "duration_s": round(duration_s, 3),
            "summary": _summarize_step_payload(step_id, payload),
            # Richer payload for the live partial report view — only
            # shipped for steps where the frontend has a component
            # ready to render the data progressively.
            "data": _full_step_payload(step_id, payload),
        }
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def _run_blocking() -> dict[str, Any]:
        report = run_pipeline(config, on_step=on_step)
        return {
            "type": "done",
            "app_id": report.target_game.app_id,
            "name": report.target_game.name,
            "duration_s": round(report.pipeline_duration_seconds, 1),
            "cost_usd": round(report.total_cost_usd, 4),
        }

    async def _runner() -> None:
        try:
            done = await loop.run_in_executor(None, _run_blocking)
            await queue.put(done)
        except Exception as exc:
            log.exception("Pipeline run failed for %r", game_name)
            await queue.put({"type": "error", "message": str(exc)})
        finally:
            await queue.put(None)  # sentinel

    asyncio.create_task(_runner())

    async def event_stream():
        # Send an initial 'started' event so the client gets immediate feedback.
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "started",
                    "game_name": game_name,
                    "total": PIPELINE_TOTAL_STEPS,
                    "config": {
                        "countries": countries_list,
                        "networks": networks_list,
                        "max_creatives": max_creatives,
                        "top_k_archetypes": top_k_archetypes,
                        "top_k_variants": top_k_variants,
                    },
                }
            )
            + "\n\n"
        )

        # Heartbeat task: SSE keep-alive every 15 s so proxies don't kill the
        # connection during the long Gemini step.
        async def _heartbeat():
            while True:
                await asyncio.sleep(15)
                await queue.put({"type": "heartbeat", "ts": datetime.now(timezone.utc).isoformat()})

        hb_task = asyncio.create_task(_heartbeat())
        try:
            while True:
                event = await queue.get()
                if event is None:  # sentinel: pipeline finished or errored
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            hb_task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Video brief endpoint — brainrot video ad concept from cached GameDNA
# ---------------------------------------------------------------------------

from app.creative.video_brief import (  # noqa: E402
    VideoAdConcept,
    VideoAdResult,
    generate_video_concept,
    generate_scenario_video,
)


def _load_game_dna(game_name: str):
    """Shared helper: load GameDNA from the most recent cached report.

    Supports multiple naming conventions used by different pipeline versions:
      - report_{slug}*.json   (canonical)
      - {app_id}_e2e.json     (notebook runner)
      - any .json in REPORTS_CACHE_DIR whose target_game.name matches
    """
    from app.models import HookLensReport  # noqa: PLC0415

    slug = game_name.strip().lower().replace(" ", "_")

    # Fast path — pattern-based
    candidates = (
        list(REPORTS_CACHE_DIR.glob(f"report_{slug}*.json"))
        + list(REPORTS_CACHE_DIR.glob(f"report_*{slug}*.json"))
    )

    # Slow path — scan all .json files for a name match
    if not candidates:
        for path in REPORTS_CACHE_DIR.glob("*.json"):
            try:
                raw = json.loads(path.read_text())
                name = (raw.get("target_game") or {}).get("name", "")
                if name.strip().lower() == game_name.strip().lower():
                    candidates.append(path)
            except Exception:
                continue

    if not candidates:
        raise HTTPException(
            status_code=404,
            detail=f"No cached report for '{game_name}'. Run the pipeline first.",
        )

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    try:
        report = HookLensReport.model_validate_json(candidates[0].read_text())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse report: {exc}") from exc
    return report.target_game


# ---------------------------------------------------------------------------
# Single-creative deep dive — powers the /ad/$id detail page
# ---------------------------------------------------------------------------


class CreativeDetailMedia(BaseModel):
    creative_url: str | None = None
    preview_url: str | None = None
    thumb_url: str | None = None
    width: int | None = None
    height: int | None = None
    aspect_ratio: str | None = None
    video_duration: int | None = None
    title: str | None = None
    button_text: str | None = None
    message: str | None = None


class CreativeDetailApp(BaseModel):
    app_id: str
    name: str
    publisher_name: str | None = None
    icon_url: str | None = None
    canonical_country: str | None = None


class SimilarCreative(BaseModel):
    creative_id: str
    network: str
    ad_type: str
    thumb_url: str | None
    advertiser_name: str | None
    icon_url: str | None
    first_seen_at: str | None
    days_active: int


class CreativeDetail(BaseModel):
    """Full payload for the ``/ad/$id`` detail page — every field comes
    from cached SensorTower data (no mocks). Returns 404 if the creative
    isn't in any cached ``creatives_top_*.json``.
    """

    creative_id: str
    network: str
    ad_type: str
    ad_formats: list[str]
    first_seen_at: str | None
    last_seen_at: str | None
    days_active: int
    phashion_group: str | None
    media: CreativeDetailMedia
    app: CreativeDetailApp
    siblings: list[SimilarCreative]


def _scan_all_creatives() -> list[dict[str, Any]]:
    """Iterate every ``ad_unit`` from every cached ``creatives_top_*.json``.
    Yields raw dicts (not Pydantic) since each row carries the bundled
    ``app_info`` block which we want to keep intact for enrichment.
    """
    out: list[dict[str, Any]] = []
    st_cache = CACHE_DIR / "sensortower"
    if not st_cache.exists():
        return out
    for path in st_cache.glob("creatives_top_*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for au in data.get("ad_units") or []:
            out.append(au)
    return out


_DECONSTRUCT_CACHE_DIR = CACHE_DIR / "deconstruct"


class DeconstructionView(BaseModel):
    """A trimmed shape of ``DeconstructedCreative`` for the /ad/$id page —
    same fields as on disk, just typed for the React UI without dragging
    the full ``RawCreative`` payload along.
    """

    creative_id: str
    hook_summary: str | None = None
    hook_visual_action: str | None = None
    hook_text_overlay: str | None = None
    hook_voiceover_transcript: str | None = None
    hook_emotional_pitch: str | None = None
    scene_flow: list[str] = []
    on_screen_text: list[str] = []
    cta_text: str | None = None
    cta_timing_seconds: float | None = None
    palette_hex: list[str] = []
    visual_style: str | None = None
    audience_proxy: str | None = None
    deconstruction_model: str | None = None


# ---------------------------------------------------------------------------
# Weekly Report — surfaces the freshest, highest-signal creatives the
# knowledge base has analysed in the last 7 days, grouped by emotional
# pitch + sorted by recency. Powers the /weekly route.
# ---------------------------------------------------------------------------


class WeeklyEntry(BaseModel):
    creative_id: str
    advertiser_name: str | None
    icon_url: str | None
    network: str | None
    ad_type: str | None
    thumb_url: str | None
    creative_url: str | None
    first_seen_at: str | None
    days_active: int | None
    hook_summary: str | None
    hook_emotional_pitch: str | None
    visual_style: str | None
    palette_hex: list[str] = []
    cta_text: str | None
    deconstructed_at: str | None  # ISO from file mtime
    new_this_week: bool = False


class WeeklyReport(BaseModel):
    generated_at: str
    knowledge_base_size: int
    """Total deconstructions on disk."""
    new_this_week: int
    """How many were added in the last 7 days."""
    by_pitch: dict[str, int]
    """Distribution: ``{emotional_pitch: count}`` across the whole base."""
    top_picks: list[WeeklyEntry]
    """Sorted list of the most-recent + highest-signal entries (cap 30)."""


@app.get("/api/weekly-report", response_model=WeeklyReport)
def get_weekly_report(
    days: int = Query(
        7,
        ge=1,
        le=60,
        description="Window in days for the 'new this week' count",
    ),
    limit: int = Query(
        30, ge=1, le=200, description="Cap on top_picks rows"
    ),
) -> WeeklyReport:
    """Aggregate the per-creative deconstruction cache into a weekly
    market brief. Each entry is enriched with the creative's
    SensorTower metadata (icon, advertiser, dates) by joining
    against the cached creatives_top_*.json files.
    """
    decon_dir = CACHE_DIR / "deconstruct"
    if not decon_dir.exists():
        return WeeklyReport(
            generated_at=datetime.now(timezone.utc).isoformat(),
            knowledge_base_size=0,
            new_this_week=0,
            by_pitch={},
            top_picks=[],
        )

    # Build a creative_id → ad_unit + app_info index from cached
    # SensorTower data so we can hydrate each deconstruction with its
    # advertiser name, icon, dates, etc.
    st_index: dict[str, dict[str, Any]] = {}
    st_cache = CACHE_DIR / "sensortower"
    if st_cache.exists():
        for p in st_cache.glob("creatives_top_*.json"):
            try:
                data = json.loads(p.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            for unit in data.get("ad_units") or []:
                cid = str(unit.get("id") or "")
                if cid and cid not in st_index:
                    st_index[cid] = unit

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    by_pitch: dict[str, int] = {}
    entries: list[WeeklyEntry] = []
    for path in decon_dir.glob("*.json"):
        try:
            decon = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue

        creative_id = decon.get("raw", {}).get("creative_id") or path.stem
        hook = decon.get("hook") or {}
        pitch = hook.get("emotional_pitch") or "other"
        by_pitch[pitch] = by_pitch.get(pitch, 0) + 1

        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        is_new = mtime >= cutoff

        # Hydrate from SensorTower cache when present
        unit = st_index.get(creative_id) or {}
        info = unit.get("app_info") or {}
        media = (unit.get("creatives") or [{}])[0]

        first_seen = unit.get("first_seen_at") or decon.get("raw", {}).get(
            "first_seen_at"
        )
        last_seen = unit.get("last_seen_at") or decon.get("raw", {}).get(
            "last_seen_at"
        )
        days_active: int | None = None
        try:
            if first_seen and last_seen:
                days_active = max(
                    0,
                    (
                        datetime.fromisoformat(last_seen)
                        - datetime.fromisoformat(first_seen)
                    ).days,
                )
        except (TypeError, ValueError):
            days_active = None

        entries.append(
            WeeklyEntry(
                creative_id=creative_id,
                advertiser_name=info.get("name")
                or info.get("humanized_name")
                or decon.get("raw", {}).get("advertiser_name"),
                icon_url=info.get("icon_url"),
                network=unit.get("network")
                or decon.get("raw", {}).get("network"),
                ad_type=unit.get("ad_type") or decon.get("raw", {}).get("ad_type"),
                thumb_url=media.get("thumb_url"),
                creative_url=media.get("creative_url"),
                first_seen_at=str(first_seen) if first_seen else None,
                days_active=days_active,
                hook_summary=hook.get("summary"),
                hook_emotional_pitch=pitch,
                visual_style=decon.get("visual_style"),
                palette_hex=list(decon.get("palette_hex") or []),
                cta_text=decon.get("cta_text"),
                deconstructed_at=mtime.isoformat(),
                new_this_week=is_new,
            )
        )

    # Sort: new-this-week first, then by deconstructed_at desc, then by
    # days_active desc (longer-running winners surface).
    entries.sort(
        key=lambda e: (
            0 if e.new_this_week else 1,
            -(
                datetime.fromisoformat(e.deconstructed_at).timestamp()
                if e.deconstructed_at
                else 0
            ),
            -(e.days_active or 0),
        )
    )

    return WeeklyReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        knowledge_base_size=len(entries),
        new_this_week=sum(1 for e in entries if e.new_this_week),
        by_pitch=by_pitch,
        top_picks=entries[:limit],
    )


@app.get(
    "/api/creatives/{creative_id}/deconstruction",
    response_model=DeconstructionView,
)
def get_creative_deconstruction(creative_id: str) -> DeconstructionView:
    """Return the cached Gemini deconstruction for a creative.

    Reads from data/cache/deconstruct/{creative_id}.json — populated by
    the pipeline (``app/analysis/deconstruct.py``) on every Gemini call,
    or pre-warmed by ``scripts/scan_top_competitors.py``. Returns 404
    when the creative hasn't been deconstructed yet so the frontend can
    show a "Run analysis" CTA.
    """
    path = _DECONSTRUCT_CACHE_DIR / f"{creative_id}.json"
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No deconstruction cached for creative {creative_id!r}",
        )
    try:
        d = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        raise HTTPException(
            status_code=500,
            detail=f"Corrupted deconstruction cache for {creative_id!r}",
        )

    hook = d.get("hook") or {}
    return DeconstructionView(
        creative_id=creative_id,
        hook_summary=hook.get("summary"),
        hook_visual_action=hook.get("visual_action"),
        hook_text_overlay=hook.get("text_overlay"),
        hook_voiceover_transcript=hook.get("voiceover_transcript"),
        hook_emotional_pitch=hook.get("emotional_pitch"),
        scene_flow=list(d.get("scene_flow") or []),
        on_screen_text=list(d.get("on_screen_text") or []),
        cta_text=d.get("cta_text"),
        cta_timing_seconds=d.get("cta_timing_seconds"),
        palette_hex=list(d.get("palette_hex") or []),
        visual_style=d.get("visual_style"),
        audience_proxy=d.get("audience_proxy"),
        deconstruction_model=d.get("deconstruction_model"),
    )


@app.get("/api/creatives/{creative_id}", response_model=CreativeDetail)
def get_creative_detail(creative_id: str) -> CreativeDetail:
    """Return rich detail for one creative by its SensorTower id."""
    units = _scan_all_creatives()

    # Find the unit — the URL ``id`` is the ad_unit id (= phashion_group),
    # which equals ``creatives[0].id`` in 99% of rows.
    target: dict[str, Any] | None = None
    for au in units:
        if str(au.get("id") or "") == creative_id:
            target = au
            break
        for c in au.get("creatives") or []:
            if str(c.get("id") or "") == creative_id:
                target = au
                break
        if target is not None:
            break

    if target is None:
        raise HTTPException(status_code=404, detail=f"Creative {creative_id} not in cache")

    media_src = (target.get("creatives") or [{}])[0]
    info = target.get("app_info") or {}

    first = target.get("first_seen_at")
    last = target.get("last_seen_at")
    try:
        days = (
            (datetime.fromisoformat(last) - datetime.fromisoformat(first)).days
            if first and last
            else 0
        )
    except (TypeError, ValueError):
        days = 0
    days = max(0, days)

    # Aspect ratio derived from width/height if both present
    w, h = media_src.get("width"), media_src.get("height")
    aspect = None
    if isinstance(w, (int, float)) and isinstance(h, (int, float)) and h:
        ratio = w / h
        if abs(ratio - 9 / 16) < 0.05:
            aspect = "9:16"
        elif abs(ratio - 1.0) < 0.05:
            aspect = "1:1"
        elif abs(ratio - 16 / 9) < 0.05:
            aspect = "16:9"
        elif abs(ratio - 4 / 5) < 0.05:
            aspect = "4:5"
        else:
            aspect = f"{w}:{h}"

    # Sibling creatives — same advertiser app_id, ranked by days_active desc,
    # excluding the current one. Caps at 6.
    same_app = [
        au
        for au in units
        if str(au.get("app_id") or "") == str(target.get("app_id") or "")
        and str(au.get("id") or "") != creative_id
    ]

    def _days(au: dict[str, Any]) -> int:
        try:
            return max(
                0,
                (
                    datetime.fromisoformat(au.get("last_seen_at"))
                    - datetime.fromisoformat(au.get("first_seen_at"))
                ).days,
            )
        except (TypeError, ValueError):
            return 0

    same_app.sort(key=_days, reverse=True)
    siblings: list[SimilarCreative] = []
    seen_sibling_ids: set[str] = set()
    for au in same_app:
        sid = str(au.get("id") or "")
        if not sid or sid in seen_sibling_ids:
            continue
        seen_sibling_ids.add(sid)
        if len(siblings) >= 6:
            break
        s_media = (au.get("creatives") or [{}])[0]
        s_info = au.get("app_info") or {}
        siblings.append(
            SimilarCreative(
                creative_id=str(au.get("id") or ""),
                network=str(au.get("network") or ""),
                ad_type=str(au.get("ad_type") or ""),
                thumb_url=s_media.get("thumb_url"),
                advertiser_name=s_info.get("name"),
                icon_url=s_info.get("icon_url"),
                first_seen_at=au.get("first_seen_at"),
                days_active=_days(au),
            )
        )

    return CreativeDetail(
        creative_id=creative_id,
        network=str(target.get("network") or ""),
        ad_type=str(target.get("ad_type") or ""),
        ad_formats=list(target.get("ad_formats") or []),
        first_seen_at=first,
        last_seen_at=last,
        days_active=days,
        phashion_group=target.get("phashion_group"),
        media=CreativeDetailMedia(
            creative_url=media_src.get("creative_url"),
            preview_url=media_src.get("preview_url"),
            thumb_url=media_src.get("thumb_url"),
            width=w if isinstance(w, int) else None,
            height=h if isinstance(h, int) else None,
            aspect_ratio=aspect,
            video_duration=media_src.get("video_duration"),
            title=media_src.get("title"),
            button_text=media_src.get("button_text"),
            message=media_src.get("message"),
        ),
        app=CreativeDetailApp(
            app_id=str(info.get("app_id") or target.get("app_id") or ""),
            name=str(info.get("name") or info.get("humanized_name") or "Unknown"),
            publisher_name=info.get("publisher_name"),
            icon_url=info.get("icon_url"),
            canonical_country=info.get("canonical_country"),
        ),
        siblings=siblings,
    )


@app.get("/api/video-brief", response_model=VideoAdConcept)
def get_video_brief(game_name: str = Query(...)) -> VideoAdConcept:
    """Return (or generate) the brainrot VideoAdConcept for a game (LLM step only, fast)."""
    if not game_name.strip():
        raise HTTPException(status_code=400, detail="game_name is required")
    dna = _load_game_dna(game_name)
    return generate_video_concept(dna)


@app.get("/api/video-brief/generate", response_model=VideoAdResult)
def generate_video(game_name: str = Query(...)) -> VideoAdResult:
    """Trigger Scenario video generation for the brainrot concept and return the video URL.

    This is the slow step (Veo 3 takes 2-5 min). The result is disk-cached
    so subsequent calls return immediately.
    """
    if not game_name.strip():
        raise HTTPException(status_code=400, detail="game_name is required")
    dna = _load_game_dna(game_name)
    concept = generate_video_concept(dna)
    return generate_scenario_video(concept)


# ---------------------------------------------------------------------------
# Voodoo catalog endpoints — power the "analyze a Voodoo title" picker
# ---------------------------------------------------------------------------


class VoodooApp(BaseModel):
    """Subset of AppMetadata exposed to the frontend pick-list."""

    app_id: str
    unified_app_id: str | None = None
    name: str
    publisher_name: str
    icon_url: str
    categories: list[int | str]
    description: str = ""
    rating: float | None = None
    rating_count: int | None = None


@app.get("/api/voodoo/apps", response_model=list[VoodooApp])
def list_voodoo_apps(refresh: bool = Query(False)) -> list[VoodooApp]:
    """Return Voodoo's full mobile game catalog from SensorTower.

    Cached on disk for 7 days under ``data/cache/voodoo/catalog.json``.
    Pass ``?refresh=1`` to force a re-fetch. Sorted by ``rating_count``
    desc, so the frontend can show the most popular Voodoo titles first.
    """
    from app.sources.voodoo import fetch_voodoo_catalog

    try:
        catalog = fetch_voodoo_catalog(refresh=refresh)
    except Exception:
        log.exception("fetch_voodoo_catalog failed")
        raise HTTPException(status_code=502, detail="SensorTower lookup failed")

    return [
        VoodooApp(
            app_id=m.app_id,
            unified_app_id=m.unified_app_id,
            name=m.name,
            publisher_name=m.publisher_name,
            icon_url=str(m.icon_url),
            categories=list(m.categories),
            description=(m.description or "")[:300],
            rating=m.rating,
            rating_count=m.rating_count,
        )
        for m in catalog
    ]


class VoodooAdSample(BaseModel):
    """One ad creative running on a Voodoo title (mp4 + thumb + metadata)."""

    creative_id: str
    network: str
    ad_type: str
    thumb_url: str | None = None
    creative_url: str | None = None
    first_seen_at: str | None = None


class VoodooPortfolioEntry(BaseModel):
    """One row in the Voodoo Portfolio page — game + ad activity summary."""

    app_id: str
    unified_app_id: str | None = None
    name: str
    publisher_name: str
    icon_url: str
    categories: list[int | str]
    rating: float | None = None
    rating_count: int | None = None
    description: str = ""
    ads_total: int = 0
    ads_by_network: dict[str, int] = {}
    ads_latest_first_seen: str | None = None
    ads_sample: list[VoodooAdSample] = []
    # UA dependency over a 3-month window (set in scripts/precache_voodoo_ads).
    paid_share: float | None = None
    organic_share: float | None = None
    total_downloads_3mo: int | None = None
    # 30-day daily download totals (sparkline-ready) + week-over-week trend.
    # ``downloads_trend_7d_pct`` is a fraction: -0.12 = −12% w/w (declining).
    # The frontend uses these to flag "needs attention" games on the
    # Voodoo Portfolio page.
    downloads_30d_curve: list[int] = []
    downloads_trend_7d_pct: float | None = None
    # UA dependency split (paid vs organic) over the precache window.
    # All three are optional — None when SensorTower has no
    # downloads_by_sources data for the tenant on that app.
    paid_share: float | None = None
    organic_share: float | None = None
    total_downloads_3mo: int | None = None


class VoodooPortfolioResponse(BaseModel):
    generated_at: str | None = None
    country: str = "US"
    limit: int = 15
    apps: list[VoodooPortfolioEntry] = []


@app.get("/api/voodoo/portfolio", response_model=VoodooPortfolioResponse)
def voodoo_portfolio(limit: int = Query(15, ge=1, le=50)) -> VoodooPortfolioResponse:
    """Return the top-N most-rated Voodoo games + their current ad activity.

    Reads from ``data/cache/voodoo/portfolio_summary.json`` (written by
    ``scripts.precache_voodoo_ads``) for instant load. If the snapshot is
    missing, returns an empty response with a friendly message hint —
    the frontend should prompt the user to run the precache script.

    Designed for the Voodoo Portfolio page where every cell needs to render
    immediately from disk during the demo (no 30s fan-out across 15
    SensorTower calls).
    """
    from app.sources.voodoo import VOODOO_CACHE_DIR

    summary_path = VOODOO_CACHE_DIR / "portfolio_summary.json"
    if not summary_path.exists():
        log.info(
            "voodoo_portfolio: portfolio_summary.json missing — "
            "run `uv run python -m scripts.precache_voodoo_ads` to populate it."
        )
        return VoodooPortfolioResponse()

    try:
        data = json.loads(summary_path.read_text())
    except (json.JSONDecodeError, OSError):
        log.exception("voodoo_portfolio: failed to read portfolio_summary.json")
        return VoodooPortfolioResponse()

    apps = data.get("apps") or []
    return VoodooPortfolioResponse(
        generated_at=data.get("generated_at"),
        country=data.get("country", "US"),
        limit=limit,
        apps=[VoodooPortfolioEntry.model_validate(a) for a in apps[:limit]],
    )


@app.get("/api/voodoo/apps/{app_id}/creatives")
def voodoo_app_creatives(
    app_id: str,
    country: str = Query("US"),
    limit: int = Query(20, ge=1, le=100),
    start_date: str | None = Query(
        None,
        description=(
            "Earliest first_seen_at to include (YYYY-MM-DD). Defaults to "
            "180 days before today, which surfaces a useful active+recent set."
        ),
    ),
):
    """Return ad creatives where Voodoo is the *advertiser* on this app.

    Thin HTTP wrapper around :func:`app.sources.voodoo.fetch_voodoo_app_creatives`.
    The shared helper is also called from the brief-generation step in the
    pipeline so we get a free benchmark of Voodoo's existing rotation.
    """
    from app.sources.voodoo import fetch_voodoo_app_creatives

    return fetch_voodoo_app_creatives(
        app_id, country=country, limit=limit, start_date=start_date
    )


# ---------------------------------------------------------------------------
# Network rank — per-advertiser, per-(network, country) ad-intel rank
# ---------------------------------------------------------------------------


class AdvertiserNetworkRank(BaseModel):
    """Latest network rank for an advertiser app on a single network."""

    country: str
    rank: int
    date: str


@app.get(
    "/api/advertisers/{app_id}/ranks",
    response_model=dict[str, AdvertiserNetworkRank],
)
def get_advertiser_ranks(
    app_id: str,
    countries: str = Query("US"),
    networks: str = Query("Facebook,TikTok,Admob,Applovin"),
    period_date: str = Query("2026-04-01"),
) -> dict[str, AdvertiserNetworkRank]:
    """Return the latest network ranks for an advertiser app, keyed by network.

    Used by the Competitive Scope page to show contextual rank badges next to
    each tracked competitor. Picks the most recent date per network from the
    SensorTower ``/v1/unified/ad_intel/network_analysis/rank`` response.

    Returns ``{}`` when the app has no rank data in the queried window —
    long-tail apps regularly fall outside SensorTower's tracked networks.
    """
    from app.sources.sensortower import fetch_network_rank

    # Use period_date as the start, today as the end, so we always pick up
    # the latest weekly rank without paginating through months of history.
    start = period_date
    end = date.today().isoformat()
    if end < start:
        # Fallback: caller asked for a future period_date — give them the
        # rank from the requested window only.
        end = start

    try:
        rows = fetch_network_rank(
            app_ids=app_id,
            networks=networks,
            countries=countries,
            start_date=start,
            end_date=end,
            period="week",
        )
    except Exception:
        log.exception("fetch_network_rank failed for %r", app_id)
        return {}

    # Pick the most recent row per network (largest date wins).
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        net = row.get("network")
        d = row.get("date") or ""
        rank = row.get("rank")
        if not net or rank is None:
            continue
        prev = latest.get(net)
        if prev is None or (prev.get("date") or "") < d:
            latest[net] = row

    out: dict[str, AdvertiserNetworkRank] = {}
    for net, row in latest.items():
        try:
            out[net] = AdvertiserNetworkRank(
                country=str(row.get("country") or countries.split(",")[0]),
                rank=int(row.get("rank")),
                date=str(row.get("date") or ""),
            )
        except (TypeError, ValueError):
            continue
    return out


# ---------------------------------------------------------------------------
# Per-variant Generate Ad — fires N parallel Scenario img2video calls,
# concatenates the resulting clips with ffmpeg, optionally appends the
# game's pre-rendered endcard, and serves the final mp4 over /videos.
# ---------------------------------------------------------------------------

# Mount /videos as a static directory so the React UI can <video src="/videos/...">.
# Existing files (the multi-clip CLI outputs in scripts/generate_demo_video.py)
# are also served from here, which means demo_<game>_full.mp4 becomes
# /videos/demo_<game>_full.mp4 for free.
_VIDEOS_DIR = CACHE_DIR / "videos"
_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/videos", StaticFiles(directory=str(_VIDEOS_DIR)), name="videos")

# Default Scenario video model for per-variant rendering. Single-frame
# image-to-video (i2v) — one call per frame, parallelized N=3 by the
# endpoint so the user sees their ad in ~3-5 minutes instead of 9-15.
# Override with SCENARIO_VARIANT_VIDEO_MODEL env var.
import os as _os

_VARIANT_VIDEO_MODEL = _os.environ.get(
    "SCENARIO_VARIANT_VIDEO_MODEL",
    "model_kling-o1-i2v",
)
# "rich" mode: Kling 2.6 Pro generates native synchronized audio per clip
# (sfx + music + voice based on the brief's audio cues). Costs more
# (~+15 CU/clip ≈ +$0.05) but gives diegetic SFX synced to the visual
# events (whoosh on swipe, chime on combo, drop on absorption) which
# OpenAI TTS / ElevenLabs alone can never match.
_VARIANT_VIDEO_MODEL_RICH = _os.environ.get(
    "SCENARIO_VARIANT_VIDEO_MODEL_RICH",
    "model_kling-v2-6-i2v-pro",
)
_ENDCARDS_DIR = CACHE_DIR / "endcards"


class VariantVideoResponse(BaseModel):
    video_url: str
    """Path served under the API's /videos mount, e.g. ``/videos/variant_xxx.mp4``."""

    cached: bool
    """``True`` when the final mp4 was already on disk (instant return)."""

    duration_s: float
    """Approximate runtime of the assembled ad in seconds."""

    clips: int
    """How many Scenario clips were concatenated (typically 3)."""

    endcard_appended: bool
    """``True`` when a pre-rendered endcard was concatenated at the end."""

    job_ids: list[str]
    """Scenario job IDs for traceability — empty when fully cached."""

    stub: bool
    """``True`` when one or more clips fell back to a Picsum placeholder
    (e.g. Scenario auth missing or job timed out). Frontend should warn."""

    has_audio: bool = False
    """``True`` when an audio overlay was applied to the final mp4."""


class VariantVideoStatus(BaseModel):
    """Lightweight existence check used by the React UI on Insights load.

    Mirrors the fields of VariantVideoResponse but with ``exists`` so the
    frontend can render a previously-rendered video instantly (no need
    to re-trigger the 5-min generation just because the user navigated
    away and came back).
    """

    exists: bool
    video_url: str | None = None
    duration_s: float = 0.0
    has_audio: bool = False
    endcard_appended: bool = False


def _slugify_game(name: str) -> str:
    import re

    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_-").lower() or "demo"


def _download_to(url: str, dest: Path) -> Path:
    """Mirror of scripts.generate_demo_video._download — used for both
    Scenario CDN downloads and SensorTower asset URLs."""
    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


@app.post("/api/variants/render-video", response_model=VariantVideoResponse)
async def render_variant_video(
    game_name: str = Query(..., description="Target game name (matches a cached report)"),
    archetype_id: str = Query(..., description="Which variant to render"),
    include_endcard: bool = Query(
        True,
        description="Append the game's pre-rendered endcard at the end if available",
    ),
    include_audio: bool = Query(
        True,
        description="Overlay an emotional-pitch-matched soundtrack from data/cache/audio/library/",
    ),
    include_voice: bool = Query(
        False,
        description=(
            "Generate a brainrot voiceover (OpenAI TTS) from the brief's "
            "text_overlays + cta and mix it on top of the music bed."
        ),
    ),
    include_sfx: bool = Query(
        True,
        description=(
            "Splice mobile-game SFX (whoosh, swoosh × 2, drop, brand "
            "chime) at fixed beats matching the 5-second clip boundaries. "
            "Reads from data/cache/audio/sfx/<stem>.mp3 — missing files "
            "are silently skipped so you can drop in just the sfx you "
            "want."
        ),
    ),
    voice: str = Query(
        "alloy",
        description=(
            "OpenAI TTS voice id. Recommended for brainrot energy: "
            "'alloy' (neutral/punchy), 'nova' (young female), 'echo' (smoky)."
        ),
    ),
    audio_quality: Literal["fast", "rich"] = Query(
        "fast",
        description=(
            "'fast' = Kling O1 silent clips + post-hoc music/voice overlay "
            "(default, ~$0.30/render). 'rich' = Kling 2.6 Pro with native "
            "audio per clip — diegetic SFX synced to visuals (whoosh on "
            "swipe, chime on combo, etc.), no post-hoc overlay. ~$1/render."
        ),
    ),
    correction: str | None = Query(
        None,
        description=(
            "Natural-language refinement appended to every per-clip prompt "
            "on this render. Example: 'make the music more energetic', "
            "'voice should sound surprised', 'use darker palette'. Hashed "
            "into the cache key so the previous output isn't reused."
        ),
        max_length=500,
    ),
    model: str | None = Query(
        None,
        description="Override the Scenario video model (defaults to env or Kling i2v)",
    ),
) -> VariantVideoResponse:
    """Generate a finished ad video for one variant of a cached report.

    Pipeline:
      1. Load the cached HookLensReport for ``game_name``.
      2. Pick the variant matching ``archetype_id`` (its hero +
         storyboard frames, plus the brief's scenario_prompts which
         carry the per-frame motion + audio cues).
      3. Download each frame to ``data/cache/scenario_frames/<slug>/``.
      4. Fire N parallel ``call_scenario_video`` calls (N = 3 typically)
         — one image-to-video call per frame, capped by an
         ``asyncio.Semaphore`` so we don't trigger Scenario tenant-wide
         throttles.
      5. ffmpeg-concat the resulting mp4s into
         ``data/cache/videos/variant_<archetype_id>.mp4``.
      6. Optionally append the game's pre-rendered endcard from
         ``data/cache/endcards/<app_id>.mp4``.
      7. Return ``/videos/...`` URL the frontend can play directly.

    Cached aggressively: if the final mp4 already exists on disk we
    return it instantly without recomputing. Re-clicks during the demo
    are zero-latency.
    """
    import re

    # 1. Load report
    cache_path = REPORTS_CACHE_DIR / f"{_resolve_app_id_for_game(game_name)}_e2e.json"
    if not cache_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No cached report for {game_name!r} — run the pipeline first",
        )
    report = json.loads(cache_path.read_text())
    target_game = report.get("target_game") or {}
    app_id = str(target_game.get("app_id") or "")
    game_slug = _slugify_game(target_game.get("name") or game_name)

    # 2. Find the variant
    variants = report.get("final_variants") or []
    variant = next(
        (v for v in variants if (v.get("brief") or {}).get("archetype_id") == archetype_id),
        None,
    )
    if variant is None:
        raise HTTPException(
            status_code=404,
            detail=f"Variant {archetype_id!r} not found in {game_name!r}",
        )
    brief = variant.get("brief") or {}
    hero_url = variant.get("hero_frame_path") or ""
    storyboard_urls = variant.get("storyboard_paths") or []
    frame_urls = [u for u in [hero_url, *storyboard_urls] if u][:3]
    if not frame_urls:
        raise HTTPException(
            status_code=422,
            detail="Variant has no hero/storyboard frames to videofy",
        )

    # Normalize the user correction up-front so both step 3 (prompt
    # building) and step 4 (filename hashing) can reference it.
    import hashlib

    correction_clean = (correction or "").strip()
    correction_tag = (
        f"_c{hashlib.sha256(correction_clean.encode()).hexdigest()[:8]}"
        if correction_clean
        else ""
    )

    # 3. Per-frame motion prompts. Prefer the brief's own scenario_prompts
    #    (which Opus tailored per frame, including audio cues), fall back
    #    to scene_flow beats, then to the global hook.
    #
    #    When ``correction`` is provided (the React UI's "Regenerate with
    #    refinement" textarea), append it to every clip's prompt. The
    #    video model treats it as the most recent / overriding directive.
    scenario_prompts = brief.get("scenario_prompts") or []
    scene_flow = brief.get("scene_flow") or []
    hook_3s = brief.get("hook_3s") or ""
    per_frame_prompts: list[str] = []
    for i in range(len(frame_urls)):
        if i < len(scenario_prompts) and scenario_prompts[i]:
            base = str(scenario_prompts[i])
        elif i < len(scene_flow) and scene_flow[i]:
            base = str(scene_flow[i])
        else:
            base = hook_3s or "5-second cinematic gameplay clip"
        if correction_clean:
            # Place the user note at the END so it's the last thing the
            # model reads. Cap the merged result so we stay under each
            # video model's prompt length cap (Kling 2.6 Pro = 2048,
            # Kling O1 = ~500). Reserve ~200 chars for the correction.
            base = base[: 2048 - len(correction_clean) - 60]
            base = f"{base}\n\nUSER REFINEMENT (highest priority): {correction_clean}"
        per_frame_prompts.append(base[:2048])

    # 4. Final output path — keyed by (archetype_id + endcard mtime +
    #    audio_quality + correction hash) so any change in inputs
    #    triggers a fresh render. Fast vs rich outputs and any
    #    user-corrected variants all coexist on disk for A/B'ing.
    safe_archetype = re.sub(r"[^a-zA-Z0-9_-]+", "-", archetype_id)[:40]
    endcard_for_cache = (
        _endcard_path_for(app_id) if include_endcard else None
    )
    endcard_tag = (
        f"_ec{int(endcard_for_cache.stat().st_mtime)}"
        if endcard_for_cache
        else "_noec"
    )
    quality_tag = "_rich" if audio_quality == "rich" else ""
    final_filename = (
        f"variant_{game_slug}_{safe_archetype}"
        f"{endcard_tag}{quality_tag}{correction_tag}.mp4"
    )
    final_path = _VIDEOS_DIR / final_filename
    if final_path.exists() and final_path.stat().st_size > 0:
        return VariantVideoResponse(
            video_url=f"/videos/{final_filename}",
            cached=True,
            duration_s=_estimate_video_duration(final_path),
            clips=len(frame_urls),
            endcard_appended=endcard_for_cache is not None,
            job_ids=[],
            stub=False,
        )

    # 5. Download frames locally for hashing
    frames_dir = CACHE_DIR / "scenario_frames" / game_slug
    frames_dir.mkdir(parents=True, exist_ok=True)
    local_frames: list[Path] = []
    for i, url in enumerate(frame_urls):
        dest = frames_dir / f"{safe_archetype}_frame_{i}.png"
        if not dest.exists() or dest.stat().st_size == 0:
            try:
                _download_to(url, dest)
            except Exception as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to download frame {i}: {exc}",
                ) from exc
        local_frames.append(dest)

    # 6. Fire N parallel Scenario img2video calls.
    #
    # Special handling for the LAST clip when an endcard PNG is on
    # disk: pass it as ``tail_image`` (Kling O1 / Kling 2.6 Pro's
    # ``lastFrameImage`` parameter). The model interpolates between
    # the variant's storyboard frame and the endcard so the concat
    # handoff is a smooth morph rather than a hard cut. Costs the
    # same (single Scenario call, just with one extra asset upload).
    from app.creative.scenario import call_scenario_video

    # Quality dispatch:
    #   fast → Kling O1 i2v (silent clips, post-hoc audio overlay)
    #   rich → Kling 2.6 Pro i2v with generateAudio=True (per-clip
    #          diegetic SFX/music/voice from the brief's audio cues,
    #          no post-hoc overlay needed)
    is_rich = audio_quality == "rich"
    chosen_model = model or (
        _VARIANT_VIDEO_MODEL_RICH if is_rich else _VARIANT_VIDEO_MODEL
    )
    endcard_png = (
        _ENDCARDS_DIR / f"{app_id}.png"
        if include_endcard and app_id
        else None
    )
    if endcard_png is not None and not endcard_png.exists():
        endcard_png = None

    loop = asyncio.get_running_loop()
    sem = asyncio.Semaphore(3)  # never more than 3 in flight per request

    async def _gen_clip(
        idx: int,
        frame: Path,
        prompt: str,
        tail: Path | None,
    ) -> tuple[int, str, dict]:
        async with sem:
            return await loop.run_in_executor(
                None,
                lambda: (
                    idx,
                    *call_scenario_video(
                        model_id=chosen_model,
                        image_paths=[frame],
                        prompt=prompt,
                        # correction_tag flows into the on-disk label so
                        # different refinement attempts get distinct cache
                        # entries. Different prompts already produce
                        # different cache keys inside call_scenario_video,
                        # but having it in the label too makes the
                        # downloaded mp4 filenames self-documenting.
                        label=(
                            f"variant_{game_slug}_{safe_archetype}_"
                            f"clip{idx}{quality_tag}{correction_tag}"
                        ),
                        tail_image_path=tail,
                        generate_audio=is_rich,
                    ),
                ),
            )

    last_idx = len(local_frames) - 1
    # Kling 2.6 Pro REJECTS `lastFrameImage` + `generateAudio` together
    # (verified empirically: the API returns a job-level error
    # "End image is not supported when audio generation is enabled").
    # Trade-off:
    #   fast → lastFrameImage on clip 3 = smooth visual morph into
    #          endcard. Clips silent (post-hoc music overlay).
    #   rich → no lastFrameImage. Clips have native audio, accept a
    #          visual cut at the clip 3 → endcard handoff (the audio
    #          cuts there too anyway since the endcard is silent).
    use_tail_on_last = endcard_png is not None and not is_rich
    log.info(
        "render_variant_video: %s · archetype=%s · %d clips × %s · "
        "audio=%s · tail_image=%s",
        game_name,
        archetype_id,
        len(local_frames),
        chosen_model,
        "native" if is_rich else "post-hoc",
        "endcard" if use_tail_on_last else "off",
    )
    try:
        results = await asyncio.gather(
            *[
                _gen_clip(
                    i,
                    frame,
                    per_frame_prompts[i],
                    # Only the LAST clip gets the endcard tail in fast
                    # mode. In rich mode no clip gets a tail (Kling 2.6
                    # Pro can't combine tail + audio).
                    endcard_png if (i == last_idx and use_tail_on_last) else None,
                )
                for i, frame in enumerate(local_frames)
            ]
        )
    except Exception as exc:
        log.exception("Parallel video generation failed")
        raise HTTPException(
            status_code=502,
            detail=f"Scenario video generation failed: {exc}",
        ) from exc

    # 7. Download each clip locally so we can ffmpeg-concat them
    clip_paths: list[Path] = []
    job_ids: list[str] = []
    any_stub = False
    for idx, video_url, meta in sorted(results, key=lambda r: r[0]):
        if meta.get("stub"):
            any_stub = True
        if jid := meta.get("job_id"):
            job_ids.append(str(jid))
        # Include both quality_tag and correction_tag in the on-disk
        # filename so distinct (quality, refinement) tuples don't
        # shadow each other. The earlier bug here: a Fast-mode silent
        # clip was being reused as the Rich-mode clip because the
        # filename was quality-agnostic.
        clip_path = (
            _VIDEOS_DIR
            / f"variant_{game_slug}_{safe_archetype}_clip{idx}"
              f"{quality_tag}{correction_tag}.mp4"
        )
        if not clip_path.exists() or clip_path.stat().st_size == 0:
            try:
                _download_to(video_url, clip_path)
            except Exception as exc:
                log.warning("Clip download failed for clip %d: %s", idx, exc)
                continue
        clip_paths.append(clip_path)

    if not clip_paths:
        raise HTTPException(
            status_code=502,
            detail="All clips failed to render — check Scenario credentials / credits",
        )

    # 8. Optionally append the endcard
    endcard = _endcard_path_for(app_id) if include_endcard else None
    concat_inputs = [*clip_paths, endcard] if endcard else clip_paths

    # 9. ffmpeg concat
    if not _ffmpeg_concat(concat_inputs, final_path):
        raise HTTPException(
            status_code=500,
            detail="ffmpeg concat failed — check server logs",
        )

    # 10. Audio strategy depends on quality:
    #
    #   rich → clips ALREADY have native audio from Kling 2.6 Pro.
    #          Skip post-hoc overlay; the diegetic SFX would clash
    #          with our static music bed. The endcard mp4 is still
    #          silent though, so we accept that asymmetry for now
    #          (most ads close on a beat anyway).
    #
    #   fast → clips are silent; run the multi-layer overlay
    #          (music bed + optional voice) like before.
    audio_overlay_applied = False
    if not is_rich and (include_audio or include_voice or include_sfx):
        # Stash the target_game on the variant dict so the audio layer
        # can read Game DNA when authoring the bespoke narration script.
        # (Variant dicts as cached on disk don't carry the target_game
        # link, so we attach it here for the duration of this request.)
        variant_with_dna = {**variant, "_target_game": target_game}
        audio_overlay_applied = _try_apply_audio_layers(
            video_path=final_path,
            variant=variant_with_dna,
            include_music=include_audio,
            include_voice=include_voice,
            include_sfx=include_sfx,
            voice_id=voice,
        )

    return VariantVideoResponse(
        video_url=f"/videos/{final_filename}",
        cached=False,
        duration_s=_estimate_video_duration(final_path),
        clips=len(clip_paths),
        endcard_appended=endcard is not None,
        job_ids=job_ids,
        stub=any_stub,
        has_audio=audio_overlay_applied or _video_has_audio(final_path),
    )


@app.get(
    "/api/variants/render-video/status",
    response_model=VariantVideoStatus,
)
def variant_video_status(
    game_name: str = Query(...),
    archetype_id: str = Query(...),
    include_endcard: bool = Query(True),
    audio_quality: Literal["fast", "rich"] = Query("fast"),
) -> VariantVideoStatus:
    """Cheap existence check for a previously rendered variant video.

    Lets the React Insights view render the video instantly on
    revisit without waiting on (or re-triggering) the 5-min Scenario
    generation. Mirrors the cache-key computation of the POST endpoint
    so the same (game, archetype, endcard mtime) combo resolves to the
    same mp4.

    Returns ``exists=False`` when no matching mp4 is on disk; the UI
    then shows the Generate Ad CTA. ``exists=True`` carries the URL +
    metadata so the player can mount immediately.
    """
    import re

    try:
        app_id = _resolve_app_id_for_game(game_name)
    except HTTPException:
        return VariantVideoStatus(exists=False)

    cache_path = REPORTS_CACHE_DIR / f"{app_id}_e2e.json"
    if not cache_path.exists():
        return VariantVideoStatus(exists=False)
    report = json.loads(cache_path.read_text())
    target_game = report.get("target_game") or {}
    game_slug = _slugify_game(target_game.get("name") or game_name)

    safe_archetype = re.sub(r"[^a-zA-Z0-9_-]+", "-", archetype_id)[:40]
    endcard_for_cache = (
        _endcard_path_for(app_id) if include_endcard else None
    )
    endcard_tag = (
        f"_ec{int(endcard_for_cache.stat().st_mtime)}"
        if endcard_for_cache
        else "_noec"
    )
    quality_tag = "_rich" if audio_quality == "rich" else ""
    final_filename = (
        f"variant_{game_slug}_{safe_archetype}{endcard_tag}{quality_tag}.mp4"
    )
    final_path = _VIDEOS_DIR / final_filename

    if not final_path.exists() or final_path.stat().st_size == 0:
        # Try alternate cache files when the exact (endcard mtime,
        # quality) tuple isn't on disk: any matching prefix is good
        # enough for the UI to surface SOMETHING the user already
        # rendered. Order: same quality without endcard tag, then
        # cross-quality with endcard tag, then no-tag legacy.
        candidates = sorted(
            _VIDEOS_DIR.glob(f"variant_{game_slug}_{safe_archetype}*.mp4"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        # Prefer matching quality_tag if the user is asking specifically
        match: Path | None = None
        for c in candidates:
            if quality_tag and quality_tag in c.name:
                match = c
                break
        if match is None and candidates:
            match = candidates[0]
        if match and match.stat().st_size > 0:
            final_path = match
            final_filename = match.name
        else:
            return VariantVideoStatus(exists=False)

    return VariantVideoStatus(
        exists=True,
        video_url=f"/videos/{final_filename}",
        duration_s=_estimate_video_duration(final_path),
        has_audio=_video_has_audio(final_path),
        endcard_appended=endcard_for_cache is not None,
    )


_AUDIO_LIBRARY_DIR = CACHE_DIR / "audio" / "library"
_AUDIO_SFX_DIR = CACHE_DIR / "audio" / "sfx"

# Standard SFX timing for the 18-second concat (3 clips × 5s + endcard
# 3s). Each tuple is (filename_stem, delay_ms, volume). The user drops
# matching mp3s into data/cache/audio/sfx/ and they ffmpeg-splice in
# automatically. Missing files are silently skipped.
#
# Volumes are calibrated below the music+voice mix so SFX punctuate
# without overpowering the narration:
#   music bed = 0.25
#   voice TTS = 1.00
#   sfx       = 0.70-0.85 (varies by impact)
_SFX_TIMELINE: list[tuple[str, int, float]] = [
    ("whoosh_in",    0,     0.85),  # opening attention-grab
    ("swoosh_1",     4500,  0.70),  # clip 1 → clip 2 cut
    ("swoosh_2",     9500,  0.70),  # clip 2 → clip 3 cut
    ("drop",         14500, 0.85),  # build before endcard
    ("brand_chime",  15000, 0.80),  # endcard appears
]

# Map emotional_pitch → vibe filename (matches
# scripts/generate_soundtrack.py:VIBE_MAP and the README in
# data/cache/audio/library/).
_PITCH_VIBE: dict[str, str] = {
    "satisfaction": "satisfaction",
    "fail": "rage_bait",
    "curiosity": "curiosity",
    "rage_bait": "rage_bait",
    "tutorial": "tutorial",
    "asmr": "asmr",
    "celebrity": "celebrity",
    "challenge": "challenge",
    "transformation": "transformation",
    "other": "satisfaction",
}


def _opus_brainrot_script(
    *,
    brief: dict[str, Any],
    target_game: dict[str, Any],
    archetype_id: str,
) -> str | None:
    """Ask Claude Opus to write a bespoke 12-15-second TikTok-style ad
    voiceover script for this specific (variant × game) pair.

    Why not just concatenate ``text_overlays + cta``: those are short
    on-screen captions, not spoken narration. Reading them aloud
    sounds like an audiobook of subtitle lines. Opus, given the same
    inputs + the Game DNA, can produce a punchy 30-50-word script
    with TikTok-narrator energy — direct address ("Hold UP"), all-caps
    emphasis, mid-sentence beat drops — which is what makes a
    VO sit right on a 15s ad.

    Output is plain UTF-8 text ready for TTS (caller strips the
    surrounding markdown if any). Cached on disk per
    (archetype_id, target_game.app_id) so re-renders of the same
    variant don't re-bill Anthropic.

    Returns None on any failure (caller falls back to the
    text_overlays concat path).
    """
    import hashlib
    import os
    import httpx

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    game_name = target_game.get("name") or "the game"
    palette = target_game.get("palette") or {}
    visual_style = target_game.get("visual_style") or ""
    ui_mood = target_game.get("ui_mood") or ""
    audience = target_game.get("audience_proxy") or ""

    title = brief.get("title") or ""
    hook = brief.get("hook_3s") or ""
    scene_flow = brief.get("scene_flow") or []
    overlays = brief.get("text_overlays") or []
    cta = brief.get("cta") or "Play now"

    user_prompt = f"""Write a TikTok-style mobile-game ad voiceover for "{game_name}".

The voiceover plays over a 15-second video that ends on the game's logo.
Length: 30-50 spoken words (≈ 12-15 seconds at conversational TikTok speed).

Tone: brainrot energy, direct address to the viewer, ALL-CAPS emphasis on
the punchline word, mid-sentence beat drops, ellipses for pauses. Think
"hold up — that ONE guy is about to take the WHOLE CITY" rather than
descriptive narration. End with the game name + the CTA verbatim.

Inputs:
- Game: {game_name}
- Visual style: {visual_style}
- UI mood: {ui_mood}
- Audience: {audience}
- Variant title: "{title}"
- 3-second hook: {hook}
- Scene beats: {" / ".join(scene_flow[:3])}
- On-screen captions (for tone reference, not to read verbatim): {", ".join([str(o) for o in overlays[:3]])}
- CTA: {cta}

Return ONLY the spoken text, no quotes, no markdown, no stage directions.
Keep it under 50 words."""

    cache_key = hashlib.sha256(
        f"{archetype_id}|{target_game.get('app_id', '')}|{title}".encode()
    ).hexdigest()[:16]
    cache_path = (
        CACHE_DIR / "audio" / "scripts" / f"{cache_key}.txt"
    )
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path.read_text().strip()

    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                # Match the alias used elsewhere in the codebase
                # (app/creative/brief.py, app/analysis/game_fit.py).
                # Anthropic resolves the alias to the latest snapshot.
                "model": "claude-opus-4-7",
                "max_tokens": 250,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=30.0,
        )
        r.raise_for_status()
        body = r.json()
        text = (body.get("content") or [{}])[0].get("text", "").strip()
        # Strip surrounding quotes / fences if Opus added them
        text = text.strip("\"'`").strip()
        if text:
            cache_path.write_text(text)
            log.info(
                "narration script: %d chars · variant=%s · game=%s",
                len(text), archetype_id, game_name,
            )
            return text
    except Exception as exc:
        log.warning("Opus narration script failed: %s", exc)
    return None


def _build_brainrot_narration(brief: dict[str, Any]) -> str:
    """Fallback narration builder: compose from the brief's
    ``text_overlays`` + ``cta`` when Opus isn't available.

    Mainly here so the audio pipeline keeps working without Anthropic
    credentials. The Opus-authored script (``_opus_brainrot_script``)
    is the preferred path — much punchier delivery, custom per variant
    rather than a captions-read-aloud feel.
    """
    import re

    overlays = brief.get("text_overlays") or []
    cta = (brief.get("cta") or "Play now").strip()

    def clean(line: str) -> str:
        # Strip arrows / emojis / brackets that TTS reads literally
        line = re.sub(r"[→←↑↓➡⬅👇👆💥🔥👀✨⚡]", "", line)
        # Convert "→" word equivalents in case
        line = line.replace(" -> ", " ")
        # Collapse whitespace
        line = re.sub(r"\s+", " ", line).strip(" .!?")
        return line

    parts = [clean(line) for line in overlays[:3] if line and line.strip()]
    parts = [p for p in parts if p]
    if not parts:
        # Fallback to the hook if no usable overlays
        hook = (brief.get("hook_3s") or "").strip()
        if hook:
            parts.append(clean(hook[:120]))
    parts.append(clean(cta))
    return ". ".join(parts) + "."


def _generate_tts_openai(
    text: str,
    voice: str,
    out_path: Path,
    *,
    speed: float = 1.15,
) -> bool:
    """Generate a TTS mp3 via OpenAI's tts-1 model.

    Voice ids: alloy / echo / fable / onyx / nova / shimmer.
    ``speed`` 1.10-1.25 gives a brainrot-energy delivery without
    distorting the voice. Cached on disk by (text, voice, speed)
    hash so re-rendering the same variant doesn't re-bill OpenAI.
    """
    import hashlib
    import os
    import httpx

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log.info("OpenAI key missing — skipping voice generation")
        return False

    cache_key = hashlib.sha256(
        f"{voice}|{speed}|{text}".encode()
    ).hexdigest()[:16]
    cache_path = (
        CACHE_DIR / "audio" / "tts" / f"{voice}_{cache_key}.mp3"
    )
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if cache_path.exists() and cache_path.stat().st_size > 0:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(cache_path.read_bytes())
        return True

    try:
        r = httpx.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "tts-1",
                "voice": voice,
                "input": text[:4000],  # OpenAI's TTS hard cap
                "speed": max(0.5, min(2.0, speed)),
            },
            timeout=60.0,
        )
        r.raise_for_status()
        cache_path.write_bytes(r.content)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(r.content)
        log.info(
            "TTS: %d chars · voice=%s · speed=%.2f → %.1f KB",
            len(text), voice, speed, len(r.content) / 1024,
        )
        return True
    except Exception as exc:
        log.warning("TTS: OpenAI call failed: %s", exc)
        return False


def _resolve_sfx_layers(video_duration: float) -> list[tuple[Path, int, float]]:
    """Return the list of SFX mp3s to splice onto the final mix.

    Each entry is (mp3_path, delay_ms, volume). Files that aren't on
    disk are silently skipped — the user controls which sfx are
    enabled simply by dropping/removing mp3s in data/cache/audio/sfx/.
    SFX whose delay falls beyond the video's duration are also pruned.
    """
    out: list[tuple[Path, int, float]] = []
    if not _AUDIO_SFX_DIR.exists():
        return out
    duration_ms = int(video_duration * 1000)
    for stem, delay_ms, volume in _SFX_TIMELINE:
        if delay_ms >= duration_ms:
            continue
        candidate = _AUDIO_SFX_DIR / f"{stem}.mp3"
        if candidate.exists() and candidate.stat().st_size > 0:
            out.append((candidate, delay_ms, volume))
    return out


def _try_apply_audio_layers(
    *,
    video_path: Path,
    variant: dict[str, Any],
    include_music: bool,
    include_voice: bool,
    include_sfx: bool = True,
    voice_id: str = "alloy",
) -> bool:
    """Multi-layer audio overlay: music bed + voiceover + game SFX
    mixed onto the silent variant mp4.

    Tier strategy:
      • music alone             → stock-music overlay (loop to length).
      • voice alone             → TTS narration over silent video.
      • music + voice           → music ducks to 25%, voice rides on top.
      • + sfx (when on disk)    → up to 5 mobile-game SFX (whoosh,
        swoosh ×2, drop, brand chime) spliced at fixed beats matching
        the 5-second clip boundaries. Volumes calibrated to punctuate
        without burying the narration.
      • none of the above       → no-op.

    The original silent mp4 is backed up as ``.silent.mp4`` so the
    user can re-roll the audio mix without re-running Scenario.

    Returns True iff an audio track ended up on the final mp4.
    """
    import subprocess

    if not include_music and not include_voice and not include_sfx:
        return False

    duration = _estimate_video_duration(video_path)
    if duration <= 0:
        log.warning("audio: ffprobe failed on %s", video_path)
        return False

    # Backup silent video first
    silent_backup = video_path.with_suffix(".silent.mp4")
    if not silent_backup.exists():
        try:
            silent_backup.write_bytes(video_path.read_bytes())
        except OSError:
            pass
    src_video = silent_backup if silent_backup.exists() else video_path

    # ─── Resolve music track ────────────────────────────────────
    music_path: Path | None = None
    if include_music:
        pitch = (
            ((variant.get("brief") or {}).get("emotional_pitch"))
            or (
                (variant.get("centroid_hook") or {}).get("emotional_pitch")
                if "centroid_hook" in variant
                else None
            )
            or "satisfaction"
        )
        vibe = _PITCH_VIBE.get(pitch, _PITCH_VIBE["other"])
        candidate = _AUDIO_LIBRARY_DIR / f"{vibe}.mp3"
        if not candidate.exists():
            candidate = _AUDIO_LIBRARY_DIR / "default.mp3"
        if candidate.exists():
            music_path = candidate
            log.info("audio: music bed = %s (vibe=%s)", music_path.name, vibe)
        else:
            log.info(
                "audio: no music library track on disk — proceeding voice-only"
            )

    # ─── Resolve voice track ────────────────────────────────────
    voice_path: Path | None = None
    if include_voice:
        brief = variant.get("brief") or {}
        # Prefer Opus-authored bespoke script (custom per variant),
        # fall back to text_overlays concat when Anthropic isn't
        # reachable.
        target_game = variant.get("_target_game") or {}
        archetype_id_for_voice = brief.get("archetype_id") or ""
        narration = _opus_brainrot_script(
            brief=brief,
            target_game=target_game,
            archetype_id=archetype_id_for_voice,
        ) or _build_brainrot_narration(brief)
        if narration.strip(". "):
            voice_path = video_path.with_suffix(".voice.mp3")
            ok = _generate_tts_openai(narration, voice_id, voice_path)
            if not ok:
                voice_path = None
            else:
                log.info(
                    "audio: voiceover (%d chars · voice=%s) generated",
                    len(narration), voice_id,
                )

    # ─── Resolve SFX layers ─────────────────────────────────────
    sfx_layers: list[tuple[Path, int, float]] = (
        _resolve_sfx_layers(duration) if include_sfx else []
    )

    if music_path is None and voice_path is None and not sfx_layers:
        return False

    # ─── ffmpeg mix ─────────────────────────────────────────────
    out = video_path.with_suffix(".audio.mp4")
    inputs: list[str] = ["-i", str(src_video)]
    # Track which input slot maps to which audio role; build the
    # filter_complex below by walking this list.
    audio_inputs: list[tuple[int, str, dict]] = []  # (idx, role, meta)
    next_idx = 1

    if music_path is not None:
        inputs += ["-stream_loop", "-1", "-i", str(music_path)]
        audio_inputs.append((next_idx, "music", {}))
        next_idx += 1
    if voice_path is not None:
        inputs += ["-i", str(voice_path)]
        audio_inputs.append((next_idx, "voice", {}))
        next_idx += 1
    for sfx_path, delay_ms, sfx_volume in sfx_layers:
        inputs += ["-i", str(sfx_path)]
        audio_inputs.append(
            (next_idx, "sfx", {"delay_ms": delay_ms, "volume": sfx_volume})
        )
        next_idx += 1

    # Build filter_complex. CRUCIAL: pad every audio source with
    # silence (apad) and then trim to video duration. Without this
    # ffmpeg shortens the output to the briefest input, which is how
    # we previously truncated 18s videos to 3s. Each role uses a
    # tailored chain:
    #   music → low volume, looped to length
    #   voice → full volume, padded to length
    #   sfx   → adelay to its timestamp, volume calibrated, padded
    chains: list[str] = []
    mix_labels: list[str] = []
    for idx, role, meta in audio_inputs:
        label = f"a{idx}"
        if role == "music":
            chains.append(
                f"[{idx}:a]volume=0.25,apad=whole_dur={duration:.3f},"
                f"atrim=0:{duration:.3f},asetpts=N/SR/TB[{label}]"
            )
        elif role == "voice":
            chains.append(
                f"[{idx}:a]volume=1.0,apad=whole_dur={duration:.3f},"
                f"atrim=0:{duration:.3f},asetpts=N/SR/TB[{label}]"
            )
        elif role == "sfx":
            delay_ms = meta["delay_ms"]
            volume = meta["volume"]
            # adelay shifts the sfx to its timestamp; apad then
            # extends silence to the full video length so amix doesn't
            # drop early.
            chains.append(
                f"[{idx}:a]volume={volume},adelay={delay_ms}|{delay_ms},"
                f"apad=whole_dur={duration:.3f},"
                f"atrim=0:{duration:.3f},asetpts=N/SR/TB[{label}]"
            )
        else:
            continue
        mix_labels.append(f"[{label}]")

    if not mix_labels:
        return False

    if len(mix_labels) == 1:
        # Single source: rename the chain output to [a] for the -map.
        # Easier: append a noop concat to relabel.
        filter_str = chains[0].replace(f"[a{audio_inputs[0][0]}]", "[a]")
    else:
        filter_str = (
            ";".join(chains)
            + f";{''.join(mix_labels)}amix=inputs={len(mix_labels)}:"
            f"duration=first:dropout_transition=0[a]"
        )

    # NOTE: NO ``-shortest`` flag — that's what was making ffmpeg cut
    # the output to the voice length. The ``-t`` cap below + the
    # apad-then-atrim chain in the filter ensure correct duration.
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_str,
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-t", f"{duration:.3f}",
        "-movflags", "+faststart",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log.warning(
            "audio: ffmpeg mix failed (%s)",
            proc.stderr.strip()[-300:],
        )
        return False

    try:
        out.replace(video_path)
    except OSError as e:
        log.warning("audio: rename failed: %s", e)
        return False

    layers = ", ".join(role for _, role, _ in audio_inputs)
    log.info("audio: mixed [%s] onto %s", layers, video_path.name)
    return True


def _video_has_audio(path: Path) -> bool:
    """Return True iff the mp4 contains an audio stream. Used by the
    Status endpoint and the render response so the UI can show an
    accurate "audio?" chip."""
    import subprocess

    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a",
                "-show_entries", "stream=codec_type",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True, text=True, timeout=10,
        )
        return "audio" in result.stdout
    except subprocess.SubprocessError:
        return False


def _resolve_app_id_for_game(game_name: str) -> str:
    """Find the cached report file's stem for a game name.

    Reports are keyed by app_id, but the user passes a game_name. Quick
    scan: read each report's target_game.name and return the first
    case-insensitive match.
    """
    if not REPORTS_CACHE_DIR.exists():
        raise HTTPException(status_code=404, detail="No cached reports yet")
    needle = game_name.strip().lower()
    for path in REPORTS_CACHE_DIR.glob("*_e2e.json"):
        try:
            data = json.loads(path.read_text())
            name = (data.get("target_game", {}).get("name") or "").lower()
            if name == needle:
                return path.stem.removesuffix("_e2e")
        except Exception:
            continue
    raise HTTPException(
        status_code=404,
        detail=f"No cached report matches game name {game_name!r}",
    )


def _endcard_path_for(app_id: str) -> Path | None:
    """Look for a pre-rendered endcard mp4 for this app_id. Returns
    ``None`` when no endcard is on disk — caller will skip the append.
    """
    if not app_id:
        return None
    candidate = _ENDCARDS_DIR / f"{app_id}.mp4"
    if candidate.exists() and candidate.stat().st_size > 0:
        return candidate
    return None


def _ffmpeg_concat(inputs: list[Path], output: Path) -> bool:
    """ffmpeg concat-demuxer with -c copy fallback to re-encode.

    Returns ``True`` on success. The fallback reencodes with libx264
    when the inputs have mismatched codecs/timestamps (common when
    mixing Scenario clips with manually-encoded endcards).
    """
    import subprocess
    import tempfile

    if not inputs:
        return False

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", dir=str(_VIDEOS_DIR), delete=False
    ) as f:
        for p in inputs:
            f.write(f"file '{p.resolve()}'\n")
        list_path = Path(f.name)

    try:
        cmd_copy = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_path), "-c", "copy", str(output),
        ]
        proc = subprocess.run(cmd_copy, capture_output=True, text=True)
        if proc.returncode != 0:
            log.info(
                "ffmpeg -c copy failed (%s); retrying with re-encode",
                proc.stderr.strip()[-200:],
            )
            cmd_reencode = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", str(list_path),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                str(output),
            ]
            proc = subprocess.run(cmd_reencode, capture_output=True, text=True)
            if proc.returncode != 0:
                log.error("ffmpeg re-encode failed: %s", proc.stderr[-500:])
                return False
        return output.exists() and output.stat().st_size > 0
    finally:
        try:
            list_path.unlink()
        except OSError:
            pass


def _estimate_video_duration(path: Path) -> float:
    """Cheap duration estimate via ffprobe; returns 0.0 on failure."""
    import subprocess

    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True, text=True, timeout=10,
        )
        return float(result.stdout.strip())
    except (subprocess.SubprocessError, ValueError):
        return 0.0
