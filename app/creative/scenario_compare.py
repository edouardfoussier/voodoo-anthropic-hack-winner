"""Side-by-side Scenario model comparison harness.

Internal team tooling — NOT used by the production pipeline. The single-model
generator lives in :mod:`app.creative.scenario` (``generate_variants``) and
its public surface is unchanged.

This module fans the same ``CreativeBrief`` out across multiple Scenario
``model_id``s in parallel so the team can eyeball which base model produces
the most on-DNA visual for a given game. Reuses ``call_scenario`` verbatim
(prompt, IP-Adapter refs, mode auto-selection) — the only thing that varies
between calls is ``model_id``.

Some Scenario models (``flux.1-dev``, ``flux.1-schnell``, ``stable-diffusion-xl-base-1.0``,
``flux.1-composition``) support the ``txt2img-ip-adapter`` endpoint and can
ingest game screenshots as IP-Adapter style refs. Most "external" custom
models proxied through Scenario (GPT Image 2, Imagen 4, Ideogram 3, Flux 1.1
Pro, Seedream 4 …) do NOT — their capability list is just ``[txt2img,
img2img]``. For those we fall back to plain ``txt2img`` (no refs), so the
comparison is "pure prompt fidelity" vs "prompt + IPA-anchored DNA".

The list of comparison candidates lives in :data:`DEFAULT_MODELS_TO_COMPARE`
(curated 2026-04-26 from Scenario's ``GET /v1/models?privacy=public``
catalog cached at ``data/cache/scenario/models_catalog.json``). Discovery
helpers below let you re-run that probe whenever Scenario adds new tenants.

Outputs land under ``out_dir/<sanitized_model_id>/hero.png`` together with a
``summary.json`` describing the run and a static ``grid.html`` for
side-by-side review in the browser.
"""

from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import NamedTuple

import httpx

from app._cache import hash_key
from app._paths import CACHE_DIR
from app.creative.scenario import (
    SCENARIO_BASE,
    _basic_auth_header,
    _picsum_stub,
    call_scenario,
    call_scenario_custom,  # promoted to scenario.py (was defined here)
)
from app.models import CreativeBrief

log = logging.getLogger(__name__)


class ModelCandidate(NamedTuple):
    """One Scenario model row in the compare matrix.

    Three flavors of Scenario model end up dispatched differently:

    1. ``type=flux.1`` / ``flux.1-composition`` / similar IPA-capable models
       (``supports_ip_adapter=True``) → :func:`call_scenario` with the
       brief's screenshot refs (true IPA mode).
    2. Same family, no refs available → :func:`call_scenario` with
       ``reference_image_paths=None`` (plain ``txt2img``).
    3. ``type=custom`` proxied APIs (GPT Image, Imagen, Ideogram, Flux
       1.1 Pro, Seedream, Veo …) → :func:`call_scenario_custom` which
       hits ``POST /v1/generate/custom/{modelId}``. The plain
       ``/v1/generate/txt2img`` route 400s for these with
       ``Standalone models are not supported for this endpoint``.
    """

    model_id: str
    label: str
    supports_ip_adapter: bool
    use_custom_endpoint: bool = False


