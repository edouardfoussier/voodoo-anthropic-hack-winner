"""Generate a demo ad video from a cached HookLensReport.

Takes a report's top variant (priority #1), downloads its hero +
storyboard frames locally, and feeds them as a keyframe sequence to one
of Scenario's video-capable models. The resulting mp4 is saved under
``data/cache/videos/demo_<game>.mp4``.

Usage::

    # Default: model_scenario-image-seq-to-video (sequence keyframe → video)
    uv run python -m scripts.generate_demo_video data/cache/reports/6754558455_e2e.json

    # Force a specific Scenario video model
    uv run python -m scripts.generate_demo_video <report> --model model_kling-v2-6-i2v-pro

    # Use a different variant (default 0 = top priority)
    uv run python -m scripts.generate_demo_video <report> --variant-idx 1

The single-image models (Kling i2v / Veo i2v / Luma i2v) only consume
the hero frame and ignore the storyboards. The sequence model uses all
3 frames as keyframes and interpolates between them.
"""

from __future__ import annotations

import argparse
import json
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

import httpx

from app._paths import CACHE_DIR

VIDEOS_DIR = CACHE_DIR / "videos"
TMP_FRAMES_DIR = CACHE_DIR / "scenario_frames"


def _slugify(text: str) -> str:
    import re

    return re.sub(r"[^a-zA-Z0-9_-]+", "_", text).strip("_-").lower() or "demo"


