# Notebook 01 — Gemini Pro video deconstruction smoke test
#
# Open as a notebook (jupytext + VS Code interactive both supported), or convert:
#   uv run jupytext --to ipynb notebooks/01_gemini_smoke.py
#
# Run cells in order. Each `# %%` marker is a cell.

# %% [markdown]
# # Notebook 01 — Gemini Pro video deconstruction smoke test
#
# **Goal**: prove that Gemini 2.5 Pro can deconstruct a 9:16 mobile ad video into
# a structured `DeconstructedCreative` in <30s per video with >80% parse rate.
#
# **Why it matters**: this is the long pole of our pipeline. If Gemini fails on
# real ads, we fall back to thumbnails+ad copy, which weakens the signal quality
# (jury criterion #1). We validate it now, before building anything else.
#
# **Approach**:
# 1. Simulate Partner 1's output with hardcoded `RawCreative` fixtures.
# 2. Run a single creative end-to-end to debug the prompt.
# 3. Scale to all fixtures with async parallelism (mimics production).
# 4. Measure latency, parse rate, cost. Decide GREEN / YELLOW / RED.
#
# > ⚠️ The `creative_url` fields in `app/_fixtures.py` are placeholder public
# > sample videos. The schema validation will pass on them, but the **content**
# > of the deconstruction will only be meaningful on real ad creatives. Swap
# > URLs with real SensorTower output as soon as Partner 1 ships even one.

# %% Setup — imports, paths, env
# ruff: noqa: E402
import logging
import sys
import time
from pathlib import Path
from statistics import median

# Make the repo root importable from notebooks/
REPO_ROOT = Path.cwd().parent if Path.cwd().name == "notebooks" else Path.cwd()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from app._fixtures import SAMPLE_CREATIVES
from app.analysis.deconstruct import (
    deconstruct_batch,
    deconstruct_one,
    get_client,
)
from app.models import DeconstructedCreative

load_dotenv(REPO_ROOT / ".env")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
console = Console()

console.print(f"[bold]Loaded {len(SAMPLE_CREATIVES)} fixture creatives[/bold]")
for c in SAMPLE_CREATIVES:
    console.print(
        f"  • {c.creative_id} — {c.advertiser_name} on {c.network} "
        f"({c.video_duration}s, share={c.share})"
    )

# %% [markdown]
# ## Step 1 — Single-shot validation
#
# Run on the first fixture only. Validates that:
# - the video downloads to `data/cache/videos/`
# - Gemini Files API accepts the upload and reaches ACTIVE state
# - the structured response parses into our schema
#
# **Expected**: a `DeconstructedCreative` printed below in <30s.

# %% Single-shot
client = get_client()
sample = SAMPLE_CREATIVES[0]

console.rule(f"[bold cyan]Deconstructing {sample.creative_id}")
deconstructed, elapsed = await deconstruct_one(sample, client=client)
console.print(
    f"[green]✓[/green] {elapsed:.1f}s · "
    f"cost ≈ ${deconstructed.deconstruction_cost_usd:.4f}"
)

# %% Inspect the result (full JSON)
console.print(deconstructed.model_dump_json(indent=2))

# %% [markdown]
# ## Step 2 — Batch run, parallelized
#
# Mimics production: `asyncio.Semaphore(5)` over the full fixture list. Records
# per-video latency and aggregates parse rate.

# %% Batch
batch_t0 = time.perf_counter()
results = await deconstruct_batch(SAMPLE_CREATIVES, concurrency=5)
batch_elapsed = time.perf_counter() - batch_t0

successes: list[tuple[DeconstructedCreative, float]] = [
    (r, lat) for (r, lat) in results if isinstance(r, DeconstructedCreative)
]
failures = [r for (r, _) in results if not isinstance(r, DeconstructedCreative)]

parse_rate = len(successes) / len(results) if results else 0.0
latencies = [lat for (_, lat) in successes]
total_cost = sum(d.deconstruction_cost_usd or 0 for (d, _) in successes)

table = Table(title="Smoke test results", header_style="bold magenta")
table.add_column("Metric", style="cyan")
table.add_column("Value", style="bold")
table.add_row("Total fixtures", str(len(SAMPLE_CREATIVES)))
table.add_row("Successes", str(len(successes)))
table.add_row("Failures", str(len(failures)))
table.add_row("Parse rate", f"{parse_rate:.0%}")
table.add_row("Latency p50", f"{median(latencies):.1f}s" if latencies else "—")
table.add_row("Latency max", f"{max(latencies):.1f}s" if latencies else "—")
table.add_row("Total cost (est.)", f"${total_cost:.4f}")
table.add_row("Wall-clock", f"{batch_elapsed:.1f}s")
console.print(table)

if failures:
    console.print("[red]Failures:[/red]")
    for f in failures:
        console.print(f"  • {f!r}")

# %% [markdown]
# ## Step 3 — Decision tree
#
# - **🟢 GREEN** (latency p50 <30s AND parse rate ≥80%): proceed with full
#   video pipeline.
# - **🟡 YELLOW** (latency 30-60s OR parse rate 60-80%): tune prompt, simplify
#   schema, or reduce concurrency. Re-run.
# - **🔴 RED** (latency >60s OR parse rate <60%): switch to thumbnail + ad-copy
#   fallback. Document this in `docs/hooklens-spec.md` and update the brief
#   prompt accordingly.

# %% Verdict
median_latency = median(latencies) if latencies else float("inf")

if parse_rate >= 0.8 and median_latency < 30:
    console.print(
        "[bold green]🟢 GREEN — proceed with the video pipeline.[/bold green]"
    )
    verdict = "green"
elif parse_rate >= 0.6 and median_latency < 60:
    console.print(
        "[bold yellow]🟡 YELLOW — iterate on prompt/schema before scaling.[/bold yellow]"
    )
    verdict = "yellow"
else:
    console.print(
        "[bold red]🔴 RED — switch to thumbnail+ad-copy fallback path.[/bold red]"
    )
    verdict = "red"

# %% [markdown]
# ## Next steps
#
# - 🟢 / 🟡:
#   - Replace the `creative_url` values in `app/_fixtures.py` with real
#     SensorTower S3 URLs (ask Partner 1 for one in WhatsApp)
#   - Re-run this notebook on real ads to verify content quality, not just schema
#   - Move on to `app/analysis/game_dna.py` (Gemini Vision on screenshots)
# - 🔴:
#   - Open `app/analysis/deconstruct.py` and add a `deconstruct_one_fallback()`
#     that uses `RawCreative.thumb_url` + `RawCreative.message` + Vision on the
#     thumbnail. Keep the same return type `DeconstructedCreative`.
#   - Update §5 of `docs/hooklens-spec.md` to reflect the fallback path

# %% (Optional) Persist the run for later inspection
import json
from datetime import datetime, timezone

run_dir = REPO_ROOT / "data" / "cache" / "smoke_runs"
run_dir.mkdir(parents=True, exist_ok=True)
ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
run_path = run_dir / f"01_gemini_smoke_{ts}.json"

run_path.write_text(
    json.dumps(
        {
            "verdict": verdict,
            "parse_rate": parse_rate,
            "latency_p50": median_latency if latencies else None,
            "latency_max": max(latencies) if latencies else None,
            "total_cost_usd": total_cost,
            "batch_wall_clock_s": batch_elapsed,
            "successes": [d.model_dump(mode="json") for (d, _) in successes],
            "failures": [repr(f) for f in failures],
        },
        indent=2,
        default=str,
    )
)
console.print(f"[dim]Run snapshot saved to {run_path.relative_to(REPO_ROOT)}[/dim]")