# Curated 2026-04-26 from /v1/models?privacy=public (531 models total on the
# tenant). The 4 IPA-capable rows below are the only ones for which
# game-DNA style transfer actually works; the rest are pure prompt-driven
# baselines we test for "ceiling quality" / text-rendering / cost.
#
# DO NOT replace this list silently — the script's --models override accepts
# bare ids and looks up capability metadata from the cached catalog at
# data/cache/scenario/models_catalog.json (see ``capability_for_model``).
DEFAULT_MODELS_TO_COMPARE: list[ModelCandidate] = [
    # ── IP-Adapter capable (game-DNA injection works) ──────────────────
    # Production default (kept here so the comparison always shows the
    # baseline the live pipeline ships).
    ModelCandidate("flux.1-dev", "Flux 1.0 dev", True),
    # Same family, ~10x cheaper. Useful as a "fast-and-good-enough" sanity
    # check during cost-sensitive runs.
    ModelCandidate("flux.1-schnell", "Flux Schnell (fast)", True),
    # ── Prompt-only premium models (proxied via /generate/custom) ──────
    # 2026-04-26 ranking on Marble Sort + Block Blast briefs:
    #   #1  GPT Image 2   — best photoreal hero, perfect text rendering,
    #                       always returns 9:16; ~11 CU/call.
    #   #2  Imagen 4 Ult. — premium photoreal, slightly less stylised,
    #                       defaults to landscape; ~10 CU/call.
    #   #3  Seedream 4.0  — strong photoreal #2, native 9:16, fastest
    #                       non-Flux (~30s, 4 CU/call) — cheap+good combo.
    # Dropped from defaults but available via --models override:
    #   model_ideogram-v3-quality   — best text rendering but wrong aspect
    #   model_bfl-flux-1-1-pro      — middle-of-the-road, text issues
    #   model_7oiHtKChpcLpy4jq3Jq2BG8n (Cutesy 3D) — empty compositions
    ModelCandidate(
        "model_openai-gpt-image-2", "GPT Image 2", False, use_custom_endpoint=True
    ),
    ModelCandidate(
        "model_imagen4-ultra", "Imagen 4 Ultra", False, use_custom_endpoint=True
    ),
    ModelCandidate(
        "model_bytedance-seedream-4-editing",
        "Seedream 4.0",
        False,
        use_custom_endpoint=True,
    ),
]
# Historic notes (kept so future agents don't repeat the mistakes):
#   * ``model-sdxl-1-0`` / ``model-sdxl-lightning`` / ``model-anime-xl`` from
#     the very first probe all 404'd — those were dashboard slugs, not API
#     ids.
#   * ``stable-diffusion-xl-base-1.0`` is the *real* SDXL id but Scenario
#     returned ``410 Gone — SD 1.5 and SDXL inference is no longer available``
#     on 2026-04-26. SDXL is dead on this tenant; do not re-add.
#   * Catalog says ~531 public models (mostly Flux 1.x LoRAs and 14
#     ``flux.1-composition`` LoRA bundles like ``Cutesy 3D`` — those still
#     work via the IPA endpoint with ``baseModelId=flux.1-dev`` under the
#     hood). All third-party APIs (GPT Image, Imagen, Ideogram, Flux 1.1
#     Pro, Seedream, Veo, Kling …) are ``type=custom`` and require
#     ``POST /v1/generate/custom/{modelId}`` — see ``call_scenario_custom``.
#   * The production pipeline default (``DEFAULT_MODEL_ID`` in
#     ``app.creative.scenario``) stays at ``flux.1-dev`` for now: switching
#     to GPT Image 2 / Imagen 4 / Seedream would require teaching
#     ``call_scenario`` about the ``/generate/custom/{modelId}`` route,
#     which is out of scope for this harness change. See commit body.

CATALOG_CACHE_PATH = CACHE_DIR / "scenario" / "models_catalog.json"


def discover_scenario_models(
    *,
    cache_path: Path = CATALOG_CACHE_PATH,
    refresh: bool = False,
    page_size: int = 100,
) -> list[dict]:
    """Fetch every public model on the tenant via ``GET /v1/models``.

    Cached on disk to ``data/cache/scenario/models_catalog.json``. Set
    ``refresh=True`` to force a re-fetch (Scenario adds new "external"
    models — Imagen, Seedream, Veo — fairly often).

    Returns the raw ``list[dict]`` from Scenario, with each entry carrying
    its own ``capabilities``, ``type``, ``name``, ``tags``, etc. If
    credentials are missing OR the cache exists, no network call is made.
    """
    if not refresh and cache_path.exists():
        return json.loads(cache_path.read_text()).get("models") or []

    auth = _basic_auth_header()
    if not auth:
        log.warning(
            "discover_scenario_models: no SCENARIO credentials, returning empty"
        )
        return []

    headers = {"Authorization": auth}
    all_models: list[dict] = []
    token: str | None = None
    page = 0
    with httpx.Client(timeout=60.0) as client:
        while True:
            params: dict[str, object] = {"privacy": "public", "pageSize": page_size}
            if token:
                params["paginationToken"] = token
            r = client.get(
                f"{SCENARIO_BASE}/models", headers=headers, params=params
            )
            r.raise_for_status()
            body = r.json()
            chunk = body.get("models") or []
            all_models.extend(chunk)
            token = (
                body.get("nextPaginationToken")
                or body.get("paginationToken")
                or (body.get("pagination") or {}).get("nextPaginationToken")
            )
            log.info(
                "discover_scenario_models page=%d got=%d total=%d next=%s",
                page,
                len(chunk),
                len(all_models),
                "<set>" if token else None,
            )
            page += 1
            if not chunk or not token or page > 30:
                break

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"models": all_models}, indent=2))
    return all_models


