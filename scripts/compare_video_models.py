"""Generate a matrix of (model × variant-frame) ad clips for visual A/B.

For a given cached HookLensReport, takes the **hero frame** of each
``final_variants[]`` (one per priority tier) and runs it through every
model in ``--models``. All jobs fire in parallel (Scenario tolerates the
fan-out — they queue server-side). Results land under
``data/cache/videos/compare/<game>/<model>/<variant_idx>.mp4`` and a
2D HTML grid (rows = variants, cols = models) is auto-opened.

Usage::

    # Default: 6 video models × 3 variants on Crowd City
    uv run python -m scripts.compare_video_models data/cache/reports/1444062497_e2e.json

    # Custom set
    uv run python -m scripts.compare_video_models <report> \
      --models model_kling-o1-i2v,model_kling-v2-6-i2v-pro,model_open-ai-sora-2

The script forces ``aspectRatio: 9:16`` on every model so the landscape
defaults (Sora / Veo / Grok / Seedance) are nudged toward mobile portrait.
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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

import httpx

from app._paths import CACHE_DIR


COMPARE_DIR = CACHE_DIR / "videos" / "compare"
TMP_FRAMES_DIR = CACHE_DIR / "scenario_frames"

DEFAULT_MODELS: list[tuple[str, str]] = [
    ("model_kling-o1-i2v", "Kling O1"),
    ("model_kling-v2-6-i2v-pro", "Kling 2.6 Pro"),
    ("model_bytedance-seedance-2-0", "Seedance 2.0"),
    ("model_xai-grok-imagine-video", "Grok Imagine"),
    ("model_veo3-1", "Veo 3.1"),
    ("model_open-ai-sora-2", "Sora 2"),
]


def _slug(s: str) -> str:
    import re
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", s).strip("_-").lower() or "demo"


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def _ffprobe(path: Path) -> dict:
    """Returns {duration, width, height, codec} or {} on failure."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-show_entries", "stream=width,height,codec_name",
                "-of", "default=nw=1",
                str(path),
            ],
            capture_output=True, text=True, check=True,
        ).stdout
        meta: dict = {}
        for line in out.strip().split("\n"):
            if "=" in line:
                k, v = line.split("=", 1)
                meta[k] = v
        return meta
    except Exception:
        return {}


def _gen_one(
    *,
    model_id: str,
    model_label: str,
    variant_idx: int,
    frame_path: Path,
    prompt: str,
    out_dir: Path,
) -> dict:
    """Run one (model × variant) cell. Returns a result dict."""
    from app.creative.scenario import call_scenario_video

    safe_model = model_id.replace("model_", "")
    cell_dir = out_dir / safe_model
    cell_dir.mkdir(parents=True, exist_ok=True)
    dest = cell_dir / f"variant_{variant_idx}.mp4"

    if dest.exists() and dest.stat().st_size > 0:
        meta = _ffprobe(dest)
        return {
            "model": model_id,
            "model_label": model_label,
            "variant_idx": variant_idx,
            "ok": True,
            "path": str(dest.relative_to(out_dir.parent)),
            "duration": float(meta.get("duration", 0)),
            "width": int(meta.get("width", 0) or 0),
            "height": int(meta.get("height", 0) or 0),
            "size_kb": dest.stat().st_size / 1024,
            "elapsed_s": 0.0,
            "cached": True,
        }

    t0 = time.perf_counter()
    try:
        url, m = call_scenario_video(
            model_id=model_id,
            image_paths=[frame_path],
            prompt=prompt,
            label=f"compare_{safe_model}_v{variant_idx}",
            aspect_ratio="9:16",
        )
    except Exception as e:
        return {
            "model": model_id,
            "model_label": model_label,
            "variant_idx": variant_idx,
            "ok": False,
            "error": str(e)[:160],
            "elapsed_s": time.perf_counter() - t0,
        }
    elapsed = time.perf_counter() - t0

    if m.get("stub"):
        return {
            "model": model_id,
            "model_label": model_label,
            "variant_idx": variant_idx,
            "ok": False,
            "error": f"stub: {m.get('stub_reason') or 'unknown'}",
            "elapsed_s": elapsed,
        }

    _download(url, dest)
    meta = _ffprobe(dest)
    return {
        "model": model_id,
        "model_label": model_label,
        "variant_idx": variant_idx,
        "ok": True,
        "path": str(dest.relative_to(out_dir.parent)),
        "duration": float(meta.get("duration", 0)),
        "width": int(meta.get("width", 0) or 0),
        "height": int(meta.get("height", 0) or 0),
        "size_kb": dest.stat().st_size / 1024,
        "elapsed_s": elapsed,
        "cached": False,
    }


