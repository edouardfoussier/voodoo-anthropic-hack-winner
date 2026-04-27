"""SensorTower API client.

Owner: Partner 1. This is the v1 baseline extracted by Edouard from
``notebooks/02_pipeline_e2e.py`` so the Streamlit pipeline can ship.
Refactor freely — the public surface (``resolve_game``, ``fetch_top_advertisers``,
``fetch_top_creatives``) is what ``app.pipeline`` consumes and should stay
stable.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx

from app._cache import disk_cached
from app._paths import CACHE_DIR
from app.models import AppMetadata, RawCreative

log = logging.getLogger(__name__)

ST_BASE = "https://api.sensortower.com"
DEFAULT_CACHE_DIR = CACHE_DIR / "sensortower"


# ---------------------------------------------------------------------------
# Low-level GET
# ---------------------------------------------------------------------------


def _token() -> str:
    token = os.environ.get("SENSORTOWER_API_KEY")
    if not token:
        raise RuntimeError("SENSORTOWER_API_KEY missing. Add it to .env.")
    return token


def _get(path: str, params: dict[str, Any]) -> dict:
    """SensorTower GET helper — auto-injects auth_token, raises on non-2xx."""
    full_params = {**params, "auth_token": _token()}
    with httpx.Client(timeout=30.0) as client:
        r = client.get(f"{ST_BASE}{path}", params=full_params)
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_game(term: str, *, country: str = "US") -> AppMetadata:
    """Search SensorTower for ``term``, fetch the top hit's iOS metadata.

    Combines ``/v1/unified/search_entities`` + ``/v1/ios/apps``. Caches both
    responses under ``data/cache/sensortower/``.
    """
    search_params = {"entity_type": "app", "term": term, "limit": 5}
    search = disk_cached(
        DEFAULT_CACHE_DIR,
        f"search_{term}",
        search_params,
        lambda: _get("/v1/unified/search_entities", search_params),
    )

    candidates = search if isinstance(search, list) else search.get("apps", [])
    if not candidates:
        raise ValueError(
            f"No SensorTower match for {term!r}. Try a more specific name."
        )

    # Iterate candidates: search-by-name often returns the web/Steam version
    # of a brand (e.g. "aquapark.io" → the Poki browser game) before its
    # mobile listing. Pick the first candidate that exposes an iOS variant.
    target = None
    for c in candidates:
        if c.get("ios_apps"):
            target = c
            break
    if target is None:
        names_seen = [c.get("name") or c.get("humanized_name") for c in candidates]
        raise ValueError(
            f"No iOS variant for {term!r} in {len(candidates)} candidates "
            f"(saw: {names_seen}). Try a more specific App Store name."
        )

    ios_apps = target.get("ios_apps") or []
    ios_app_id = str(ios_apps[0].get("app_id") or ios_apps[0].get("id"))

    meta_params = {"app_ids": ios_app_id, "country": country}
    meta_resp = disk_cached(
        DEFAULT_CACHE_DIR,
        f"meta_{ios_app_id}_{country}",
        meta_params,
        lambda: _get("/v1/ios/apps", meta_params),
    )
    meta = meta_resp["apps"][0]

    return AppMetadata(
        app_id=str(meta["app_id"]),
        unified_app_id=str(target["app_id"]),
        name=meta["name"],
        publisher_name=meta["publisher_name"],
        icon_url=meta["icon_url"],
        categories=meta.get("categories", []),
        description=meta.get("description", ""),
        screenshot_urls=meta.get("screenshot_urls", []),
        rating=meta.get("rating"),
        rating_count=meta.get("rating_count"),
    )


def fetch_creatives_for_app(
    *,
    unified_app_id: str,
    country: str = "US",
    networks: str = "Facebook,Instagram,TikTok,Admob,Applovin,Unity",
    ad_types: str = "video,video-interstitial,playable",
    start_date: str | None = None,
    lookback_days: int = 180,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Fetch every cached/live ad for one specific advertiser
    (any unified app_id — Voodoo or external).

    Hits ``/v1/unified/ad_intel/creatives`` with ``app_ids=<unified_id>``.
    SensorTower returns up to ``limit`` ad_units, each containing the
    creative URL, network, ad_type, first/last seen dates, etc.

    Cached on disk per (app_id, country, start_date) so opening the
    same competitor twice is free. Returns an empty list when the app
    has no recent ad activity (SensorTower 422) or the call fails —
    callers should treat that as "no data" rather than an error.
    """
    from datetime import date, timedelta

    if not unified_app_id or unified_app_id == "unknown":
        return []

    effective_start = start_date or (
        date.today() - timedelta(days=lookback_days)
    ).isoformat()

    params: dict[str, Any] = {
        "app_ids": unified_app_id,
        "start_date": effective_start,
        "countries": country,
        "networks": networks,
        "ad_types": ad_types,
        "limit": limit,
    }

    try:
        resp = disk_cached(
            DEFAULT_CACHE_DIR / "advertiser_creatives",
            f"{unified_app_id}_{country}_{effective_start}",
            params,
            lambda: _get("/v1/unified/ad_intel/creatives", params),
        )
    except Exception:
        log.exception(
            "fetch_creatives_for_app: SensorTower /creatives failed for %s",
            unified_app_id,
        )
        return []

    return resp.get("ad_units") or []


