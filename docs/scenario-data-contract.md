# Scenario data contract — prompt iteration cheat sheet

> For Partner 2 iterating on creative briefs and Scenario prompts.
>
> All real values below are from the cached Marble Sort run
> (`data/cache/reports/6754558455_e2e.json`). Pull the repo and re-run on
> any other game to see equivalent values.

---

## Pipeline placement

```
… steps 1–8 …
  ↓
[ STEP 9 — Author CreativeBrief (Opus) ]
  ↓ produces brief.scenario_prompts[]  ← these strings are sent to Scenario
  ↓
[ STEP 10 — Generate visuals (Scenario) ]
```

**Where prompt iteration happens** = step 9. The Opus prompt that authors the
brief lives at [`app/creative/brief.py::_build_prompt`](../app/creative/brief.py).
The Opus output is a `CreativeBrief` Pydantic object whose `scenario_prompts:
list[str]` field is what step 10 actually sends to Scenario.

---

## Section A — What Scenario receives today

### A.1 — HTTP payload per generation call

For every prompt in `brief.scenario_prompts` (typically 3 per variant), step
10 sends one POST to Scenario.

```json
{
  "endpoint": "POST https://api.cloud.scenario.com/v1/generate/txt2img-ip-adapter",
  "auth": "Basic base64(SCENARIO_API_KEY:SCENARIO_API_SECRET)",
  "body": {
    "prompt": "Hero frame, aspect 9:16, top-down 3D cartoon render of a glossy stream of multi-colored marbles (red, blue, yellow, green) pouring from a pastel tray onto a soft light-grey (#F0F0F8) conveyor belt, four labeled glass jars below catching color-matched marbles, lavender (#E5DFFF) studio background, vibrant orange (#FFB13B) accent label reading 'No. 001 RAINBOW SORT', clean and colorful 3D cartoon style with soft rounded shapes, soft global illumination, shallow depth of field, ASMR product-shot aesthetic, ultra crisp.",
    "modelId": "flux.1-dev",
    "ipAdapterImageIds": ["asset_<id1>", "asset_<id2>", "asset_<id3>"],
    "ipAdapterType": "style",
    "numSamples": 1,
    "numInferenceSteps": 28,
    "guidance": 3.5,
    "width": 720,
    "height": 1280
  }
}
```

### A.2 — Reference images (IP-Adapter style transfer)

The `ipAdapterImageIds` array is built from the target game's actual
screenshots, uploaded to Scenario via `POST /v1/assets` and cached by SHA256
under `data/cache/scenario_assets/<sha>.txt`.

For Marble Sort:

```json
{
  "reference_images": {
    "source": "data/cache/screenshots/6754558455/",
    "files": ["00.png", "01.png", "02.png"],
    "purpose": "Transfer the game's actual palette + character + UI vibe onto each generated frame, anti-deceptive-ad strategy.",
    "ipa_strength_default": "Scenario default (~0.9)",
    "max_refs": 3
  }
}
```

### A.3 — The text prompt itself (the iteration surface)

The `prompt` string is **fully Opus-authored** at step 9. Each `CreativeBrief`
typically yields 3 prompts: 1 hero frame + 2 storyboard frames.

Example brief from Marble Sort run, archetype `satisfaction-3d-render`:

```json
{
  "title": "Marble Pour ASMR — Sort the Rainbow",
  "scenario_prompts": [
    "Hero frame, aspect 9:16, top-down 3D cartoon render of a glossy stream of multi-colored marbles (red, blue, yellow, green) pouring from a pastel tray onto a soft light-grey (#F0F0F8) conveyor belt, four labeled glass jars below catching color-matched marbles, lavender (#E5DFFF) studio background, vibrant orange (#FFB13B) accent label reading 'No. 001 RAINBOW SORT', clean and colorful 3D cartoon style with soft rounded shapes, soft global illumination, shallow depth of field, ASMR product-shot aesthetic, ultra crisp.",
    "Storyboard frame 1, aspect 9:16, 3D cartoon scene of a cartoon finger tapping a pastel tray that releases a single glossy green marble mid-air with motion trail, conveyor belt with colored jars below, lavender (#E5DFFF) background, light-grey (#F0F0F8) machinery, orange (#FFB13B) UI button glowing with text 'Tap to release', clean and colorful 3D cartoon style with soft rounded shapes, playful and satisfying mood.",
    "Storyboard frame 2, aspect 9:16, 3D cartoon hero shot of four glass jars filled to the brim with perfectly sorted red, blue, yellow, and green marbles on a light-grey (#F0F0F8) conveyor, orange (#FFB13B) confetti and sparkles bursting, lavender (#E5DFFF) backdrop, big bold orange overlay text 'Oddly satisfying 🫧', clean and colorful 3D cartoon style with soft rounded shapes, celebratory and calming."
  ]
}
```

