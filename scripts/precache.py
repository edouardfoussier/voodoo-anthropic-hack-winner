"""Pre-cache HookLensReports for a list of games.

Usage:
    uv run python -m scripts.precache "Marble Sort" "Mob Control" "Sand Loop"

Each game runs the full pipeline (3-5 min, ~$1-2 in API costs) and persists
the report under data/cache/reports/{app_id}_e2e.json. Subsequent live
loads via /api/report or the Streamlit app are then instant.

Designed to be run before the demo so the React Insights view always loads
from cache and never waits on Gemini/Opus/Scenario at presentation time.
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
# httpx logs every request URL at INFO — this leaks the SensorTower auth_token
# query param into shipping logs. Bump httpx to WARNING so cache misses no
# longer print full URLs.
logging.getLogger("httpx").setLevel(logging.WARNING)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("games", nargs="+", help="Game names to pre-cache")
    parser.add_argument(
        "--countries",
        default="all",
        help="Comma-separated country codes, or 'all' for the curated worldwide list",
    )
    parser.add_argument(
        "--networks",
        default="all",
        help="Comma-separated networks (TikTok, Facebook, Instagram), or 'all'",
    )
    parser.add_argument("--max-creatives", type=int, default=8)
    parser.add_argument("--top-k-archetypes", type=int, default=5)
    parser.add_argument("--top-k-variants", type=int, default=3)
    args = parser.parse_args()

    from app.pipeline import PipelineConfig, run_pipeline

    countries = [c.strip() for c in args.countries.split(",") if c.strip()]
    networks = [n.strip() for n in args.networks.split(",") if n.strip()]

    successes: list[tuple[str, float]] = []
    failures: list[tuple[str, str]] = []

    for game in args.games:
        print(f"\n{'=' * 70}")
        print(f"Pre-caching: {game!r}  ({','.join(countries)} × {','.join(networks)})")
        print("=" * 70)
        config = PipelineConfig(
            game_name=game,
            countries=countries,
            networks=networks,
            max_creatives=args.max_creatives,
            top_k_archetypes=args.top_k_archetypes,
            top_k_variants=args.top_k_variants,
        )
        t0 = time.perf_counter()
        try:
            report = run_pipeline(config)
            elapsed = time.perf_counter() - t0
            print(
                f"\n✓ {game!r} → {report.target_game.name} "
                f"({len(report.top_archetypes)} archs, "
                f"{len(report.final_variants)} variants) "
                f"in {elapsed:.1f}s, est. ${report.total_cost_usd:.4f}"
            )
            successes.append((game, elapsed))
        except Exception as e:  # noqa: BLE001
            elapsed = time.perf_counter() - t0
            print(f"\n✗ {game!r} failed after {elapsed:.1f}s: {e}")
            failures.append((game, str(e)))

    print(f"\n{'=' * 70}")
    print(f"DONE — {len(successes)} succeeded · {len(failures)} failed")
    print("=" * 70)
    for game, elapsed in successes:
        print(f"  ✓ {game!r}  ({elapsed:.1f}s)")
    for game, err in failures:
        print(f"  ✗ {game!r}  → {err}")

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
