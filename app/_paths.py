"""Shared filesystem paths anchored at the repository root.

Every cache directory in the codebase resolves through this module so it
doesn't matter whether the caller is a Streamlit script (cwd=repo root),
a notebook (cwd=notebooks/), or a script invoked from elsewhere — paths
always point to the same locations.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
DATA_DIR: Path = REPO_ROOT / "data"
CACHE_DIR: Path = DATA_DIR / "cache"