def _download(url: str, dest: Path) -> Path:
    """Fetch ``url`` to ``dest`` (creating parents). Follows redirects."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", help="Path to a cached HookLensReport JSON")
    parser.add_argument(
        "--variant-idx",
        type=int,
        default=0,
        help="Which final_variants[] to videofy (default: 0 = top priority)",
    )
    parser.add_argument(
        "--model",
        default="model_scenario-image-seq-to-video",
        help="Scenario video model_id. Defaults to the sequence-to-video model.",
    )
    parser.add_argument(
        "--prompt",
        default=None,
        help="Optional prompt override. If absent, derived from the brief's hook_3s.",
    )
    parser.add_argument(
        "--multi-clip",
        action="store_true",
        help=(
            "Generate one Kling clip per frame (hero + storyboards) and "
            "concat into a single mp4 via ffmpeg. Produces ~15s 3-act ad."
        ),
    )
    args = parser.parse_args()

    report_path = Path(args.report)
    if not report_path.exists():
        print(f"ERROR: report file not found: {report_path}")
        return 1

    report = json.loads(report_path.read_text())
    target = report.get("target_game", {})
    name = target.get("name", "demo")
    variants = report.get("final_variants") or []
    if args.variant_idx >= len(variants):
        print(f"ERROR: variant-idx {args.variant_idx} out of range ({len(variants)} variants)")
        return 1

    variant = variants[args.variant_idx]
    brief = variant.get("brief") or {}
    title = brief.get("title", "untitled")
    hook = brief.get("hook_3s") or ""
    prompt = args.prompt or hook

    hero = variant.get("hero_frame_path") or ""
    storyboard = variant.get("storyboard_paths") or []
    frame_urls = [u for u in [hero, *storyboard] if u]

    if not frame_urls:
        print("ERROR: variant has no hero/storyboard images to videofy")
        return 1

    # Single-image models only need the hero frame.
    is_single_image_model = "i2v" in args.model and "seq" not in args.model
    if is_single_image_model:
        frame_urls = frame_urls[:1]

    print(
        f"\n{'=' * 70}\n"
        f"Generating demo video for: {name}\n"
        f"  Brief: {title!r}\n"
        f"  Hook: {hook[:80]}\n"
        f"  Model: {args.model}\n"
        f"  Frames: {len(frame_urls)} (hero{'+' + str(len(storyboard)) + ' storyboard' if not is_single_image_model and storyboard else ''})\n"
        f"{'=' * 70}"
    )

    # Download frames locally so call_scenario_video can hash + upload them.
    slug = _slugify(name)
    frames_dir = TMP_FRAMES_DIR / slug
    frames_dir.mkdir(parents=True, exist_ok=True)
    local_frames: list[Path] = []
    for i, url in enumerate(frame_urls):
        dest = frames_dir / f"frame_{i:02d}.png"
        if not dest.exists() or dest.stat().st_size == 0:
            print(f"  ↓ downloading frame {i + 1}/{len(frame_urls)} → {dest.name}")
            _download(url, dest)
        else:
            print(f"  ✓ frame {i + 1}/{len(frame_urls)} cached: {dest.name}")
        local_frames.append(dest)

    # Generate video(s).
    from app.creative.scenario import call_scenario_video

    if args.multi_clip:
        return _multi_clip_pipeline(
            slug=slug,
            local_frames=local_frames,
            model=args.model,
            prompt=prompt,
            scene_flow=brief.get("scene_flow") or [],
        )

    print(f"\n→ Calling Scenario video API (timeout 12 min)…")
    t0 = time.perf_counter()
    try:
        video_url, meta = call_scenario_video(
            model_id=args.model,
            image_paths=local_frames,
            prompt=prompt,
            label=f"demo_{slug}",
        )
    except Exception as e:
        print(f"\n✗ Video generation failed: {e}")
        return 1
    elapsed = time.perf_counter() - t0

    if meta.get("stub"):
        print(
            f"\n⚠ Generation returned a stub (reason={meta.get('stub_reason')}). "
            f"Job ID {meta.get('job_id')} may still complete in Scenario's queue."
        )
        return 1

    output_path = VIDEOS_DIR / f"demo_{slug}.mp4"
    print(f"\n↓ downloading mp4 → {output_path}")
    _download(video_url, output_path)
    size_kb = output_path.stat().st_size / 1024

    print(
        f"\n{'=' * 70}\n"
        f"DONE — generated in {elapsed:.0f}s · {size_kb:.0f} KB · job {meta.get('job_id')}\n"
        f"{'=' * 70}\n"
        f"  Output:   {output_path}\n"
        f"  Preview:  open {output_path}\n"
        f"  CDN URL:  {video_url}\n"
    )
    return 0


def _multi_clip_pipeline(
    *,
    slug: str,
    local_frames: list[Path],
    model: str,
    prompt: str,
    scene_flow: list[str],
) -> int:
    """Generate N Kling clips (one per frame) and concat into a single mp4.

    Each frame becomes a 5-second clip with a per-frame motion prompt
    derived from the brief's ``scene_flow`` (one beat per clip when
    available, falling back to the global hook prompt).
    """
    import subprocess

    from app.creative.scenario import call_scenario_video

    if model.startswith("model_kling-o1") and len(local_frames) > 1:
        # Kling i2v is single-frame; multi-clip uses one call per frame.
        pass

    n = len(local_frames)
    print(
        f"\n→ Multi-clip mode: {n} clips × ~60s each. Total budget ≈ {n * 60}s.\n"
    )

    clip_paths: list[Path] = []
    for i, frame in enumerate(local_frames):
        # Prefer the matching scene_flow beat as motion prompt; fall back to
        # the global hook so every clip still has motion guidance.
        beat_prompt = scene_flow[i] if i < len(scene_flow) else prompt
        # Trim ridiculously long beats — Kling's prompt budget is ~500 chars.
        beat_prompt = (beat_prompt or prompt or "")[:500]

        print(f"  [{i + 1}/{n}] frame={frame.name} prompt={beat_prompt[:80]!r}")
        t0 = time.perf_counter()
        try:
            url, meta = call_scenario_video(
                model_id=model,
                image_paths=[frame],
                prompt=beat_prompt,
                label=f"demo_{slug}_clip{i}",
            )
        except Exception as e:
            print(f"      ✗ clip {i + 1} failed: {e}")
            return 1
        elapsed = time.perf_counter() - t0
        if meta.get("stub"):
            print(f"      ⚠ clip {i + 1} returned stub — aborting concat.")
            return 1

        clip_path = VIDEOS_DIR / f"demo_{slug}_clip{i}.mp4"
        _download(url, clip_path)
        clip_paths.append(clip_path)
        print(f"      ✓ {elapsed:.0f}s · {clip_path.stat().st_size / 1024:.0f} KB")

    # Concat via ffmpeg's concat demuxer (no re-encode = fast, lossless).
    concat_list = VIDEOS_DIR / f"demo_{slug}_concat.txt"
    concat_list.write_text(
        "\n".join(f"file '{p.name}'" for p in clip_paths) + "\n"
    )
    output_path = VIDEOS_DIR / f"demo_{slug}_full.mp4"

    print(f"\n→ ffmpeg concat → {output_path}")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list.name),
        "-c", "copy",
        str(output_path.name),
    ]
    proc = subprocess.run(cmd, cwd=VIDEOS_DIR, capture_output=True, text=True)
    if proc.returncode != 0:
        # If -c copy fails (codec/timestamp mismatch), retry with re-encode.
        print("  ↻ -c copy failed (likely codec mismatch), retrying with re-encode…")
        cmd_reencode = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(concat_list.name),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            str(output_path.name),
        ]
        proc = subprocess.run(cmd_reencode, cwd=VIDEOS_DIR, capture_output=True, text=True)
        if proc.returncode != 0:
            print(f"      ✗ ffmpeg failed:\n{proc.stderr[-800:]}")
            return 1

    size_kb = output_path.stat().st_size / 1024
    print(
        f"\n{'=' * 70}\n"
        f"DONE — {n}-clip ad assembled · {size_kb:.0f} KB\n"
        f"{'=' * 70}\n"
        f"  Output:   {output_path}\n"
        f"  Preview:  open {output_path}\n"
    )
    # Auto-open at the end for convenience.
    subprocess.run(["open", str(output_path)], check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
