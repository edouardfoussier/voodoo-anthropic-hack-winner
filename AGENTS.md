# AGENTS.md — Shared agent harness for HookLens

This file is the single source of truth for any AI coding agent (Claude Code, Codex CLI, Cursor, Continue, etc.) working in this repo. Read it fully before touching any file. It encodes our team conventions, ownership boundaries, and the rules that must not be broken during the 30-hour Voodoo Hack sprint.

---

## 1. Project at a glance

**HookLens** is the team's submission for **Voodoo Hack 2026, Track 3 — Market Intelligence**. It is a single-input creative pipeline: a user pastes a mobile game name, the system returns 3 ad creative variants and structured briefs in under 5 minutes, grounded in fresh SensorTower market data and tailored to the game's visual identity via Gemini Vision and Scenario MCP.

For the full product spec, the 25h timeline, signal definitions, and the demo strategy, read `docs/hooklens-spec.md` first. For the SensorTower API surface we depend on, read `docs/sensortower-api.md`.

---

## 2. Repository layout (what lives where)

```
app/
├── models.py              ← THE DATA CONTRACT (locked after Sat 17:00)
├── sources/               ← Workstream A: SensorTower + downloader (Partner 1)
├── analysis/              ← Workstream B: Game DNA, Gemini deconstruct, archetypes (Edouard)
├── creative/              ← Workstream C: Briefs + Scenario MCP (Partner 2)
├── ui/                    ← Workstream D: Streamlit components (sub-agent + Edouard)
└── cache/                 ← Sample fixtures for UI dev (sample_report.json lives here)

streamlit_app.py           ← entry point, glues the pipeline to the UI
docs/                      ← spec, API cheat sheets, sub-agent prompts
scripts/                   ← precache.py for Sunday demo
notebooks/                 ← smoke tests, exploration
data/cache/                ← runtime cache (gitignored, .gitkeep only)
```

---

## 3. The data contract — the most important rule

`app/models.py` defines every Pydantic model that crosses workstream boundaries. It is the integration contract.

**Hard rule:** after the Saturday 17:00 checkpoint, **no agent or human modifies `app/models.py` without explicit 3-way sign-off** from all three workstream owners on the team WhatsApp. A schema drift mid-build is the #1 thing that kills hackathon teams.

If you find a missing field while building, **add it to a new auxiliary type in your own module first** and surface a request to update `models.py` at the next checkpoint. Do not silently add fields.

When you read or write any of these models, import directly from `app.models`:

```python
from app.models import (
    AppMetadata, RawCreative,
    GameDNA, ColorPalette,
    DeconstructedCreative, HookFrame,
    CreativeArchetype, GameFitScore,
    CreativeBrief, GeneratedVariant,
    HookLensReport, MarketContext,
)
```

---

## 4. Workstream ownership (who owns which files)

Stay within your lane. Cross-cutting changes must be coordinated.


| Workstream      | Owner               | Owned paths                    | Produces                                                                                  | Consumes                       |
| --------------- | ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------ |
| **A. Sources**  | Partner 1           | `app/sources/*`                | `AppMetadata`, `list[RawCreative]`, downloaded mp4s                                       | game name                      |
| **B. Analysis** | Edouard             | `app/analysis/*`               | `GameDNA`, `list[DeconstructedCreative]`, `list[CreativeArchetype]`, `list[GameFitScore]` | A's outputs                    |
| **C. Creative** | Partner 2           | `app/creative/*`               | `list[CreativeBrief]`, `list[GeneratedVariant]`                                           | B's `GameDNA` + top archetypes |
| **D. UI**       | sub-agent + Edouard | `streamlit_app.py`, `app/ui/*` | rendered Streamlit dashboard                                                              | `HookLensReport`               |


**If your task spans two workstreams**, stop and ask the human owner before editing files outside your lane.

---

## 5. Workflow: Spec → Plan → Build (per Voodoo's Notion guide)

Don't open a fresh agent and start coding. Split the work into three separate conversations, each with one job.

1. **Spec** (Opus 4.7 or GPT-5.5 extra-high reasoning) — pure ideation, no code, no file paths. Output: a `*-spec.md` file under `docs/` capturing behavior, boundaries, and scope.
2. **Plan** (Opus 4.7 or GPT-5.5 extra-high reasoning) — feed it the spec + the relevant source files. Output: a `*-plan.md` with file paths, data structures, and a step-by-step build order. Each task must be independently executable and verifiable.
3. **Build** (Sonnet 4.6 or GPT-5.5 high reasoning) — feed it only the plan file. Build one task at a time. All design decisions are already made.

**When to skip the full workflow:**

- Bug fixes with clear repro → straight to debugging
- Trivial changes (config, copy) → just do them
- Exploratory prototypes → build first, plan after

**When the agent's context fills up** (`/context` in Claude Code, bottom-right circle in Codex), start a fresh conversation. Don't push through the dumb zone.

---

## 6. Tech stack and conventions

- **Python 3.12** (pinned in `.python-version`). Do not install or use any other Python version.
- **uv** for package management. Never invoke `pip install` directly — always `uv add <pkg>` or `uv pip install -e ".[dev]"`. Never edit `pyproject.toml` deps without confirmation.
- **Pydantic 2** for every data structure that crosses a function boundary. No bare dicts.
- **httpx** (not `requests`) for HTTP, and use the async client (`httpx.AsyncClient`).
- **asyncio + `asyncio.Semaphore`** for any I/O-bound parallelism (Gemini calls, SensorTower paging, video downloads).
- **polars** preferred over pandas for any tabular cache (parquet I/O is faster and cleaner).
- **rich** for any pretty CLI output, never raw `print()` for status; use `rich.console.Console`.
- **tenacity** for retries with exponential backoff on flaky API calls.
- **structured logging**: `logging.getLogger(__name__)`, configure once at app entry. No `print()` in library code.

