"""Pre-render static endcards for Voodoo (or any) games.

The endcard is a 9:16 image rendered by Scenario's gpt-image-2 from a
prompt that fuses the game's name, palette, visual style and audience
proxy (the Game DNA) into the standard mobile-ad-endcard composition:
big logo or wordmark + dominant character/asset + bold "PLAY NOW" CTA
+ store badges. The output is the static frame that feeds
``scripts/animate_endcards.py`` (Scenario img2video) to produce the
mp4 the ``/api/variants/render-video`` endpoint appends after every
generated ad.

Usage::

    # Single game (the most common path during demo prep)
    uv run python -m scripts.generate_endcards --game "Crowd City"

    # Every Voodoo game we have a Game DNA cache for (≈ 14 today)
    uv run python -m scripts.generate_endcards --all

    # Pass a custom CTA / model
    uv run python -m scripts.generate_endcards --game "Helix Jump" \
        --cta "PLAY FREE" --model model_imagen4-ultra

Reads Game DNA from ``data/cache/game_dna/<app_id>.json`` (populated
by the main pipeline's `_step_game_dna`) and SensorTower meta from
``data/cache/sensortower/meta_*.json`` for the icon URL. Writes the
resulting endcard to ``data/cache/endcards/<app_id>.png`` plus a
sidecar ``<app_id>.json`` with the prompt used (for reproducibility
and easy human iteration).

If a game has no cached Game DNA, the script falls back to a generic
mobile-ad-endcard prompt seeded only by the game name — quality drops
but it still ships something.
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
from app.creative.scenario import call_scenario_custom

ENDCARDS_DIR = CACHE_DIR / "endcards"
ENDCARDS_DIR.mkdir(parents=True, exist_ok=True)

# Default model: Scenario's gpt-image-2 — same one the pipeline already
# uses for variant heroes/storyboards, so endcards inherit the same
# fidelity profile. Override with --model.
DEFAULT_MODEL = "model_openai-gpt-image-2"


def _slug(name: str) -> str:
    import re

    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_-").lower() or "demo"


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def _load_game_dna(app_id: str) -> dict | None:
    """Read the cached GameDNA JSON. Returns None when missing — caller
    will fall back to a name-only prompt."""
    p = CACHE_DIR / "game_dna" / f"{app_id}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _resolve_game(name_or_id: str) -> tuple[str, str, dict | None]:
    """Resolve a user-friendly input (game name OR app_id) to a tuple
    (app_id, display_name, game_dna_dict). Scans the cached game_dna
    files first (fast, deterministic) and falls back to scanning the
    SensorTower meta cache.
    """
    needle = name_or_id.strip()
    needle_lower = needle.lower()

    # Try by exact app_id match
    candidate = CACHE_DIR / "game_dna" / f"{needle}.json"
    if candidate.exists():
        dna = json.loads(candidate.read_text())
        return (
            str(dna.get("app_id") or needle),
            str(dna.get("name") or needle),
            dna,
        )

    # Try by name match in the game_dna cache
    for p in (CACHE_DIR / "game_dna").glob("*.json"):
        try:
            dna = json.loads(p.read_text())
        except Exception:
            continue
        if (dna.get("name") or "").lower() == needle_lower:
            return str(dna.get("app_id") or p.stem), str(dna["name"]), dna

    # Last resort: meta cache (returns name + app_id but no DNA)
    for p in (CACHE_DIR / "sensortower").glob("meta_*.json"):
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        for app in data.get("apps") or []:
            if (app.get("name") or "").lower() == needle_lower:
                return str(app.get("app_id")), str(app["name"]), None

    raise SystemExit(
        f"❌ Could not resolve game {name_or_id!r}. Run the pipeline on it first to cache its Game DNA."
    )


def _build_prompt(
    *,
    name: str,
    cta: str,
    dna: dict | None,
) -> str:
    """Compose a 9:16 endcard prompt blending the game's identity (when
    DNA is cached) with the standard mobile-ad-endcard composition:
    big logo, dominant character/asset, prominent CTA, app-store
    badges, brand-coloured background.
    """
    parts: list[str] = [
        f'Mobile game ad endcard for "{name}". Vertical 9:16 portrait composition, premium mobile UA creative quality, app store ad endcard final frame.',
        "Composition: bold game wordmark/logo prominently centered in the upper third (clean, legible, occupying ~30% of the frame width). A large dominant character or signature gameplay asset fills the middle third — must be instantly recognisable as belonging to this specific game, NOT generic stock-game art.",
        f'Bottom third: a high-contrast bold CTA button reading "{cta}" with a vibrant gradient and rounded corners, plus the standard "Download on the App Store" and "GET IT ON Google Play" badges side-by-side just below the CTA.',
        "Style: cinematic mobile-game-poster lighting, clean background that matches the game's brand mood, no clutter, high color contrast for thumb-stopping power on a phone screen.",
    ]

    if dna:
        palette = dna.get("palette") or {}
        prim = palette.get("primary_hex", "")
        sec = palette.get("secondary_hex", "")
        accent = palette.get("accent_hex", "")
        visual_style = dna.get("visual_style") or "stylized 3D"
        ui_mood = dna.get("ui_mood") or "energetic"
        audience = dna.get("audience_proxy") or ""
        mechanics = dna.get("key_mechanics") or []
        chars_present = dna.get("character_present", True)

        parts.append(
            f"Visual style: {visual_style}. UI mood: {ui_mood}. "
            f"Brand palette: primary {prim}, secondary {sec}, accent {accent} — "
            "use these for the CTA button, the wordmark, and the background gradient."
        )
        if mechanics:
            parts.append(
                f"Hint at the core mechanic ({', '.join(mechanics[:3])}) "
                "in the middle-third gameplay imagery."
            )
        if not chars_present:
            parts.append(
                "The game has no protagonist character — fill the middle third "
                "with the signature gameplay object/scene rather than a person."
            )
        if audience:
            parts.append(f"Target feel: {audience}.")

    parts.append(
        "Final negative: no real human celebrities, no copyrighted IP outside this game, no Apple/Google logos beyond the standard store badges, no QR codes, no text other than the game name and the CTA."
    )
    return " ".join(parts)


def generate_endcard(
    *,
    name_or_id: str,
    cta: str = "PLAY NOW",
    model: str = DEFAULT_MODEL,
    overwrite: bool = False,
) -> Path:
    app_id, display_name, dna = _resolve_game(name_or_id)
    out_path = ENDCARDS_DIR / f"{app_id}.png"
    sidecar_path = ENDCARDS_DIR / f"{app_id}.json"

    if out_path.exists() and not overwrite:
        print(f"  ↪ {display_name}: cached endcard already at {out_path.name}")
        return out_path

    prompt = _build_prompt(name=display_name, cta=cta, dna=dna)
    print(f"  ✚ {display_name} ({app_id})")
    print(f"      prompt: {prompt[:140]}…")

    url, meta = call_scenario_custom(
        prompt=prompt,
        model_id=model,
        label=f"endcard_{_slug(display_name)}",
    )

    if meta.get("stub"):
        print(
            f"      ⚠ Scenario returned a stub (auth missing or model unavailable). "
            f"Saving sidecar only."
        )
    else:
        _download(url, out_path)
        print(f"      ✓ saved → {out_path}")

    sidecar_path.write_text(
        json.dumps(
            {
                "app_id": app_id,
                "name": display_name,
                "cta": cta,
                "model": model,
                "prompt": prompt,
                "scenario_url": url,
                "stub": meta.get("stub", False),
            },
            indent=2,
        )
    )
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--game",
        help='Game name or app_id. Use "all" or pass --all for the full Game DNA cache.',
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Render an endcard for every game we have a cached Game DNA for.",
    )
    parser.add_argument(
        "--cta",
        default="PLAY NOW",
        help='Call-to-action text (default: "PLAY NOW")',
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Scenario model_id (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-render even if an endcard already exists for the app_id.",
    )
    args = parser.parse_args()

    targets: list[str] = []
    if args.all or args.game == "all":
        for p in (CACHE_DIR / "game_dna").glob("*.json"):
            targets.append(p.stem)
        if not targets:
            print(
                "❌ No game_dna cache found. Run the pipeline on at least one game first."
            )
            return 1
        print(f"Rendering {len(targets)} endcards…\n")
    elif args.game:
        targets = [args.game]
    else:
        parser.error("Pass --game <name|app_id> or --all")

    failed = 0
    for t in targets:
        try:
            generate_endcard(
                name_or_id=t,
                cta=args.cta,
                model=args.model,
                overwrite=args.overwrite,
            )
        except Exception as exc:
            failed += 1
            print(f"  ✗ {t}: {exc}")

    print(
        f"\n{'=' * 50}\n"
        f"DONE — {len(targets) - failed}/{len(targets)} endcards rendered\n"
        f"  Output: {ENDCARDS_DIR}\n"
        f"  Animate them with: uv run python -m scripts.animate_endcards --all\n"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
