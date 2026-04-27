import { useMutation, useQuery } from "@tanstack/react-query";
import type { Creative, CompetitorGame } from "@/data/sample";
import type { HookLensReport, ReportSummary, VideoAdConcept, VideoAdResult } from "@/types/hooklens";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

async function apiFetch<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, API_BASE);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface CreativesParams {
  game_name?: string;
  category_id?: number;
  country?: string;
  period?: string;
  period_date?: string;
  limit?: number;
}

export function useCreatives(params: CreativesParams = {}) {
  return useQuery<Creative[]>({
    queryKey: ["creatives", params],
    queryFn: () => apiFetch<Creative[]>("/api/creatives", params as Record<string, string | number | undefined>),
    staleTime: 5 * 60 * 1000,
    enabled: true,
  });
}

/**
 * Lists every ad we've rendered ourselves through the per-variant
 * Scenario pipeline. IDs are formatted ``generated:<game>:<archetype>``
 * so the AdLibrary grid can swap in a "VoodRadar" badge / different
 * click handler. Backed by `/api/creatives/generated`.
 */
export function useGeneratedCreatives() {
  return useQuery<Creative[]>({
    queryKey: ["creatives", "generated"],
    queryFn: () => apiFetch<Creative[]>("/api/creatives/generated"),
    staleTime: 60 * 1000,
  });
}

export interface AdvertisersParams {
  game_name?: string;
  category_id?: number;
  country?: string;
  period?: string;
  period_date?: string;
  limit?: number;
}

export function useAdvertisers(params: AdvertisersParams = {}) {
  return useQuery<CompetitorGame[]>({
    queryKey: ["advertisers", params],
    queryFn: () => apiFetch<CompetitorGame[]>("/api/advertisers", params as Record<string, string | number | undefined>),
    staleTime: 5 * 60 * 1000,
    enabled: true,
  });
}

export interface CompetitorDetail {
  app_id: string;
  name: string;
  publisher: string | null;
  icon_url: string | null;
  description: string | null;
  rating: number | null;
  rating_count: number | null;
  categories: string[] | null;
  creatives: Creative[];
  creatives_total: number;
  creatives_with_deconstruction: number;
  networks: Record<string, number>;
  formats: Record<string, number>;
}

/**
 * Fetch the full ad inventory + metadata for a single competitor
 * advertiser, keyed by SensorTower app_id. Returns null on 404 so the
 * detail page can render an empty state.
 */
export function useCompetitorDetail(appId: string | undefined) {
  return useQuery<CompetitorDetail | null>({
    queryKey: ["competitor", appId],
    queryFn: async () => {
      if (!appId) return null;
      const url = new URL(`/api/competitor/${encodeURIComponent(appId)}`, API_BASE);
      const res = await fetch(url.toString());
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`API /api/competitor → ${res.status}`);
      const data = (await res.json()) as CompetitorDetail | null;
      return data;
    },
    enabled: Boolean(appId),
    staleTime: 5 * 60 * 1000,
  });
}

export interface GameMeta {
  name: string;
  publisher: string;
  app_id: string;
  icon_url: string;
  description: string;
}

export function useGameMeta(name: string) {
  return useQuery<GameMeta | null>({
    queryKey: ["game", name],
    queryFn: () => apiFetch<GameMeta | null>("/api/game", { name }),
    staleTime: 30 * 60 * 1000,
    enabled: name.trim().length > 0,
  });
}

// ---------------------------------------------------------------------------
// HookLensReport — full pipeline output
// ---------------------------------------------------------------------------

/**
 * Fetch the full HookLensReport for a game (Game DNA, archetypes, fit scores,
 * briefs, generated variants). Loaded from disk cache; returns null on 404 so
 * callers can render a "no report yet" empty state.
 */
export function useReport(gameName: string) {
  return useQuery<HookLensReport | null>({
    queryKey: ["report", gameName],
    queryFn: async () => {
      const url = new URL("/api/report", API_BASE);
      url.searchParams.set("game_name", gameName);
      const res = await fetch(url.toString());
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`API /api/report → ${res.status}`);
      return res.json() as Promise<HookLensReport>;
    },
    staleTime: 10 * 60 * 1000,
    enabled: gameName.trim().length > 0,
  });
}

/**
 * Source ad creatives that fed into a given report's archetype clusters.
 * Returned as a map of ``archetype_id → list of thumbs/videos`` so the
 * Insights view can show real S3 thumbnails inside ArchetypesTable.
 */
export interface SourceCreative {
  creative_id: string;
  network: string;
  ad_type: string;
  thumb_url: string | null;
  creative_url: string | null;
  first_seen_at: string | null;
  advertiser_name: string | null;
}

