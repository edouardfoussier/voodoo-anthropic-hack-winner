"""Backfill the Gemini deconstruction knowledge base from cached SensorTower data.

Walks every cached ``creatives_top_*.json`` under ``data/cache/sensortower/``,
extracts every unique ad creative SensorTower has surfaced for us, and runs
Gemini Pro Vision on the ones that don't yet have a cached deconstruction
under ``data/cache/deconstruct/<creative_id>.json``.

This is the foundation of the "knowledge base" architecture the mentor
suggested:

  • Stop running Gemini per-game-analysis. Run it ONCE per creative, EVER.
  • Every subsequent pipeline analysis (cross-game, cross-week, cross-machine)
    rehydrates from disk in <10ms instead of paying Gemini again.
  • A weekly cron on this script keeps the base fresh — every new top
    creative SensorTower surfaces gets analysed within a week, automatically.

Usage::

    # Backfill everything that's not yet deconstructed (default)
    uv run python -m scripts.scan_top_competitors

    # Smaller batch to validate cost before going wide
    uv run python -m scripts.scan_top_competitors --limit 20

    # Force re-deconstruct (e.g. after the prompt changes)
    uv run python -m scripts.scan_top_competitors --overwrite

Cost estimate: ~$0.001-0.005 per 15-second creative on Gemini 3 Flash.
A full ~400-creative backfill costs $2-5 and takes 8-15 minutes wall-clock
at concurrency=5.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("google.genai").setLevel(logging.WARNING)

from app._paths import CACHE_DIR
from app.analysis.deconstruct import deconstruct_batch
from app.models import RawCreative

ST_CACHE = CACHE_DIR / "sensortower"
DECON_CACHE = CACHE_DIR / "deconstruct"


def _scan_cached_creatives() -> dict[str, dict]:
    """Walk every creatives_top_*.json and return a deduped map of
    ``creative_id → ad_unit_dict``. Earliest-seen-wins (we don't merge
    fields across files).
    """
    out: dict[str, dict] = {}
    if not ST_CACHE.exists():
        return out
    for path in ST_CACHE.glob("creatives_top_*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for unit in data.get("ad_units") or []:
            cid = str(unit.get("id") or "")
            if not cid or cid in out:
                continue
            out[cid] = unit
    return out


def _ad_unit_to_raw_creative(unit: dict) -> RawCreative | None:
    """Coerce a raw ad_unit dict (from creatives_top_*.json) into a
    ``RawCreative`` Pydantic model so it can be fed to ``deconstruct_one``.
    Returns None when required fields are missing (no video URL, no app).
    """
    media = (unit.get("creatives") or [{}])[0]
    creative_url = media.get("creative_url") or ""
    if not creative_url:
        return None

    info = unit.get("app_info") or {}
    advertiser_name = info.get("name") or info.get("humanized_name") or "Unknown"
    app_id = str(info.get("app_id") or unit.get("app_id") or "")
    network = unit.get("network") or "Unknown"
    ad_type = unit.get("ad_type") or "video"

    first_seen = unit.get("first_seen_at")
    last_seen = unit.get("last_seen_at")
    if not first_seen:
        return None  # need first_seen to satisfy RawCreative

    try:
        return RawCreative(
            creative_id=str(unit.get("id") or ""),
            ad_unit_id=str(unit.get("id") or ""),
            app_id=app_id,
            advertiser_name=advertiser_name,
            network=network,
            ad_type=ad_type,
            creative_url=creative_url,
            thumb_url=media.get("thumb_url"),
            preview_url=media.get("preview_url"),
            phashion_group=unit.get("phashion_group"),
            share=None,
            first_seen_at=first_seen,
            last_seen_at=last_seen or first_seen,
            video_duration=media.get("video_duration"),
            aspect_ratio=None,
            width=media.get("width"),
            height=media.get("height"),
            message=media.get("message"),
            button_text=media.get("button_text"),
            days_active=None,
        )
    except Exception as exc:
        logging.warning(
            "Skipping malformed ad unit %s: %s", unit.get("id"), exc
        )
        return None


def _filter_to_undeconstructed(
    candidates: list[RawCreative],
    overwrite: bool,
) -> list[RawCreative]:
    """Drop creatives whose deconstruction is already on disk."""
    if overwrite:
        return candidates
    out: list[RawCreative] = []
    for c in candidates:
        target = DECON_CACHE / f"{c.creative_id}.json"
        if target.exists() and target.stat().st_size > 0:
            continue
        out.append(c)
    return out


async def main_async(args: argparse.Namespace) -> int:
    log = logging.getLogger(__name__)

    log.info("Scanning cached SensorTower creatives in %s", ST_CACHE)
    units = _scan_cached_creatives()
    log.info("Found %d unique creative_ids across cache files", len(units))

    raw: list[RawCreative] = []
    for unit in units.values():
        rc = _ad_unit_to_raw_creative(unit)
        if rc is not None:
            raw.append(rc)
    log.info("Coerced %d into RawCreative models", len(raw))

    pending = _filter_to_undeconstructed(raw, args.overwrite)
    log.info(
        "%d still need Gemini analysis (%d already on disk)",
        len(pending),
        len(raw) - len(pending),
    )

    if args.limit and args.limit < len(pending):
        pending = pending[: args.limit]
        log.info("Capped to --limit=%d for this run", args.limit)

    if not pending:
        log.info("Nothing to do. The knowledge base is fully up to date. ✓")
        return 0

    DECON_CACHE.mkdir(parents=True, exist_ok=True)

    log.info(
        "Running Gemini on %d creatives with concurrency=%d…",
        len(pending),
        args.concurrency,
    )

    started = datetime.now()
    results = await deconstruct_batch(pending, concurrency=args.concurrency)
    elapsed = (datetime.now() - started).total_seconds()

    successes = 0
    failures = 0
    fresh_runs = 0
    cache_hits = 0
    for (item, lat) in results:
        if isinstance(item, Exception):
            failures += 1
            continue
        successes += 1
        # ``deconstruct_one`` returns elapsed=0.0 on cache hits — handy
        # signal to count how many were already on disk vs freshly run.
        if lat == 0.0:
            cache_hits += 1
        else:
            fresh_runs += 1

    log.info(
        "DONE — %ds wall-clock · %d ✓ (%d fresh, %d cache hit) · %d ✗",
        int(elapsed),
        successes,
        fresh_runs,
        cache_hits,
        failures,
    )
    log.info("Cache populated at %s", DECON_CACHE)
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max number of fresh Gemini calls this run (default: no cap)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-deconstruct creatives already in cache (e.g. after the prompt changed)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=5,
        help="Parallel Gemini calls (default: 5; bump cautiously — Gemini's rate cap kicks in fast on the free tier)",
    )
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
