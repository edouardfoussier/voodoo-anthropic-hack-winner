"""One-off introspection script: ask Scenario for each video model's
input schema so we can find out which ones support first/last-frame
('tail_image', 'lastFrame', 'endImage') for clean transitions into
the endcard.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

import httpx

KEY = os.environ.get("SCENARIO_API_KEY") or ""
SECRET = os.environ.get("SCENARIO_API_SECRET") or ""
AUTH = "Basic " + base64.b64encode(f"{KEY}:{SECRET}".encode()).decode()
BASE = "https://api.cloud.scenario.com/v1"

TARGETS = [
    "model_kling-o1-i2v",
    "model_kling-v2-6-i2v-pro",
    "model_kling-v2-1-master-i2v",
    "model_veo3",
    "model_veo3-fast",
    "model_xai-grok-imagine-video",
    "model_luma-dream-machine",
    "model_luma-ray2-i2v",
    "model_runway-gen3",
    "model_runway-gen-4-turbo-i2v",
    "model_seedance-1-pro",
    "model_pika-2-2",
]


def main() -> int:
    if not KEY or not SECRET:
        print("Missing SCENARIO_API_KEY / SCENARIO_API_SECRET in .env")
        return 1
    print(
        f"Probing {len(TARGETS)} candidate video models for first/last-frame "
        "parameters\n"
    )
    headers = {"Authorization": AUTH}
    for m in TARGETS:
        try:
            r = httpx.get(f"{BASE}/models/{m}", headers=headers, timeout=15.0)
        except Exception as e:
            print(f"  ✗ {m}: {e}")
            continue
        if r.status_code != 200:
            print(f"  · {m} → HTTP {r.status_code} {r.text[:80]}")
            continue
        body = r.json()
        # Schema can be under several keys depending on Scenario version
        schema = (
            body.get("inputSchema")
            or body.get("schema")
            or body.get("parameters")
            or body.get("inputs")
            or {}
        )
        # Walk into 'properties' if present (JSON Schema convention)
        if isinstance(schema, dict) and "properties" in schema:
            schema = schema["properties"]
        if not isinstance(schema, dict):
            print(f"  ? {m} → unexpected schema shape (keys={list(body.keys())[:6]})")
            continue
        keys = list(schema.keys())
        # Look for any image/frame-related keys
        frame_keys = [
            k for k in keys
            if any(
                needle in k.lower()
                for needle in [
                    "image", "frame", "tail", "last", "first", "end", "start"
                ]
            )
        ]
        print(f"  ✓ {m}")
        for k in frame_keys:
            v = schema[k]
            desc = (
                v.get("description") or v.get("title") or ""
                if isinstance(v, dict)
                else str(v)[:80]
            )
            print(f"      • {k}: {desc[:140]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