/** App Store screenshot URLs for a target game (from SensorTower meta cache). */
export interface GameScreenshots {
  app_id: string;
  name: string | null;
  screenshot_urls: string[];
}

export function useGameScreenshots(gameName: string) {
  return useQuery<GameScreenshots>({
    queryKey: ["gameScreenshots", gameName],
    queryFn: async () => {
      const url = new URL("/api/game/screenshots", API_BASE);
      url.searchParams.set("game_name", gameName);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`API → ${res.status}`);
      return res.json() as Promise<GameScreenshots>;
    },
    staleTime: 60 * 60 * 1000,
    enabled: gameName.trim().length > 0,
  });
}

export function useReportSourceCreatives(gameName: string) {
  return useQuery<Record<string, SourceCreative[]>>({
    queryKey: ["reportSourceCreatives", gameName],
    queryFn: async () => {
      const url = new URL("/api/report/source_creatives", API_BASE);
      url.searchParams.set("game_name", gameName);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`API → ${res.status}`);
      return res.json() as Promise<Record<string, SourceCreative[]>>;
    },
    staleTime: 10 * 60 * 1000,
    enabled: gameName.trim().length > 0,
  });
}

// ---------------------------------------------------------------------------
// Geo signals — Tom's worldwide market-intensity heatmap (cf. GeoHeatmap.tsx)
// ---------------------------------------------------------------------------

export interface CountrySignal {
  country_code: string;
  country_name: string;
  continent: string;
  lat: number;
  lng: number;
  radius: number;
  num_advertisers: number;
  top_sov: number;
  market_intensity: number;
}

export interface GeoSignalsParams {
  game_name?: string;
  category_id?: number;
  period?: string;
  period_date?: string;
}

export function useGeoSignals(params: GeoSignalsParams = {}) {
  return useQuery<CountrySignal[]>({
    queryKey: ["geo-signals", params],
    queryFn: () =>
      apiFetch<CountrySignal[]>(
        "/api/geo-signals",
        params as Record<string, string | number | undefined>,
      ),
    staleTime: 10 * 60 * 1000,
  });
}

