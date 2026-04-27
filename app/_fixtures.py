"""Sample ``RawCreative`` fixtures simulating Partner 1's SensorTower output.

These let any workstream develop without blocking on the real SensorTower
client. The ``creative_url`` values currently point at public sample mp4s
(test-videos.co.uk) so the Gemini pipeline runs end-to-end.

⚠️ **Replace ``creative_url`` with real SensorTower S3 URLs as soon as
Partner 1 ships even one.** The Gemini deconstruction output will only be
meaningful on real ad creatives.

This module is intentionally underscore-prefixed: it's shared dev data,
not part of the public API. It will be deleted once we wire the live
SensorTower path.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models import RawCreative

NOW = datetime.now(timezone.utc)


def _days_ago(n: int) -> datetime:
    return NOW - timedelta(days=n)


# Three sample creatives chosen to exercise downstream signal logic:
# - fixtures #1 and #3 share ``phashion_group="ph_alpha"`` so derivative_spread > 0
# - fixture #2 is fresher (first_seen < 14 days) → freshness bucket
# - shares span a realistic distribution
SAMPLE_CREATIVES: list[RawCreative] = [
    RawCreative(
        creative_id="fixture_001_royal_match",
        ad_unit_id="au_fixture_001",
        app_id="55c5028802ac64f9c0001faf",
        advertiser_name="Royal Match",
        network="TikTok",
        ad_type="video",
        creative_url=(
            "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/"
            "Big_Buck_Bunny_360_10s_1MB.mp4"
        ),
        thumb_url="https://picsum.photos/seed/fixture_001/200/356",
        phashion_group="ph_alpha",
        share=0.18,
        first_seen_at=_days_ago(20),
        last_seen_at=_days_ago(1),
        video_duration=10.0,
        aspect_ratio="9:16",
        message="Match colors, beat levels!",
        button_text="Play Now",
        days_active=19,
    ),
    RawCreative(
        creative_id="fixture_002_block_blast",
        ad_unit_id="au_fixture_002",
        app_id="60f16a8019f7b275235017614",
        advertiser_name="Block Blast",
        network="Instagram",
        ad_type="video",
        creative_url=(
            "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/"
            "Jellyfish_360_10s_1MB.mp4"
        ),
        thumb_url="https://picsum.photos/seed/fixture_002/200/356",
        phashion_group="ph_beta",
        share=0.12,
        first_seen_at=_days_ago(11),
        last_seen_at=NOW,
        video_duration=10.0,
        aspect_ratio="9:16",
        message="Block Blast is sweeping TikTok!",
        button_text="Install",
        days_active=11,
    ),
    RawCreative(
        creative_id="fixture_003_goods_sort_3d",
        ad_unit_id="au_fixture_003",
        app_id="70a16a8019f7b275235999000",
        advertiser_name="Goods Sort 3D",
        network="TikTok",
        ad_type="video",
        creative_url=(
            "https://test-videos.co.uk/vids/sintel/mp4/h264/360/"
            "Sintel_360_10s_1MB.mp4"
        ),
        thumb_url="https://picsum.photos/seed/fixture_003/200/356",
        phashion_group="ph_alpha",  # same as #1 → derivative spread > 0
        share=0.09,
        first_seen_at=_days_ago(8),
        last_seen_at=NOW,
        video_duration=10.0,
        aspect_ratio="9:16",
        message="Satisfying! Can you sort them all?",
        button_text="Try it!",
        days_active=8,
    ),
]