def capability_for_model(
    model_id: str, *, catalog: list[dict] | None = None
) -> tuple[list[str], dict | None]:
    """Return ``(capabilities, raw_metadata)`` for a single ``model_id``.

    Used by the CLI when the user passes a bare ``--models foo,bar`` list
    and we need to decide whether each model can accept IP-Adapter refs.
    Falls back to an empty list when the model isn't in the catalog.
    """
    if catalog is None:
        catalog = discover_scenario_models()
    by_id = {m["id"]: m for m in catalog}
    m = by_id.get(model_id)
    if not m:
        return [], None
    return list(m.get("capabilities") or []), m


# NOTE: the canonical implementation of ``call_scenario_custom`` lives in
# ``app/creative/scenario.py`` since 2026-04-26 (production routes GPT
# Image 2 and other proxied APIs through the same helper, so it had to
# be in scenario.py to avoid a circular import). It's re-exported above
# for the legacy import path used by ``scripts/compare_models.py``.


_SAFE_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _safe_slug(value: str) -> str:
    return _SAFE_SLUG_RE.sub("_", value).strip("._-") or "model"


def _download_image(url: str, dest: Path) -> Path:
    """Fetch ``url`` to ``dest`` (creating parents). Returns ``dest``.

    Picsum (used by the no-credentials stub) returns 302 → image; httpx
    follows redirects when ``follow_redirects=True``.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def _run_one(
    *,
    model_id: str,
    model_label: str,
    supports_ip_adapter: bool,
    use_custom_endpoint: bool,
    prompt: str,
    label_base: str,
    out_dir: Path,
    reference_image_paths: list[Path] | None,
) -> dict:
    """Generate one image for one ``model_id``. Never raises.

    Dispatch:

    * ``use_custom_endpoint=True`` → :func:`call_scenario_custom` (proxied
      third-party APIs: GPT Image, Imagen, Ideogram, Flux Pro, Seedream …).
      Refs are ignored — the ``/generate/custom/{modelId}`` route is
      prompt-only by design.
    * ``supports_ip_adapter=True`` → :func:`call_scenario` with refs (true
      IPA mode, real game-DNA injection).
    * Otherwise → :func:`call_scenario` without refs (plain ``txt2img``).

    Returns a result dict with keys: ``model_id``, ``model_label``,
    ``ok``, ``elapsed_s``, ``image_path`` (relative to ``out_dir``) or
    ``error`` on failure, plus the underlying ``meta`` dict from the
    underlying call when successful.
    """
    slug = _safe_slug(model_id)
    model_dir = out_dir / slug
    image_path = model_dir / "hero.png"

    refs_for_call = reference_image_paths if supports_ip_adapter else None

    t0 = time.perf_counter()
    try:
        if use_custom_endpoint:
            url, meta = call_scenario_custom(
                prompt,
                model_id=model_id,
                label=f"{label_base}__{slug}",
            )
        else:
            url, meta = call_scenario(
                prompt,
                label=f"{label_base}__{slug}",
                model_id=model_id,
                reference_image_paths=refs_for_call,
            )
    except Exception as e:  # noqa: BLE001
        elapsed = time.perf_counter() - t0
        log.warning("Scenario compare failed for model_id=%s: %s", model_id, e)
        return {
            "model_id": model_id,
            "model_label": model_label,
            "ok": False,
            "elapsed_s": elapsed,
            "error": f"{type(e).__name__}: {e}",
            "image_path": None,
            "meta": None,
        }

    try:
        _download_image(url, image_path)
    except Exception as e:  # noqa: BLE001
        elapsed = time.perf_counter() - t0
        log.warning(
            "Scenario compare: download failed for model_id=%s url=%s: %s",
            model_id,
            url,
            e,
        )
        return {
            "model_id": model_id,
            "model_label": model_label,
            "ok": False,
            "elapsed_s": elapsed,
            "error": f"download_failed: {e}",
            "image_path": None,
            "meta": meta,
        }

    elapsed = time.perf_counter() - t0
    return {
        "model_id": model_id,
        "model_label": model_label,
        "ok": True,
        "elapsed_s": elapsed,
        "image_path": str(image_path.relative_to(out_dir)),
        "stub": bool(meta.get("stub")),
        "url": url,
        "mode": meta.get("mode"),
        "meta": meta,
    }


def _render_grid_html(
    *,
    out_dir: Path,
    brief: CreativeBrief,
    prompt: str,
    results: list[dict],
) -> Path:
    """Write a no-build static HTML page with a CSS-grid of all variants."""
    cards: list[str] = []
    for r in results:
        slug = _safe_slug(r["model_id"])
        if r["ok"] and r["image_path"]:
            img_html = (
                f'<img src="{r["image_path"]}" alt="{slug}" '
                f'loading="lazy" />'
            )
            badge = (
                "stub" if r.get("stub") else f'{r["elapsed_s"]:.1f}s'
            )
        else:
            img_html = (
                '<div class="missing">no image<br/><small>'
                f'{(r.get("error") or "").replace("<", "&lt;")}</small></div>'
            )
            badge = "FAIL"

        mode_tag = (r.get("mode") or "?").replace("txt2img-ip-adapter", "ipa")
        ipa_dot = "●" if r.get("supports_ip_adapter") else "○"
        cards.append(
            f"""
        <figure class="card">
          <div class="frame">{img_html}</div>
          <figcaption>
            <strong>{r["model_label"]}</strong>
            <code>{r["model_id"]}</code>
            <span class="meta">{ipa_dot} {mode_tag}</span>
            <span class="badge">{badge}</span>
          </figcaption>
        </figure>"""
        )

    prompt_html = prompt.replace("<", "&lt;").replace(">", "&gt;")
    title = (brief.title or "Scenario model comparison").replace(
        "<", "&lt;"
    )

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>HookLens · Scenario model compare · {title}</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{
    margin: 0; padding: 24px;
    font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
    background: #0d0d10; color: #e8e8ee;
  }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  h2 {{ font-size: 13px; font-weight: 500; opacity: .7; margin: 0 0 16px; }}
  .prompt {{
    background: #16161c; border: 1px solid #2a2a32; border-radius: 8px;
    padding: 12px 14px; font-size: 12px; line-height: 1.45;
    white-space: pre-wrap; max-height: 160px; overflow: auto;
    margin-bottom: 24px;
  }}
  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }}
  .card {{
    background: #16161c; border: 1px solid #2a2a32; border-radius: 10px;
    padding: 10px; margin: 0; display: flex; flex-direction: column;
  }}
  .frame {{
    aspect-ratio: 9 / 16; width: 100%; background: #0a0a0d;
    border-radius: 6px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }}
  .frame img {{ width: 100%; height: 100%; object-fit: cover; }}
  .missing {{ color: #ff6b6b; font-size: 12px; text-align: center; padding: 12px; }}
  figcaption {{
    margin-top: 8px; display: flex; flex-direction: column; gap: 2px;
    font-size: 12px;
  }}
  figcaption code {{
    font-size: 11px; opacity: .65;
  }}
  figcaption .meta {{
    font-size: 10px; opacity: .55; letter-spacing: .03em;
    margin-top: 2px;
  }}
  .badge {{
    align-self: flex-start; margin-top: 4px;
    background: #23232c; padding: 2px 6px; border-radius: 4px;
    font-size: 10px; letter-spacing: .03em;
  }}
</style>
</head>
<body>
  <h1>{title}</h1>
  <h2>Scenario model comparison · brief id <code>{brief.archetype_id}</code> · target <code>{brief.target_game_id}</code></h2>
  <div class="prompt">{prompt_html}</div>
  <div class="grid">{"".join(cards)}
  </div>
</body>
</html>
"""
    grid_path = out_dir / "grid.html"
    grid_path.write_text(html)
    return grid_path