What's already inside the prompts (good):

- Aspect ratio (`9:16`)
- Game palette hexes (`#E5DFFF`, `#F0F0F8`, `#FFB13B`)
- Visual style label (`clean and colorful 3D cartoon style with soft rounded shapes`)
- Mood adjectives
- One signature on-screen text per frame
- Specific scene composition

---

## Section B — Data available in the pipeline state but NOT in the prompts

These are loaded into memory at brief-generation time but only **partially**
surface in the final `scenario_prompts` strings. Each one is a candidate for
prompt-iteration leverage.

### B.1 — Full Game DNA

The Opus brief prompt receives the full DNA, but only palette + style flow
through verbatim. Everything else is paraphrased or dropped.

```json
{
  "app_id": "6754558455",
  "name": "Marble Sort!",
  "genre": "Puzzle",
  "sub_genre": "Sorting",
  "core_loop": "Tap to release marbles from trays, which fall with physics onto a moving conveyor belt, and then drop into correctly colored boxes below to clear levels.",
  "audience_proxy": "Casual puzzle players, likely women aged 25-55, who enjoy satisfying and relaxing brain-training games.",
  "visual_style": "Clean and colorful 3D cartoon style with soft, rounded shapes.",
  "palette": {
    "primary_hex": "#E5DFFF",
    "secondary_hex": "#F0F0F8",
    "accent_hex": "#FFB13B",
    "description": "A soft, pastel palette with a lavender background, light grey machine, and a vibrant orange accent for titles and highlights."
  },
  "key_mechanics": [
    "physics-tap",
    "color sorting",
    "timing",
    "conveyor management"
  ],
  "character_present": false,
  "ui_mood": "calm/satisfying",
  "screenshot_signals": [
    "Core sorting mechanic",
    "Relaxing gameplay",
    "Puzzle-solving challenge",
    "Level progression with special blocks"
  ]
}
```

**Not currently in the prompts:** `core_loop` (verbatim), `key_mechanics` list,
`character_present`, `ui_mood`, `screenshot_signals`, `palette.description`.

> ✅ **Dashboard**: all six fields above are now surfaced in `GameDnaCard.tsx`
> (palette swatches + description, core loop, UI mood, character toggle,
> key mechanics chips, screenshot signals list). See `front/src/components/insights/GameDnaCard.tsx`.

### B.2 — Source archetype (cluster the brief came from)

```json
{
  "archetype_id": "satisfaction-3d-render",
  "label": "Satisfaction · 3D-render",
  "member_creative_ids": ["7f3a…", "9b2e…", "4d18…"],
  "centroid_hook": {
    "summary": "Spice jars dramatically roll into a wooden rack one by one with crisp ASMR sound and pop into perfectly aligned position",
    "visual_action": "Spice jars roll across a wooden surface and slot into a rack one after another",
    "text_overlay": "Oddly satisfying organization",
    "voiceover_transcript": null,
    "emotional_pitch": "satisfaction"
  },
  "palette_hex": ["#7B5034", "#E8D9B5", "#2A1810"],
  "common_mechanics": [],
  "velocity_score": 1.42,
  "derivative_spread": 0.667,
  "freshness_days": 14.3,
  "overall_signal_score": 1.13,
  "rationale": "3 creatives across 2 unique advertisers, average age 14d. Hook representative: 'Spice jars dramatically roll into a wooden rack one by one with crisp ASMR sound...'"
}
```

**Not currently in the prompts:** the `centroid_hook.visual_action`,
`text_overlay`, `voiceover_transcript`, `emotional_pitch`, the original
archetype's own palette (different from target game's!), the signal scores, the
rationale.

> ✅ **Dashboard (partial)**: `emotional_pitch`, palette swatches, velocity /
> derivative_spread / freshness / overall_signal_score bars, and `rationale` are
> displayed in `ArchetypesTable.tsx`.
> ⚠️ **Still missing from dashboard**: `centroid_hook.visual_action` and
> `centroid_hook.text_overlay` are not separately shown (only `centroid_hook.summary`
> is rendered). See `front/src/components/insights/ArchetypesTable.tsx:104`.

