"""Animate static endcards into 3-5s mp4 clips via Scenario img2video.

Pairs with ``scripts/generate_endcards.py``. Reads each png in
``data/cache/endcards/`` and produces an mp4 with the same stem
that the ``/api/variants/render-video`` endpoint can append at the
end of every generated ad.

Usage::

    # All endcards that don't yet have an mp4 sibling
    uv run python -m scripts.animate_endcards --all

    # Single game
    uv run python -m scripts.animate_endcards --game "Crowd City"

    # Different motion model (default: Kling i2v which respects the still
    # composition very well — recommended for endcards)
    uv run python -m scripts.animate_endcards --all --model model_kling-o1-i2v

    # Keep the full Scenario clip (skip post-trim)
    uv run python -m scripts.animate_endcards --all --no-trim

The animation prompt is intentionally minimal ("subtle camera push-in,
text bounce, brand confetti shimmer, 3 seconds") so the base composition
stays stable. Scenario typically returns a 5-second clip regardless of
the requested duration in the prompt, and the last 1-2 seconds tend to
drift (empty placeholder CTA, frame collapse). We post-trim every clip
to ``--trim-seconds`` (default: 3) via ffmpeg so the endcards always
end on a clean, branded beat.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
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
from app.creative.scenario import call_scenario_video

ENDCARDS_DIR = CACHE_DIR / "endcards"

DEFAULT_MODEL = "model_kling-o1-i2v"
DEFAULT_MOTION_PROMPT = (
    "Subtle camera push-in on the game logo with a soft sparkle/shimmer "
    "behind the wordmark. The CTA button gently pulses once. The "
    "background has a slow, almost imperceptible parallax. Brand-confident, "
    "premium mobile-ad endcard finish. 9:16 vertical, 3 seconds."
)


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def _resolve_target_pngs(args: argparse.Namespace) -> list[Path]:
    """Resolve --game / --all into the set of static endcards to animate."""
    if args.all:
        pngs = sorted(ENDCARDS_DIR.glob("*.png"))
        if not args.overwrite:
            pngs = [p for p in pngs if not (p.with_suffix(".mp4")).exists()]
        return pngs

    if args.game:
        # Resolve game name → app_id by reading the sidecar JSONs we wrote
        needle = args.game.strip().lower()
        for sidecar in ENDCARDS_DIR.glob("*.json"):
            try:
                meta = json.loads(sidecar.read_text())
            except Exception:
                continue
            if (
                str(meta.get("app_id") or "") == needle
                or (meta.get("name") or "").lower() == needle
            ):
                png = ENDCARDS_DIR / f"{meta['app_id']}.png"
                if png.exists():
                    return [png]
        # Fallback: assume input is already an app_id stem
        png = ENDCARDS_DIR / f"{args.game}.png"
        if png.exists():
            return [png]
        raise SystemExit(
            f"❌ No static endcard found for {args.game!r}. Run "
            f"scripts.generate_endcards on it first."
        )

    raise SystemExit("Pass --game <name|app_id> or --all")


def _trim_video(src: Path, dst: Path, seconds: float) -> bool:
    """ffmpeg-trim ``src`` to its first ``seconds`` and write to ``dst``.

    Re-encodes (libx264 + aac) rather than ``-c copy`` to avoid keyframe
    boundary issues — at endcard scale (3.5 MB / 3s) the cost is
    negligible. Returns True on success, False on any failure.
    """
    import subprocess

    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-t", f"{seconds:.2f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"      ⚠ trim failed: {proc.stderr.strip()[-200:]}")
        return False
    return dst.exists() and dst.stat().st_size > 0


def animate_one(
    png: Path,
    *,
    model: str,
    prompt: str,
    overwrite: bool,
    trim_seconds: float | None,
    max_retries: int = 3,
    base_backoff_s: float = 30.0,
) -> Path | None:
    out_mp4 = png.with_suffix(".mp4")
    if out_mp4.exists() and not overwrite:
        # Skip cleanly — no Scenario call, no asset upload, no rate-limit
        # exposure. Re-running the script after a 429 storm always picks
        # up exactly the still-missing endcards.
        print(f"  ↪ {png.name} → cached (skipped)")
        return out_mp4

    # Inline retry on Scenario's 429 (rate limit). The default tier
    # caps concurrent video jobs at ~3-5, and a --all run easily hits
    # that. Exponential backoff (30s, 60s, 120s) usually clears.
    import time as _time
    for attempt in range(1, max_retries + 1):
        attempt_label = "" if attempt == 1 else f" (retry {attempt}/{max_retries})"
        print(f"  ✚ animating {png.name}{attempt_label}")
        try:
            url, meta = call_scenario_video(
                model_id=model,
                image_paths=[png],
                prompt=prompt,
                label=f"endcard_anim_{png.stem}",
            )
            break
        except Exception as exc:
            msg = str(exc)
            is_rate_limited = "429" in msg or "rate limit" in msg.lower()
            if is_rate_limited and attempt < max_retries:
                wait = base_backoff_s * (2 ** (attempt - 1))
                print(f"      ⌛ Scenario 429; backing off {wait:.0f}s before retry…")
                _time.sleep(wait)
                continue
            print(f"      ✗ {png.name}: {exc}")
            return None
    else:
        # Loop completed without break — all retries exhausted.
        print(f"      ✗ {png.name}: rate-limited after {max_retries} attempts")
        return None

    if meta.get("stub"):
        print(f"      ⚠ stub returned (job_id={meta.get('job_id')}). Skipping.")
        return None

    # Download to a .raw.mp4 sidecar first; the final out_mp4 will be the
    # post-trimmed version (or a copy of the raw when --no-trim).
    raw_path = out_mp4.with_suffix(".raw.mp4")
    _download(url, raw_path)
    raw_kb = raw_path.stat().st_size / 1024

    if trim_seconds is None:
        raw_path.replace(out_mp4)
        print(f"      ✓ {out_mp4.name} ({raw_kb:.0f} KB, untrimmed)")
        return out_mp4

    if not _trim_video(raw_path, out_mp4, trim_seconds):
        # Fall back to the untrimmed clip rather than producing nothing.
        raw_path.replace(out_mp4)
        print(f"      ⚠ trim failed; kept untrimmed clip {out_mp4.name}")
        return out_mp4

    raw_path.unlink(missing_ok=True)
    final_kb = out_mp4.stat().st_size / 1024
    print(
        f"      ✓ {out_mp4.name} "
        f"({final_kb:.0f} KB, trimmed to {trim_seconds:.1f}s "
        f"from {raw_kb:.0f} KB)"
    )
    return out_mp4


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--game",
        help="App_id (stem) or game name to animate. Mutually exclusive with --all.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Animate every static endcard png in data/cache/endcards/.",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Scenario video model_id (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--prompt",
        default=DEFAULT_MOTION_PROMPT,
        help="Motion prompt. Keep it gentle — endcards work best with subtle motion.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-animate even when the mp4 sibling already exists.",
    )
    parser.add_argument(
        "--trim-seconds",
        type=float,
        default=3.0,
        help=(
            "Post-trim every clip to this many seconds (default: 3). "
            "Scenario typically returns 5s clips; the last 1-2s tend to "
            "drift to an empty placeholder CTA, so we trim them off."
        ),
    )
    parser.add_argument(
        "--no-trim",
        action="store_true",
        help="Keep the full untrimmed Scenario clip (overrides --trim-seconds).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=8.0,
        help=(
            "Seconds of pause between consecutive Scenario calls (default: "
            "8). Scenario's free tier caps concurrent video jobs at 3-5; "
            "without a delay, a --all run quickly trips 429 errors. Set "
            "to 0 to disable."
        ),
    )
    args = parser.parse_args()

    targets = _resolve_target_pngs(args)
    if not targets:
        print("Nothing to animate (all endcards already have an mp4 sibling).")
        return 0

    trim = None if args.no_trim else max(0.5, float(args.trim_seconds))
    print(
        f"Animating {len(targets)} endcards via {args.model}"
        + (f" (trim → {trim:.1f}s)" if trim else " (untrimmed)")
        + (f" · {args.delay:.0f}s between calls" if args.delay > 0 else "")
        + "…\n"
    )
    import time as _time
    failed = 0
    for i, png in enumerate(targets):
        if animate_one(
            png,
            model=args.model,
            prompt=args.prompt,
            overwrite=args.overwrite,
            trim_seconds=trim,
        ) is None:
            failed += 1
        # Spacing between calls — only matters when we actually called
        # Scenario (cached skips return in <10ms anyway). Conservative
        # 8s default keeps us well under any reasonable rate limit.
        if args.delay > 0 and i < len(targets) - 1:
            _time.sleep(args.delay)

    print(
        f"\n{'=' * 50}\n"
        f"DONE — {len(targets) - failed}/{len(targets)} animated mp4s\n"
        f"  Output: {ENDCARDS_DIR}\n"
        f"  These are auto-appended by /api/variants/render-video when the\n"
        f"  matching app_id has an mp4 in this directory.\n"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
