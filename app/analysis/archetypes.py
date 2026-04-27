"""Cluster deconstructed creatives into archetypes + compute non-obvious signals.

Three signals (the differentiator vs other teams):

- **velocity_score**: real Share-of-Voice growth per archetype, sourced from
  SensorTower's ``/v1/{os}/ad_intel/network_analysis`` endpoint. We aggregate
  weekly SoV across an archetype's member advertisers over the last 4 weeks
  and express the change as ``(recent_2w_avg - older_2w_avg) / older_2w_avg``,
  clipped to ``[0.5, 5.0]`` for front-end compatibility. When the SoV API
  returns no usable data (niche apps, missing advertiser ids, quota
  exhaustion), we fall back to the legacy freshness proxy and log loudly.
- **derivative_spread**: unique advertisers / number of creatives in cluster.
  Higher = more publishers copying the hook = stronger market validation.
- **freshness_days**: mean age of member creatives.
- **overall_signal_score**: weighted composite ``0.4·v + 0.35·d + 0.25·1/f``.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean

from app.models import CreativeArchetype, DeconstructedCreative
from app.sources.sensortower import fetch_sov_timeseries

log = logging.getLogger(__name__)

# Velocity bounds — kept aligned with the front-end's existing 0.5..5.0
# normalisation (CreativeArchetype.velocity_score docstring in app/models.py).
_VELOCITY_MIN = 0.5
_VELOCITY_MAX = 5.0

# Default window for the SoV growth comparison: last 4 weeks split into two
# halves (older 2w vs recent 2w).
_SOV_WINDOW_DAYS = 28


def _slugify(*parts: str) -> str:
    return "-".join(p.lower().replace(" ", "_").replace("/", "-")[:20] for p in parts)


def _ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _proxy_velocity(freshness_norm: float) -> float:
    """Legacy hand-rolled velocity proxy — kept as a fallback when SoV is
    unavailable. Same formula the codebase shipped with pre-real-SoV.
    """
    if freshness_norm <= 0:
        return 1.0
    return min(2.0, 1.0 / freshness_norm)


def _compute_real_velocity(
    member_creatives: list[DeconstructedCreative],
    period_date: str,
) -> float | None:
    """Real Share-of-Voice growth for an archetype's member advertisers.

    Steps:
    1. Resolve advertiser app_ids from each member's ``raw.app_id`` (already
       the unified SensorTower id, set during creatives/top ingestion).
    2. Fetch weekly SoV via ``fetch_sov_timeseries`` over the last 4 weeks.
    3. Aggregate SoV across (advertiser × country × network) per week, then
       compare the most-recent 2-week mean against the prior 2-week mean.

    Returns ``None`` when the result is unreliable (no resolved ids, empty
    network_analysis response, fewer than 2 weeks of data, or zero baseline)
    so the caller can fall back to the proxy.
    """
    advertiser_ids = sorted({
        m.raw.app_id
        for m in member_creatives
        if m.raw.app_id and m.raw.app_id != "unknown"
    })
    if not advertiser_ids:
        log.warning(
            "velocity: no resolvable advertiser app_ids for %d members — "
            "falling back to proxy",
            len(member_creatives),
        )
        return None

    try:
        end_dt = datetime.fromisoformat(period_date).date()
    except ValueError:
        log.exception("velocity: bad period_date=%r, falling back to proxy", period_date)
        return None
    start_dt = end_dt - timedelta(days=_SOV_WINDOW_DAYS)

    try:
        rows = fetch_sov_timeseries(
            advertiser_ids,
            start_date=start_dt.isoformat(),
            end_date=end_dt.isoformat(),
            period="week",
        )
    except Exception:
        log.exception(
            "velocity: network_analysis failed for advertisers=%s — falling back to proxy",
            advertiser_ids,
        )
        return None

    if not rows:
        log.warning(
            "velocity: network_analysis returned 0 rows for %d advertisers — "
            "falling back to proxy",
            len(advertiser_ids),
        )
        return None

    by_week: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        date_val = row.get("date")
        sov_val = row.get("sov")
        if date_val is None or sov_val is None:
            continue
        try:
            sov = float(sov_val)
        except (TypeError, ValueError):
            continue
        # Negative or NaN SoV would poison the average — drop them quietly.
        if sov != sov or sov < 0:  # NaN check
            continue
        by_week[str(date_val)[:10]].append(sov)

    if len(by_week) < 2:
        log.warning(
            "velocity: only %d distinct weeks in network_analysis response — "
            "need ≥2, falling back to proxy",
            len(by_week),
        )
        return None

    sorted_weeks = sorted(by_week.keys())
    midpoint = len(sorted_weeks) // 2
    older_weeks = sorted_weeks[:midpoint] if midpoint else sorted_weeks[:1]
    recent_weeks = sorted_weeks[midpoint:] if midpoint else sorted_weeks[-1:]

    older_vals = [v for w in older_weeks for v in by_week[w]]
    recent_vals = [v for w in recent_weeks for v in by_week[w]]
    if not older_vals or not recent_vals:
        return None

    older_avg = mean(older_vals)
    recent_avg = mean(recent_vals)

    # Ratio (1 + growth_rate) keeps "stable ≈ 1.0" semantics that the front-end
    # already encodes (>1.5 ascending, <0.7 declining). The task spec
    # expressed this as a delta: (recent - older) / older = ratio - 1 — we
    # re-anchor at 1.0 here so the [0.5, 5.0] clipped range still has 1.0 at
    # its centre and the existing UI labels keep their meaning.
    growth_ratio = recent_avg / max(older_avg, 1e-6)
    velocity = max(_VELOCITY_MIN, min(_VELOCITY_MAX, growth_ratio))

    log.info(
        "velocity: archetype real SoV growth=%.3f (older_avg=%.4f recent_avg=%.4f, "
        "advertisers=%d weeks=%d) → clipped=%.3f",
        growth_ratio,
        older_avg,
        recent_avg,
        len(advertiser_ids),
        len(sorted_weeks),
        velocity,
    )
    return round(velocity, 3)


def compute_archetypes(
    deconstructed: list[DeconstructedCreative],
    *,
    now: datetime | None = None,
    period_date: str | None = None,
) -> list[CreativeArchetype]:
    """Group by ``(emotional_pitch, visual_style)`` and compute signals.

    ``period_date`` (``YYYY-MM-DD``) anchors the SoV window's ``end_date``;
    defaults to today's UTC date so the existing pipeline call sites
    (``compute_archetypes(state.deconstructed)``) keep working unchanged.

    Returns archetypes sorted by ``overall_signal_score`` desc.
    """
    if not deconstructed:
        return []

    now = now or datetime.now(timezone.utc)
    effective_period_date = period_date or now.date().isoformat()

    clusters: dict[tuple[str, str], list[DeconstructedCreative]] = defaultdict(list)
    for d in deconstructed:
        clusters[(d.hook.emotional_pitch, d.visual_style)].append(d)

    archetypes: list[CreativeArchetype] = []
    for (pitch, vstyle), members in clusters.items():
        if not members:
            continue

        ages = [(now - _ensure_aware(m.raw.first_seen_at)).days for m in members]
        freshness = mean(ages)
        freshness_norm = max(freshness, 1.0) / 30.0  # "1 = ~one month old"

        unique_advertisers = {m.raw.advertiser_name for m in members}
        derivative_spread = len(unique_advertisers) / max(len(members), 1)

        real_velocity = _compute_real_velocity(members, effective_period_date)
        if real_velocity is None:
            velocity = _proxy_velocity(freshness_norm)
            velocity_source = "proxy"
        else:
            velocity = real_velocity
            velocity_source = "sov"

        overall = (
            0.4 * velocity
            + 0.35 * derivative_spread
            + 0.25 * (1.0 / freshness_norm)
        )

        # Centroid hook — share-weighted "ideal" representative.
        centroid = max(members, key=lambda m: m.raw.share or 0.0)

        rationale = (
            f"{len(members)} creatives across {len(unique_advertisers)} unique "
            f"advertisers, average age {freshness:.0f}d (velocity source: "
            f'{velocity_source}). Hook representative: '
            f'"{centroid.hook.summary[:80]}"'
        )

        archetypes.append(
            CreativeArchetype(
                archetype_id=_slugify(pitch, vstyle),
                label=f"{pitch.replace('_', ' ').title()} · {vstyle}",
                member_creative_ids=[m.raw.creative_id for m in members],
                centroid_hook=centroid.hook,
                palette_hex=centroid.palette_hex,
                common_mechanics=[],
                velocity_score=round(velocity, 3),
                derivative_spread=round(derivative_spread, 3),
                freshness_days=round(freshness, 1),
                overall_signal_score=round(overall, 3),
                rationale=rationale,
            )
        )

    archetypes.sort(key=lambda a: a.overall_signal_score, reverse=True)
    return archetypes