### B.3 — Member deconstructed creatives (the actual hook reference set)

For each member of the archetype, we have the full Gemini-Pro deconstruction:

```json
[
  {
    "raw": {
      "creative_id": "7f3a…",
      "advertiser_name": "McCormick Spice Library",
      "network": "TikTok",
      "creative_url": "https://x-ad-assets.s3.amazonaws.com/.../media",
      "thumb_url": "https://x-ad-assets.s3.amazonaws.com/.../thumb",
      "phashion_group": "ph_alpha",
      "share": 0.087,
      "first_seen_at": "2026-04-08T00:00:00Z",
      "video_duration": 13.2
    },
    "hook": {
      "summary": "Spice jars roll dramatically across a wooden countertop with crisp ASMR clinks",
      "visual_action": "Wide-angle slow-mo of glass spice jars rolling and slotting into a labeled wooden rack",
      "text_overlay": "Oddly satisfying organization",
      "voiceover_transcript": null,
      "emotional_pitch": "satisfaction"
    },
    "scene_flow": [
      "0–3s: Top-down shot, jars roll one by one",
      "3–8s: Close-up of labels clicking into place",
      "8–12s: Pullback to show full organized rack",
      "12–15s: CTA appears with sparkle effect"
    ],
    "on_screen_text": ["Oddly satisfying", "Tap to organize", "Free download"],
    "cta_text": "Get the App",
    "cta_timing_seconds": 12.0,
    "palette_hex": ["#7B5034", "#E8D9B5", "#2A1810"],
    "visual_style": "3D-render",
    "audience_proxy": "Women 30-55, home organization enthusiasts"
  }
]
```

**Not currently in the prompts:** any of these fields. Most importantly:

- The actual `creative_url` (could be passed to Scenario as **video reference**
  if Scenario supports image-from-video extraction, or just to a video model)
