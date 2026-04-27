"""CLI: compare Scenario base models on the same CreativeBrief.

Internal team tool used to pick the best Scenario ``model_id`` for the
demo's visuals. The production pipeline still uses the single default
model; this script does NOT touch ``app/pipeline.py``.

Usage::

    # Default: top brief of the report, all 5 default models
    uv run python -m scripts.compare_models data/cache/reports/6754558455_e2e.json

    # Pick a specific brief, custom subset of models
    uv run python -m scripts.compare_models <report_path> \
      --variant-idx 0 \
      --models flux.1-dev,model-sdxl-1-0 \
      --out data/cache/compare/marble_sort/

Each model produces 1 hero image. Output landing zone defaults to
``data/cache/compare/<game_slug>/<brief_slug>/`` and contains:

  - ``<model_id>/hero.png``
  - ``summary.json``
  - ``grid.html`` (open in a browser for side-by-side review)
"""

from __future__ import annotations

import argparse
import json
import logging
import re
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

from app._paths import CACHE_DIR  # noqa: E402
from app.creative.scenario_compare import (  # noqa: E402
    DEFAULT_MODELS_TO_COMPARE,
    ModelCandidate,
    capability_for_model,
    compare_models_for_brief,
    discover_scenario_models,
)
from app.models import CreativeBrief  # noqa: E402

SCREENSHOT_CACHE_DIR = CACHE_DIR / "screenshots"

_SLUG_RE = re.compile(r"[^a-zA-Z0-9]+")


def _slug(value: str) -> str:
    return _SLUG_RE.sub("_", value).strip("_").lower() or "unknown"


def _resolve_models(arg: str | None) -> list[ModelCandidate]:
    """Build the comparison row list.

    Without ``--models`` the curated default set in
    ``DEFAULT_MODELS_TO_COMPARE`` is returned verbatim. With ``--models``,
    each requested id is looked up in (1) the default set (cheapest, no
    network), (2) the cached Scenario catalog at
    ``data/cache/scenario/models_catalog.json`` for capability metadata.
    Unknown ids default to IPA=True (best-effort) so the user can probe
    raw new ids without re-running discovery.
    """
    if not arg:
        return list(DEFAULT_MODELS_TO_COMPARE)

    by_id = {c.model_id: c for c in DEFAULT_MODELS_TO_COMPARE}
    catalog: list[dict] | None = None

    requested = [m.strip() for m in arg.split(",") if m.strip()]
    out: list[ModelCandidate] = []
    for mid in requested:
        if mid in by_id:
            out.append(by_id[mid])
            continue
        if catalog is None:
            try:
                catalog = discover_scenario_models()
            except Exception:  # noqa: BLE001
                catalog = []
        caps, meta = capability_for_model(mid, catalog=catalog)
        label = (meta or {}).get("name") or mid
        ipa = "txt2img_ip_adapter" in caps if caps else True
        is_custom = bool(meta and meta.get("type") == "custom")
        out.append(ModelCandidate(mid, label, ipa, is_custom))
    return out


def _resolve_refs(report: dict) -> list[Path]:
    """Pick up the target game's screenshots (if cached) for IP-Adapter style refs."""
    app_id = (report.get("target_game") or {}).get("app_id")
    if not app_id:
        return []
    screenshot_dir = SCREENSHOT_CACHE_DIR / str(app_id)
    if not screenshot_dir.exists():
        return []
    return sorted(
        p for p in screenshot_dir.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "report",
        type=Path,
        help="Path to a cached HookLensReport JSON under data/cache/reports/",
    )
    parser.add_argument(
        "--variant-idx",
        type=int,
        default=0,
        help="Which final_variants[i].brief to use (default 0 = top brief).",
    )
    parser.add_argument(
        "--models",
        default=None,
        help=(
            "Comma-separated Scenario model_ids. "
            f"Default: {','.join(c.model_id for c in DEFAULT_MODELS_TO_COMPARE)}"
        ),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output dir. Default: data/cache/compare/<game_slug>/<brief_slug>/",
    )
    args = parser.parse_args()

    if not args.report.exists():
        print(f"✗ Report not found: {args.report}", file=sys.stderr)
        return 2

    report = json.loads(args.report.read_text())
    target = report.get("target_game") or {}
    game_name = target.get("name") or "unknown"
    variants = report.get("final_variants") or []
    if not variants:
        print(f"✗ No final_variants in {args.report}", file=sys.stderr)
        return 2
    if not (0 <= args.variant_idx < len(variants)):
        print(
            f"✗ --variant-idx {args.variant_idx} out of range "
            f"(report has {len(variants)} variants)",
            file=sys.stderr,
        )
        return 2

    brief_dict = variants[args.variant_idx].get("brief")
    if not brief_dict:
        print(f"✗ Variant {args.variant_idx} has no .brief field", file=sys.stderr)
        return 2
    brief = CreativeBrief.model_validate(brief_dict)

    models = _resolve_models(args.models)
    if not models:
        print("✗ No models selected.", file=sys.stderr)
        return 2

    refs = _resolve_refs(report)

    out_dir = args.out or (
        CACHE_DIR / "compare" / _slug(game_name) / _slug(brief.archetype_id)
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"\n=== Comparing {len(models)} Scenario model(s) for "
        f"\"{brief.title}\" (brief {args.variant_idx}/{len(variants) - 1}) ==="
    )
    print(f"    target_game={game_name!r}  app_id={target.get('app_id')}")
    print(
        f"    refs: {len(refs)} screenshot(s) "
        f"{'(' + ', '.join(p.name for p in refs) + ')' if refs else '(none — txt2img only)'}"
    )
    print(f"    out_dir={out_dir}")
    print()

    t0 = time.perf_counter()
    compare_models_for_brief(
        brief,
        model_ids=models,
        reference_image_paths=refs or None,
        out_dir=out_dir,
    )
    elapsed = time.perf_counter() - t0

    summary = json.loads((out_dir / "summary.json").read_text())
    name_w = max(len(m["model_id"]) for m in summary["models"])
    label_w = max(len(m["model_label"]) for m in summary["models"])

    for m in summary["models"]:
        mark = "✓" if m["ok"] else "✗"
        head = f"{mark} {m['model_label']:<{label_w}}  {m['model_id']:<{name_w}}"
        if m["ok"]:
            tag = " [STUB]" if m.get("stub") else ""
            rel = (out_dir / m["image_path"]).resolve()
            print(f"{head} → {rel}  ({m['elapsed_s']:.1f}s){tag}")
        else:
            print(f"{head} → ERROR: {m.get('error')}")

    failed = [m["model_id"] for m in summary["models"] if not m["ok"]]
    grid_path = (out_dir / summary["grid_html"]).resolve()
    print(
        f"\nDone in {elapsed:.1f}s · "
        f"{len(summary['models']) - len(failed)} ok · {len(failed)} failed"
    )
    print("\nOpen the comparison sheet:")
    print(f"  open {grid_path}")
    if failed:
        print(f"\nFailed model_ids: {','.join(failed)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
