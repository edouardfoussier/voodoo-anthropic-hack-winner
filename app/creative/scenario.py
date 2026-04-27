"""Scenario REST API client for asset generation.

Owner: Partner 2. The production target uses the **Scenario MCP** connector
inside Claude Code; this module is the v1 REST baseline so the Streamlit
pipeline runs end-to-end from Python.

Three generation modes (auto-selected based on inputs):

- ``txt2img``: pure prompt-driven. No reference image.
- ``txt2img-ip-adapter`` (default when refs provided): prompt-driven
  composition with **IP-Adapter style transfer** from 1-3 game screenshots.
  This is the right tool for "ad creative that stays on-brand" — the prompt
  drives the narrative, the references inject palette + character + UI vibe
  without locking the canvas. Anti-deceptive-ad strategy.
- ``img2img`` (opt-in via ``img2img_strength=...``): single-reference
  composition lock. Useful when one screenshot must define the layout
  exactly (rare for ads — kept for flexibility).

API auth: Basic with ``API_KEY:API_SECRET`` base64-encoded.

Async workflow: trigger → jobId → poll ``/v1/jobs/{id}`` until success →
read ``assetIds`` from job metadata → fetch each asset via ``/v1/assets/{id}``.

If credentials are missing, ``call_scenario`` falls back to a deterministic
Picsum URL so the rest of the pipeline still completes end-to-end.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
from pathlib import Path

import httpx

from app._cache import hash_key
from app._paths import CACHE_DIR
from app.models import CreativeArchetype, CreativeBrief, GameFitScore, GeneratedVariant

log = logging.getLogger(__name__)

SCENARIO_BASE = "https://api.cloud.scenario.com/v1"

# Default model: GPT Image 2 (proxied via Scenario's /generate/custom/{id}).
# We benchmarked 8 models on Marble Sort + Block Blast briefs (cf.
# data/cache/compare/*); GPT Image 2 produced the most demo-ready visuals
# (photoreal hero, perfect text rendering, native 9:16). It's a *custom*
# Scenario model — no IP-Adapter support — so when this is the default we
# rely on prompt-engineering (the brief's CRITICAL FIDELITY DIRECTIVE in
# app/creative/brief.py + palette/style/mechanics inlined into the prompt)
# to keep visuals on-DNA. Switch back to "flux.1-dev" via env var
# ``SCENARIO_DEFAULT_MODEL_ID`` to fall back to flux + IP-Adapter when
# game-DNA fidelity matters more than photo-realism.
DEFAULT_MODEL_ID = os.environ.get(
    "SCENARIO_DEFAULT_MODEL_ID", "model_openai-gpt-image-2"
)

# Custom-model prefix used by Scenario for proxied third-party APIs (GPT
# Image, Imagen, Ideogram, Flux 1.1 Pro, Seedream, Veo, Sora, Kling…).
# These models route through ``POST /generate/custom/{modelId}`` (no
# IP-Adapter, prompt-only). Anything else (flux.1-*, sd-xl-*, the ~150
# LoRA flux variants) goes through the regular ``txt2img`` /
# ``txt2img-ip-adapter`` / ``img2img`` endpoints.
CUSTOM_MODEL_PREFIX = "model_"

DEFAULT_CACHE_DIR = CACHE_DIR / "scenario"
ASSETS_CACHE_DIR = CACHE_DIR / "scenario_assets"
DEFAULT_IMG2IMG_STRENGTH = 0.6  # 0.0 = identical to reference, 1.0 = ignore reference
MAX_IPADAPTER_REFS = 3  # Scenario / Veo / most IP-Adapter models cap quality at 3 refs


def _is_custom_model(model_id: str) -> bool:
    """Return True for Scenario's proxied third-party API models.

    These (e.g. ``model_openai-gpt-image-2``, ``model_imagen4-ultra``)
    only accept the ``/generate/custom/{modelId}`` endpoint and reject
    ``/generate/txt2img`` with HTTP 400. They also do NOT support
    IP-Adapter — the route is prompt-only by design.
    """
    return model_id.startswith(CUSTOM_MODEL_PREFIX)


def _basic_auth_header() -> str | None:
    key = os.environ.get("SCENARIO_API_KEY")
    sec = os.environ.get("SCENARIO_API_SECRET")
    if not (key and sec):
        return None
    raw = f"{key}:{sec}".encode()
    return f"Basic {base64.b64encode(raw).decode()}"


def _picsum_stub(prompt: str) -> str:
    seed = abs(hash(prompt)) % 10**6
    return f"https://picsum.photos/seed/{seed}/720/1280"


def upload_asset(image_path: Path, *, name: str | None = None) -> str:
    """Upload a local image to Scenario and return its ``asset_id``.

    Cached by file hash on disk under ``data/cache/scenario_assets/<sha8>.txt``,
    so the same screenshot is uploaded at most once even across pipeline runs.
    """
    auth = _basic_auth_header()
    if not auth:
        raise RuntimeError(
            "SCENARIO_API_KEY/SECRET missing — cannot upload reference image."
        )

    image_bytes = image_path.read_bytes()
    sha = hashlib.sha256(image_bytes).hexdigest()[:16]
    cache_path = ASSETS_CACHE_DIR / f"{sha}.txt"
    if cache_path.exists():
        return cache_path.read_text().strip()

    log.info("Scenario asset upload (%d KB) for %s", len(image_bytes) // 1024, image_path.name)
    payload = {
        "image": base64.b64encode(image_bytes).decode("utf-8"),
        "name": name or image_path.name,
    }
    headers = {"Content-Type": "application/json", "Authorization": auth}
    r = httpx.post(
        f"{SCENARIO_BASE}/assets",
        headers=headers,
        json=payload,
        timeout=60.0,
    )
    r.raise_for_status()
    body = r.json()
    asset_id = (body.get("asset") or {}).get("id") or body.get("id") or body.get("assetId")
    if not asset_id:
        raise RuntimeError(f"Scenario /v1/assets returned no id: {body}")

    ASSETS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(asset_id)
    return asset_id


def call_scenario_custom(
    prompt: str,
    *,
    model_id: str,
    label: str = "asset",
    timeout_s: float = 360.0,
) -> tuple[str, dict]:
    """Generate one image via ``POST /v1/generate/custom/{modelId}``.

    This is the only route Scenario's proxied third-party API models
    accept (GPT Image 2, Imagen 4, Ideogram 3, Flux 1.1 Pro, Seedream 4,
    Veo, Sora, Kling, ...). They do **NOT** accept ``/generate/txt2img``
    (returns 400 *Standalone models are not supported*) and do **NOT**
    support IP-Adapter — pure prompt-driven, so the brief's prompt-engineering
    has to do all the work of staying on-DNA.

    Same return shape as :func:`call_scenario`. Cached on disk under
    ``data/cache/scenario/`` with a non-colliding key namespace.
    """
    cache_key = {"p": prompt, "m": model_id, "endpoint": "custom"}
    cache_path = DEFAULT_CACHE_DIR / f"{label}__{hash_key(cache_key)}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        return cached["url"], cached

    auth = _basic_auth_header()
    if not auth:
        url = _picsum_stub(prompt)
        result = {
            "url": url,
            "stub": True,
            "prompt": prompt,
            "model_id": model_id,
            "mode": "custom",
        }
        DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(result, indent=2))
        return url, result

    headers = {"Content-Type": "application/json", "Authorization": auth}
    payload = {"prompt": prompt}

    log.info(
        "Scenario CACHE MISS · POST /generate/custom/%s · prompt-only", model_id
    )
    r = httpx.post(
        f"{SCENARIO_BASE}/generate/custom/{model_id}",
        headers=headers,
        json=payload,
        timeout=60.0,
    )
    r.raise_for_status()
    job_id = r.json()["job"]["jobId"]

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        rr = httpx.get(
            f"{SCENARIO_BASE}/jobs/{job_id}",
            headers={"Authorization": auth},
            timeout=30.0,
        )
        rr.raise_for_status()
        body = rr.json()
        status = body["job"]["status"]

        if status == "success":
            asset_ids = (body["job"].get("metadata") or {}).get("assetIds") or []
            if not asset_ids:
                raise RuntimeError(
                    f"Scenario custom job {job_id} succeeded but no assetIds"
                )
            asset_id = asset_ids[0]
            ar = httpx.get(
                f"{SCENARIO_BASE}/assets/{asset_id}",
                headers={"Authorization": auth},
                timeout=30.0,
            )
            ar.raise_for_status()
            ar_body = ar.json()
            asset_url = (
                (ar_body.get("asset") or {}).get("url")
                or ar_body.get("url")
                or ""
            )
            result = {
                "url": asset_url,
                "job_id": job_id,
                "asset_id": asset_id,
                "stub": False,
                "prompt": prompt,
                "model_id": model_id,
                "mode": "custom",
            }
            DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(result, indent=2))
            return asset_url, result

        if status in ("failure", "canceled"):
            raise RuntimeError(
                f"Scenario custom job {job_id} ended with status={status}"
            )
        time.sleep(3.0)

    log.warning(
        "Scenario custom job %s timed out after %.0fs — falling back to stub.",
        job_id,
        timeout_s,
    )
    fallback_url = _picsum_stub(prompt)
    return fallback_url, {
        "url": fallback_url,
        "stub": True,
        "stub_reason": "scenario_custom_timeout",
        "job_id": job_id,
        "prompt": prompt,
        "model_id": model_id,
        "mode": "custom",
    }


def call_scenario_video(
    *,
    model_id: str,
    image_paths: list[Path],
    prompt: str | None = None,
    label: str = "video",
    timeout_s: float = 720.0,  # video gen is slow (1-5 min typical)
    aspect_ratio: str | None = "9:16",
    tail_image_path: Path | None = None,
    generate_audio: bool = False,
) -> tuple[str, dict]:
    """Generate a video via Scenario's custom endpoint for video models.

    Supports three shapes today:

    - **Sequence-to-video** (e.g. ``model_scenario-image-seq-to-video``):
      pass 2-5 keyframe images as ``image_paths`` (uploaded as Scenario
      assets first). Optional ``prompt`` adds a textual transition hint.
    - **Image-to-video** (e.g. ``model_kling-v2-6-i2v-pro``,
      ``model_kling-o1-i2v``): pass a single image_path. Prompt is
      typically required for these.
    - **First+last frame i2v** (Kling O1 / Kling 2.6 Pro): same as
      single-image i2v plus ``tail_image_path`` to anchor the last
      frame. The model interpolates between the two — perfect for
      morphing the variant's final gameplay frame into the game's
      pre-rendered endcard frame so the concat'd ad has a seamless
      handoff into the endcard mp4 instead of a cut.

    ``generate_audio=True`` requests native synchronized audio from
    models that support it (Kling 2.6 Pro, Veo 3). Quietly ignored by
    silent models (Kling O1).

    Returns ``(video_url, metadata_dict)``. The video URL points at a
    Scenario CDN-hosted mp4 with a signed expiration ~6 months out.

    On timeout, falls back to a Picsum stub so the caller doesn't crash.
    Cached on disk under ``data/cache/scenario/`` keyed by
    (model_id, image hashes, prompt, tail_image_hash, audio_flag).
    """
    if not image_paths:
        raise ValueError("call_scenario_video requires at least one image_path")

    image_hashes = [
        hashlib.sha256(p.read_bytes()).hexdigest()[:16] for p in image_paths
    ]
    tail_hash = (
        hashlib.sha256(tail_image_path.read_bytes()).hexdigest()[:16]
        if tail_image_path is not None
        else None
    )
    cache_key = {
        "p": prompt or "",
        "m": model_id,
        "endpoint": "video",
        "frames": image_hashes,
        "ar": aspect_ratio or "",
        "tail": tail_hash or "",
        "audio": bool(generate_audio),
    }
    cache_path = DEFAULT_CACHE_DIR / f"{label}__{hash_key(cache_key)}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        return cached["url"], cached

    auth = _basic_auth_header()
    if not auth:
        url = _picsum_stub(f"{model_id}_{prompt or 'video'}")
        result = {
            "url": url,
            "stub": True,
            "model_id": model_id,
            "prompt": prompt,
            "mode": "video",
        }
        DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(result, indent=2))
        return url, result

    # Upload each frame as a Scenario asset.
    asset_ids: list[str] = []
    for i, p in enumerate(image_paths):
        asset_ids.append(upload_asset(p, name=f"vidframe_{label}_{i}"))

    # Optional tail image (first+last frame mode for Kling). Uploaded
    # as a separate asset so the model gets the full path to it.
    tail_asset_id: str | None = None
    if tail_image_path is not None:
        tail_asset_id = upload_asset(
            tail_image_path, name=f"vidtail_{label}"
        )

    # Payload shape (probed against Scenario's actual API on 2026-04-26):
    #   - sequence/keyframe models accept ``images: [assetId, ...]``
    #     (validated empirically: ``imageIds``, ``imageAssetIds``,
    #     ``frames``, ``keyframes`` all return 400 "Input images is required")
    #   - single-image i2v (kling/veo/luma/sora/grok) accept ``image: assetId``
    #   - Kling O1 / Kling 2.6 Pro accept ``lastFrameImage: assetId`` for
    #     first+last frame interpolation (verified against the live
    #     /models/<id> input schema on 2026-04-26).
    #   - Veo 3 / Kling 2.6 Pro accept ``generateAudio: true`` for native
    #     synchronized audio generation.
    #   - ``aspectRatio: "9:16"`` is the accepted name on this tenant for
    #     forcing mobile-vertical output (Sora 2 / Veo 3.1 / Grok / Seedance
    #     default to landscape 16:9; Kling is already 9:16 and ignores).
    payload: dict = {}
    if "seq" in model_id or "keyframe" in model_id or len(asset_ids) > 1:
        payload["images"] = asset_ids
    else:
        payload["image"] = asset_ids[0]
    if tail_asset_id:
        payload["lastFrameImage"] = tail_asset_id
    if prompt:
        payload["prompt"] = prompt
    if aspect_ratio:
        payload["aspectRatio"] = aspect_ratio
    if generate_audio:
        payload["generateAudio"] = True

    headers = {"Content-Type": "application/json", "Authorization": auth}
    log.info(
        "Scenario CACHE MISS · POST /generate/custom/%s · video · %d frame(s)",
        model_id,
        len(asset_ids),
    )
    r = httpx.post(
        f"{SCENARIO_BASE}/generate/custom/{model_id}",
        headers=headers,
        json=payload,
        timeout=60.0,
    )
    r.raise_for_status()
    job_id = r.json()["job"]["jobId"]

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        rr = httpx.get(
            f"{SCENARIO_BASE}/jobs/{job_id}",
            headers={"Authorization": auth},
            timeout=30.0,
        )
        rr.raise_for_status()
        body = rr.json()
        status = body["job"]["status"]

        if status == "success":
            metadata = body["job"].get("metadata") or {}
            asset_ids_out = metadata.get("assetIds") or []
            if not asset_ids_out:
                raise RuntimeError(
                    f"Scenario video job {job_id} succeeded but no assetIds"
                )
            asset_id = asset_ids_out[0]
            ar = httpx.get(
                f"{SCENARIO_BASE}/assets/{asset_id}",
                headers={"Authorization": auth},
                timeout=30.0,
            )
            ar.raise_for_status()
            ar_body = ar.json()
            asset_url = (
                (ar_body.get("asset") or {}).get("url")
                or ar_body.get("url")
                or ""
            )
            result = {
                "url": asset_url,
                "job_id": job_id,
                "asset_id": asset_id,
                "stub": False,
                "model_id": model_id,
                "prompt": prompt,
                "mode": "video",
                "input_frames": len(image_paths),
                "tail_image": tail_asset_id is not None,
                "audio": bool(generate_audio),
            }
            DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(result, indent=2))
            return asset_url, result

        if status in ("failure", "canceled"):
            # Scenario surfaces the actual reason under metadata.error
            # (validation rejections like "end_image not supported with
            # audio", quota exhaustion, content-policy blocks, etc.).
            # Bubbling the message up makes 502s in the UI actionable
            # instead of opaque "status=failure".
            err_detail = (
                (body["job"].get("metadata") or {}).get("error")
                or "no detail provided"
            )
            raise RuntimeError(
                f"Scenario video job {job_id} ended with status={status}: "
                f"{err_detail}"
            )
        time.sleep(5.0)  # video gen polls less aggressively

    log.warning(
        "Scenario video job %s timed out after %.0fs — returning stub.",
        job_id,
        timeout_s,
    )
    fallback_url = _picsum_stub(f"video_{model_id}")
    return fallback_url, {
        "url": fallback_url,
        "stub": True,
        "stub_reason": "scenario_video_timeout",
        "job_id": job_id,
        "model_id": model_id,
        "mode": "video",
    }


def call_scenario(
    prompt: str,
    *,
    label: str = "asset",
    model_id: str = DEFAULT_MODEL_ID,
    width: int = 720,
    height: int = 1280,
    timeout_s: float = 360.0,
    reference_image_paths: list[Path] | None = None,
    ipadapter_type: str = "style",  # "style" or "character"
    img2img_strength: float | None = None,  # if set, force img2img mode (single ref)
) -> tuple[str, dict]:
    """Generate one image via Scenario REST API. Dispatch:

    - ``model_id`` starts with ``model_`` (custom proxied API like GPT
      Image 2, Imagen 4, Seedream …) → ``call_scenario_custom``. Refs
      are silently ignored (the route doesn't support IP-Adapter).
    - 0 refs                                 → ``txt2img``
    - 1+ refs, no ``img2img_strength``       → ``txt2img-ip-adapter``
    - exactly 1 ref + ``img2img_strength``   → ``img2img`` (composition lock)

    Returns ``(asset_url, metadata_dict)``. ``metadata_dict["stub"]`` is True
    when credentials are missing or when generation timed out (graceful
    degradation: the pipeline continues with a Picsum placeholder rather
    than crashing on a single slow asset).

    On timeout, the failure is *not* cached — re-running may succeed if
    Scenario's queue has cleared.

    Cached on disk by all inputs that affect the output.
    """
    # Custom (third-party proxied) models route through a different endpoint
    # and ignore reference images. Delegate before any ref upload.
    if _is_custom_model(model_id):
        if reference_image_paths:
            log.info(
                "Scenario custom model %s ignores %d reference image(s) "
                "(prompt-only route).",
                model_id,
                len(reference_image_paths),
            )
        return call_scenario_custom(
            prompt, model_id=model_id, label=label, timeout_s=timeout_s
        )

    refs = reference_image_paths or []
    refs = refs[:MAX_IPADAPTER_REFS]  # cap

    if img2img_strength is not None and len(refs) >= 1:
        mode = "img2img"
    elif len(refs) >= 1:
        mode = "txt2img-ip-adapter"
    else:
        mode = "txt2img"

    cache_key = {
        "p": prompt,
        "m": model_id,
        "mode": mode,
        "refs": [
            hashlib.sha256(p.read_bytes()).hexdigest()[:16] for p in refs
        ],
        "strength": img2img_strength,
        "ipa_type": ipadapter_type if mode == "txt2img-ip-adapter" else None,
    }
    cache_path = DEFAULT_CACHE_DIR / f"{label}__{hash_key(cache_key)}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        return cached["url"], cached

    auth = _basic_auth_header()

    # Stub path — no credentials.
    if not auth:
        url = _picsum_stub(prompt)
        result = {
            "url": url,
            "stub": True,
            "prompt": prompt,
            "model_id": model_id,
            "mode": mode,
        }
        DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(result, indent=2))
        return url, result

    headers = {"Content-Type": "application/json", "Authorization": auth}

    # Build payload — same base for all 3 modes
    payload: dict = {
        "prompt": prompt,
        "modelId": model_id,
        "numSamples": 1,
        "numInferenceSteps": 28,
        "guidance": 3.5,
        "width": width,
        "height": height,
    }

    # Upload refs and add mode-specific fields
    endpoint = "/generate/txt2img"
    asset_ids: list[str] = []
    if mode != "txt2img":
        try:
            asset_ids = [
                upload_asset(p, name=f"ref_{label}_{i}")
                for i, p in enumerate(refs)
            ]
        except Exception as e:  # noqa: BLE001
            log.warning(
                "Scenario reference upload failed (%s) — falling back to txt2img.", e
            )
            mode = "txt2img"

    if mode == "img2img":
        payload["image"] = asset_ids[0]
        payload["strength"] = img2img_strength
        endpoint = "/generate/img2img"
    elif mode == "txt2img-ip-adapter":
        payload["ipAdapterImageIds"] = asset_ids
        payload["ipAdapterType"] = ipadapter_type
        endpoint = "/generate/txt2img-ip-adapter"

    log.info(
        "Scenario CACHE MISS · POST %s · model=%s%s",
        endpoint,
        model_id,
        (
            f" · {len(asset_ids)} ref(s) · type={ipadapter_type}"
            if mode == "txt2img-ip-adapter"
            else f" · ref={refs[0].name}, strength={img2img_strength}"
            if mode == "img2img"
            else ""
        ),
    )
    r = httpx.post(
        f"{SCENARIO_BASE}{endpoint}",
        headers=headers,
        json=payload,
        timeout=60.0,
    )
    r.raise_for_status()
    job_id = r.json()["job"]["jobId"]

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        rr = httpx.get(
            f"{SCENARIO_BASE}/jobs/{job_id}",
            headers={"Authorization": auth},
            timeout=30.0,
        )
        rr.raise_for_status()
        body = rr.json()
        status = body["job"]["status"]

        if status == "success":
            asset_ids = (body["job"].get("metadata") or {}).get("assetIds") or []
            if not asset_ids:
                raise RuntimeError("Scenario job succeeded but no assetIds returned")

            asset_id = asset_ids[0]
            ar = httpx.get(
                f"{SCENARIO_BASE}/assets/{asset_id}",
                headers={"Authorization": auth},
                timeout=30.0,
            )
            ar.raise_for_status()
            ar_body = ar.json()
            asset_url = (
                (ar_body.get("asset") or {}).get("url")
                or ar_body.get("url")
                or ""
            )
            result = {
                "url": asset_url,
                "job_id": job_id,
                "asset_id": asset_id,
                "stub": False,
                "prompt": prompt,
                "model_id": model_id,
                "mode": mode,
                "reference_images": [p.name for p in refs] if refs else None,
                "img2img_strength": img2img_strength if mode == "img2img" else None,
                "ipadapter_type": ipadapter_type if mode == "txt2img-ip-adapter" else None,
            }
            DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(result, indent=2))
            return asset_url, result

        if status in ("failure", "canceled"):
            raise RuntimeError(f"Scenario job ended with status={status}")

        time.sleep(3.0)

    # Graceful degradation on timeout — return a Picsum placeholder so the
    # pipeline can complete. Do NOT cache: a future re-run may succeed once
    # Scenario's queue clears. The job_id is kept in metadata so the user can
    # check the Scenario dashboard manually for the eventual asset.
    log.warning(
        "Scenario job %s timed out after %.0fs — falling back to placeholder. "
        "Re-run later to retry; the job may still complete in Scenario's queue.",
        job_id,
        timeout_s,
    )
    fallback_url = _picsum_stub(prompt)
    return fallback_url, {
        "url": fallback_url,
        "stub": True,
        "stub_reason": "scenario_timeout",
        "job_id": job_id,
        "prompt": prompt,
        "model_id": model_id,
    }


def generate_variants(
    chosen: list[tuple[CreativeArchetype, GameFitScore]],
    briefs: list[CreativeBrief],
    *,
    model_id: str = DEFAULT_MODEL_ID,
    reference_image_paths: list[Path] | None = None,
    ipadapter_type: str = "style",
) -> list[GeneratedVariant]:
    """For each brief, generate one hero frame + storyboard via Scenario.

    When ``reference_image_paths`` is non-empty (typical: the target game's
    screenshots), uses **txt2img + IP-Adapter** to transfer the game's
    visual STYLE (palette, character/UI vibe) onto each prompt-driven
    composition. This is the right tool for ad creatives — palette match
    without composition lock — and prevents the "deceptive ad" problem
    where a generated visual looks nothing like the actual game.

    All available refs (capped at 3) are passed as IP-Adapter style refs
    for every scenario_prompt — every frame of the variant gets the full
    style anchor.

    ``test_priority`` is a final ranking by ``signal_score × game_fit / 100``
    so the publishing team knows which variant to A/B-test first.
    """
    variants: list[GeneratedVariant] = []
    refs = (reference_image_paths or [])[:MAX_IPADAPTER_REFS]

    for arch, sc in chosen:
        brief = next(b for b in briefs if b.archetype_id == arch.archetype_id)
        urls: list[str] = []
        for j, prompt in enumerate(brief.scenario_prompts):
            url, _meta = call_scenario(
                prompt,
                label=f"{brief.archetype_id}_{j}",
                model_id=model_id,
                reference_image_paths=refs,
                ipadapter_type=ipadapter_type,
            )
            urls.append(url)

        hero = urls[0] if urls else ""
        storyboard = urls[1:] if len(urls) > 1 else []

        priority_score = arch.overall_signal_score * (sc.overall / 100.0)
        variants.append(
            GeneratedVariant(
                brief=brief,
                hero_frame_path=hero,
                storyboard_paths=storyboard,
                test_priority=0,  # set below
                test_priority_rationale=(
                    f"signal_score={arch.overall_signal_score:.2f} × "
                    f"game_fit={sc.overall}/100 ⇒ priority={priority_score:.2f}"
                ),
            )
        )

    # Final ranking by combined score
    variants.sort(
        key=lambda v: float(v.test_priority_rationale.split("priority=")[-1]),
        reverse=True,
    )
    for i, v in enumerate(variants, start=1):
        v.test_priority = i

    return variants
