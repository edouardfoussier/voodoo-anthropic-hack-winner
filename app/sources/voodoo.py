"""Voodoo catalog harvester.

Single entry point: :func:`fetch_voodoo_catalog`. The result is the full
list of Voodoo-published iOS games as ``AppMetadata`` objects, persisted
to ``data/cache/voodoo/catalog.json`` for 7 days.

Why three SensorTower endpoints (not the spec's two)?
---------------------------------------------------
The original plan used ``/v1/unified/search_entities?entity_type=app&term=Voodoo``
+ a single batched ``/v1/ios/apps`` call. That term-based search ranks by
**name relevance** to "voodoo", so it returns ~5 apps whose *name* contains
the word and skips Voodoo's other ~500 hits — Voodoo's own real catalog is
523 unified apps, almost none of which have "voodoo" in the title.

The reliable path uses ``entity_type=publisher`` first to discover the
publisher dossier (which includes a ``unified_apps[]`` array of every
game Voodoo ever shipped), then resolves unified → iTunes IDs via
``/v1/unified/apps?app_id_type=unified`` before pulling rich iOS metadata
in batched ``/v1/ios/apps`` calls.

Cold-path API budget (per 7-day cache cycle):

- 1 publisher search
- ~6 unified→iTunes mapping calls (chunks of 100)
- ~4 iOS metadata calls (chunks of 100)

Every chunk is independently disk-cached via :func:`app._cache.disk_cached`,
so a re-run that hits the API after the JSON snapshot expires only re-fetches
the chunks whose payloads changed.

Stays consistent with :mod:`app.sources.sensortower` — same ``httpx.Client``,
same ``disk_cached`` helper, same ``AppMetadata`` Pydantic return type.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app._cache import disk_cached
from app._paths import CACHE_DIR
from app.models import AppMetadata
from app.sources.sensortower import _get

log = logging.getLogger(__name__)

VOODOO_CACHE_DIR: Path = CACHE_DIR / "voodoo"
SENSORTOWER_CACHE_DIR: Path = CACHE_DIR / "sensortower"

CATALOG_FILENAME = "catalog.json"
CATALOG_TTL_SECONDS = 7 * 24 * 3600  # 7 days

# The legitimate Voodoo unified publisher_id observed from
# /v1/unified/search_entities?entity_type=publisher&term=Voodoo. Locking on
# the publisher_id (and exact name match as a fallback) is the only way to
# avoid imposter publishers — SensorTower returns ~10 lookalikes that abuse
# zero-width characters or extra suffixes (e.g. ``"VOODOO\u00ad"``,
# ``"Voodoo Technologies Private Limited"``, ``"InVooDoo"``).
VOODOO_PUBLISHER_ID = "59bad4eb63f2dc0d0b9689e1"
VOODOO_PUBLISHER_NAME = "Voodoo"

# Acceptable ``publisher_name`` values on individual app records — used by
# the creatives advertiser-filter endpoint.
VOODOO_PUBLISHER_NAME_VARIANTS: tuple[str, ...] = (
    "voodoo",
    "voodoo sas",
    "voodoo.io",
)

SEARCH_LIMIT = 10
DEFAULT_COUNTRY = "US"

# URL length keeps us below typical 8 KB limits.
UNIFIED_BATCH_SIZE = 100  # 24-char hex IDs → ~2.5 KB per chunk
IOS_BATCH_SIZE = 100      # 9-10 digit IDs → ~1 KB per chunk


# ---------------------------------------------------------------------------
# Step 1: discover the Voodoo publisher dossier
# ---------------------------------------------------------------------------


def _is_official_voodoo(entry: dict[str, Any]) -> bool:
    """Return True only for the canonical Voodoo publisher entity."""
    if entry.get("publisher_id") == VOODOO_PUBLISHER_ID:
        return True
    name = (entry.get("publisher_name") or entry.get("name") or "").strip()
    return name == VOODOO_PUBLISHER_NAME


def _fetch_voodoo_publisher() -> dict[str, Any] | None:
    """Fetch the Voodoo publisher dossier (with ``unified_apps[]``)."""
    params = {
        "entity_type": "publisher",
        "term": VOODOO_PUBLISHER_NAME,
        "limit": SEARCH_LIMIT,
    }
    raw = disk_cached(
        SENSORTOWER_CACHE_DIR,
        "search_publisher_voodoo",
        params,
        lambda: _get("/v1/unified/search_entities", params),
    )

    candidates: list[dict[str, Any]] = (
        raw if isinstance(raw, list) else raw.get("apps") or raw.get("publishers") or []
    )

    for entry in candidates:
        if _is_official_voodoo(entry):
            unified_apps = entry.get("unified_apps") or []
            log.info(
                "Voodoo publisher located (id=%s, %d unified apps)",
                entry.get("publisher_id"),
                len(unified_apps),
            )
            return entry

    log.warning(
        "No canonical Voodoo publisher in %d candidates. Names seen: %s",
        len(candidates),
        [c.get("publisher_name") for c in candidates],
    )
    return None


# ---------------------------------------------------------------------------
# Step 2: unified app IDs → iTunes app IDs
# ---------------------------------------------------------------------------


def _chunked(seq: list[str], size: int) -> list[list[str]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def _fetch_unified_chunk(unified_ids: list[str]) -> list[dict[str, Any]]:
    csv_ids = ",".join(unified_ids)
    params = {"app_ids": csv_ids, "app_id_type": "unified"}
    resp = disk_cached(
        SENSORTOWER_CACHE_DIR,
        f"unified_apps_voodoo_{len(unified_ids)}",
        params,
        lambda: _get("/v1/unified/apps", params),
    )
    return resp.get("apps") or []


def _resolve_unified_to_itunes(
    unified_ids: list[str],
) -> dict[str, str]:
    """Return ``{unified_app_id: itunes_app_id}`` for apps with an iOS variant."""
    mapping: dict[str, str] = {}
    chunks = _chunked(unified_ids, UNIFIED_BATCH_SIZE)
    log.info(
        "Resolving %d unified IDs → iTunes IDs in %d chunks",
        len(unified_ids),
        len(chunks),
    )
    for chunk in chunks:
        apps = _fetch_unified_chunk(chunk)
        for app in apps:
            unified_id = str(app.get("unified_app_id") or "")
            itunes_apps = app.get("itunes_apps") or []
            if not unified_id or not itunes_apps:
                continue
            ios_id = itunes_apps[0].get("app_id")
            if ios_id is None:
                continue
            mapping[unified_id] = str(ios_id)
    return mapping


# ---------------------------------------------------------------------------
# Step 3: rich iOS metadata
# ---------------------------------------------------------------------------


def _fetch_ios_chunk(
    itunes_ids: list[str], *, country: str
) -> list[dict[str, Any]]:
    csv_ids = ",".join(itunes_ids)
    params = {"app_ids": csv_ids, "country": country}
    resp = disk_cached(
        SENSORTOWER_CACHE_DIR,
        f"ios_apps_voodoo_{country}_{len(itunes_ids)}",
        params,
        lambda: _get("/v1/ios/apps", params),
    )
    return resp.get("apps") or []


def _fetch_ios_metadata(
    itunes_ids: list[str], *, country: str = DEFAULT_COUNTRY
) -> dict[str, dict[str, Any]]:
    """Return ``{itunes_app_id: meta_dict}`` for the supplied IDs."""
    if not itunes_ids:
        return {}

    out: dict[str, dict[str, Any]] = {}
    chunks = _chunked(itunes_ids, IOS_BATCH_SIZE)
    log.info(
        "Fetching iOS metadata for %d apps in %d chunks (country=%s)",
        len(itunes_ids),
        len(chunks),
        country,
    )
    for chunk in chunks:
        apps = _fetch_ios_chunk(chunk, country=country)
        for meta in apps:
            aid = meta.get("app_id")
            if aid is None:
                continue
            out[str(aid)] = meta
    return out


# ---------------------------------------------------------------------------
# Step 4: assembly
# ---------------------------------------------------------------------------


def _build_app_metadata(
    *, unified_id: str, ios_id: str, meta: dict[str, Any]
) -> AppMetadata | None:
    """Combine unified ID + iOS meta → :class:`AppMetadata`."""
    try:
        return AppMetadata(
            app_id=str(meta["app_id"]),
            unified_app_id=unified_id,
            name=meta["name"],
            publisher_name=meta.get("publisher_name") or VOODOO_PUBLISHER_NAME,
            icon_url=meta["icon_url"],
            categories=meta.get("categories", []) or [],
            description=meta.get("description") or "",
            screenshot_urls=meta.get("screenshot_urls", []) or [],
            rating=meta.get("rating"),
            rating_count=meta.get("rating_count"),
        )
    except (KeyError, ValidationError) as exc:
        log.debug(
            "Skipping Voodoo app ios_id=%s unified=%s: %s",
            ios_id,
            unified_id,
            exc,
        )
        return None


def _sort_catalog(catalog: list[AppMetadata]) -> list[AppMetadata]:
    """Sort by rating_count desc, then name asc — drives the UI pick-list order."""
    return sorted(
        catalog,
        key=lambda m: (-(m.rating_count or 0), m.name.casefold()),
    )


# ---------------------------------------------------------------------------
# Catalog snapshot (the user-facing 7-day disk cache)
# ---------------------------------------------------------------------------


def _catalog_path() -> Path:
    return VOODOO_CACHE_DIR / CATALOG_FILENAME


def _load_cached_catalog() -> list[AppMetadata] | None:
    path = _catalog_path()
    if not path.exists():
        return None

    age_s = time.time() - path.stat().st_mtime
    if age_s > CATALOG_TTL_SECONDS:
        log.info(
            "Voodoo catalog snapshot is stale (%.1f days old), refreshing",
            age_s / 86400,
        )
        return None

    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError:
        log.warning("Voodoo catalog snapshot is corrupted, refreshing")
        return None

    parsed: list[AppMetadata] = []
    for entry in raw:
        try:
            parsed.append(AppMetadata.model_validate(entry))
        except ValidationError:
            log.warning("Dropping invalid cached entry for app %s", entry.get("app_id"))
            continue
    return parsed


def _persist_catalog(catalog: list[AppMetadata]) -> None:
    path = _catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [m.model_dump(mode="json") for m in catalog]
    path.write_text(json.dumps(payload, indent=2))
    log.info("Wrote Voodoo catalog snapshot (%d apps) to %s", len(catalog), path)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def fetch_voodoo_catalog(*, refresh: bool = False) -> list[AppMetadata]:
    """Return the full list of Voodoo-published mobile games (iOS).

    Cached on disk under ``data/cache/voodoo/catalog.json``. Subsequent calls
    within the 7-day TTL are instant and hit zero APIs. Pass ``refresh=True``
    to force a re-fetch (still bounded to one publisher search, plus chunked
    unified→iTunes mapping and chunked iOS metadata batches — every chunk
    independently disk-cached).

    The returned list is sorted by ``rating_count`` desc (then name) so the
    most popular Voodoo titles surface first in the UI.
    """
    if not refresh:
        cached = _load_cached_catalog()
        if cached is not None:
            log.debug("Voodoo catalog cache hit (%d apps)", len(cached))
            return cached

    log.info("CACHE MISS for Voodoo catalog — querying SensorTower")

    publisher = _fetch_voodoo_publisher()
    if publisher is None:
        log.warning("Voodoo publisher entity not found; returning empty catalog.")
        return []

    unified_ids = [str(uid) for uid in (publisher.get("unified_apps") or [])]
    if not unified_ids:
        log.warning("Voodoo publisher has no unified_apps entries.")
        return []

    unified_to_itunes = _resolve_unified_to_itunes(unified_ids)
    if not unified_to_itunes:
        log.warning("No iTunes app IDs resolved from %d unified IDs.", len(unified_ids))
        return []

    itunes_to_unified = {ios_id: u for u, ios_id in unified_to_itunes.items()}
    meta_by_id = _fetch_ios_metadata(list(itunes_to_unified.keys()))

    catalog: list[AppMetadata] = []
    for ios_id, meta in meta_by_id.items():
        unified_id = itunes_to_unified.get(ios_id, "")
        am = _build_app_metadata(unified_id=unified_id, ios_id=ios_id, meta=meta)
        if am is not None:
            catalog.append(am)

    catalog = _sort_catalog(catalog)
    log.info(
        "Voodoo catalog assembled: %d apps (from %d unified IDs)",
        len(catalog),
        len(unified_ids),
    )

    if catalog:
        _persist_catalog(catalog)

    return catalog


# ---------------------------------------------------------------------------
# Advertiser-creatives lookup (what Voodoo is running on its OWN game)
# ---------------------------------------------------------------------------


# Networks the /v1/unified/ad_intel/creatives endpoint accepts. Anything else
# (ironSource, Pangle, …) returns SensorTower 422.
VOODOO_ADVERTISER_NETWORKS = "Facebook,Instagram,TikTok,Youtube,Unity,Admob,Applovin"

VOODOO_ADVERTISER_AD_TYPES = (
    "video,video-interstitial,playable,image,banner,full_screen"
)

# 180-day window covers most active campaigns while excluding ancient assets.
DEFAULT_ADVERTISER_LOOKBACK_DAYS = 180


def fetch_voodoo_app_creatives(
    app_id: str,
    *,
    country: str = DEFAULT_COUNTRY,
    limit: int = 20,
    start_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return the ad creatives Voodoo is currently running on its own app.

    ``app_id`` may be either the iTunes id (the public ``app_id`` field on
    ``AppMetadata``) or the unified id directly. The function looks the
    target up in the cached Voodoo catalog to resolve to a unified id, then
    hits ``/v1/unified/ad_intel/creatives`` with networks + ad-types known
    to be supported.

    Returns ``[]`` if the app is unknown to the catalog or SensorTower
    returns no ad units (zero ads recently is normal, not an error).

    The returned shape is a list of plain dicts (not Pydantic) — keys map
    directly onto SensorTower's ``ad_units[].creatives[0]`` fields, ready
    for the brief-generation prompt or the API response.
    """
    catalog = fetch_voodoo_catalog()
    by_itunes = {m.app_id: m for m in catalog}
    by_unified = {m.unified_app_id: m for m in catalog if m.unified_app_id}

    target = by_itunes.get(str(app_id)) or by_unified.get(str(app_id))
    if target is None or not target.unified_app_id:
        log.info("fetch_voodoo_app_creatives: %s not in Voodoo catalog", app_id)
        return []

    effective_start = start_date or (
        date.today() - timedelta(days=DEFAULT_ADVERTISER_LOOKBACK_DAYS)
    ).isoformat()

    params: dict[str, Any] = {
        "app_ids": target.unified_app_id,
        "start_date": effective_start,
        "countries": country,
        "networks": VOODOO_ADVERTISER_NETWORKS,
        "ad_types": VOODOO_ADVERTISER_AD_TYPES,
        "limit": limit,
    }

    try:
        # Cached on disk per (app_id, country, start_date) so re-runs are free.
        resp = disk_cached(
            VOODOO_CACHE_DIR / "advertiser_creatives",
            f"{target.unified_app_id}_{country}_{effective_start}",
            params,
            lambda: _get("/v1/unified/ad_intel/creatives", params),
        )
    except Exception:
        # Best-effort: SensorTower 422 is common when an app has zero ad
        # activity in the window. Treat as empty rather than an error.
        log.exception(
            "fetch_voodoo_app_creatives: SensorTower /creatives failed for %s",
            target.unified_app_id,
        )
        return []

    ad_units = resp.get("ad_units") or []
    out: list[dict[str, Any]] = []
    for au in ad_units:
        creatives = au.get("creatives") or []
        if not creatives:
            continue
        first = creatives[0]
        out.append(
            {
                "creative_id": str(first.get("id") or ""),
                "ad_unit_id": str(au.get("id") or ""),
                "app_id": str(app_id),
                "advertiser_name": target.name,
                "network": au.get("network") or "",
                "ad_type": au.get("ad_type") or "video",
                "creative_url": first.get("creative_url"),
                "thumb_url": first.get("thumb_url"),
                "preview_url": first.get("preview_url"),
                "first_seen_at": au.get("first_seen_at"),
                "last_seen_at": au.get("last_seen_at"),
                "share": au.get("share"),
                "phashion_group": au.get("phashion_group"),
                "message": first.get("message"),
                "button_text": first.get("button_text"),
            }
        )

    log.info(
        "fetch_voodoo_app_creatives: %s → %d ad_units (raw), %d returned",
        target.name,
        len(ad_units),
        len(out),
    )
    return out