- The `thumb_url` (could be a **second IP-Adapter reference** for "match this
  hook style" instead of just "match this game's style")
- `cta_timing_seconds` and `scene_flow` per-second breakdowns (could let us
  generate frames that map exactly to t=0s, t=3s, t=7s, etc.)

> ❌ **Dashboard**: `DeconstructedCreative` objects are **not** part of
> `HookLensReport` (stored separately as `data/cache/deconstructed/*.parquet`).
> These fields cannot be surfaced via `/api/report` without extending the report
> schema or adding a dedicated `/api/deconstructed?archetype_id=…` endpoint.

### B.4 — Game-fit reasoning (Opus output)

```json
{
  "archetype_id": "satisfaction-3d-render",
  "visual_match": 78,
  "mechanic_match": 62,
  "audience_match": 88,
  "overall": 76,
  "rationale": "Visual match strong on the 3D ASMR aesthetic that overlaps with Marble Sort's clean cartoon look. Mechanic gap: spice-jar archetype shows organization, not the tap-to-release-and-sort core loop — risk of install-to-engagement drop unless we explicitly show marbles + conveyor in the first 3s. Audience match excellent: women 25-55, satisfaction-driven. Recommended adaptation: keep the ASMR pour aesthetic and 3D cartoon style, but show multi-color marbles + conveyor + tap-release within hook 3s."
}
```

**Not currently in the prompts:** the rationale text. Specifically the
"recommended adaptation" sentence at the end is GOLD for prompt steering — it
literally says "show X within hook 3s" which is the EXACT prompt content
we want in `scenario_prompts[0]`.

> ✅ **Dashboard**: the full `fit_score.rationale` (including the "recommended
> adaptation" sentence) is displayed in `GameFitGrid.tsx`. See
> `front/src/components/insights/GameFitGrid.tsx:146`.

### B.5 — Market context

```json
{
  "category_id": "7012",
  "category_name": "Puzzle",
  "countries": ["US"],
  "networks": ["TikTok"],
  "period_start": "2026-04-01T00:00:00Z",
  "period_end": "2026-04-01T00:00:00Z",
  "num_advertisers_scanned": 10,
  "num_creatives_analyzed": 8,
  "num_phashion_groups": 5
}
```

**Not currently in the prompts:** none. Mostly low-value for prompt content,
but could caption a "trending in {network} {month}" overlay if we wanted to
make ads self-referential.

### B.6 — Top competing advertisers (raw SensorTower output)

```json
[
  {
    "name": "Royal Match",
    "publisher_name": "Dream Games",
    "icon_url": "https://...",
    "sov": 0.142,
    "app_id": "1542705034"
  },
  ...
]
```

**Not currently in the prompts:** none, and probably should stay out — copying
direct competitor visual cues = bad-faith ad.

---

## Section C — How each unused field could lift prompt quality

Ranked by signal-to-effort.

| Field | Lift hypothesis | Concrete prompt-side recipe |
|---|---|---|
| `dna.core_loop` (verbatim) | Forces every storyboard frame to map onto a real game beat → less generic | Inject as a system-level constraint: *"Every frame must visually demonstrate one moment from this core loop: '{core_loop}'"* |
| `dna.key_mechanics` array | Currently lost in paraphrase. Reinjecting the verbs prevents Scenario from drifting to vague "puzzle action" | Postfix each prompt: *"Mechanics that must be visible: physics-tap, color sorting, timing"* |
| `dna.ui_mood` | Mood adjectives are scattered. Pinning one mood per variant prevents tonal drift | Use as the closing adjective: *"…overall mood: {ui_mood}"* |
| `archetype.centroid_hook.visual_action` | This is the EXACT visual that won the market. Currently rephrased | Inject literal: *"Echo this visual action from the source: '{visual_action}'"* |
| `archetype.member_creatives[*].thumb_url` | Real top-performing ad thumbnail. Could become a 2nd IP-Adapter ref ("style of this winning ad") with weight 0.3 alongside the game's screenshot at 0.7 | Add `ipAdapterImageIds: [game_screenshot_id, *member_thumb_ids]`, `ipAdapterScales: [0.9, 0.4, 0.4]` |
| `fit_score.rationale` (last sentence) | Opus already wrote what the ad must do. Verbatim copy → most-aligned generation | Append: *"Critical: {rationale}"* |
| `archetype.palette_hex` (the source archetype's own palette) | Currently we use the **game's** palette. But sometimes the winning archetype's palette is what makes the hook memorable. Optionally blend at 30/70 | Bind a 6-color palette: 3 from game DNA + 3 from archetype, tag which is dominant |
| `deconstructed.scene_flow` per-second | Currently the brief writes its own scene flow. We could mirror the winning ad's exact timing | Map prompt n to second n directly; e.g. prompt #3 = "frame at t=11s of an ad following this scene_flow: …" |
| `deconstructed.cta_timing_seconds` | The winning CTA appears at t=12s. Frame our CTA prompt accordingly | *"CTA frame should compose as if shown at the 12-second mark of a 15s ad"* |

---

## Section D — Quick-win prompt iteration tonight

If Partner 2 wants the highest leverage in 1 hour:

1. **Rewrite the brief-generation prompt** in [`app/creative/brief.py::_build_prompt`](../app/creative/brief.py) to **explicitly inject** `dna.core_loop`, `dna.key_mechanics`, and the **last sentence of `fit_score.rationale`** as MUST-INCLUDE constraints. Currently they're context but not constraints.

2. **Add a critique pass**: after Opus writes a `CreativeBrief`, send it back to Opus with the prompt *"verify each scenario_prompt mentions the core mechanic and at least one key_mechanic verb. If not, rewrite."* This is a 1-shot self-critique loop, ~30 sec extra per brief, big consistency lift.

3. **Multi-ref IP-Adapter**: in [`app/creative/scenario.py::generate_variants`](../app/creative/scenario.py), pass `ipAdapterImageIds = [game_screenshots..., archetype_member_thumbs...]` (mix). Today it's only game screenshots. Adding 1-2 winning-ad thumbs at 30-40% weight should give us hooks that feel both on-brand AND market-tested.

4. **Per-frame timing prompts**: in the brief, add a hidden field `frame_seconds: [0, 7, 14]` and bake it into each scenario_prompt: *"This frame represents the t=0s moment of the ad…"* — gives Scenario a temporal anchor it currently lacks.

---

## File references

| What | Path |
|---|---|
| Pydantic models for every shape above | [`app/models.py`](../app/models.py) |
| Brief-generation Opus prompt (the iteration surface) | [`app/creative/brief.py`](../app/creative/brief.py) |
| Scenario REST client (where prompts hit the API) | [`app/creative/scenario.py`](../app/creative/scenario.py) |
| Live cached examples | [`data/cache/reports/*.json`](../data/cache/reports/), [`data/cache/briefs/*.json`](../data/cache/briefs/) |
| Game DNA cache (per app_id) | [`data/cache/game_dna/*.json`](../data/cache/game_dna/) |