/** List of pre-cached reports — for a "previously analyzed" picker. */
export function useReportList() {
  return useQuery<ReportSummary[]>({
    queryKey: ["reports"],
    queryFn: () => apiFetch<ReportSummary[]>("/api/reports"),
    staleTime: 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Voodoo Portfolio — top games + their currently-running ad creatives
// ---------------------------------------------------------------------------

export interface VoodooAdSample {
  creative_id: string;
  network: string;
  ad_type: string;
  thumb_url: string | null;
  creative_url: string | null;
  first_seen_at: string | null;
}

export interface VoodooPortfolioEntry {
  app_id: string;
  unified_app_id: string | null;
  name: string;
  publisher_name: string;
  icon_url: string;
  categories: (number | string)[];
  rating: number | null;
  rating_count: number | null;
  description: string;
  ads_total: number;
  ads_by_network: Record<string, number>;
  ads_latest_first_seen: string | null;
  ads_sample: VoodooAdSample[];
  /** Paid UA share (0-1) over the precache 3-month window. Null when SensorTower has no data. */
  paid_share: number | null;
  /** Organic UA share (0-1) over the same window. Null when no data. */
  organic_share: number | null;
  /** Total downloads across all sources in the precache window. */
  total_downloads_3mo: number | null;
  /**
   * 30 daily download totals (organic + paid + paid_search + browser),
   * most recent last. Powers the sparkline on the Voodoo Portfolio cards.
   */
  downloads_30d_curve?: number[];
  /**
   * Week-over-week change (last 7d sum vs prior 7d sum) as a fraction.
   * Example: ``-0.34`` means downloads dropped 34% w/w → declining hard,
   * prompts the PM to "Run analysis" for a creative refresh. ``null`` when
   * fewer than 14 days of data are available.
   */
  downloads_trend_7d_pct?: number | null;
}

export interface VoodooPortfolioResponse {
  generated_at: string | null;
  country: string;
  limit: number;
  apps: VoodooPortfolioEntry[];
}

export function useVoodooPortfolio(limit = 15) {
  return useQuery<VoodooPortfolioResponse>({
    queryKey: ["voodooPortfolio", limit],
    queryFn: () =>
      apiFetch<VoodooPortfolioResponse>("/api/voodoo/portfolio", { limit }),
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Advertiser network ranks — SensorTower /v1/{os}/ad_intel/network_analysis/rank
// ---------------------------------------------------------------------------

export interface AdvertiserNetworkRank {
  country: string;
  rank: number;
  date: string;
}

export type AdvertiserRankMap = Record<string, AdvertiserNetworkRank>;

/**
 * Fetch the latest network rank per channel for an advertiser app id. Returns
 * an empty map when SensorTower has no rank data (long-tail apps frequently
 * fall outside the tracked networks). Suitable for small contextual chips
 * next to each competitor on the Competitive Scope page.
 */
export function useAdvertiserRanks(
  appId: string | null | undefined,
  options: { countries?: string; networks?: string; period_date?: string } = {},
) {
  const { countries = "US", networks, period_date } = options;
  return useQuery<AdvertiserRankMap>({
    queryKey: ["advertiserRanks", appId, countries, networks, period_date],
    queryFn: async () => {
      if (!appId) return {};
      const url = new URL(
        `/api/advertisers/${encodeURIComponent(appId)}/ranks`,
        API_BASE,
      );
      if (countries) url.searchParams.set("countries", countries);
      if (networks) url.searchParams.set("networks", networks);
      if (period_date) url.searchParams.set("period_date", period_date);
      const res = await fetch(url.toString());
      if (!res.ok) return {};
      return res.json() as Promise<AdvertiserRankMap>;
    },
    staleTime: 10 * 60 * 1000,
    enabled: Boolean(appId),
  });
}

// ---------------------------------------------------------------------------
// Tom's brainrot video ad pipeline — Scenario Veo3 + structured 3-beat prompts
// ---------------------------------------------------------------------------

/** Brainrot video ad concept — LLM step only, fast. */
export function useVideoBrief(gameName: string | undefined) {
  return useQuery<VideoAdConcept>({
    queryKey: ["video-brief", gameName],
    queryFn: () =>
      apiFetch<VideoAdConcept>("/api/video-brief", { game_name: gameName }),
    enabled: !!gameName,
    staleTime: Infinity,
  });
}

/** Trigger Scenario video generation (slow — 2-5 min). Returns video_url when done. */
export function useGenerateVideo(
  gameName: string | undefined,
  enabled: boolean,
) {
  return useQuery<VideoAdResult>({
    queryKey: ["video-generate", gameName],
    queryFn: () =>
      apiFetch<VideoAdResult>("/api/video-brief/generate", {
        game_name: gameName,
      }),
    enabled: !!gameName && enabled,
    staleTime: Infinity,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Per-variant Generate Ad — fires N parallel Scenario img2video calls
// from the variant's hero+storyboards, concats with ffmpeg, returns mp4.
// Slower than useGenerateVideo on first run (3-5 min), instant when cached.
// ---------------------------------------------------------------------------

export interface VariantVideoResponse {
  /** Path served from the API's static /videos mount, e.g. ``/videos/variant_xxx.mp4``. */
  video_url: string;
  /** True when the mp4 was already on disk (instant return — cache hit). */
  cached: boolean;
  duration_s: number;
  clips: number;
  endcard_appended: boolean;
  job_ids: string[];
  /** True when one or more clips fell back to a Picsum placeholder. */
  stub: boolean;
  has_audio?: boolean;
}

// ---------------------------------------------------------------------------
// Per-creative Gemini deconstruction — populated by the pipeline + the
// background scan_top_competitors job. Powers the /ad/$id "AI analysis"
// section that turns the page from a metadata viewer into a creative
// dossier.
// ---------------------------------------------------------------------------

export interface CreativeDeconstruction {
  creative_id: string;
  hook_summary: string | null;
  hook_visual_action: string | null;
  hook_text_overlay: string | null;
  hook_voiceover_transcript: string | null;
  hook_emotional_pitch:
    | "satisfaction"
    | "fail"
    | "curiosity"
    | "rage_bait"
    | "tutorial"
    | "asmr"
    | "celebrity"
    | "challenge"
    | "transformation"
    | "other"
    | null;
  scene_flow: string[];
  on_screen_text: string[];
  cta_text: string | null;
  cta_timing_seconds: number | null;
  palette_hex: string[];
  visual_style: string | null;
  audience_proxy: string | null;
  deconstruction_model: string | null;
}

// Weekly Report — aggregated knowledge-base view, powers the /weekly route.

export interface WeeklyEntry {
  creative_id: string;
  advertiser_name: string | null;
  icon_url: string | null;
  network: string | null;
  ad_type: string | null;
  thumb_url: string | null;
  creative_url: string | null;
  first_seen_at: string | null;
  days_active: number | null;
  hook_summary: string | null;
  hook_emotional_pitch: string | null;
  visual_style: string | null;
  palette_hex: string[];
  cta_text: string | null;
  deconstructed_at: string | null;
  new_this_week: boolean;
}

export interface WeeklyReport {
  generated_at: string;
  knowledge_base_size: number;
  new_this_week: number;
  by_pitch: Record<string, number>;
  top_picks: WeeklyEntry[];
}

export function useWeeklyReport(days = 7, limit = 60) {
  return useQuery<WeeklyReport>({
    queryKey: ["weekly-report", days, limit],
    queryFn: () =>
      apiFetch<WeeklyReport>("/api/weekly-report", { days, limit }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreativeDeconstruction(creativeId: string | undefined) {
  return useQuery<CreativeDeconstruction | null>({
    queryKey: ["creativeDeconstruction", creativeId],
    queryFn: async () => {
      if (!creativeId) return null;
      const url = new URL(
        `/api/creatives/${encodeURIComponent(creativeId)}/deconstruction`,
        API_BASE,
      );
      const res = await fetch(url.toString());
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`API → ${res.status}`);
      return res.json() as Promise<CreativeDeconstruction>;
    },
    enabled: Boolean(creativeId),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export interface VariantVideoStatus {
  exists: boolean;
  video_url?: string | null;
  duration_s?: number;
  has_audio?: boolean;
  endcard_appended?: boolean;
}

/**
 * Cheap existence check that runs whenever the Insights detail view
 * mounts. If the user previously generated a video for this variant
 * (in any session), ``exists: true`` lets the UI render the cached
 * mp4 instantly without re-triggering the 5-min Scenario job.
 *
 * Pass ``audioQuality`` to bias the lookup toward fast vs rich
 * outputs — fast and rich variants are cached as separate files on
 * disk so the user can A/B them without overwriting either.
 */
export function useVariantVideoStatus(
  gameName: string | undefined,
  archetypeId: string | undefined,
  audioQuality: "fast" | "rich" = "fast",
) {
  return useQuery<VariantVideoStatus>({
    queryKey: ["variant-video-status", gameName, archetypeId, audioQuality],
    queryFn: async () => {
      if (!gameName || !archetypeId) return { exists: false };
      const url = new URL(
        "/api/variants/render-video/status",
        API_BASE,
      );
      url.searchParams.set("game_name", gameName);
      url.searchParams.set("archetype_id", archetypeId);
      url.searchParams.set("audio_quality", audioQuality);
      const res = await fetch(url.toString());
      if (!res.ok) return { exists: false };
      return res.json() as Promise<VariantVideoStatus>;
    },
    enabled: Boolean(gameName && archetypeId),
    staleTime: 30 * 1000,
  });
}

/**
 * Trigger the per-variant ad rendering pipeline. Returns a mutation
 * helper so the UI can fire it on click and track loading/error
 * state without auto-firing on every render.
 *
 * Cache strategy: the BACKEND caches by archetype_id, so re-clicking
 * the same variant returns the same mp4 in <100ms.
 *
 * Audio knobs:
 *   - includeAudio (default true): overlay a music bed.
 *   - includeVoice (default false): generate a brainrot voiceover via
 *     OpenAI TTS from the brief's text_overlays + cta and mix it on
 *     top of the music. The bed automatically ducks to ~25% volume
 *     so the voice cuts through.
 */
export function useRenderVariantVideo() {
  return useMutation({
    mutationKey: ["render-variant-video"],
    mutationFn: async (vars: {
      gameName: string;
      archetypeId: string;
      includeEndcard?: boolean;
      includeAudio?: boolean;
      includeVoice?: boolean;
      includeSfx?: boolean;
      voice?: string;
      audioQuality?: "fast" | "rich";
      /** Free-text refinement appended to every per-clip prompt
       *  (e.g. "more energetic music", "voice should sound surprised").
       *  Hashed into the cache key so distinct refinements coexist. */
      correction?: string;
    }): Promise<VariantVideoResponse> => {
      const url = new URL("/api/variants/render-video", API_BASE);
      url.searchParams.set("game_name", vars.gameName);
      url.searchParams.set("archetype_id", vars.archetypeId);
      url.searchParams.set(
        "include_endcard",
        vars.includeEndcard === false ? "false" : "true",
      );
      url.searchParams.set(
        "include_audio",
        vars.includeAudio === false ? "false" : "true",
      );
      url.searchParams.set(
        "include_voice",
        vars.includeVoice === true ? "true" : "false",
      );
      url.searchParams.set(
        "include_sfx",
        vars.includeSfx === false ? "false" : "true",
      );
      if (vars.voice) {
        url.searchParams.set("voice", vars.voice);
      }
      if (vars.audioQuality) {
        url.searchParams.set("audio_quality", vars.audioQuality);
      }
      if (vars.correction && vars.correction.trim()) {
        url.searchParams.set("correction", vars.correction.trim());
      }
      const res = await fetch(url.toString(), { method: "POST" });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Render failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      return res.json() as Promise<VariantVideoResponse>;
    },
    // No retry — a 5-minute video gen failing once shouldn't trigger
    // another 5-minute attempt automatically.
    retry: false,
  });
}