def fetch_app_meta_by_unified_id(
    unified_app_id: str,
    *,
    country: str = "US",
) -> dict[str, Any] | None:
    """Look up rich app metadata (name, publisher, icon, description,
    rating, categories) for any unified_app_id without going through
    name resolution.

    Two-step process matching how the Voodoo catalog resolver works:
      1. ``/v1/unified/apps?app_ids=<id>&app_id_type=unified`` →
         returns ``itunes_apps[]`` (the iOS variant of the unified app)
      2. ``/v1/ios/apps?app_ids=<itunes_id>`` → returns the rich meta
         (icon_url, publisher_name, description, rating…)

    Both calls cached on disk so re-opening the same competitor is
    free. Returns ``None`` when either lookup fails — callers fall
    back to whatever metadata they already have.
    """
    if not unified_app_id or unified_app_id == "unknown":
        return None

    # ─── Step 1: unified → iTunes app_id ────────────────────────
    unified_params = {"app_ids": unified_app_id, "app_id_type": "unified"}
    try:
        unified_resp = disk_cached(
            DEFAULT_CACHE_DIR,
            f"unified_app_meta_{unified_app_id}",
            unified_params,
            lambda: _get("/v1/unified/apps", unified_params),
        )
    except Exception:
        log.exception(
            "fetch_app_meta_by_unified_id: /v1/unified/apps failed for %s",
            unified_app_id,
        )
        return None

    apps = unified_resp.get("apps") or []
    if not apps:
        return None
    unified_app = apps[0]
    itunes_apps = unified_app.get("itunes_apps") or []
    if not itunes_apps:
        # No iOS variant — return what little the unified call gave us
        # rather than nothing (name + humanized_name are usually set).
        return {
            "name": unified_app.get("name") or unified_app.get("humanized_name"),
            "publisher_name": unified_app.get("publisher_name"),
            "icon_url": unified_app.get("icon_url"),
            "description": unified_app.get("description"),
        }

    itunes_app_id = str(itunes_apps[0].get("app_id") or itunes_apps[0].get("id") or "")
    if not itunes_app_id:
        return None

    # ─── Step 2: iTunes app_id → rich meta ──────────────────────
    ios_params = {"app_ids": itunes_app_id, "country": country}
    try:
        ios_resp = disk_cached(
            DEFAULT_CACHE_DIR,
            f"ios_app_meta_{itunes_app_id}_{country}",
            ios_params,
            lambda: _get("/v1/ios/apps", ios_params),
        )
    except Exception:
        log.exception(
            "fetch_app_meta_by_unified_id: /v1/ios/apps failed for %s",
            itunes_app_id,
        )
        # Graceful: still surface what unified gave us
        return {
            "name": unified_app.get("name") or unified_app.get("humanized_name"),
            "publisher_name": unified_app.get("publisher_name"),
            "icon_url": unified_app.get("icon_url"),
        }
    ios_apps = ios_resp.get("apps") or []
    if not ios_apps:
        return None
    return ios_apps[0]


def fetch_top_advertisers(
    *,
    category_id: int,
    country: str,
    period: str,
    period_date: str,
    limit: int = 10,
) -> list[dict]:
    """Top advertisers by Share-of-Voice for category × country × period.

    Uses ``network=All Networks`` (only this endpoint accepts it).
    Returns the raw ``apps`` list from SensorTower (each has ``name``,
    ``publisher_name``, ``sov``, ``app_id``...).
    """
    params = {
        "role": "advertisers",
        "date": period_date,
        "period": period,
        "category": category_id,
        "country": country,
        "network": "All Networks",
        "limit": limit,
    }
    resp = disk_cached(
        DEFAULT_CACHE_DIR,
        f"top_apps_{category_id}_{country}_{period}_{period_date}",
        params,
        lambda: _get("/v1/unified/ad_intel/top_apps", params),
    )
    return resp.get("apps") or resp.get("top_apps") or []


