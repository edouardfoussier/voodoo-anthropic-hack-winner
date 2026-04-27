# HookLens pipeline — data contract & improvement opportunities

> Snapshot date: 2026-04-26
> Branch: edouard
> Reading order: this is the canonical reference. For the high-level product spec, see `docs/hooklens-spec.md`; for SensorTower API details, `docs/sensortower-api.md`.

## Pipeline overview at a glance

| # | step_id | label (UI) | External / LLM | Cost (est.) | Primary cache / disk |
|---|---------|------------|----------------|-------------|----------------------|
| 1 | `target_meta` | Resolve target game | SensorTower + optional Voodoo catalog | — | `data/cache/sensortower/search_*`, `meta_*` |
| 2 | `game_dna` | Extract Game DNA | Gemini Vision (`GEMINI_VISION_MODEL`, default `gemini-3.1-pro-preview`) | Not tallied in code | `data/cache/game_dna/{app_id}.json`, `data/cache/screenshots/{app_id}/*.png` |
| 3 | `top_advertisers` | Discover top advertisers | SensorTower | — | `data/cache/sensortower/top_apps_*` |
| 4 | `raw_creatives` | Pull top creatives | SensorTower | — | `data/cache/sensortower/creatives_top_*` |
| 5 | `deconstructed` | Deconstruct videos (STEPS label: "Gemini Pro") | Gemini (`GEMINI_VIDEO_MODEL`, default `gemini-3-flash-preview`) | ~`estimate_cost_usd()` — e.g. **~$0.002** / 15s at default $/M | `data/cache/videos/{creative_id}.mp4` — **no** Gemini output cache |
| 6 | `archetypes` | Cluster archetypes + signals | — (Python) | — | — |
| 7 | `fit_scores` | Score game-fit (Opus) | `claude-opus-4-7` (tool use) | Not in code | `data/cache/game_fit/fit_{archetype_id}_{app_id}__*.json` |
| 8 | `briefs` | Author creative briefs (Opus) | `claude-opus-4-7` + optional Voodoo benchmark | Not in code | `data/cache/briefs/brief_{archetype_id}_{app_id}__*.json` |
| 9 | `variants` | Generate visuals (Scenario) | Scenario REST + `flux.1-dev` | Not in code | `data/cache/scenario/`, `data/cache/scenario_assets/` |
| 10 | `report` | Compose final report | — | `total_cost_usd` = **deconstruct sum only** | `data/cache/reports/{app_id}_e2e.json` |

Orchestration: `STEPS` at `app/pipeline.py:432-443`, `run_pipeline` at `app/pipeline.py:451-476`.

---

## Step 1 — Resolve target game (`_step_resolve_game`)

- **File:** `app/pipeline.py:146-171`, `_resolve_via_voodoo_catalog` `app/pipeline.py:174-186`, `resolve_game` `app/sources/sensortower.py:55-113`.

- **What it does:** Expands `countries` / `networks` (sentinel `"all"` → `ALL_COUNTRIES` / `ALL_NETWORKS`, `app/pipeline.py:62-75`). If `game_name` casefold-matches a Voodoo catalog title, uses that `AppMetadata` and skips search. Otherwise calls `resolve_game(term, country=primary)`.

- **Inputs:** `PipelineConfig.game_name`, `PipelineConfig.countries` → `state.resolved_countries[0]` as primary; `SENSORTOWER_API_KEY` (`sensortower.py:34-38`); optional `fetch_voodoo_catalog()` / `data/cache/voodoo/catalog.json` (`voodoo.py:314+`).

- **Outputs:** `AppMetadata` → `state.target_meta`.

- **Disk:** `disk_cached` search + meta under `data/cache/sensortower/` (`sensortower.py:62-99`).

- **Improvement opportunities:** First search hit with an iOS app only (`sensortower.py:75-88`) — **multi-candidate disambiguation** would help wrong-app cases (needs UI, optional `models` extension). `PrototypeInput.target_audience_proxy` is **unused** (`pipeline.py:109`).

---

## Step 2 — Extract Game DNA (`_step_game_dna`)

- **File:** `app/pipeline.py:189-192`, `app/analysis/game_dna.py`.

- **What it does:** Cache hit: read `data/cache/game_dna/{app_id}.json`. Else download screenshots, run Gemini with JSON schema `GameDNA`.

- **Inputs:** `AppMetadata` (`screenshot_urls`, `description`, `app_id`, `name`); `GEMINI_API_KEY`; `GEMINI_VISION_MODEL` default `gemini-3.1-pro-preview` (`game_dna.py:22-23`).

- **Prompt:** `_build_prompt` (`game_dna.py:25-42`): instructions + `description[:1500]`; images are `Part.from_bytes` **before** text (`game_dna.py:80-88`).

- **Outputs:** `GameDNA` on `state.game_dna`.