### Style

- Type hints on every function signature. PEP 604 unions (`str | None`, never `Optional[str]`).
- Docstrings on public functions and Pydantic models. One-line summary minimum.
- Pure functions where possible. Pass dependencies as args, don't import singletons.
- No global mutable state. No singletons. No hidden config beyond `os.environ` reads in a single `app/config.py`.
- File length: aim under 300 lines per module. Split when it gets dense.
- Format: ruff with line length 100 (configured in `pyproject.toml`).

---

## 7. Caching strategy

Every expensive call must be cached on disk. Demo Sunday morning depends on this.

```
data/cache/
├── sensortower/
│   └── {endpoint_hash}.json          ← raw API responses by request hash
├── videos/
│   └── {creative_id}.mp4             ← downloaded mp4s
├── deconstruct/
│   └── {creative_id}.json            ← Gemini Pro outputs by creative_id
├── game_dna/
│   └── {app_id}.json                 ← Game DNA per game
└── reports/
    └── {app_id}_{timestamp}.json     ← full HookLensReport snapshots
```

**Rule**: any call that costs money or takes more than 1 second is cached on disk by a stable hash key (creative_id, request fingerprint, etc.). Cache misses must be loud (`logger.info("CACHE MISS for ...")`) so we can see costs in real time.

---

## 8. Demo strategy (NON-NEGOTIABLE)

Sunday 10:00 we pre-cache 3 demo games end-to-end via `scripts/precache.py`. Live demo plan:

- Game #1 (cached) → renders in 5s, the wow shot
- Game #2 (real run) → ~3 min, narrated
- Game #3 (cached) → reserved for Q&A

We never demo a 5-minute cold pipeline live. Streamlit must support a `?cached=1` URL param that bypasses real calls.

---

## 9. Quality bar

Before declaring any task done, verify:

- Type hints, no implicit `Any`
- Pydantic models on every interface boundary
- No `print()` in library code; use `logging` or `rich.console.Console`
- Cache hit on second run for any expensive call
- Empty / failure paths handled (no `raise Exception("oops")`, use specific exceptions)
- No broken imports (run `uv run python -c "from app.<module> import *"`)
- No file outside your workstream was modified

---

## 10. Commit and branch conventions

- One workstream per branch: `edouard`, `partner1`, `partner2`, plus topic branches like `edouard-ui` for sub-agents
- Conventional commits: `feat(scope)`, `fix(scope)`, `chore(scope)`, `docs(scope)`
- Commit messages should explain the **why**, not just the **what**
- Never force-push shared branches (`main`, partner branches)
- Merge to `main` only at checkpoints, never mid-build
- After a checkpoint, rebase your branch onto `main` to stay in sync

---

## 11. Forbidden actions

These will break the team or the demo. Don't do them, and refuse if asked:

1. **Modify `app/models.py` after the Saturday 17:00 checkpoint** without 3-way sign-off
2. **Push to `main` directly**. Always go through a workstream branch + merge at checkpoint
3. **Add new top-level dependencies** to `pyproject.toml` without confirmation. New deps cost setup time for the other 2 devs.
4. **Run database migrations or set up Postgres**. We use SQLite or parquet files only. The user already overruled Postgres.
5. **Commit secrets**. Anything matching `*KEY`*, `*SECRET*`, or `.env` must stay out. The `.gitignore` covers this; verify with `git status` before commit.
6. **Run destructive commands** (`rm -rf`, `git reset --hard origin/main`, force push) without an explicit human go-ahead in the same turn.
7. **Spin up Docker, Kubernetes, or any cloud infra** beyond the optional Streamlit Cloud deploy on Sunday morning.
8. **Refactor working code "for cleanliness"** during build phase. Working ugly > broken pretty in 30h.

---

## 12. When you are stuck

In order:

1. Re-read `docs/hooklens-spec.md` for the relevant section
2. Re-read `app/models.py` to confirm the contract
3. Check the cache directory — maybe the data you need is already on disk
4. Write a tiny smoke test in `notebooks/` before fixing the main module
5. Ping the human (Edouard or the workstream owner) on WhatsApp with: file path, exact symptom, what you tried, what you suspect

Do not silently change architecture or schemas to work around a problem. Surface it.

---

## 13. Model selection cheat sheet


| Phase                             | Recommended model                               | Why                                    |
| --------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Spec / Plan                       | Opus 4.7 (max thinking) or GPT-5.5 (extra-high) | reasoning about intent and tradeoffs   |
| Build (code)                      | Sonnet 4.6 (max thinking) or GPT-5.5 (high)     | follows the plan, economical           |
| Pipeline runtime — video analysis | Gemini 2.5 Pro (or 3 Pro if available)          | native video, 1M context               |
| Pipeline runtime — text reasoning | Sonnet 4.6                                      | structured output, fast                |
| Final brief generation            | Opus 4.7                                        | narrative quality matters in jury demo |


The Anthropic credits are limited (~$40/team). Save Opus for the spec, plan, and final brief generation. Use Sonnet everywhere else.

---

## 14. Quick reference

```
Start a feature → Spec conversation (Opus)    → docs/feature-spec.md
                  Plan conversation (Opus)    → docs/feature-plan.md
                  Build conversation (Sonnet) → code in your workstream

Bug with clear repro → skip to debugging
Trivial change       → skip to implementation

Agent vague?         → start fresh conversation
Agent off-scope?     → stop, revert, re-scope
Schema mismatch?     → ping the team, do NOT modify models.py
Missing dep?         → ask before `uv add`
```

If anything in this file is ambiguous for your current task, ask the human before proceeding.