def fetch_sov_timeseries(
    app_ids: list[str],
    *,
    start_date: str,
    end_date: str,
    period: str = "week",
    os: str = "unified",
) -> list[dict]:
    """Network-level Share-of-Voice time series for one or more advertisers.

    Wraps ``GET /v1/{os}/ad_intel/network_analysis``. Returns the raw list of
    ``{app_id, country, network, date, sov}`` rows (the API returns either a
    bare list or an object wrapping one — we normalise to ``list``). Cached
    on disk so re-running the analysis on the same window costs zero quota.

    Returns an empty list if ``app_ids`` is empty after dropping ``"unknown"``
    sentinels — callers should treat that as a "no SoV data, fall back to
    proxy" signal rather than an error.
    """
    cleaned_ids = sorted({a for a in app_ids if a and a != "unknown"})
    if not cleaned_ids:
        return []

    params = {
        "app_ids": ",".join(cleaned_ids),
        "start_date": start_date,
        "end_date": end_date,
        "period": period,
    }
    cache_key = (
        f"sov_{os}_{period}_{start_date}_{end_date}_"
        f"{','.join(cleaned_ids)[:80]}"
    )
    resp = disk_cached(
        DEFAULT_CACHE_DIR,
        f"network_analysis_{os}_{period}_{end_date}",
        cache_key,
        lambda: _get(f"/v1/{os}/ad_intel/network_analysis", params),
    )

    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for key in ("network_analysis", "data", "results", "items"):
            if isinstance(resp.get(key), list):
                return resp[key]
    return []


def fetch_top_creatives(
    *,
    category_id: int,
    country: str,
    network: str,
    period: str,
    period_date: str,
    max_creatives: int = 8,
    ad_types: str = "video,video-interstitial",
    aspect_ratios: str = "9:16",
    video_durations: str = ":15",
    new_creative: bool = False,
) -> list[RawCreative]:
    """Top creatives in the category for a single network.

    ``creatives/top`` rejects ``network=All Networks`` — pass one network only.
    Each ad_unit groups visually-similar creatives (same ``phashion_group``);
    we take the first creative per ad_unit.
    """
    params = {
        "date": period_date,
        "period": period,
        "category": category_id,
        "country": country,
        "network": network,
        "ad_types": ad_types,
        "aspect_ratios": aspect_ratios,
        "video_durations": video_durations,
        "new_creative": "true" if new_creative else "false",
        "limit": max_creatives,
    }
    resp = disk_cached(
        DEFAULT_CACHE_DIR,
        f"creatives_top_{category_id}_{network}_{period_date}",
        params,
        lambda: _get("/v1/unified/ad_intel/creatives/top", params),
    )

    raw_creatives: list[RawCreative] = []
    for ad_unit in resp.get("ad_units", [])[:max_creatives]:
        creatives_in_unit = ad_unit.get("creatives") or []
        if not creatives_in_unit:
            continue
        c = creatives_in_unit[0]

        try:
            raw_creatives.append(
                RawCreative(
                    creative_id=str(c["id"]),
                    ad_unit_id=str(ad_unit["id"]),
                    app_id=str(ad_unit.get("app_id") or "unknown"),
                    advertiser_name=(ad_unit.get("app_info") or {}).get("name", "unknown"),
                    network=ad_unit.get("network", network),
                    ad_type=ad_unit.get("ad_type", "video"),
                    creative_url=c["creative_url"],
                    thumb_url=c.get("thumb_url"),
                    preview_url=c.get("preview_url"),
                    phashion_group=ad_unit.get("phashion_group"),
                    share=ad_unit.get("share"),
                    first_seen_at=ad_unit["first_seen_at"],
                    last_seen_at=ad_unit["last_seen_at"],
                    video_duration=c.get("video_duration"),
                    aspect_ratio=(
                        f"{c.get('width')}:{c.get('height')}" if c.get("width") else None
                    ),
                    width=c.get("width"),
                    height=c.get("height"),
                    message=c.get("message"),
                    button_text=c.get("button_text"),
                )
            )
        except Exception:  # noqa: BLE001
            log.exception("Failed to parse creative %s", c.get("id"))
            continue

    return raw_creatives


# ---------------------------------------------------------------------------
# Downloads by sources (paid vs organic UA breakdown)
# ---------------------------------------------------------------------------