- **Cost:** not included in `HookLensReport.total_cost_usd` (`pipeline.py:417-419`).

- **Improvement opportunities:** Tally Vision cost in report; optional Flash via env to save budget; extend inputs (icon, more assets) = prompt + possible `GameDNA` scope.

---

## Step 3 — Discover top advertisers (`_step_top_advertisers`)

- **File:** `app/pipeline.py:195-223`, `sensortower.py:116-145`.

- **What it does:** Per `resolved_country`, `fetch_top_advertisers` with `network=All Networks`; merge/dedupe; cap `max_top_advertisers`.

- **Inputs:** `category_id`, `period`, `period_date`, `resolved_countries`.

- **Outputs:** `list[dict]` → `state.top_advertisers` (raw ST, not a Pydantic model).

- **Disk:** `top_apps_*` cache (`sensortower.py:139-144`).

- **Improvement opportunities:** Per-network top advertisers for narrative alignment with step 4; use SoV to weight archetype importance (new logic or fields).

---

## Step 4 — Pull top creatives (`_step_top_creatives`)

- **File:** `app/pipeline.py:226-276`, `sensortower.py:148-223`.

- **What it does:** Nested loops over `resolved_networks` × `resolved_countries`; `fetch_top_creatives` per cell; dedupe by `creative_id` until `max_creatives`. Continues on per-cell exceptions.

- **Inputs:** Defaults include `ad_types=video,video-interstitial`, `aspect_ratios=9:16`, `video_durations=:15` (`sensortower.py:156-160`).

- **Outputs:** `list[RawCreative]`.

- **Disk:** `creatives_top_*` (`sensortower.py:179-184`).

- **Improvement opportunities:** `new_creative` flag; stronger diversity (phashion / sampling) for clustering quality.

---

## Step 5 — Deconstruct videos (`_step_deconstruct`)

- **File:** `app/pipeline.py:279-291`, `app/analysis/deconstruct.py`.

- **What it does:** `deconstruct_batch` with semaphore `deconstruct_concurrency`; per creative: local MP4 → Files API → `generate_content` with `DECONSTRUCT_PROMPT` and `_GeminiAnalysis` schema.

- **Model / cost:** `GEMINI_VIDEO_MODEL` default `gemini-3-flash-preview` (`deconstruct.py:36-42`); `estimate_cost_usd` in `deconstruct.py:117-123` (defaults $0.50/M in, $3/M out, 70 tok/s video, `deconstruct.py:48-51`).

- **Prompt structure:** Static `DECONSTRUCT_PROMPT` (`deconstruct.py:87-108`); `contents=[file, DECONSTRUCT_PROMPT]` — no inline ST fields.

- **Outputs:** `list[DeconstructedCreative]`; failures excluded in pipeline (`pipeline.py:289-290`).

- **Disk:** Videos cached; **`DEFAULT_DECONSTRUCT_CACHE_DIR` is unused** (`deconstruct.py:46`) — no deconstruct JSON cache.

- **Improvement opportunities:** **Disk cache Gemini output by `creative_id`** (spec in `AGENTS.md` `deconstruct/`); add ST `message`/`button_text` into prompt; optional Pro model via env for demo.

---

## Step 6 — Cluster archetypes + signals (`_step_archetypes`)

- **File:** `app/pipeline.py:295-298`, `app/analysis/archetypes.py`.

- **What it does:** Clusters on `(emotional_pitch, visual_style)`. Signals: `freshness` (mean days from `first_seen_at`), `freshness_norm`, `derivative_spread` = unique advertisers / cluster size, **`velocity` = real Share-of-Voice growth from SensorTower's `/v1/{os}/ad_intel/network_analysis` endpoint** (`archetypes.py:_compute_real_velocity`). For each archetype we resolve its members' advertiser app_ids, fetch weekly SoV over the last 4 weeks, and express velocity as `recent_2w_avg / older_2w_avg` clipped to `[0.5, 5.0]`. When SoV data is missing (no resolvable app_ids, empty `network_analysis` response, fewer than 2 weeks of data, quota exhaustion) we **fall back to the legacy `min(2, 1/freshness_norm)` proxy and log loudly** — the pipeline keeps running for niche apps. SoV time series cached on disk under `data/cache/sensortower/network_analysis_*` so re-clustering is free. `overall_signal_score` weighted 0.4 / 0.35 / 0.25. Centroid = max `raw.share`. `state.top_archetypes` = first `top_k_archetypes`.

- **Outputs:** `list[CreativeArchetype]`; `common_mechanics` always `[]` (`archetypes.py:87`).

- **Improvement opportunities:** Per-network velocity (currently aggregated across all networks); decay-weighted SoV (recent days weigh more); fill `common_mechanics`; richer cluster keys (e.g. `phashion_group`).

