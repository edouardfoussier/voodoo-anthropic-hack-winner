/**
 * GeoHeatmap — dot-grid world map.
 *
 * A lat/lng grid is generated at mount time. Each point is tested with
 * geoContains() against the loaded world topojson: points on land become
 * fully-colored circles (heat scale for tracked countries, silhouette for the
 * rest). Ocean grid points are simply skipped. This means every dot is either
 * fully rendered or absent — no SVG clipping artifacts at borders.
 */
import { useMemo, useState, useEffect, useCallback } from "react";
import { geoMercator, geoContains } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
import { Globe } from "lucide-react";
import { useGame } from "@/lib/game-context";
import { useGeoSignals, type CountrySignal } from "@/lib/api";

// ---------------------------------------------------------------------------
// SVG viewport & dot grid config
// ---------------------------------------------------------------------------

const SVG_W = 800;
const SVG_H = 420;
const DOT_STEP = 3.8;   // degrees between dot centres (controls density)
const DOT_R    = 4.2;   // dot radius in SVG units

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface DotData {
  x: number;
  y: number;
  countryCode: string | null;
}

// Module-level caches — survive navigation re-mounts, computed once per session
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cachedFeatures: any[] | null = null;
let _cachedDots: DotData[] | null = null;

// Mercator projection — same params as the previous react-simple-maps config
const projection = geoMercator()
  .scale(128)
  .center([10, 10])
  .translate([SVG_W / 2, SVG_H / 2]);

// ---------------------------------------------------------------------------
// ISO 3166-1 numeric → alpha-2 mapping for the 34 countries we track
// ---------------------------------------------------------------------------

const NUMERIC_TO_CODE: Record<string, string> = {
  "840": "US", "124": "CA", "484": "MX",
  "076": "BR", "032": "AR", "170": "CO",
  "826": "GB", "250": "FR", "276": "DE", "380": "IT", "724": "ES",
  "528": "NL", "752": "SE", "616": "PL", "643": "RU",
  "792": "TR", "682": "SA", "784": "AE", "376": "IL",
  "392": "JP", "410": "KR", "156": "CN", "356": "IN",
  "360": "ID", "764": "TH", "702": "SG", "158": "TW",
  "608": "PH", "458": "MY",
  "036": "AU", "554": "NZ",
  "710": "ZA", "566": "NG", "818": "EG",
};

// Continent colors for pills
const CONTINENT_COLOR: Record<string, string> = {
  "North America": "#60a5fa",
  "South America": "#34d399",
  "Europe":        "#a78bfa",
  "Middle East":   "#f59e0b",
  "Asia":          "#f472b6",
  "Oceania":       "#22d3ee",
  "Africa":        "#fb923c",
};

// ---------------------------------------------------------------------------
// Heat color scale  blue(0) → amber(50) → red(100)
// ---------------------------------------------------------------------------

function heatColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity / 100));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(30 + s * 225);
    g = Math.round(100 + s * 80);
    b = Math.round(200 - s * 200);
  } else {
    const s = (t - 0.5) * 2;
    r = 255;
    g = Math.round(180 - s * 160);
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number;
  y: number;
  signal: CountrySignal;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GeoHeatmap() {
  const { gameName } = useGame();
  const { data: signals = [], isLoading } = useGeoSignals(
    gameName ? { game_name: gameName } : {},
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [geoFeatures, setGeoFeatures] = useState<any[]>(_cachedFeatures ?? []);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredContinent, setHoveredContinent] = useState<string | null>(null);

  // Fetch world topojson once — skip if already cached from a previous mount
  useEffect(() => {
    if (_cachedFeatures) return;
    fetch(GEO_URL)
      .then((r) => r.json())
      .then((topo) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const world = topoFeature(topo as any, (topo as any).objects.countries) as any;
        _cachedFeatures = world.features;
        setGeoFeatures(world.features);
      });
  }, []);

  const signalByCode = useMemo(
    () => Object.fromEntries(signals.map((s) => [s.country_code, s])),
    [signals],
  );

  const continents = useMemo(
    () => [...new Set(signals.map((s) => s.continent))].sort(),
    [signals],
  );

  // Normalize intensity to full 0-100 range so color spread is always visible
  const { minI, maxI } = useMemo(() => {
    const vals = signals.map((s) => s.market_intensity);
    return { minI: Math.min(...vals, 0), maxI: Math.max(...vals, 1) };
  }, [signals]);

  const normalize = useCallback(
    (v: number) => (maxI === minI ? 50 : ((v - minI) / (maxI - minI)) * 100),
    [minI, maxI],
  );

  const visibleCodes = useMemo(
    () =>
      new Set(
        hoveredContinent
          ? signals.filter((s) => s.continent === hoveredContinent).map((s) => s.country_code)
          : signals.map((s) => s.country_code),
      ),
    [signals, hoveredContinent],
  );

  // ---------------------------------------------------------------------------
  // Build dot grid — runs once after topojson is loaded.
  // For each lat/lng grid point we test geoContains against all country
  // features. Tracked countries come first in the feature list so the loop
  // exits early for most land points.
  // ---------------------------------------------------------------------------
  const dots = useMemo((): DotData[] => {
    if (!geoFeatures.length) return [];
    // Return cached dot grid if already computed — avoids re-running the
    // O(grid × features) geoContains loop on every navigation back to this page
    if (_cachedDots) return _cachedDots;

    const trackedCodes = new Set(Object.values(NUMERIC_TO_CODE));
    const trackedFeatures = geoFeatures.filter((f) => trackedCodes.has(NUMERIC_TO_CODE[f.id]));
    const otherFeatures   = geoFeatures.filter((f) => !trackedCodes.has(NUMERIC_TO_CODE[f.id]));

    const result: DotData[] = [];

    for (let lat = -57; lat <= 75; lat += DOT_STEP) {
      for (let lng = -175; lng <= 180; lng += DOT_STEP) {
        const point: [number, number] = [lng, lat];
        const svgPos = projection(point);
        if (!svgPos) continue;

        let countryCode: string | null = null;
        for (const feat of trackedFeatures) {
          if (geoContains(feat, point)) {
            countryCode = NUMERIC_TO_CODE[feat.id as string] ?? null;
            break;
          }
        }

        if (countryCode !== null) {
          result.push({ x: svgPos[0], y: svgPos[1], countryCode });
          continue;
        }

        for (const feat of otherFeatures) {
          if (geoContains(feat, point)) {
            result.push({ x: svgPos[0], y: svgPos[1], countryCode: null });
            break;
          }
        }
      }
    }

    _cachedDots = result;
    return result;
  }, [geoFeatures]);

  const dotsLoading = !geoFeatures.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4 text-primary" />
            Global Market Intensity
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Composite score: top-advertiser Share-of-Voice × active advertiser count
            {gameName ? ` · scoped to ${gameName}'s category` : " · Puzzle (default)"}
          </p>
        </div>

        {/* Heat legend */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Low</span>
          <svg width={80} height={10}>
            <defs>
              <linearGradient id="heat-legend-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor={heatColor(0)} />
                <stop offset="50%"  stopColor={heatColor(50)} />
                <stop offset="100%" stopColor={heatColor(100)} />
              </linearGradient>
            </defs>
            <rect x={0} y={2} width={80} height={6} rx={3} fill="url(#heat-legend-grad)" />
          </svg>
          <span className="text-[10px] text-muted-foreground">High</span>
        </div>
      </div>

      {/* Continent filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setHoveredContinent(null)}
          className="rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors"
          style={{
            borderColor: hoveredContinent === null ? "#6366f1" : "#cbd5e1",
            color: hoveredContinent === null ? "#6366f1" : "#94a3b8",
            background: hoveredContinent === null ? "#eef2ff" : "transparent",
          }}
        >
          All
        </button>
        {continents.map((c) => (
          <button
            key={c}
            onClick={() => setHoveredContinent(hoveredContinent === c ? null : c)}
            className="rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors"
            style={{
              borderColor: hoveredContinent === null || hoveredContinent === c
                ? (CONTINENT_COLOR[c] ?? "#64748b")
                : "#e2e8f0",
              color:
                hoveredContinent === null || hoveredContinent === c
                  ? (CONTINENT_COLOR[c] ?? "#64748b")
                  : "#cbd5e1",
              background:
                hoveredContinent === c ? `${CONTINENT_COLOR[c]}22` : "transparent",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="relative rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        {(isLoading || dotsLoading) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80">
            <span className="text-xs text-slate-500 animate-pulse">
              {dotsLoading ? "Building dot map…" : "Querying 34 markets…"}
            </span>
          </div>
        )}

        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          {dots.map((dot, i) => {
            const signal = dot.countryCode ? signalByCode[dot.countryCode] : undefined;
            const tracked = !!signal;
            const dimmed = tracked && !visibleCodes.has(dot.countryCode!);

            const fill = tracked && !dimmed
              ? heatColor(normalize(signal!.market_intensity))
              : "#cbd5e1";

            return (
              <circle
                key={i}
                cx={dot.x}
                cy={dot.y}
                r={DOT_R}
                fill={fill}
                opacity={dimmed ? 0.2 : 1}
                style={{ cursor: tracked ? "pointer" : "default" }}
                onMouseEnter={
                  tracked && signal
                    ? (e) => {
                        const rect = (e.currentTarget as SVGElement)
                          .closest("svg")!
                          .getBoundingClientRect();
                        setTooltip({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                          signal: signal!,
                        });
                      }
                    : undefined
                }
                onMouseMove={
                  tracked && signal
                    ? (e) => {
                        const rect = (e.currentTarget as SVGElement)
                          .closest("svg")!
                          .getBoundingClientRect();
                        setTooltip({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                          signal: signal!,
                        });
                      }
                    : undefined
                }
                onMouseLeave={tracked ? () => setTooltip(null) : undefined}
              />
            );
          })}
        </svg>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 rounded-lg border border-white/10 bg-[#0f1525]/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
          >
            <p className="font-semibold text-white">{tooltip.signal.country_name}</p>
            <p className="mb-1 text-[10px] text-slate-400">{tooltip.signal.continent}</p>
            <div className="space-y-0.5 tabular-nums">
              <div className="flex justify-between gap-6">
                <span className="text-slate-400">Intensity</span>
                <span
                  className="font-bold"
                  style={{ color: heatColor(normalize(tooltip.signal.market_intensity)) }}
                >
                  {tooltip.signal.market_intensity.toFixed(0)}
                </span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-slate-400">Advertisers</span>
                <span>{tooltip.signal.num_advertisers}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-slate-400">Top SoV</span>
                <span>{(tooltip.signal.top_sov * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Country table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Country</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Continent</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Advertisers</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Top SoV</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Intensity</th>
            </tr>
          </thead>
          <tbody>
            {[...signals]
              .filter((s) => hoveredContinent === null || s.continent === hoveredContinent)
              .sort((a, b) => b.market_intensity - a.market_intensity)
              .map((s) => (
                <tr
                  key={s.country_code}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-1.5 font-medium">
                    <span className="mr-2 font-mono text-muted-foreground">{s.country_code}</span>
                    {s.country_name}
                  </td>
                  <td className="px-4 py-1.5">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{
                        background: `${CONTINENT_COLOR[s.continent] ?? "#64748b"}22`,
                        color: CONTINENT_COLOR[s.continent] ?? "#64748b",
                      }}
                    >
                      {s.continent}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{s.num_advertisers}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {(s.top_sov * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${normalize(s.market_intensity)}%`,
                            background: heatColor(normalize(s.market_intensity)),
                          }}
                        />
                      </div>
                      <span
                        className="w-6 text-right font-mono font-semibold"
                        style={{ color: heatColor(normalize(s.market_intensity)) }}
                      >
                        {s.market_intensity.toFixed(0)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