def fetch_downloads_by_sources(
    *,
    unified_app_ids: list[str] | str,
    countries: str = "US",
    start_date: str,
    end_date: str,
    date_granularity: str = "monthly",
) -> list[dict[str, Any]]:
    """Fetch ``/v1/unified/downloads_by_sources`` — paid vs organic UA mix.

    Returns the raw ``data[]`` list — one entry per app, each with a
    ``breakdown[]`` of per-period download counts (organic_abs, paid_abs,
    paid_search_abs, browser_abs, …).

    ``unified_app_ids`` must be SensorTower **unified** ids (the 24-char
    hex strings, e.g. ``55c527c302ac64f9c0002b18``), not iTunes ids.
    """
    if isinstance(unified_app_ids, list):
        app_ids_csv = ",".join(unified_app_ids)
    else:
        app_ids_csv = unified_app_ids

    if not app_ids_csv:
        return []

    params: dict[str, Any] = {
        "app_ids": app_ids_csv,
        "countries": countries,
        "date_granularity": date_granularity,
        "start_date": start_date,
        "end_date": end_date,
    }
    label = f"downloads_by_sources_{countries}_{date_granularity}_{start_date}_{end_date}_{len(app_ids_csv)}"
    resp = disk_cached(
        DEFAULT_CACHE_DIR,
        label,
        params,
        lambda: _get("/v1/unified/downloads_by_sources", params),
    )
    if isinstance(resp, dict):
        return resp.get("data") or []
    if isinstance(resp, list):
        return resp
    return []


# Per-row keys in /v1/unified/downloads_by_sources breakdown[].
# These are the four top-level absolute-count buckets; ``organic_browse_abs``
# and ``organic_search_abs`` are sub-breakdowns of ``organic_abs`` and would
# double-count if summed in.
_DOWNLOADS_TOP_LEVEL_KEYS: tuple[str, ...] = (
    "organic_abs",
    "paid_abs",
    "paid_search_abs",
    "browser_abs",
)


def aggregate_downloads_breakdown(
    breakdown: list[dict[str, Any]],
) -> dict[str, float | int | None]:
    """Aggregate a ``breakdown[]`` list into paid/organic shares + total downloads.

    Returns ``{paid_share, organic_share, total_downloads}``. ``*_share``
    are floats in [0, 1] (or None when the total is zero); ``total_downloads``
    is the integer sum of every top-level absolute bucket across periods.
    """
    if not breakdown:
        return {"paid_share": None, "organic_share": None, "total_downloads": 0}

    totals: dict[str, int] = {k: 0 for k in _DOWNLOADS_TOP_LEVEL_KEYS}
    for row in breakdown:
        for k in _DOWNLOADS_TOP_LEVEL_KEYS:
            v = row.get(k)
            if isinstance(v, (int, float)) and v > 0:
                totals[k] += int(v)

    grand = sum(totals.values())
    if grand <= 0:
        return {"paid_share": None, "organic_share": None, "total_downloads": 0}

    paid = totals["paid_abs"] + totals["paid_search_abs"]
    organic = totals["organic_abs"] + totals["browser_abs"]

    return {
        "paid_share": round(paid / grand, 4),
        "organic_share": round(organic / grand, 4),
        "total_downloads": grand,
    }


# ---------------------------------------------------------------------------
# Network rank — per-(network, country) ad-intel rank for an app
# ---------------------------------------------------------------------------


def fetch_network_rank(
    *,
    app_ids: list[str] | str,
    networks: str = "Facebook,TikTok,Admob,Applovin",
    countries: str = "US",
    start_date: str,
    end_date: str,
    period: str = "week",
    os_slug: str = "unified",
) -> list[dict[str, Any]]:
    """Fetch ``/v1/{os}/ad_intel/network_analysis/rank`` and return the raw rows.

    Each row is ``{app_id, country, network, date, rank}``. Caller is
    responsible for picking the latest row per (network, country).

    ``os_slug`` defaults to ``"unified"`` since that's the cross-platform
    entry point and accepts unified app ids out of the box.
    """
    if isinstance(app_ids, list):
        app_ids_csv = ",".join(app_ids)
    else:
        app_ids_csv = app_ids

    if not app_ids_csv:
        return []

    params: dict[str, Any] = {
        "app_ids": app_ids_csv,
        "networks": networks,
        "countries": countries,
        "start_date": start_date,
        "end_date": end_date,
        "period": period,
    }
    label = (
        f"network_rank_{os_slug}_{countries}_{period}_"
        f"{start_date}_{end_date}_{len(app_ids_csv)}"
    )
    resp = disk_cached(
        DEFAULT_CACHE_DIR,
        label,
        params,
        lambda: _get(f"/v1/{os_slug}/ad_intel/network_analysis/rank", params),
    )
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        # Some SensorTower responses wrap the list in {"data": [...]}.
        return resp.get("data") or resp.get("ranks") or []
    return []

