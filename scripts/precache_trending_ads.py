"""Pre-cache the worldwide top trending mobile-game ad creatives.

Hits SensorTower's ``/v1/unified/ad_intel/creatives/top`` for a curated grid
of (network × country × game category) combinations covering the major
mobile-gaming ad-spend markets, and dumps the results into the existing
SensorTower disk cache so subsequent ``/api/creatives`` calls are instant
no matter which region / network the user filters on.

Usage::

    # Default: top creatives across (TikTok+Meta+Insta) × (US+GB+DE+FR+JP+BR+KR)
    # × Puzzle (7012) for the last month → ~21 distinct API calls
    uv run python -m scripts.precache_trending_ads

    # Wider net: also hit Casual + Action + Casino categories
    uv run python -m scripts.precache_trending_ads --categories 7012,7003,7001,7006

    # Force-refresh the disk cache (re-hit SensorTower even if cached)
    uv run python -m scripts.precache_trending_ads --refresh

The point of this is **demo density**: with the cache warm, the Ad Library
page shows real top-ranked creatives from every region/network the user
might filter on, not just the default US/Puzzle slice.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
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


# Curated demo grid — kept tight on purpose so we don't burn through the
# SensorTower quota. These are the markets / networks where mobile-gaming
# UA spend concentrates in 2026.
DEFAULT_NETWORKS = ["TikTok", "Facebook", "Instagram"]
DEFAULT_COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "KR"]
DEFAULT_CATEGORIES = [7012]  # iOS Puzzle (the demo's anchor category)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--networks",
        default=",".join(DEFAULT_NETWORKS),
        help="Comma-separated networks (creatives/top doesn't accept 'All Networks')",
    )
    parser.add_argument(
        "--countries", default=",".join(DEFAULT_COUNTRIES), help="Comma-separated country codes"
    )
    parser.add_argument(
        "--categories",
        default=",".join(str(c) for c in DEFAULT_CATEGORIES),
        help="Comma-separated iOS category IDs (cf. docs/sensortower-api.md §9.1)",
    )
    parser.add_argument("--period", default="month", choices=["week", "month", "quarter"])
    parser.add_argument("--period-date", default="2026-04-01")
    parser.add_argument(
        "--per-combo",
        type=int,
        default=10,
        help="Top creatives per (network × country × category) combo. Default 10.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Force re-fetch even when the response is already cached on disk.",
    )
    args = parser.parse_args()

    networks = [n.strip() for n in args.networks.split(",") if n.strip()]
    countries = [c.strip() for c in args.countries.split(",") if c.strip()]
    categories = [int(c.strip()) for c in args.categories.split(",") if c.strip()]

    from app.sources.sensortower import fetch_top_creatives

    if args.refresh:
        # Quick cache nuke: delete only the relevant creatives_top_* files.
        from app._paths import CACHE_DIR

        st_cache = CACHE_DIR / "sensortower"
        for cat in categories:
            for net in networks:
                pattern = f"creatives_top_{cat}_{net}_{args.period_date}*.json"
                for p in st_cache.glob(pattern):
                    p.unlink()
                    print(f"  ✗ removed {p.name}")

    total_combos = len(networks) * len(countries) * len(categories)
    successes = 0
    failures: list[tuple[str, str]] = []
    total_creatives = 0

    print(
        f"\n{'=' * 70}\n"
        f"Pre-caching trending ads — {len(networks)} networks × "
        f"{len(countries)} countries × {len(categories)} categories = "
        f"{total_combos} combos · {args.per_combo} creatives each\n"
        f"{'=' * 70}"
    )

    t0 = time.perf_counter()
    for cat in categories:
        for net in networks:
            for country in countries:
                combo = f"{net}/{country}/cat={cat}"
                try:
                    creatives = fetch_top_creatives(
                        category_id=cat,
                        country=country,
                        network=net,
                        period=args.period,
                        period_date=args.period_date,
                        max_creatives=args.per_combo,
                    )
                    print(f"  ✓ {combo:<28} → {len(creatives):>2} creatives")
                    total_creatives += len(creatives)
                    successes += 1
                except Exception as e:  # noqa: BLE001
                    msg = str(e)[:80]
                    print(f"  ✗ {combo:<28} → ERROR {msg}")
                    failures.append((combo, msg))

    elapsed = time.perf_counter() - t0
    print(
        f"\n{'=' * 70}\n"
        f"DONE — {successes}/{total_combos} combos OK · {len(failures)} failed · "
        f"{total_creatives} creatives total · {elapsed:.1f}s\n"
        f"{'=' * 70}"
    )
    if failures:
        print("\nFailed combos (likely SensorTower 422 = unsupported filter combo):")
        for combo, msg in failures[:10]:
            print(f"  - {combo}: {msg}")

    return 0 if successes > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