def _build_html(out_dir: Path, results: list[dict], game_name: str, variants_meta: list[dict]) -> Path:
    """Build a 2D grid: rows = variants, cols = models."""
    # Group by (variant, model)
    by_cell: dict[tuple[int, str], dict] = {(r["variant_idx"], r["model"]): r for r in results}
    models_seen = sorted({r["model"] for r in results})
    variant_indices = sorted({r["variant_idx"] for r in results})

    css = """
body{background:#0a0a0a;color:#eee;font-family:system-ui,-apple-system,sans-serif;padding:24px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:13px;color:#888;font-weight:400;margin:0 0 24px}
.matrix{display:grid;gap:16px;align-items:start}
.head{font-size:12px;color:#9cf;font-weight:600;padding:8px 0;text-align:center;text-transform:uppercase;letter-spacing:0.5px}
.row-label{font-size:13px;color:#fff;font-weight:600;padding:12px 8px;border-right:2px solid #333}
.row-label .priority{display:inline-block;background:#10b981;color:#000;padding:1px 6px;border-radius:3px;font-size:10px;margin-right:6px}
.row-label .priority.p2{background:#3b82f6;color:#fff}
.row-label .priority.p3{background:#f59e0b;color:#000}
.row-label .title{display:block;color:#aaa;font-weight:400;font-size:11px;margin-top:4px;line-height:1.4}
.cell{background:#1a1a1a;border-radius:6px;padding:8px;border:1px solid #333}
.cell .meta{font-size:10px;color:#888;font-family:monospace;margin-bottom:4px;text-align:center}
.cell.portrait{border-color:#10b981}
.cell.error{border-color:#ef4444;padding:24px 8px;text-align:center;color:#fca5a5;font-size:11px}
video{width:100%;border-radius:4px;background:#000;display:block}
"""
    cols = len(models_seen)
    grid_template = f"160px repeat({cols}, 1fr)"

    parts = [
        '<!doctype html><html><head><meta charset="utf-8">',
        f'<title>{game_name} — video model matrix</title>',
        f'<style>{css}',
        f'.matrix{{grid-template-columns: {grid_template}}}',
        '</style></head><body>',
        f'<h1>{game_name} — video model comparison</h1>',
        f'<h2>{len(variant_indices)} variants × {len(models_seen)} models = {len(results)} clips · '
        f'green border = mobile-ready 9:16</h2>',
        '<div class="matrix">',
        '<div></div>',  # top-left empty cell
    ]
    # Header row (model labels)
    for mid in models_seen:
        label = next((r["model_label"] for r in results if r["model"] == mid), mid)
        parts.append(f'<div class="head">{label}</div>')

    for v_idx in variant_indices:
        meta = variants_meta[v_idx] if v_idx < len(variants_meta) else {}
        priority = meta.get("priority", v_idx + 1)
        title = meta.get("title", f"variant {v_idx}")
        cls = "priority" if priority == 1 else f"priority p{priority}"
        parts.append(
            f'<div class="row-label"><span class="{cls}">#{priority}</span>'
            f'<span class="title">{title}</span></div>'
        )
        for mid in models_seen:
            r = by_cell.get((v_idx, mid))
            if r is None or not r.get("ok"):
                err = (r or {}).get("error", "n/a")
                parts.append(f'<div class="cell error">✗ {err[:80]}</div>')
                continue
            portrait = r["height"] > r["width"]
            cls = "cell portrait" if portrait else "cell"
            ar = f"{r['width']}×{r['height']}"
            dur = r["duration"]
            kb = r["size_kb"]
            cached = " · cached" if r.get("cached") else ""
            parts.append(
                f'<div class="{cls}">'
                f'<div class="meta">{ar} · {dur:.1f}s · {kb:.0f}KB{cached}</div>'
                f'<video controls preload="metadata" src="{r["path"]}"></video>'
                f'</div>'
            )

    parts.append('</div></body></html>')
    out = out_dir / "grid.html"
    out.write_text("\n".join(parts))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", help="Path to a cached HookLensReport JSON")
    parser.add_argument(
        "--models",
        default=",".join(m for m, _ in DEFAULT_MODELS),
        help=(
            "Comma-separated model_ids. Default: 6 leading video models "
            "(Kling O1, Kling 2.6 Pro, Seedance 2.0, Grok Imagine, Veo 3.1, Sora 2)."
        ),
    )
    parser.add_argument(
        "--variants",
        default="all",
        help='Comma-separated variant indices, or "all" (default).',
    )
    parser.add_argument(
        "--max-parallel",
        type=int,
        default=12,
        help="Concurrent generation jobs (default 12 = full matrix in parallel).",
    )
    args = parser.parse_args()

    report_path = Path(args.report)
    if not report_path.exists():
        print(f"ERROR: {report_path} not found")
        return 1
    report = json.loads(report_path.read_text())
    target = report.get("target_game", {}) or {}
    game = target.get("name", "demo")
    variants = report.get("final_variants") or []
    if not variants:
        print("ERROR: report has no final_variants")
        return 1

    # Pick variants
    if args.variants == "all":
        v_indices = list(range(len(variants)))
    else:
        v_indices = [int(x) for x in args.variants.split(",") if x.strip()]

    # Pick models — accept ids; pretty-label from defaults if known
    label_map = {mid: lab for mid, lab in DEFAULT_MODELS}
    model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    models = [(m, label_map.get(m, m.replace("model_", ""))) for m in model_ids]

    out_dir = COMPARE_DIR / _slug(game)
    frames_dir = TMP_FRAMES_DIR / _slug(game)
    frames_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Prepare variant-level metadata + download hero frames
    variants_meta: list[dict] = []
    for i in v_indices:
        v = variants[i]
        b = v.get("brief") or {}
        variants_meta.append({
            "priority": v.get("test_priority", i + 1),
            "title": b.get("title", f"variant {i}"),
            "hook": b.get("hook_3s", ""),
            "scene_flow": b.get("scene_flow", []),
        })
        hero_url = v.get("hero_frame_path") or ""
        if not hero_url:
            print(f"  ⚠ variant[{i}] has no hero — skipping")
            continue
        dest = frames_dir / f"variant_{i}_hero.png"
        if not dest.exists() or dest.stat().st_size == 0:
            _download(hero_url, dest)

    # Build the job matrix
    jobs: list[tuple[str, str, int, Path, str]] = []
    for v_idx in v_indices:
        v = variants[v_idx]
        b = v.get("brief") or {}
        prompt = (b.get("hook_3s") or "")[:500]
        frame = frames_dir / f"variant_{v_idx}_hero.png"
        if not frame.exists():
            continue
        for mid, lab in models:
            jobs.append((mid, lab, v_idx, frame, prompt))

    print(
        f"\n{'=' * 70}\n"
        f"Video model matrix for {game!r}\n"
        f"  variants: {v_indices}  ·  models: {len(models)}  ·  total cells: {len(jobs)}\n"
        f"  out_dir:  {out_dir}\n"
        f"{'=' * 70}"
    )

    t0 = time.perf_counter()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.max_parallel) as pool:
        futures = {
            pool.submit(
                _gen_one,
                model_id=mid, model_label=lab,
                variant_idx=v_idx, frame_path=frame, prompt=prompt,
                out_dir=out_dir,
            ): (mid, v_idx)
            for (mid, lab, v_idx, frame, prompt) in jobs
        }
        for fut in as_completed(futures):
            r = fut.result()
            mark = "✓" if r["ok"] else "✗"
            extra = (
                f"{r['width']}×{r['height']} · {r['duration']:.1f}s"
                if r["ok"] else f"ERROR {r.get('error', '')[:60]}"
            )
            print(f"  {mark} v{r['variant_idx']} · {r['model_label']:<18} · {r.get('elapsed_s', 0):>4.0f}s · {extra}")
            results.append(r)

    total = time.perf_counter() - t0
    ok = sum(1 for r in results if r["ok"])
    print(
        f"\n{'=' * 70}\n"
        f"DONE — {ok}/{len(results)} cells OK in {total:.0f}s wall\n"
        f"{'=' * 70}"
    )

    # Build grid HTML
    grid_path = _build_html(out_dir, results, game, variants_meta)
    print(f"  open {grid_path}")
    subprocess.run(["open", str(grid_path)], check=False)

    # Summary JSON for later inspection
    (out_dir / "summary.json").write_text(json.dumps({
        "game": game, "results": results, "variants": variants_meta,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
