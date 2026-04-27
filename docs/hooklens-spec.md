# HookLens — Product Spec

**Voodoo Hack 2026, Track 3 — Market Intelligence**

## Mantra

> A Voodoo PM types a game name on Monday morning and ships 3 testable ad concepts before lunch.

## The product in one sentence

HookLens is a single-input creative pipeline: paste a Voodoo-style mobile game name, get back 3 ad creative variants and structured briefs in under 5 minutes, grounded in fresh market data and tailored to the game's visual identity.

## Golden path (the only flow we ship)

1. User pastes game name → "Marble Sort"
2. **Game DNA**: SensorTower metadata + Gemini Vision on screenshots → palette, core loop, audience, visual style
3. **Market scan**: top 10 advertisers in the iOS category × top 5 networks × last 30 days
4. **Pull ~80 video creatives** via `/ad_intel/creatives/top`, filtered 9:16, ≤15s
5. **Deconstruct each video** with Gemini 2.5 Pro into structured features (hook 3s, scene flow, palette, on-screen text, voiceover, CTA)
6. **Cluster into archetypes** weighted by `phashion_group` and `share`
7. **Score each archetype** on three NON-OBVIOUS signals: velocity, derivative_spread, freshness
8. **Game-fit**: Opus 4.7 maps top-5 archetypes to Game DNA, picks top 3
9. For top 3 → **Brief** (Opus) + **Scenario MCP** generates hero frame + 2 storyboard frames
10. **Streamlit dashboard** progressive reveal: Game DNA → archetype table with signal bars → 3 creatives + downloadable briefs (PDF + JSON)

## Non-goals (explicit, written so we don't drift)

- No global market trends dashboard (game-specific only)
- No real-time monitoring or alerts
- No video generation (image + storyboard only via Scenario)
- No auth, no multi-user
- No Postgres, no Docker, no cloud deploy on Saturday
- Streamlit local Saturday → optional Streamlit Cloud Sunday morning if time

## Signal definitions (the differentiator)

Most teams will rank ads on raw `share`. We rank on three composed signals that surface NON-OBVIOUS market patterns:

**velocity_score**
```
share_last_week / share_3_weeks_ago, clipped [0.5, 5.0]
> 1.5 = ascending, < 0.7 = declining, ~ 1.0 = stable
```

**derivative_spread**
```
unique_advertisers_in_phashion / creatives_in_archetype  ∈ [0, 1]
Higher = more publishers copying this hook = stronger market validation
```

**freshness_days**
```
mean(today - first_seen_at) for creatives in archetype
< 14 = breakout candidate, > 60 = saturated
```

**overall_signal_score**
```
0.4 * velocity + 0.35 * derivative_spread + 0.25 * (1 / freshness_normalized)
```

This composite is what the demo voiceover hammers home: *"On a détecté que l'archétype X est apparu il y a 11 jours et est déjà copié par 6 advertisers — c'est le breakout en cours, pas un hit établi."*

## Game-fit scoring

For each top-5 archetype, Opus 4.7 (max thinking) scores 0-100 on three dimensions:

- **Visual match**: palette / character compatibility from Game DNA
- **Mechanic match**: does the hook concept work for this core loop?
- **Audience match**: implied audience overlap

Output: `GameFitScore` with rationale per dimension + overall.

## Demo strategy (NON-NEGOTIABLE)

Sunday 10:00 we **pre-cache 3 target games** in `data/cache/{game_id}/`:

- `raw_creatives.parquet`
- `deconstructed.parquet`
- `archetypes.json`
- `briefs.json`
- `generated_assets/*.png`
- `report.json` (full `HookLensReport`)

Live demo plan:
- **Game #1**: cached → renders in 5s. The wow moment.
- **Game #2**: real run, ~3 min, narrated.
- **Game #3**: cached → reserved for Q&A.

We never demo a 5-min cold pipeline live.

## 25h plan (Saturday 14:30 → Sunday 16:00)

```
Sat 14:30  ✓ All sync. Lock models.py. Branches up. .env distributed.
Sat 15:00    Phase 1 — smoke tests (parallel):
              You         → 1 video → Gemini Pro → DeconstructedCreative parses
              Partner 1   → SensorTower call → 1 RawCreative
              Partner 2   → Scenario MCP → 1 image OK
Sat 17:00  ⚠ CHECKPOINT 1 — All smoke tests green or scope down.
              models.py LOCKED. No more changes without 3-way sign.
Sat 17:00    Phase 2 — core pipeline:
              You         → deconstruct.py async pool 5, parquet cache
              Partner 1   → discovery.py + downloader.py
              Partner 2   → brief.py prompt + 1 e2e Scenario gen
Sat 20:00    Dinner + CHECKPOINT 2 (45 min). Each module demoed on Marble Sort.
Sat 20:45    Phase 3 — integration:
              You         → archetypes.py (clustering + signals)
              Partner 1   → precache script + hardening
              Partner 2   → game_fit.py prompt + scoring loop
Sat 23:30  ⚠ CHECKPOINT 3 — End-to-end pipeline runs on Marble Sort, JSON output valid.
              If KO → cut scope: 1 archetype, 1 variant, thumbnails instead of videos.
Sun 00:00    Sleep rotation (you 0-3h, Partner 1 3-6h, Partner 2 polishes UI)
Sun 06:00    Phase 4 — UI + polish:
              Streamlit progressive reveal, PDF brief export
Sun 10:00    Pre-cache 3 demo games. Verify renders.
Sun 12:00  ⚠ CHECKPOINT 4 — 3 slides + voiceover script + 2 dry-runs.
Sun 14:30    Final tweaks + submission.
Sun 16:00    Jury presentation.
```

## Risks & mitigations (kept here so we don't lose them)

| Risk | Probability | Mitigation by 17:00 |
|---|---|---|
| Gemini Pro cost / rate-limit blows up on video | Medium | Cap 80 creatives, async pool 5, hash-cache. Fallback: thumb_url + ad copy text. |
| Scenario MCP unstable mid-pipeline | Medium | Partner 2 validates one image gen at 17:00 sharp. Fallback: REST API direct. |
| Pipeline > 5 min in live demo | High | Pre-cache 3 games Sunday 10:00. Demo cached + 1 narrated live run. |
| Partner workstream stalls | Medium | Each module ships with a fixture file. UI must render on stub data alone. |

## Pitch story (the money shot)

> "Sur les 80 ads Puzzle TikTok analysées, on a détecté 14 phashion_groups distincts, mais 73% du share est concentré sur 3 archétypes — dont un, l'ASMR-sort, est apparu il y a 11 jours et est déjà copié par 6 advertisers. C'est le breakout en cours, et c'est ce qu'on a généré pour Marble Sort."

Real numbers replace the placeholders. We harvest this sentence Saturday night once `archetypes.py` outputs first run.

## Evaluation criteria mapping

| Jury criterion | How HookLens scores |
|---|---|
| Signal Quality | Three composed signals (velocity / derivative_spread / freshness) backed by exact phashion_group counts and date deltas |
| Creative Actionability | Each variant ships with full structured brief + Scenario prompts ready to paste, ranked by test_priority |
| Game Fit | Game DNA extracted from screenshots via Vision, scored on 3 axes per archetype with Opus rationale |
| AI Usage | Multi-model orchestration (Gemini Vision + Gemini Pro video + Opus reasoning + Scenario MCP), async pool, sub-agent for UI |
| Product Quality | Streamlit progressive reveal, downloadable briefs, pre-cached demo |