---

## Step 7 — Score game fit (`_step_game_fit`)

- **File:** `app/pipeline.py:301-309`, `app/analysis/game_fit.py`.

- **What it does:** `score_all(top_archetypes, game_dna)` — sequential `score_archetype` with tool `report_game_fit` / `GameFitScore` (`game_fit.py:25-29`, `62-85`). Then ranks `(archetype, fit)` and sets `state.chosen` to top `top_k_variants` (`pipeline.py:304-310`).

- **Prompt:** `game_fit.py:39-59` — full `GameDNA` JSON + archetype fields + signal numbers.

- **Model:** `claude-opus-4-7` (`game_fit.py:23-24`).

- **Cache:** `disk_cached` under `data/cache/game_fit/` (`game_fit.py:79-85`).

- **Improvement opportunities:** **Score only archetypes you will brief** to save Opus calls (currently scores all `top_k_archetypes` then slices); add market context to the prompt (no `models` if unstructured).

---

## Step 8 — Author creative briefs (`_step_briefs`)

- **File:** `app/pipeline.py:313-362`, `app/creative/brief.py`.

- **What it does:** `_build_publisher_benchmark` for Voodoo apps: `fetch_voodoo_app_creatives` (SensorTower `GET /v1/unified/ad_intel/creatives`, `voodoo.py:389-483`) → `PublisherBenchmark` (local model `brief.py:40-52`). `author_briefs(chosen, game_dna, benchmark)`.

- **Prompt:** `brief.py:86-130` — `GameDNA` JSON, archetype, fit scores, optional `to_prompt_block()` and differentiation directive. Tool `report_creative_brief` / `CreativeBrief` (`brief.py:27-32`).

- **Model:** `claude-opus-4-7` (`brief.py:25`).

- **Cache key:** `brief_{archetype_id}_{app_id}{_benchN}` when benchmark has N rows (`brief.py:168-176`) — count-only, not content hash.

- **Outputs:** `list[CreativeBrief]`.

- **Improvement opportunities:** **Benchmark for non-Voodoo** (same ST endpoint with competitor unified id + prompt block); **stronger cache invalidation** (hash benchmark payload); "competitor set" for jury story.

---

## Step 9 — Generate visuals (Scenario) (`_step_visuals`)

- **File:** `app/pipeline.py:365-388`, `app/creative/scenario.py`.

- **What it does:** Loads up to 3 PNGs from `SCREENSHOT_CACHE_DIR / {app_id}/*.png` (`pipeline.py:370-381`, `game_dna.py:20`). `generate_variants` runs each `brief.scenario_prompts` through `call_scenario` with IP-Adapter (style) when refs exist (`scenario.py:307-345`).

- **Auth / model:** `SCENARIO_API_KEY`, `SCENARIO_API_SECRET`; `flux.1-dev` default (`scenario.py:47-48`). Stubs to Picsum if missing (`scenario.py:162-176`).

- **Ref upload:** `upload_asset` → POST `/v1/assets`, `asset_id` cached under `data/cache/scenario_assets/` (`scenario.py:68-106`).

- **Outputs:** `list[GeneratedVariant]`; priority = `arch.overall_signal_score * (sc.overall/100)` (`scenario.py:350-370`).

- **Disk:** `data/cache/scenario/*.json` on success; timeout path not cached (`scenario.py:281-304`).

- **Improvement opportunities:** `ipadapter_type` = `character` when `GameDNA.character_present` (`scenario.py:118-119` + `pipeline.py:365-388`); document MCP vs this REST for Partner 2.

---

## Step 10 — Compose final report (`_step_compose_report`)

- **File:** `app/pipeline.py:391-428`.

- **What it does:** `HookLensReport` with `MarketContext` (note `period_start` == `period_end` from same `period_date` — `pipeline.py:394-406`), `top_archetypes`, all `fit_scores`, `final_variants`, `total_cost_usd` = sum of `deconstruction_cost_usd` only (`417-419`). Writes `data/cache/reports/{app_id}_e2e.json`.

- **Improvement opportunities:** Real date range; full cost rollup (Opus, Vision, Scenario).

---

## Cross-cutting

- **Report cost** understates the pipeline; biggest gaps: Opus, Game DNA, Scenario (`pipeline.py:417-419`).
- **Multi-market:** `resolved_countries` is in the report, but **Opus steps do not receive per-market archetype context** (prompt-only addition).
- **`models.py`:** Post-checkpoint changes need 3-way sign-off (`app/models.py:10-12`); `PublisherBenchmark` is intentionally local (`brief.py:35-36`).

## Prototype path

- `run_pipeline_prototype` (`app/pipeline.py:483-576`) skips live `target_meta` but still fires a synthetic step 1 event; `config.category_id` comes from `PrototypeInput.target_category_id` (`543-544`).
