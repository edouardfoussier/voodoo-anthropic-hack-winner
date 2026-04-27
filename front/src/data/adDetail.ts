// Realistic sample data for the Ad Intelligence Detail page.
// Active ad: Clash of Clans — Meta — Video — 47 days

export interface TimelineSegment {
  key: "Hook" | "Tension" | "Resolution" | "CTA";
  range: string;
  label: string;
  description: string;
  color: string;
}

export interface CopyLine {
  time: string;
  text: string;
}

export interface AudienceBar {
  label: string;
  pct: number;
}

export interface PlayerAffinity {
  tag: string;
  score: number; // 0-100
}

export interface ComparisonRow {
  metric: string;
  thisAd: number;
  categoryAvg: number;
  topPerformer: number;
  format?: (n: number) => string;
}

export interface SimilarAd {
  id: string;
  game: string;
  network: string;
  format: string;
  similarity: number; // %
  reason?: string;
}

export interface DetectedPattern {
  name: string;
  category: string;
  frequency: number; // ads using it
  avgScore: number;
  delta: number; // this ad vs avg
  trend: "Rising" | "Stable" | "Declining";
}

export interface PatternPoint {
  name: string;
  frequency: number; // 0-100 (Rare→Common)
  score: number; // 0-100
  highlighted?: boolean;
}

export interface PlatformReaction {
  platform: "Reddit" | "YouTube" | "TikTok" | "Discord";
  sentiment: number; // 0-100
  theme: string;
}

export interface PlayerQuote {
  quote: string;
  source: "Reddit" | "YouTube" | "TikTok" | "Discord";
  sentiment: "Positive" | "Neutral" | "Negative";
  theme: string;
}

export interface ReviewMatch {
  claim: string;
  match: boolean;
  detail: string;
}

export interface BriefClassification {
  genre: string;
  archetype: string;
  narrative: string;
  tone: string;
  production: string;
}

export interface BriefSnapshot {
  pills: string[];
  paragraph: string;
}

export interface BriefAudienceProfile {
  left: { label: string; value: string }[];
  right: { label: string; value: string }[];
}

export interface BriefInstallSignal {
  trend: "up" | "down" | "flat";
  text: string;
}

export interface BriefSearchKeyword {
  keyword: string;
  source: "Google" | "App Store" | "TikTok";
  trend: "rising" | "stable" | "declining";
  volume: "High" | "Medium" | "Low";
}

export interface BriefRetentionHook {
  name: string;
  description: string;
}

export interface BriefViralityVector {
  name: string;
  intensity: "High" | "Medium" | "Low";
  description: string;
}

export interface BriefStoryboardPanel {
  src: string;
  caption: string;
}

export interface BriefConcepts {
  image: {
    title: string;
    description: string;
    tags: string[];
    src: string;
  };
  storyboard: {
    title: string;
    tags: string[];
    panels: BriefStoryboardPanel[];
  };
  video: {
    title: string;
    src: string;
    beats: { time: string; text: string }[];
    tags: string[];
  };
}

export interface CreativeBrief {
  classification: BriefClassification;
  snapshot: BriefSnapshot;
  audience: BriefAudienceProfile;
  installSignals: BriefInstallSignal[];
  installContext: string;
  searchKeywords: BriefSearchKeyword[];
  retentionHooks: BriefRetentionHook[];
  viralityVectors: BriefViralityVector[];
  concepts: BriefConcepts;
}

export interface AdDetail {
  id: string;
  game: string;
  developer: string;
  network: "Meta" | "Google" | "TikTok" | "ironSource";
  format: "Video" | "Static" | "Playable";
  country: string;
  countryFlag: string;
  dateRange: string;
  runDays: number;
  impressions: string;
  spendTier: "Micro" | "Mid" | "Top";
  score: number; // 0-100
  // Tab 1
  timeline: TimelineSegment[];
  hook: {
    type: string;
    trigger: string;
    strength: number;
    rationale: string;
  };
  visual: {
    style: string;
    palette: string[];
    pacing: string;
    character: string;
  };
  cta: {
    text: string;
    placement: string;
    style: string;
    score: number;
  };
  copyLines: CopyLine[];
  audio: {
    direction: string;
    voiceover: boolean;
  };
  // Tab 2
  audience: {
    reach: string;
    primary: string;
    engagement: string;
    ageBars: AudienceBar[];
    genderMale: number;
    geo: { country: string; flag: string; pct: number }[];
    affinities: PlayerAffinity[];
    intent: number; // 0=new users, 100=re-engagement
    placement: string;
  };
  // Tab 3
  comparison: ComparisonRow[];
  similar: SimilarAd[];
  network_context: {
    rank: string;
    saturation: number;
    bestDays: string;
    formatShare: string;
  };
  // Tab 4
  patterns: DetectedPattern[];
  patternMatrix: PatternPoint[];
  patternCombo: string[];
  comboRationale: string;
  // Tab 5
  sentiment: {
    overall: number;
    volume: string;
    topEmotion: string;
    platforms: PlatformReaction[];
    quotes: PlayerQuote[];
    reviewMatches: ReviewMatch[];
  };
  // Tab 6
  insights: {
    summary: string;
    works: string[];
    improve: string[];
    differentiate: string[];
    related: SimilarAd[];
  };
  // Tab 7
  brief: CreativeBrief;
}