def _normalize_candidates(
    model_ids: (
        list[ModelCandidate]
        | list[tuple[str, str]]
        | list[tuple[str, str, bool]]
        | list[tuple[str, str, bool, bool]]
    ),
) -> list[ModelCandidate]:
    """Coerce legacy tuple inputs to :class:`ModelCandidate`.

    * 2-tuple ``(id, label)`` → IPA-capable, non-custom (historical
      Flux-only behavior).
    * 3-tuple ``(id, label, ipa)`` → custom-endpoint defaults to False.
    * 4-tuple ``(id, label, ipa, use_custom_endpoint)`` → as given.
    """
    out: list[ModelCandidate] = []
    for item in model_ids:
        if isinstance(item, ModelCandidate):
            out.append(item)
        elif len(item) == 4:
            out.append(
                ModelCandidate(item[0], item[1], bool(item[2]), bool(item[3]))
            )
        elif len(item) == 3:
            out.append(ModelCandidate(item[0], item[1], bool(item[2]), False))
        elif len(item) == 2:
            out.append(ModelCandidate(item[0], item[1], True, False))
        else:
            raise ValueError(f"Unrecognized model spec: {item!r}")
    return out


def compare_models_for_brief(
    brief: CreativeBrief,
    *,
    model_ids: list[ModelCandidate] | list[tuple[str, str]] | list[tuple[str, str, bool]],
    reference_image_paths: list[Path] | None = None,
    out_dir: Path,
) -> dict[str, list[Path]]:
    """Generate ``brief``'s hero shot through every ``model_id`` in parallel.

    Each ``ModelCandidate`` carries its own ``supports_ip_adapter`` bit; for
    models without that capability the call is forced through plain
    ``txt2img`` (no refs) so the API doesn't 404. For backward compatibility
    a 2-tuple ``(id, label)`` is treated as IPA-capable.

    Reuses ``call_scenario`` from :mod:`app.creative.scenario` (and therefore
    its on-disk cache, keyed by prompt + model + mode + refs). Subsequent
    runs with the same inputs hit the cache and are essentially free.

    On per-model failure, the slot's value is an empty list and execution
    continues — one bad ``model_id`` does not abort the whole comparison.

    Side effects (under ``out_dir``):
      - ``<safe_model_id>/hero.png`` for each model that succeeded
      - ``summary.json`` listing prompt + per-model status, paths, timings
      - ``grid.html`` static viewer (open it in a browser)

    Returns ``{model_id: [Path, ...]}``. Caller should treat an empty list
    as "this model errored — see ``summary.json`` for the reason".
    """
    if not brief.scenario_prompts:
        raise ValueError(
            f"Brief {brief.archetype_id!r} has no scenario_prompts to compare."
        )

    candidates = _normalize_candidates(model_ids)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    hero_prompt = brief.scenario_prompts[0]
    label_base = f"compare_{_safe_slug(brief.target_game_id)}_{_safe_slug(brief.archetype_id)}"

    results: list[dict] = []
    max_workers = max(1, len(candidates))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {
            ex.submit(
                _run_one,
                model_id=c.model_id,
                model_label=c.label,
                supports_ip_adapter=c.supports_ip_adapter,
                use_custom_endpoint=c.use_custom_endpoint,
                prompt=hero_prompt,
                label_base=label_base,
                out_dir=out_dir,
                reference_image_paths=reference_image_paths,
            ): c.model_id
            for c in candidates
        }
        for fut in as_completed(futures):
            r = fut.result()
            cand = next(
                (c for c in candidates if c.model_id == r["model_id"]), None
            )
            r["supports_ip_adapter"] = cand.supports_ip_adapter if cand else False
            r["use_custom_endpoint"] = cand.use_custom_endpoint if cand else False
            results.append(r)

    order = {c.model_id: i for i, c in enumerate(candidates)}
    results.sort(key=lambda r: order.get(r["model_id"], 999))

    grid_path = _render_grid_html(
        out_dir=out_dir, brief=brief, prompt=hero_prompt, results=results
    )

    summary = {
        "brief": {
            "archetype_id": brief.archetype_id,
            "target_game_id": brief.target_game_id,
            "title": brief.title,
        },
        "hero_prompt": hero_prompt,
        "reference_image_paths": [
            str(p) for p in (reference_image_paths or [])
        ],
        "models": [
            {
                "model_id": r["model_id"],
                "model_label": r["model_label"],
                "supports_ip_adapter": r.get("supports_ip_adapter", False),
                "use_custom_endpoint": r.get("use_custom_endpoint", False),
                "ok": r["ok"],
                "elapsed_s": round(r["elapsed_s"], 2),
                "image_path": r.get("image_path"),
                "stub": r.get("stub", False),
                "mode": r.get("mode"),
                "url": r.get("url"),
                "error": r.get("error"),
            }
            for r in results
        ],
        "grid_html": str(grid_path.relative_to(out_dir)),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    return {
        r["model_id"]: (
            [out_dir / r["image_path"]]
            if r["ok"] and r["image_path"]
            else []
        )
        for r in results
    }
