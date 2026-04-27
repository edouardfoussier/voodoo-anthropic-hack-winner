/**
 * HookLensReport TypeScript types — mirror of `app/models.py` Pydantic schemas.
 *
 * Generated manually for speed (Pydantic-to-TS codegen would be cleaner long-term).
 * If `app/models.py` changes, this file MUST be updated to match — see
 * `docs/scenario-data-contract.md` for field-by-field rationale.
 */

// ---------------------------------------------------------------------------
// 1. Game DNA + palette
// ---------------------------------------------------------------------------

export interface ColorPalette {
  primary_hex: string;
  secondary_hex: string;
  accent_hex: string;
  description: string;
}

export interface GameDNA {
  app_id: string;
  name: string;
  genre: string;
  sub_genre: string | null;
  core_loop: string;
  audience_proxy: string;
  visual_style: string;
  palette: ColorPalette;
  key_mechanics: string[];
  character_present: boolean;
  ui_mood: string;
  screenshot_signals: string[];
}

// ---------------------------------------------------------------------------
// 2. Raw SensorTower creative + Gemini deconstruction
// ---------------------------------------------------------------------------

export type AdType =
  | "video"
  | "video-rewarded"
  | "video-interstitial"
  | "video-other"
  | "playable"
  | "interactive-playable"
  | "interactive-playable-rewarded"
  | "image"
  | "image-interstitial"
  | "image-other"
  | "banner"
  | "full_screen";

export interface RawCreative {
  creative_id: string;
  ad_unit_id: string;
  app_id: string;
  advertiser_name: string;
  network: string;
  ad_type: AdType;
  creative_url: string;
  thumb_url: string | null;
  preview_url: string | null;
  phashion_group: string | null;
  share: number | null;
  first_seen_at: string;
  last_seen_at: string;
  video_duration: number | null;
  aspect_ratio: string | null;
  width: number | null;
  height: number | null;
  message: string | null;
  button_text: string | null;
  days_active: number | null;
}

export type EmotionalPitch =
  | "satisfaction"
  | "fail"
  | "curiosity"
  | "rage_bait"
  | "tutorial"
  | "asmr"
  | "celebrity"
  | "challenge"
  | "transformation"
  | "other";

export interface HookFrame {
  summary: string;
  visual_action: string;
  text_overlay: string | null;
  voiceover_transcript: string | null;
  emotional_pitch: EmotionalPitch;
}

export interface DeconstructedCreative {
  raw: RawCreative;
  hook: HookFrame;
  scene_flow: string[];
  on_screen_text: string[];
  cta_text: string | null;
  cta_timing_seconds: number | null;
  palette_hex: string[];
  visual_style: string;
  audience_proxy: string;
  deconstruction_model: string;
  deconstruction_cost_usd: number | null;
}

// ---------------------------------------------------------------------------
// 3. Archetypes + signals (the differentiator)
// ---------------------------------------------------------------------------

export interface CreativeArchetype {
  archetype_id: string;
  label: string;
  member_creative_ids: string[];
  centroid_hook: HookFrame;
  palette_hex: string[];
  common_mechanics: string[];

  /** share_last_week / share_3_weeks_ago, clipped [0.5, 5.0]. >1.5 = ascending. */
  velocity_score: number;

  /** unique_advertisers / creatives_in_archetype, in [0, 1]. Higher = stronger market validation. */
  derivative_spread: number;

  /** mean(today - first_seen_at) for members. <14 = breakout candidate, >60 = saturated. */
  freshness_days: number;

  /** Composite: 0.4*velocity + 0.35*derivative_spread + 0.25*(1/normalized_freshness). */
  overall_signal_score: number;

  /** Claude-written explanation of why this archetype matters. */
  rationale: string;
}

export interface GameFitScore {
  archetype_id: string;
  visual_match: number; // 0-100
  mechanic_match: number; // 0-100
  audience_match: number; // 0-100
  overall: number; // 0-100
  rationale: string;
}

// ---------------------------------------------------------------------------
// 4. Final creative output
// ---------------------------------------------------------------------------

export interface CreativeBrief {
  archetype_id: string;
  target_game_id: string;
  title: string;
  hook_3s: string;
  scene_flow: string[];
  visual_direction: string;
  text_overlays: string[];
  cta: string;
  rationale: string;
  scenario_prompts: string[];
}

export interface GeneratedVariant {
  brief: CreativeBrief;
  hero_frame_path: string;
  storyboard_paths: string[];
  test_priority: number; // 1 = test first
  test_priority_rationale: string;
}

// ---------------------------------------------------------------------------
// 5. Top-level report
// ---------------------------------------------------------------------------

export interface MarketContext {
  category_id: string;
  category_name: string;
  countries: string[];
  networks: string[];
  period_start: string;
  period_end: string;
  num_advertisers_scanned: number;
  num_creatives_analyzed: number;
  num_phashion_groups: number;
}

export interface HookLensReport {
  target_game: GameDNA;
  market_context: MarketContext;
  top_archetypes: CreativeArchetype[];
  game_fit_scores: GameFitScore[];
  final_variants: GeneratedVariant[];
  pipeline_duration_seconds: number;
  total_cost_usd: number;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// 6. /api/reports list summary
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7. Brainrot video ad concept — /api/video-brief
// ---------------------------------------------------------------------------

export interface VideoAdConcept {
  title: string;
  gameplay_hook: string;
  concept: string;
  scenario_prompt: string;
  narration_script: string;
  style_tags: string[];
}

export interface VideoAdResult {
  concept: VideoAdConcept;
  video_url: string;
  stub: boolean;
  job_id: string | null;
}

export interface ReportSummary {
  app_id: string;
  name: string;
  publisher: string | null;
  icon_url: string | null;
  generated_at: string | null;
  num_archetypes: number;
  num_variants: number;
  total_cost_usd: number;
  duration_seconds: number;
}