export const SAMPLE_AD_DETAIL: AdDetail = {
  id: "AD-2847",
  game: "Clash of Clans",
  developer: "Supercell",
  network: "Meta",
  format: "Video",
  country: "United States",
  countryFlag: "🇺🇸",
  dateRange: "Mar 12 – Apr 28",
  runDays: 47,
  impressions: "3.2M",
  spendTier: "Mid",
  score: 84,
  timeline: [
    {
      key: "Hook",
      range: "0–3s",
      label: "Failed base raid",
      description:
        "Player loses a chaotic raid in 3 seconds — exaggerated reaction face overlaid on burning Town Hall.",
      color: "#f59e0b",
    },
    {
      key: "Tension",
      range: "3–15s",
      label: "Rebuild & strategy montage",
      description:
        "Fast cuts of upgrading defenses, recruiting troops, and clan members reacting in chat.",
      color: "#3b82f6",
    },
    {
      key: "Resolution",
      range: "15–25s",
      label: "Triumphant 3-star victory",
      description:
        "Same opponent base destroyed cleanly — slow zoom on 3-star result screen with clan cheers.",
      color: "#10b981",
    },
    {
      key: "CTA",
      range: "25–30s",
      label: "Play Free",
      description:
        "Logo lockup with 'Play Free' button, app store badges, and 500M+ downloads social proof.",
      color: "#8b5cf6",
    },
  ],
  hook: {
    type: "Fail-to-win",
    trigger: "Frustration → Relief",
    strength: 78,
    rationale:
      "Strategy players relate to early defeats. The setback primes viewers to invest emotionally in the comeback arc.",
  },
  visual: {
    style: "In-game footage",
    palette: ["#3a2e1a", "#c9a24a", "#2f5a2c", "#7a3a1f"],
    pacing: "Fast cut — 8 scenes in 30s",
    character: "Yes — Main character (Barbarian King) featured",
  },
  cta: {
    text: "Play Free",
    placement: "Last 5 seconds",
    style: "Social proof",
    score: 71,
  },
  copyLines: [
    { time: "0:02", text: "When your base gets wrecked..." },
    { time: "0:08", text: "Time to rebuild stronger" },
    { time: "0:18", text: "Revenge served — 3 stars" },
    { time: "0:26", text: "Play Free — 500M+ downloads" },
  ],
  audio: {
    direction: "Upbeat tribal drums + raid SFX, no voiceover",
    voiceover: false,
  },
  audience: {
    reach: "3.2M impressions",
    primary: "Men 25–34",
    engagement: "Above average for format",
    ageBars: [
      { label: "18–24", pct: 22 },
      { label: "25–34", pct: 41 },
      { label: "35–44", pct: 24 },
      { label: "45+", pct: 13 },
    ],
    genderMale: 72,
    geo: [
      { country: "United States", flag: "🇺🇸", pct: 38 },
      { country: "United Kingdom", flag: "🇬🇧", pct: 17 },
      { country: "Germany", flag: "🇩🇪", pct: 12 },
    ],
    affinities: [
      { tag: "Competitive player", score: 84 },
      { tag: "Mid-core gamer", score: 76 },
      { tag: "Strategy fan", score: 91 },
    ],
    intent: 28, // closer to new users
    placement: "Between levels — Mobile game apps",
  },
  comparison: [
    { metric: "Performance score", thisAd: 84, categoryAvg: 67, topPerformer: 92 },
    { metric: "Run duration (days)", thisAd: 47, categoryAvg: 21, topPerformer: 62 },
    { metric: "Est. impressions (M)", thisAd: 3.2, categoryAvg: 1.4, topPerformer: 4.8 },
  ],
  similar: [
    { id: "AD-2812", game: "Clash Royale", network: "Meta", format: "Video", similarity: 87, reason: "Same hook type" },
    { id: "AD-2790", game: "Rise of Kingdoms", network: "Meta", format: "Video", similarity: 81, reason: "Fail-to-win + clan reveal" },
    { id: "AD-2755", game: "State of Survival", network: "TikTok", format: "Video", similarity: 74, reason: "Comeback arc, fast pacing" },
  ],
  network_context: {
    rank: "#3 of 24",
    saturation: 73,
    bestDays: "Wednesday–Friday",
    formatShare: "Video = 61% of all CoC Meta spend",
  },
  patterns: [
    { name: "Fail-to-win arc", category: "Narrative", frequency: 142, avgScore: 72, delta: 12, trend: "Rising" },
    { name: "Clan social proof", category: "Social", frequency: 89, avgScore: 69, delta: 15, trend: "Stable" },
    { name: "3-star payoff", category: "Visual", frequency: 211, avgScore: 64, delta: 20, trend: "Stable" },
    { name: "Tribal drum audio bed", category: "Audio", frequency: 47, avgScore: 70, delta: 14, trend: "Rising" },
  ],
  patternMatrix: [
    { name: "Fail-to-win arc", frequency: 38, score: 72, highlighted: true },
    { name: "Clan social proof", frequency: 22, score: 69, highlighted: true },
    { name: "3-star payoff", frequency: 64, score: 64, highlighted: true },
    { name: "Tribal drum bed", frequency: 12, score: 70, highlighted: true },
    { name: "Live action skit", frequency: 18, score: 58 },
    { name: "Celebrity cameo", frequency: 9, score: 81 },
    { name: "UGC reaction", frequency: 31, score: 66 },
    { name: "Pixel art intro", frequency: 6, score: 55 },
    { name: "Voiceover narration", frequency: 72, score: 61 },
    { name: "Static end card only", frequency: 84, score: 47 },
    { name: "Discount overlay", frequency: 53, score: 52 },
    { name: "Comparison ad", frequency: 27, score: 73 },
  ],
  patternCombo: ["Fail-to-win", "Fast pacing", "Play Free CTA"],
  comboRationale: "This combination appears in 4% of top-performing ads — uncommon but effective.",
  sentiment: {
    overall: 72,
    volume: "1.2K mentions this month",
    topEmotion: "Nostalgia",
    platforms: [
      { platform: "Reddit", sentiment: 74, theme: "Veterans returning to the game" },
      { platform: "YouTube", sentiment: 68, theme: "Nostalgic comments on gameplay" },
      { platform: "TikTok", sentiment: 81, theme: "Clan recruitment trend" },
      { platform: "Discord", sentiment: 63, theme: "Strategy debates around new troops" },
    ],
    quotes: [
      {
        quote: "Honestly this ad made me redownload after 4 years. Looks exactly how I remember it.",
        source: "Reddit",
        sentiment: "Positive",
        theme: "Nostalgic",
      },
      {
        quote: "Cool ad but the actual game grind is way slower than this makes it look.",
        source: "YouTube",
        sentiment: "Negative",
        theme: "Misleading gameplay",
      },
      {
        quote: "Clan moment at the end is goated, made me message my old clanmates.",
        source: "TikTok",
        sentiment: "Positive",
        theme: "Funny",
      },
    ],
    reviewMatches: [
      { claim: "Clan battles", match: true, detail: "Confirmed by reviews — players highlight clan wars as core appeal." },
      { claim: "Base building depth", match: true, detail: "Confirmed by reviews — depth praised as long-term hook." },
      { claim: "Easy progression", match: false, detail: "Contradicted by reviews — late game grind cited as churn risk." },
    ],
  },
  insights: {
    summary:
      "This ad scores above average on hook strength but underperforms on CTA. The fail-to-win pattern is rising in this sub-genre — strong reference for your next brief.",
    works: [
      "3-second fail hook with exaggerated reaction reads instantly on autoplay",
      "Clan reveal moment doubles as social proof — repurpose for re-engagement variants",
      "Tribal drum audio bed scores well even with sound off because of strong visual rhythm",
    ],
    improve: [
      "CTA card lingers too long — last 5 seconds bleeds attention",
      "No urgency or limited-time hook in the end card",
      "Missing in-app screenshot stack to anchor the install promise",
    ],
    differentiate: [
      "Competitors lean heavily on CGI cinematics — real in-game footage is an opening",
      "No competitor in the top 10 uses a female lead — untapped audience expansion",
      "Tutorial-style overlay variant could capture lapsed players competitors ignore",
    ],
    related: [
      { id: "AD-2812", game: "Clash Royale", network: "Meta", format: "Video", similarity: 87, reason: "Same hook type" },
      { id: "AD-2790", game: "Rise of Kingdoms", network: "Meta", format: "Video", similarity: 81, reason: "Same network + format" },
      { id: "AD-2755", game: "State of Survival", network: "TikTok", format: "Video", similarity: 74, reason: "Top performer this month" },
      { id: "AD-2701", game: "Lords Mobile", network: "Google", format: "Video", similarity: 69, reason: "Similar pattern combo" },
    ],
  },
  brief: {
    classification: {
      genre: "Strategy / Base-building (Mid-core)",
      archetype: "Fail-to-win — Frustration hook",
      narrative: "Problem → Failure → Solution → CTA",
      tone: "Competitive, slightly humorous",
      production: "High — In-game footage + motion graphics",
    },
    snapshot: {
      pills: ["3.2M impressions", "47-day run", "CTR est. 2.4%", "Spend tier: Mid"],
      paragraph:
        "This ad has maintained above-average longevity for its format and network. Meta video ads in the 4X strategy sub-genre average 18 days of run time — this creative is running 2.6× longer, a strong proxy signal for positive ROI. Spend has been consistent with no detected scaling, suggesting a steady performer rather than an aggressive push.",
    },
    audience: {
      left: [
        { label: "Primary demographic", value: "Men, 25–34 (est. 41% of reach)" },
        { label: "Secondary demographic", value: "Men, 35–44 (est. 28% of reach)" },
        { label: "Geographic focus", value: "US, UK, Germany, Canada" },
        { label: "Platform context", value: "Mid-session placement, mobile game apps" },
      ],
      right: [
        { label: "Player type", value: "Competitive mid-core" },
        { label: "Motivation triggers", value: "Progression, clan rivalry, base optimization" },
        { label: "Re-engagement signal", value: "Mixed — new users + lapsed players" },
        { label: "Device split", value: "iOS 58% / Android 42%" },
      ],
    },
    installSignals: [
      { trend: "up", text: "Global installs (est.): +12% vs previous 30 days" },
      { trend: "flat", text: "US App Store rank: Stable at #4 Grossing (Strategy)" },
      { trend: "up", text: "Google Play installs (est.): +8% vs previous 30 days" },
    ],
    installContext:
      "Install uplift correlates with increased ad spend observed on Meta and Google UAC over the same period.",
    searchKeywords: [
      { keyword: "clash of clans new update", source: "Google", trend: "rising", volume: "High" },
      { keyword: "best base layout 2025", source: "Google", trend: "rising", volume: "High" },
      { keyword: "clash of clans gameplay", source: "TikTok", trend: "rising", volume: "Medium" },
      { keyword: "clash of clans download", source: "App Store", trend: "stable", volume: "High" },
      { keyword: "clash of clans clan wars", source: "Google", trend: "stable", volume: "Medium" },
      { keyword: "clash royale vs clash clans", source: "Google", trend: "declining", volume: "Low" },
    ],
    retentionHooks: [
      { name: "Variable reward loop", description: "Loot drops and raid outcomes create unpredictable rewards" },
      { name: "Social accountability", description: "Clan membership creates daily return obligation" },
      { name: "Progression visibility", description: "Town Hall levels provide clear long-term milestones" },
      { name: "Loss aversion trigger", description: "Base destruction risk activates protection spending" },
    ],
    viralityVectors: [
      { name: "Clan recruitment sharing", intensity: "High", description: "Players share invite links to fill clan slots" },
      { name: "Rage-share moments", intensity: "Medium", description: "Failed raids trigger social venting on Reddit/TikTok" },
      { name: "Seasonal event FOMO", intensity: "Medium", description: "Limited skins drive word-of-mouth spikes" },
    ],
    concepts: {
      image: {
        title: "The Undefended Base",
        description:
          "A wide shot of a high-level base left unshielded, surrounded by incoming enemy troops. Bold overlay text: 'Can you stop them?' CTA button bottom-right: Play Free.",
        tags: ["Fail-to-win hook", "Loss aversion", "High contrast"],
        src: "https://placehold.co/720x405/1a1d27/4f8ef7?text=Ad+Image+Concept",
      },
      storyboard: {
        title: "Fail, Upgrade, Dominate",
        tags: ["30s format", "Fail-to-win arc", "Rewarded placement"],
        panels: [
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=1", caption: "0–3s: Player sees unprotected enemy base" },
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=2", caption: "3–8s: Launches attack, troops pour in" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=3", caption: "8–15s: Attack fails, base holds" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=4", caption: "15–22s: Player upgrades defenses" },
          { src: "https://placehold.co/320x180/1a1d27/10b981?text=5", caption: "22–27s: Revenge attack succeeds" },
          { src: "https://placehold.co/320x180/1a1d27/8b5cf6?text=6", caption: "27–30s: Victory screen + CTA overlay" },
        ],
      },
      video: {
        title: "15 Seconds of Chaos",
        src: "https://placehold.co/720x405/1a1d27/10b981?text=Video+Concept",
        beats: [
          { time: "0–3s", text: "Aerial pan over a burning enemy village" },
          { time: "3–8s", text: "Player POV: tap to deploy troops, chaotic SFX" },
          { time: "8–12s", text: "Victory animation, loot counter spinning up" },
          { time: "12–15s", text: "Logo reveal + \"Join 500M players\" + CTA" },
        ],
        tags: ["15s cut-down", "High energy", "Social proof CTA"],
      },
    },
  },
};