def fetch_app_downloads_timeseries(
    unified_app_id: str,
    *,
    country: str = "US",
    days: int = 30,
    granularity: str = "daily",
) -> list[dict[str, Any]]:
    """Return a daily/monthly downloads time series for one app.

    Hits ``/v1/unified/downloads_by_sources`` and returns the
    ``breakdown[]`` array (~30 points for the default 30-day daily
    request). Each point has ``date``, ``organic_abs``, ``paid_abs``,
    ``paid_search_abs``, ``browser_abs`` and the matching ``*_frac``.

    Used by the Voodoo Portfolio page to draw a sparkline + compute a
    "trending up vs declining this week" signal so the PM knows which
    games to prioritise re-running ads on.

    Cached on disk per (unified_app_id, country, days, granularity).
    """
    from datetime import date, timedelta

    end = date.today()
    start = end - timedelta(days=days)
    params: dict[str, Any] = {
        "app_ids": unified_app_id,
        "countries": country,
        "date_granularity": granularity,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    try:
        resp = disk_cached(
            VOODOO_CACHE_DIR / "downloads_timeseries",
            f"{unified_app_id}_{country}_{days}_{granularity}",
            params,
            lambda: _get("/v1/unified/downloads_by_sources", params),
        )
    except Exception:
        log.exception(
            "fetch_app_downloads_timeseries: API call failed for %s",
            unified_app_id,
        )
        return []
    apps = resp.get("data") or []
    if not apps:
        return []
    return apps[0].get("breakdown") or []


def compute_downloads_trend(
    breakdown: list[dict[str, Any]],
) -> tuple[list[int], float | None]:
    """Compute (daily totals list, week-over-week trend percent).

    ``daily_totals``: one entry per breakdown point, sum of all download
    sources (organic + paid + paid_search + browser; *_browse and *_search
    are sub-buckets of organic_abs and would double-count).

    ``trend_pct``: (last 7d sum / prior 7d sum) − 1, expressed as a
    fraction (e.g. 0.065 = +6.5% w/w). Returns ``None`` when there are
    fewer than 14 daily points or when the prior window is zero.
    """
    daily: list[int] = []
    for p in breakdown:
        total = (
            int(p.get("organic_abs") or 0)
            + int(p.get("paid_abs") or 0)
            + int(p.get("paid_search_abs") or 0)
            + int(p.get("browser_abs") or 0)
        )
        daily.append(total)

    if len(daily) < 14:
        return daily, None
    recent = sum(daily[-7:])
    prior = sum(daily[-14:-7])
    if prior == 0:
        return daily, None
    return daily, (recent - prior) / prior


def is_voodoo_app(app_id: str) -> bool:
    """Cheap catalog-membership check for the brief-generation pipeline.

    Used to decide whether to fetch the Voodoo benchmark for a given target
    game. Hits the cached catalog only — never the API.
    """
    catalog = fetch_voodoo_catalog()
    return any(m.app_id == str(app_id) for m in catalog)


__all__ = [
    "fetch_voodoo_catalog",
    "fetch_voodoo_app_creatives",
    "fetch_app_downloads_timeseries",
    "compute_downloads_trend",
    "is_voodoo_app",
    "VOODOO_PUBLISHER_ID",
    "VOODOO_PUBLISHER_NAME",
    "VOODOO_PUBLISHER_NAME_VARIANTS",
    "VOODOO_CACHE_DIR",
]
