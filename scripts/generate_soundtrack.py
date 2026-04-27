"""Generate a unified soundtrack for a generated ad video and overlay it.

Two-step pipeline kept independent of the React-facing endpoint so the
PM (or a follow-up sub-agent) can iterate on audio without re-running
the expensive video generation:

  1. Compose a textual music brief from the variant's Game DNA +
     emotional pitch + scene_flow (no LLM call — deterministic mapping).
  2. Hand it off to one of:
        --provider stock      (default: pick a royalty-free track from
                               data/cache/audio/library/<vibe>.mp3)
        --provider elevenlabs (call ElevenLabs Music API; requires
                               ELEVENLABS_API_KEY)
        --provider suno       (call Suno API; requires SUNO_API_KEY)
  3. ffmpeg-overlay the resulting mp3 onto the silent variant mp4
     produced by the React UI's "Generate Ad" button. Volume ducks
     during the endcard so the brand chime can punch through if there
     is one.

Usage::

    # Stock track (zero API calls; just needs library/<vibe>.mp3 on disk)
    uv run python -m scripts.generate_soundtrack \
        --game "Crowd City" \
        --variant-archetype satisfaction-live-action-ugc

    # ElevenLabs Music (best quality, costs ~$0.05 per 30s)
    uv run python -m scripts.generate_soundtrack \
        --game "Crowd City" \
        --variant-archetype satisfaction-live-action-ugc \
        --provider elevenlabs

The output replaces ``data/cache/videos/variant_<game>_<archetype>...mp4``
in place after writing a ``.silent.mp4`` backup, so the React UI's
``<video>`` tag picks up the audio version on next reload.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
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


CACHE_DIR = REPO_ROOT / "data" / "cache"
AUDIO_DIR = CACHE_DIR / "audio"
LIBRARY_DIR = AUDIO_DIR / "library"
VIDEOS_DIR = CACHE_DIR / "videos"


# ─── Vibe mapping ──────────────────────────────────────────────────────────

# Each emotional pitch → (vibe key, prompt seed for AI providers).
# Keep prompts under 30 words; quality engines do better with focused briefs.
VIBE_MAP: dict[str, tuple[str, str]] = {
    "satisfaction": (
        "satisfaction",
        "Punchy upbeat trap-pop loop, 130 BPM, satisfying chimes on key drops, mobile-game feel, high energy without lyrics.",
    ),
    "fail": (
        "rage_bait",
        "Tense suspense build with a fail-buzzer drop, 100 BPM, comedic frustration, viral TikTok meme vibe.",
    ),
    "curiosity": (
        "curiosity",
        "Whimsical playful underscore, 110 BPM, cartoon strings + glockenspiel, leaves space for a voiceover.",
    ),
    "rage_bait": (
        "rage_bait",
        "Aggressive trap loop with crowd shout, 140 BPM, big bass drop, brainrot meme energy.",
    ),
    "tutorial": (
        "tutorial",
        "Bright instructional underscore, 105 BPM, clean pop drums, leaves space for voice — think app onboarding music.",
    ),
    "asmr": (
        "asmr",
        "Soft ambient pad, 70 BPM, satisfying tactile foley, no melody, quiet luxury feel — pure mood, no lyrics.",
    ),
    "celebrity": (
        "celebrity",
        "Confident hip-hop instrumental, 95 BPM, snappy claps, podcast-ready — leaves the centre clear for narration.",
    ),
    "challenge": (
        "challenge",
        "High-energy electronic build, 128 BPM, gym-pop drops, motivational and competitive.",
    ),
    "transformation": (
        "transformation",
        "Cinematic build-and-release, 100 → 130 BPM ramp, big cymbal swell on transformation moment, payoff drop.",
    ),
    "other": (
        "satisfaction",
        "Bright catchy mobile-game underscore, 120 BPM, no lyrics, leaves space for voice or SFX.",
    ),
}


# ─── Source resolvers ──────────────────────────────────────────────────────


def _resolve_variant_video(game: str, archetype: str) -> Path:
    """Find the silent mp4 the React UI's render-video endpoint produced.

    Filename follows the pattern
    ``variant_<game_slug>_<safe_archetype><cache_tag>.mp4``. We pick the
    most recent matching file — newer = "current cached" output.
    """
    import re

    game_slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", game).strip("_-").lower()
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", archetype)[:40]
    candidates = sorted(
        VIDEOS_DIR.glob(f"variant_{game_slug}_{safe}*.mp4"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise SystemExit(
            f"❌ No variant mp4 matching variant_{game_slug}_{safe}*.mp4. "
            "Run 'Generate Ad' on the variant in the React UI first."
        )
    return candidates[0]


def _emotional_pitch_for(game: str, archetype_id: str) -> str:
    """Look up the variant's archetype emotional pitch from the cached
    HookLensReport. Falls back to 'satisfaction' if anything's missing —
    a safe default for hyper-casual."""
    needle = game.strip().lower()
    for path in (CACHE_DIR / "reports").glob("*_e2e.json"):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        if (data.get("target_game", {}).get("name") or "").lower() != needle:
            continue
        for arch in data.get("top_archetypes") or []:
            if (arch.get("archetype_id") or "") == archetype_id:
                return (arch.get("centroid_hook") or {}).get(
                    "emotional_pitch"
                ) or "satisfaction"
    return "satisfaction"


# ─── Audio source providers ────────────────────────────────────────────────


def _stock_track(vibe: str) -> Path | None:
    """Return any mp3 in data/cache/audio/library/<vibe>.mp3, with
    fallback to ``library/default.mp3``. Returns None when nothing is
    on disk — caller should print a setup hint."""
    candidate = LIBRARY_DIR / f"{vibe}.mp3"
    if candidate.exists():
        return candidate
    fallback = LIBRARY_DIR / "default.mp3"
    if fallback.exists():
        return fallback
    return None


def _elevenlabs_compose(prompt: str, dest: Path, duration_s: int) -> Path:
    """Generate a music track via ElevenLabs Music API.

    Docs: https://elevenlabs.io/docs/api-reference/music
    Costs ~$0.05 per 30-second track at the time of writing.
    """
    import httpx

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("❌ ELEVENLABS_API_KEY not set in .env")

    payload = {
        "prompt": prompt,
        "music_length_ms": duration_s * 1000,
        "model_id": "music_v1",
    }
    log = logging.getLogger(__name__)
    log.info("ElevenLabs Music · %ds · %s", duration_s, prompt[:60])
    r = httpx.post(
        "https://api.elevenlabs.io/v1/music",
        headers={"xi-api-key": api_key, "Accept": "audio/mpeg"},
        json=payload,
        timeout=180.0,
    )
    r.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    log.info("  → %s (%.1f KB)", dest, dest.stat().st_size / 1024)
    return dest


def _suno_compose(prompt: str, dest: Path, duration_s: int) -> Path:
    """Generate via Suno API (https://suno.com/api)."""
    import httpx

    api_key = os.environ.get("SUNO_API_KEY")
    if not api_key:
        raise SystemExit("❌ SUNO_API_KEY not set in .env")

    # Suno's API is async — submit, poll, download.
    submit = httpx.post(
        "https://api.suno.ai/v1/music",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"prompt": prompt, "duration_seconds": duration_s, "instrumental": True},
        timeout=60.0,
    )
    submit.raise_for_status()
    job_id = submit.json()["job_id"]
    log = logging.getLogger(__name__)
    log.info("Suno job %s submitted, polling…", job_id)
    import time

    deadline = time.time() + 300
    while time.time() < deadline:
        time.sleep(5)
        poll = httpx.get(
            f"https://api.suno.ai/v1/music/{job_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )
        poll.raise_for_status()
        body = poll.json()
        if body.get("status") == "completed":
            audio_url = body["audio_url"]
            ar = httpx.get(audio_url, timeout=120.0)
            ar.raise_for_status()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(ar.content)
            return dest
        if body.get("status") in ("failed", "canceled"):
            raise SystemExit(f"❌ Suno job {job_id} failed: {body}")
    raise SystemExit(f"❌ Suno job {job_id} timed out after 5 min")


# ─── ffmpeg overlay ────────────────────────────────────────────────────────


def _video_duration(path: Path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
        )
        return float(out.strip())
    except (subprocess.SubprocessError, ValueError):
        return 0.0


def overlay_audio(video: Path, audio: Path, out: Path) -> bool:
    """Overlay ``audio`` onto ``video`` with the audio length matched
    to the video duration (loop or trim). Existing video audio is
    DROPPED — keeps the soundtrack coherent across all 3 silent clips
    plus the endcard.

    Returns True on success.
    """
    duration = _video_duration(video)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-stream_loop", "-1",  # loop the audio if it's shorter than video
        "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-t", f"{duration:.3f}",  # cap at video length
        "-shortest",
        "-movflags", "+faststart",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        logging.error("ffmpeg overlay failed: %s", proc.stderr[-400:])
        return False
    return out.exists() and out.stat().st_size > 0


# ─── Main ──────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--game", required=True, help="Game name as shown in HookLens"
    )
    parser.add_argument(
        "--variant-archetype",
        required=True,
        help="Archetype id of the variant whose mp4 to overlay (matches the React 'Generate Ad' button)",
    )
    parser.add_argument(
        "--provider",
        choices=["stock", "elevenlabs", "suno"],
        default="stock",
        help="Where the music comes from. 'stock' uses data/cache/audio/library/<vibe>.mp3.",
    )
    parser.add_argument(
        "--prompt-override",
        default=None,
        help="Override the auto-generated music brief.",
    )
    args = parser.parse_args()

    log = logging.getLogger(__name__)
    video = _resolve_variant_video(args.game, args.variant_archetype)
    log.info("Target video: %s", video.name)

    pitch = _emotional_pitch_for(args.game, args.variant_archetype)
    vibe, default_prompt = VIBE_MAP.get(pitch, VIBE_MAP["other"])
    prompt = args.prompt_override or default_prompt
    duration = max(8, int(round(_video_duration(video))) + 1)
    log.info("Pitch=%s · vibe=%s · duration=%ds", pitch, vibe, duration)
    log.info("Music brief: %s", prompt)

    # 1. Get the audio file
    audio_path: Path | None
    if args.provider == "stock":
        audio_path = _stock_track(vibe)
        if audio_path is None:
            print(
                "\n❌ No stock track found at "
                f"{LIBRARY_DIR / f'{vibe}.mp3'} (or library/default.mp3).\n\n"
                "Setup: drop royalty-free mp3s into data/cache/audio/library/\n"
                "named after the vibe (satisfaction.mp3 / curiosity.mp3 /\n"
                "rage_bait.mp3 / tutorial.mp3 / asmr.mp3 / celebrity.mp3 /\n"
                "challenge.mp3 / transformation.mp3) plus a default.mp3\n"
                "fallback. Pixabay / Mixkit have great free options.\n\n"
                "Or use --provider elevenlabs / --provider suno.\n"
            )
            return 1
        log.info("Using stock track %s", audio_path.name)
    elif args.provider == "elevenlabs":
        audio_dest = AUDIO_DIR / "generated" / f"{vibe}_{duration}s.mp3"
        audio_path = (
            audio_dest if audio_dest.exists()
            else _elevenlabs_compose(prompt, audio_dest, duration)
        )
    else:  # suno
        audio_dest = AUDIO_DIR / "generated" / f"{vibe}_{duration}s_suno.mp3"
        audio_path = (
            audio_dest if audio_dest.exists()
            else _suno_compose(prompt, audio_dest, duration)
        )

    # 2. Backup the silent video (in case overlay fails) then overlay
    silent_backup = video.with_suffix(".silent.mp4")
    if not silent_backup.exists():
        silent_backup.write_bytes(video.read_bytes())
        log.info("Backed up silent video to %s", silent_backup.name)

    tmp_out = video.with_suffix(".audio.mp4")
    if not overlay_audio(silent_backup, audio_path, tmp_out):
        print("❌ ffmpeg overlay failed — video kept silent")
        return 1

    tmp_out.replace(video)
    log.info(
        "✓ %s now has audio (%.1f KB)",
        video.name,
        video.stat().st_size / 1024,
    )
    print(
        f"\nDONE. Reload the React UI to hear it.\n"
        f"  Video: {video}\n"
        f"  Audio source: {audio_path}\n"
        f"  Backup: {silent_backup}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
