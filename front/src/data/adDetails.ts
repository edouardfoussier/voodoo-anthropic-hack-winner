// Registry of detailed ads keyed by creative ID.
// Reuses the AdDetail type from adDetail.ts and ships realistic, distinct
// data for Subway Surfers, Royal Match and Coin Master in addition to the
// original Clash of Clans sample.

import { SAMPLE_AD_DETAIL, type AdDetail } from "./adDetail";

// ---------- Royal Match (CR-1045) — Meta · Video · 62 days ----------
const ROYAL_MATCH_AD: AdDetail = {
  id: "CR-1045",
  game: "Royal Match",
  developer: "Dream Games",
  network: "Meta",
  format: "Video",
  country: "United States",
  countryFlag: "🇺🇸",
  dateRange: "Feb 21 – Apr 24",
  runDays: 62,
  impressions: "3.8M",
  spendTier: "Top",
  score: 92,
  timeline: [
    {
      key: "Hook",
      range: "0–3s",
      label: "King trapped in lava",
      description:
        "King Robert is stuck on a tiny platform as lava rises — viewer instantly feels urgency to 'save the king'.",
      color: "#f59e0b",
    },
    {
      key: "Tension",
      range: "3–15s",
      label: "Wrong pin pulled, fail",
      description:
        "A faux player pulls the wrong pin, water floods the wrong chamber and the king sinks further. Classic 'pull-the-pin' fake fail.",
      color: "#3b82f6",
    },
    {
      key: "Resolution",
      range: "15–25s",
      label: "Match-3 saves the day",
      description:
        "Cut to real Match-3 gameplay: a 5-in-a-row clears the puzzle, the king is rescued, confetti burst.",
      color: "#10b981",
    },
    {
      key: "CTA",
      range: "25–30s",
      label: "Play Now — Free",
      description:
        "Crown logo lockup, 'Play Now' button with #1 Puzzle game social proof and App Store ratings.",
      color: "#8b5cf6",
    },
  ],
  hook: {
    type: "Save-the-character",
    trigger: "Empathy → Urgency",
    strength: 86,
    rationale:
      "Casual puzzle players respond to rescue narratives. The king under threat creates immediate stakes without requiring genre knowledge.",
  },
  visual: {
    style: "Mixed — Fake gameplay + real Match-3",
    palette: ["#7a1f1f", "#f5c542", "#1f3a7a", "#2f5a2c"],
    pacing: "Medium — 6 scenes in 30s",
    character: "Yes — King Robert featured throughout",
  },
  cta: {
    text: "Play Now — Free",
    placement: "Last 5 seconds",
    style: "Social proof",
    score: 79,
  },
  copyLines: [
    { time: "0:02", text: "Save the king!" },
    { time: "0:09", text: "Wrong move…" },
    { time: "0:18", text: "Match 3 to win" },
    { time: "0:26", text: "Play Now — #1 Puzzle Game" },
  ],
  audio: {
    direction: "Light orchestral score + cartoon SFX, soft female voiceover",
    voiceover: true,
  },
  audience: {
    reach: "3.8M impressions",
    primary: "Women 35–54",
    engagement: "Top decile for Match-3 format",
    ageBars: [
      { label: "18–24", pct: 11 },
      { label: "25–34", pct: 24 },
      { label: "35–44", pct: 34 },
      { label: "45+", pct: 31 },
    ],
    genderMale: 28,
    geo: [
      { country: "United States", flag: "🇺🇸", pct: 44 },
      { country: "United Kingdom", flag: "🇬🇧", pct: 14 },
      { country: "France", flag: "🇫🇷", pct: 9 },
    ],
    affinities: [
      { tag: "Casual puzzle player", score: 92 },
      { tag: "Daily mobile gamer", score: 78 },
      { tag: "Reward-driven user", score: 71 },
    ],
    intent: 42,
    placement: "Feed & Reels — Meta family of apps",
  },
  comparison: [
    { metric: "Performance score", thisAd: 92, categoryAvg: 71, topPerformer: 95 },
    { metric: "Run duration (days)", thisAd: 62, categoryAvg: 24, topPerformer: 71 },
    { metric: "Est. impressions (M)", thisAd: 3.8, categoryAvg: 1.6, topPerformer: 5.2 },
  ],
  similar: [
    { id: "CR-2901", game: "Gardenscapes", network: "Meta", format: "Video", similarity: 89, reason: "Pull-the-pin fake fail hook" },
    { id: "CR-2880", game: "Homescapes", network: "Meta", format: "Video", similarity: 84, reason: "Save-the-character + Match-3 reveal" },
    { id: "CR-2854", game: "Match Masters", network: "TikTok", format: "Video", similarity: 76, reason: "Casual puzzle, female lead" },
  ],
  network_context: {
    rank: "#1 of 31",
    saturation: 88,
    bestDays: "Sunday–Tuesday",
    formatShare: "Video = 74% of all Royal Match Meta spend",
  },
  patterns: [
    { name: "Pull-the-pin fake fail", category: "Narrative", frequency: 187, avgScore: 76, delta: 16, trend: "Rising" },
    { name: "Save-the-character", category: "Emotional", frequency: 124, avgScore: 73, delta: 19, trend: "Rising" },
    { name: "Real gameplay reveal", category: "Visual", frequency: 96, avgScore: 70, delta: 22, trend: "Stable" },
    { name: "Soft VO narration", category: "Audio", frequency: 142, avgScore: 65, delta: 9, trend: "Stable" },
  ],
  patternMatrix: [
    { name: "Pull-the-pin fake fail", frequency: 56, score: 76, highlighted: true },
    { name: "Save-the-character", frequency: 38, score: 73, highlighted: true },
    { name: "Real gameplay reveal", frequency: 28, score: 70, highlighted: true },
    { name: "Soft VO narration", frequency: 47, score: 65, highlighted: true },
    { name: "Influencer cameo", frequency: 14, score: 79 },
    { name: "Live action skit", frequency: 22, score: 61 },
    { name: "Static end card only", frequency: 81, score: 49 },
    { name: "Discount overlay", frequency: 53, score: 54 },
    { name: "UGC reaction", frequency: 33, score: 67 },
    { name: "Choose-your-path", frequency: 19, score: 72 },
    { name: "Voice-of-god narration", frequency: 64, score: 58 },
    { name: "Comparison ad", frequency: 27, score: 70 },
  ],
  patternCombo: ["Save-the-character", "Pull-the-pin", "Match-3 payoff"],
  comboRationale:
    "This combination appears in 7% of top-performing puzzle ads — a proven, high-yield trio in casual.",
  sentiment: {
    overall: 64,
    volume: "2.1K mentions this month",
    topEmotion: "Amusement",
    platforms: [
      { platform: "Reddit", sentiment: 58, theme: "Misleading ad debate" },
      { platform: "YouTube", sentiment: 61, theme: "Comments calling out fake gameplay" },
      { platform: "TikTok", sentiment: 78, theme: "King Robert memes trending" },
      { platform: "Discord", sentiment: 52, theme: "Mid-core players mocking the format" },
    ],
    quotes: [
      {
        quote: "I clicked this ad knowing the gameplay isn't real, the king memes are just too good.",
        source: "TikTok",
        sentiment: "Positive",
        theme: "Funny",
      },
      {
        quote: "These pull-the-pin ads have nothing to do with the actual game. Pure bait.",
        source: "Reddit",
        sentiment: "Negative",
        theme: "Misleading gameplay",
      },
      {
        quote: "Honestly relaxing once you start playing. Way calmer than the ads suggest.",
        source: "YouTube",
        sentiment: "Positive",
        theme: "Nostalgic",
      },
    ],
    reviewMatches: [
      { claim: "Match-3 gameplay", match: true, detail: "Confirmed — core loop is exactly Match-3 puzzles." },
      { claim: "King Robert character", match: true, detail: "Confirmed — King Robert is featured between levels." },
      { claim: "Pull-the-pin puzzles", match: false, detail: "Contradicted — this mechanic does not exist in the actual game." },
    ],
  },
  insights: {
    summary:
      "Top decile performer with a 62-day run. Format fatigue risk on Meta is high — consider rotating new hooks while keeping the King Robert IP equity.",
    works: [
      "King Robert as a recurring character builds long-term IP recognition across the ad set",
      "Match-3 reveal at 15s reassures viewers and lifts install intent",
      "Soft female VO outperforms voice-of-god narration in this audience",
    ],
    improve: [
      "Pull-the-pin fake fail risks negative review sentiment — rotate weekly",
      "CTA card lacks urgency — try limited-time event overlay",
      "No localization variants detected for top non-English markets",
    ],
    differentiate: [
      "Competitors avoid showing real gameplay — leaning in could differentiate on trust",
      "No competitor uses serialized King Robert episodes — story arc opportunity",
      "Underused: cooperative puzzle angle for the 35–54 women cluster",
    ],
    related: [
      { id: "CR-2901", game: "Gardenscapes", network: "Meta", format: "Video", similarity: 89, reason: "Same hook archetype" },
      { id: "CR-2880", game: "Homescapes", network: "Meta", format: "Video", similarity: 84, reason: "Same network + format" },
      { id: "CR-2854", game: "Match Masters", network: "TikTok", format: "Video", similarity: 76, reason: "Top performer this month" },
      { id: "CR-2820", game: "Toon Blast", network: "Google", format: "Video", similarity: 70, reason: "Similar pattern combo" },
    ],
  },
  brief: {
    classification: {
      genre: "Casual / Match-3 puzzle",
      archetype: "Save-the-character — Empathy hook",
      narrative: "Threat → Fake fail → Real gameplay → CTA",
      tone: "Cartoonish, warm, slightly comedic",
      production: "Very high — Mixed CGI fake puzzle + in-game footage",
    },
    snapshot: {
      pills: ["3.8M impressions", "62-day run", "CTR est. 3.1%", "Spend tier: Top"],
      paragraph:
        "This creative is the longest-running ad in the Match-3 sub-genre on Meta this quarter, sitting 2.6× above the format median. Spend has scaled steadily over the run with no plateau detected — a clear flagship asset rather than a test. Frequency capping appears tight, suggesting Royal Match is intentionally protecting creative fatigue.",
    },
    audience: {
      left: [
        { label: "Primary demographic", value: "Women, 35–44 (est. 34% of reach)" },
        { label: "Secondary demographic", value: "Women, 45+ (est. 31% of reach)" },
        { label: "Geographic focus", value: "US, UK, France, Germany" },
        { label: "Platform context", value: "Feed + Reels, mobile dominant" },
      ],
      right: [
        { label: "Player type", value: "Casual daily puzzler" },
        { label: "Motivation triggers", value: "Relaxation, completionism, character attachment" },
        { label: "Re-engagement signal", value: "Lapsed-leaning — King IP drives reactivation" },
        { label: "Device split", value: "iOS 64% / Android 36%" },
      ],
    },
    installSignals: [
      { trend: "up", text: "Global installs (est.): +18% vs previous 30 days" },
      { trend: "up", text: "US App Store rank: Up to #1 Grossing (Puzzle)" },
      { trend: "flat", text: "Google Play installs (est.): Stable vs prior period" },
    ],
    installContext:
      "Install spike on iOS lines up with a Reels-heavy push and a King Robert TikTok meme moment in the same week.",
    searchKeywords: [
      { keyword: "royal match save the king", source: "Google", trend: "rising", volume: "High" },
      { keyword: "king robert royal match", source: "TikTok", trend: "rising", volume: "High" },
      { keyword: "royal match download", source: "App Store", trend: "stable", volume: "High" },
      { keyword: "best match 3 game 2025", source: "Google", trend: "rising", volume: "Medium" },
      { keyword: "royal match cheats", source: "Google", trend: "stable", volume: "Medium" },
      { keyword: "candy crush vs royal match", source: "Google", trend: "declining", volume: "Low" },
    ],
    retentionHooks: [
      { name: "Daily king events", description: "Time-bound King Robert challenges create return obligation" },
      { name: "Soft narrative arc", description: "Each level advances the castle restoration story" },
      { name: "Generous early progression", description: "Rapid level-up in first sessions builds habit" },
      { name: "Streak rewards", description: "Daily login chain unlocks compounding bonuses" },
    ],
    viralityVectors: [
      { name: "King Robert memes", intensity: "High", description: "TikTok creators remix King Robert reactions virally" },
      { name: "Co-watching with kids", intensity: "Medium", description: "Parents share casual sessions with children" },
      { name: "Fake-ad meta humor", intensity: "Medium", description: "Players joke about the misleading hooks online" },
    ],
    concepts: {
      image: {
        title: "King in the Lava",
        description:
          "Wide shot of King Robert on a shrinking platform with lava rising. Bold text overlay: 'Only Match-3 can save him.' CTA bottom right: Play Now.",
        tags: ["Save-the-character", "High urgency", "Warm palette"],
        src: "https://placehold.co/720x405/1a1d27/f59e0b?text=Royal+Match+Concept",
      },
      storyboard: {
        title: "Save the King in 30s",
        tags: ["30s format", "Save-the-character arc", "Feed placement"],
        panels: [
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=1", caption: "0–3s: King trapped, lava rising" },
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=2", caption: "3–8s: Wrong pin pulled, faux fail" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=3", caption: "8–15s: Cut to real Match-3 board" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=4", caption: "15–22s: 5-in-a-row clears puzzle" },
          { src: "https://placehold.co/320x180/1a1d27/10b981?text=5", caption: "22–27s: King rescued, confetti" },
          { src: "https://placehold.co/320x180/1a1d27/8b5cf6?text=6", caption: "27–30s: Logo + Play Now CTA" },
        ],
      },
      video: {
        title: "15s Rescue Cut-down",
        src: "https://placehold.co/720x405/1a1d27/10b981?text=Royal+Match+Video",
        beats: [
          { time: "0–3s", text: "King Robert clinging to a melting platform" },
          { time: "3–8s", text: "Player POV: tap to swap, jewels cascade" },
          { time: "8–12s", text: "Castle rebuilds, king cheers" },
          { time: "12–15s", text: "Logo + '#1 Puzzle Game' + Play Now" },
        ],
        tags: ["15s cut-down", "Warm tone", "Social proof CTA"],
      },
    },
  },
};

// ---------- Coin Master (CR-1048) — TikTok · Video · 28 days ----------
const COIN_MASTER_AD: AdDetail = {
  id: "CR-1048",
  game: "Coin Master",
  developer: "Moon Active",
  network: "TikTok",
  format: "Video",
  country: "United States",
  countryFlag: "🇺🇸",
  dateRange: "Mar 28 – Apr 25",
  runDays: 28,
  impressions: "2.1M",
  spendTier: "Mid",
  score: 84,
  timeline: [
    {
      key: "Hook",
      range: "0–3s",
      label: "Slot machine BIG WIN",
      description:
        "Slot machine spins and lands on triple coins with explosive coin shower — instant dopamine hook tuned for autoplay scrolling.",
      color: "#f59e0b",
    },
    {
      key: "Tension",
      range: "3–15s",
      label: "Friend raids your village",
      description:
        "Notification pops: a friend just raided you for 2M coins. Player reacts with mock outrage, scrolls revenge targets.",
      color: "#3b82f6",
    },
    {
      key: "Resolution",
      range: "15–25s",
      label: "Revenge raid + village build",
      description:
        "Player retaliates, doubles their coin stack, finishes upgrading their village to the next theme.",
      color: "#10b981",
    },
    {
      key: "CTA",
      range: "25–30s",
      label: "Spin & Win Free",
      description:
        "Logo + Spin & Win Free button, '100M+ players worldwide' social proof and free spins offer.",
      color: "#8b5cf6",
    },
  ],
  hook: {
    type: "Slot-machine jackpot",
    trigger: "Anticipation → Reward",
    strength: 81,
    rationale:
      "The coin shower in the first second triggers a strong dopamine response and stops the scroll on TikTok feeds.",
  },
  visual: {
    style: "Vertical UGC + in-game capture",
    palette: ["#f5c542", "#7a1f1f", "#1f3a7a", "#2f5a2c"],
    pacing: "Very fast — 10 scenes in 30s",
    character: "No — UGC creator face shown instead",
  },
  cta: {
    text: "Spin & Win Free",
    placement: "Last 5 seconds",
    style: "FOMO",
    score: 74,
  },
  copyLines: [
    { time: "0:01", text: "JACKPOT 🎰" },
    { time: "0:07", text: "She raided my village 😤" },
    { time: "0:17", text: "Revenge time" },
    { time: "0:27", text: "Spin & Win — Free spins inside" },
  ],
  audio: {
    direction: "TikTok-trending sound + slot SFX, creator voiceover",
    voiceover: true,
  },
  audience: {
    reach: "2.1M impressions",
    primary: "Women 25–44",
    engagement: "Above average — high TikTok save rate",
    ageBars: [
      { label: "18–24", pct: 26 },
      { label: "25–34", pct: 34 },
      { label: "35–44", pct: 27 },
      { label: "45+", pct: 13 },
    ],
    genderMale: 38,
    geo: [
      { country: "United States", flag: "🇺🇸", pct: 41 },
      { country: "Brazil", flag: "🇧🇷", pct: 16 },
      { country: "Philippines", flag: "🇵🇭", pct: 11 },
    ],
    affinities: [
      { tag: "Social casino fan", score: 88 },
      { tag: "TikTok daily user", score: 84 },
      { tag: "Casual collector", score: 72 },
    ],
    intent: 55,
    placement: "TikTok For You feed — vertical autoplay",
  },
  comparison: [
    { metric: "Performance score", thisAd: 84, categoryAvg: 64, topPerformer: 90 },
    { metric: "Run duration (days)", thisAd: 28, categoryAvg: 16, topPerformer: 44 },
    { metric: "Est. impressions (M)", thisAd: 2.1, categoryAvg: 1.1, topPerformer: 3.4 },
  ],
  similar: [
    { id: "CR-3120", game: "Monopoly Go", network: "TikTok", format: "Video", similarity: 86, reason: "Slot + raid combo" },
    { id: "CR-3088", game: "Pirate Kings", network: "TikTok", format: "Video", similarity: 79, reason: "Revenge raid arc" },
    { id: "CR-3040", game: "Solitaire Cash", network: "Meta", format: "Video", similarity: 71, reason: "FOMO CTA + UGC creator" },
  ],
  network_context: {
    rank: "#2 of 18",
    saturation: 81,
    bestDays: "Thursday–Sunday",
    formatShare: "Video = 92% of all Coin Master TikTok spend",
  },
  patterns: [
    { name: "Slot-machine jackpot opener", category: "Visual", frequency: 168, avgScore: 70, delta: 14, trend: "Rising" },
    { name: "Raid revenge arc", category: "Narrative", frequency: 121, avgScore: 67, delta: 17, trend: "Stable" },
    { name: "UGC creator voiceover", category: "Audio", frequency: 204, avgScore: 65, delta: 19, trend: "Rising" },
    { name: "Free spins offer overlay", category: "Offer", frequency: 88, avgScore: 71, delta: 13, trend: "Stable" },
  ],
  patternMatrix: [
    { name: "Slot-machine opener", frequency: 51, score: 70, highlighted: true },
    { name: "Raid revenge arc", frequency: 36, score: 67, highlighted: true },
    { name: "UGC creator VO", frequency: 62, score: 65, highlighted: true },
    { name: "Free spins overlay", frequency: 27, score: 71, highlighted: true },
    { name: "Static end card only", frequency: 78, score: 46 },
    { name: "Celebrity cameo", frequency: 11, score: 80 },
    { name: "Comparison ad", frequency: 24, score: 68 },
    { name: "Live action skit", frequency: 19, score: 60 },
    { name: "Voice-of-god narration", frequency: 55, score: 57 },
    { name: "Pixel art intro", frequency: 7, score: 53 },
    { name: "Discount overlay", frequency: 49, score: 51 },
    { name: "Hidden gem influencer", frequency: 13, score: 76 },
  ],
  patternCombo: ["Slot opener", "Raid revenge", "Free spins CTA"],
  comboRationale:
    "This trio appears in 6% of top-performing social casino ads — concentrated, high-conversion mix.",
  sentiment: {
    overall: 58,
    volume: "1.6K mentions this month",
    topEmotion: "Excitement",
    platforms: [
      { platform: "Reddit", sentiment: 49, theme: "Players debating predatory monetization" },
      { platform: "YouTube", sentiment: 55, theme: "Compilation reactions to slot ads" },
      { platform: "TikTok", sentiment: 74, theme: "UGC raid revenge stitches trending" },
      { platform: "Discord", sentiment: 53, theme: "Whale players sharing village screenshots" },
    ],
    quotes: [
      {
        quote: "Tried it because of the TikTok ad and now I check my spins every morning. Help.",
        source: "TikTok",
        sentiment: "Positive",
        theme: "Funny",
      },
      {
        quote: "Coin Master ads are basically gambling commercials disguised as games.",
        source: "Reddit",
        sentiment: "Negative",
        theme: "Misleading gameplay",
      },
      {
        quote: "Got my mom hooked, she raids my village every day now.",
        source: "TikTok",
        sentiment: "Positive",
        theme: "Nostalgic",
      },
    ],
    reviewMatches: [
      { claim: "Slot machine spins", match: true, detail: "Confirmed — core loop is the slot machine." },
      { claim: "Friend raids", match: true, detail: "Confirmed — social raid mechanic is central." },
      { claim: "Big jackpots every spin", match: false, detail: "Contradicted — most spins yield small rewards." },
    ],
  },
  insights: {
    summary:
      "Strong TikTok performer leveraging social casino dopamine loops. Sentiment risk on Reddit — counterbalance with UGC trust signals.",
    works: [
      "Coin shower in first second is a textbook TikTok scroll-stopper",
      "UGC creator format builds trust at lower production cost",
      "Free spins overlay drives higher install intent than generic CTAs",
    ],
    improve: [
      "Negative Reddit sentiment around predatory framing — soften offer language",
      "No localization detected despite Brazil and Philippines reach",
      "CTA could surface time-limited spin counter for added urgency",
    ],
    differentiate: [
      "Competitors over-rely on celebrity cameos — UGC is a cheaper differentiator",
      "Underused: cooperative village-building angle (currently all PvP framing)",
      "No competitor uses regional creators in PT-BR or TL — clear opening",
    ],
    related: [
      { id: "CR-3120", game: "Monopoly Go", network: "TikTok", format: "Video", similarity: 86, reason: "Same hook archetype" },
      { id: "CR-3088", game: "Pirate Kings", network: "TikTok", format: "Video", similarity: 79, reason: "Same network + format" },
      { id: "CR-3040", game: "Solitaire Cash", network: "Meta", format: "Video", similarity: 71, reason: "Top performer this month" },
      { id: "CR-3001", game: "Bingo Blitz", network: "Google", format: "Video", similarity: 67, reason: "Similar pattern combo" },
    ],
  },
  brief: {
    classification: {
      genre: "Social casino / Casual",
      archetype: "Slot-machine jackpot — Dopamine hook",
      narrative: "Reward → Loss → Revenge → CTA",
      tone: "High-energy, playful, slightly chaotic",
      production: "Medium — UGC + screen capture overlays",
    },
    snapshot: {
      pills: ["2.1M impressions", "28-day run", "CTR est. 2.9%", "Spend tier: Mid"],
      paragraph:
        "This ad is one of the most efficient creatives in Coin Master's TikTok rotation. It's running 1.75× longer than the social casino median on TikTok, with stable spend and no scaling phase detected — a reliable evergreen rather than a launch push. UGC production keeps cost-per-acquisition low.",
    },
    audience: {
      left: [
        { label: "Primary demographic", value: "Women, 25–34 (est. 34% of reach)" },
        { label: "Secondary demographic", value: "Women, 35–44 (est. 27% of reach)" },
        { label: "Geographic focus", value: "US, Brazil, Philippines, Mexico" },
        { label: "Platform context", value: "TikTok For You feed, vertical mobile" },
      ],
      right: [
        { label: "Player type", value: "Social casino casual" },
        { label: "Motivation triggers", value: "Reward anticipation, social rivalry, collection" },
        { label: "Re-engagement signal", value: "Mixed — heavy reactivation overlay" },
        { label: "Device split", value: "iOS 47% / Android 53%" },
      ],
    },
    installSignals: [
      { trend: "up", text: "Global installs (est.): +9% vs previous 30 days" },
      { trend: "flat", text: "US App Store rank: Stable at #6 Grossing (Casino)" },
      { trend: "up", text: "Google Play installs (est.): +14% vs previous 30 days" },
    ],
    installContext:
      "Android install lift correlates with a Brazil-focused TikTok creator push during the same window.",
    searchKeywords: [
      { keyword: "coin master free spins", source: "Google", trend: "rising", volume: "High" },
      { keyword: "coin master raid revenge", source: "TikTok", trend: "rising", volume: "High" },
      { keyword: "coin master download", source: "App Store", trend: "stable", volume: "High" },
      { keyword: "coin master village 200", source: "Google", trend: "rising", volume: "Medium" },
      { keyword: "coin master tips", source: "Google", trend: "stable", volume: "Medium" },
      { keyword: "coin master vs monopoly go", source: "Google", trend: "declining", volume: "Low" },
    ],
    retentionHooks: [
      { name: "Free spins timer", description: "Hourly free spins create return-every-few-hours habit" },
      { name: "Friend raid notifications", description: "Push alerts from friend raids drive immediate re-opens" },
      { name: "Village progression", description: "Themed villages give clear long-term cosmetic goals" },
      { name: "Card collection sets", description: "Trading cards create completionist obligation" },
    ],
    viralityVectors: [
      { name: "Friend invite spins", intensity: "High", description: "Inviting friends unlocks free spin packs" },
      { name: "Raid bragging stitches", intensity: "Medium", description: "TikTok users stitch raid wins for clout" },
      { name: "Village screenshot sharing", intensity: "Medium", description: "High-level villages get shared in casual gamer groups" },
    ],
    concepts: {
      image: {
        title: "Triple Coins Jackpot",
        description:
          "Vertical 9:16 frame of a slot machine mid-spin with coins exploding outward. Overlay text: 'Free spins inside.' CTA bottom: Spin & Win.",
        tags: ["Dopamine hook", "Vertical format", "Free spins offer"],
        src: "https://placehold.co/720x405/1a1d27/f5c542?text=Coin+Master+Concept",
      },
      storyboard: {
        title: "Spin, Raid, Win",
        tags: ["30s vertical", "Raid revenge arc", "TikTok placement"],
        panels: [
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=1", caption: "0–3s: Slot lands on triple coins" },
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=2", caption: "3–8s: Push notif: friend raided you" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=3", caption: "8–15s: Creator reacts, scrolls targets" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=4", caption: "15–22s: Revenge raid succeeds" },
          { src: "https://placehold.co/320x180/1a1d27/10b981?text=5", caption: "22–27s: Village upgrade animation" },
          { src: "https://placehold.co/320x180/1a1d27/8b5cf6?text=6", caption: "27–30s: Logo + Spin & Win CTA" },
        ],
      },
      video: {
        title: "15s Free Spins Cut-down",
        src: "https://placehold.co/720x405/1a1d27/f5c542?text=Coin+Master+Video",
        beats: [
          { time: "0–3s", text: "Slot machine explodes with coins" },
          { time: "3–8s", text: "Creator POV: 'I just got raided for 2M'" },
          { time: "8–12s", text: "Revenge raid wipes opponent" },
          { time: "12–15s", text: "Logo + 'Free spins inside' + CTA" },
        ],
        tags: ["15s cut-down", "High energy", "FOMO CTA"],
      },
    },
  },
};

// ---------- Subway Surfers (CR-1051) — Google · Video · 41 days ----------
const SUBWAY_SURFERS_AD: AdDetail = {
  id: "CR-1051",
  game: "Subway Surfers",
  developer: "SYBO Games",
  network: "Google",
  format: "Video",
  country: "United States",
  countryFlag: "🇺🇸",
  dateRange: "Mar 14 – Apr 24",
  runDays: 41,
  impressions: "2.9M",
  spendTier: "Top",
  score: 86,
  timeline: [
    {
      key: "Hook",
      range: "0–3s",
      label: "Cop chase starts",
      description:
        "Jake jumps onto the train, the inspector and dog launch into pursuit — vibrant Tokyo World Tour skin with fireworks overlay.",
      color: "#f59e0b",
    },
    {
      key: "Tension",
      range: "3–15s",
      label: "Near-miss obstacle dodging",
      description:
        "Triple-jump grind on rails, hoverboard save from a barrier, narrow tunnel dodge — pacing keeps you on edge.",
      color: "#3b82f6",
    },
    {
      key: "Resolution",
      range: "15–25s",
      label: "High-score celebration",
      description:
        "Mega coin streak, world-tour stamp animation, Jake hits a personal best with confetti and friend leaderboard ping.",
      color: "#10b981",
    },
    {
      key: "CTA",
      range: "25–30s",
      label: "Run Free Now",
      description:
        "Logo + 'Run Free Now' button, App Store editor's choice badge and 1B+ downloads social proof.",
      color: "#8b5cf6",
    },
  ],
  hook: {
    type: "Chase-and-dodge",
    trigger: "Adrenaline → Flow",
    strength: 79,
    rationale:
      "Endless runner viewers respond to motion and momentum. The chase establishes stakes and rhythm in under 2 seconds.",
  },
  visual: {
    style: "In-game footage — Tokyo World Tour skin",
    palette: ["#ff4d6a", "#3da9fc", "#f5c542", "#7c4dff"],
    pacing: "Very fast — 12 scenes in 30s",
    character: "Yes — Jake + Tricky featured",
  },
  cta: {
    text: "Run Free Now",
    placement: "Last 5 seconds",
    style: "Social proof",
    score: 76,
  },
  copyLines: [
    { time: "0:02", text: "Don't get caught!" },
    { time: "0:09", text: "Grind. Dodge. Survive." },
    { time: "0:18", text: "New high score!" },
    { time: "0:27", text: "Run Free — 1B+ downloads" },
  ],
  audio: {
    direction: "Upbeat electro chiptune + game SFX, no voiceover",
    voiceover: false,
  },
  audience: {
    reach: "2.9M impressions",
    primary: "Mixed 13–24",
    engagement: "Above average — strong completion rate",
    ageBars: [
      { label: "13–17", pct: 28 },
      { label: "18–24", pct: 32 },
      { label: "25–34", pct: 23 },
      { label: "35+", pct: 17 },
    ],
    genderMale: 54,
    geo: [
      { country: "United States", flag: "🇺🇸", pct: 33 },
      { country: "India", flag: "🇮🇳", pct: 19 },
      { country: "Brazil", flag: "🇧🇷", pct: 12 },
    ],
    affinities: [
      { tag: "Endless runner fan", score: 90 },
      { tag: "Casual session gamer", score: 81 },
      { tag: "Hyper-casual viewer", score: 68 },
    ],
    intent: 18,
    placement: "Google UAC — YouTube Shorts + in-app rewarded",
  },
  comparison: [
    { metric: "Performance score", thisAd: 86, categoryAvg: 69, topPerformer: 91 },
    { metric: "Run duration (days)", thisAd: 41, categoryAvg: 19, topPerformer: 56 },
    { metric: "Est. impressions (M)", thisAd: 2.9, categoryAvg: 1.3, topPerformer: 4.1 },
  ],
  similar: [
    { id: "CR-3401", game: "Temple Run 2", network: "Google", format: "Video", similarity: 88, reason: "Chase-and-dodge hook" },
    { id: "CR-3380", game: "Stumble Guys", network: "TikTok", format: "Video", similarity: 76, reason: "Fast-pacing + bright palette" },
    { id: "CR-3355", game: "Bus Out", network: "Google", format: "Playable", similarity: 70, reason: "Casual session, autoplay friendly" },
  ],
  network_context: {
    rank: "#1 of 22",
    saturation: 67,
    bestDays: "Friday–Sunday",
    formatShare: "Video = 58% of all Subway Surfers Google spend",
  },
  patterns: [
    { name: "Chase-and-dodge opener", category: "Narrative", frequency: 159, avgScore: 71, delta: 15, trend: "Stable" },
    { name: "World tour skin", category: "Visual", frequency: 74, avgScore: 74, delta: 12, trend: "Rising" },
    { name: "High-score payoff", category: "Reward", frequency: 197, avgScore: 66, delta: 20, trend: "Stable" },
    { name: "Chiptune music bed", category: "Audio", frequency: 88, avgScore: 68, delta: 18, trend: "Rising" },
  ],
  patternMatrix: [
    { name: "Chase-and-dodge opener", frequency: 48, score: 71, highlighted: true },
    { name: "World tour skin", frequency: 22, score: 74, highlighted: true },
    { name: "High-score payoff", frequency: 59, score: 66, highlighted: true },
    { name: "Chiptune music bed", frequency: 26, score: 68, highlighted: true },
    { name: "Live action skit", frequency: 17, score: 59 },
    { name: "Celebrity cameo", frequency: 8, score: 80 },
    { name: "UGC reaction", frequency: 30, score: 65 },
    { name: "Pixel art intro", frequency: 9, score: 56 },
    { name: "Voice-of-god narration", frequency: 67, score: 60 },
    { name: "Static end card only", frequency: 82, score: 47 },
    { name: "Discount overlay", frequency: 41, score: 53 },
    { name: "Comparison ad", frequency: 25, score: 70 },
  ],
  patternCombo: ["Chase-and-dodge", "World tour skin", "High-score payoff"],
  comboRationale:
    "This combination appears in 5% of top-performing endless runner ads — efficient and brand-safe across all networks.",
  sentiment: {
    overall: 78,
    volume: "1.4K mentions this month",
    topEmotion: "Nostalgia",
    platforms: [
      { platform: "Reddit", sentiment: 76, theme: "Players returning after years away" },
      { platform: "YouTube", sentiment: 72, theme: "Tokyo skin praised in Shorts comments" },
      { platform: "TikTok", sentiment: 84, theme: "Subway Surfers split-screen meme trend" },
      { platform: "Discord", sentiment: 71, theme: "Speedrunners discussing high-score techniques" },
    ],
    quotes: [
      {
        quote: "This game has been with me since 2012, the Tokyo skin made me redownload immediately.",
        source: "Reddit",
        sentiment: "Positive",
        theme: "Nostalgic",
      },
      {
        quote: "Subway Surfers split-screen on TikTok is the only reason I can finish a video.",
        source: "TikTok",
        sentiment: "Positive",
        theme: "Funny",
      },
      {
        quote: "Ad shows insane runs but I die in 30 seconds. Skill issue I guess.",
        source: "YouTube",
        sentiment: "Neutral",
        theme: "Misleading gameplay",
      },
    ],
    reviewMatches: [
      { claim: "Endless run gameplay", match: true, detail: "Confirmed — core loop is exactly endless running." },
      { claim: "World tour cities", match: true, detail: "Confirmed — Tokyo and other cities rotate every few weeks." },
      { claim: "Effortless high scores", match: false, detail: "Contradicted — high scores require significant practice." },
    ],
  },
  insights: {
    summary:
      "Top performer with broad youth appeal and exceptional brand equity. Low risk creative — safe to scale spend further on Google UAC.",
    works: [
      "Tokyo World Tour skin gives the asset rotation freshness without re-shooting",
      "Chiptune audio bed performs well even with sound off thanks to motion clarity",
      "1B+ downloads stamp converts well in younger audiences",
    ],
    improve: [
      "CTA card lingers too long for a 30s asset — try a 5s shorter cut-down",
      "No localization variants for India and Brazil despite reach concentration",
      "Missing playable end-card variant for rewarded placements",
    ],
    differentiate: [
      "Competitors leaning into UGC — pure in-game footage is a brand-equity differentiator",
      "No competitor highlights the split-screen TikTok meme — embrace it natively",
      "Untapped: collab-skin angle (already exists in-game) for cross-IP audience expansion",
    ],
    related: [
      { id: "CR-3401", game: "Temple Run 2", network: "Google", format: "Video", similarity: 88, reason: "Same hook archetype" },
      { id: "CR-3380", game: "Stumble Guys", network: "TikTok", format: "Video", similarity: 76, reason: "Same network + format" },
      { id: "CR-3355", game: "Bus Out", network: "Google", format: "Playable", similarity: 70, reason: "Top performer this month" },
      { id: "CR-3320", game: "Sonic Dash", network: "Meta", format: "Video", similarity: 67, reason: "Similar pattern combo" },
    ],
  },
  brief: {
    classification: {
      genre: "Endless runner / Casual",
      archetype: "Chase-and-dodge — Adrenaline hook",
      narrative: "Threat → Flow → Reward → CTA",
      tone: "Energetic, playful, youthful",
      production: "High — In-game capture + motion overlays",
    },
    snapshot: {
      pills: ["2.9M impressions", "41-day run", "CTR est. 2.7%", "Spend tier: Top"],
      paragraph:
        "Subway Surfers continues to anchor SYBO's Google UAC strategy. This creative is running 2.1× longer than the endless runner median and shows steady scaling, suggesting strong ROAS. The Tokyo World Tour seasonal skin gives the asset legitimate freshness without re-shoots.",
    },
    audience: {
      left: [
        { label: "Primary demographic", value: "Mixed, 18–24 (est. 32% of reach)" },
        { label: "Secondary demographic", value: "Mixed, 13–17 (est. 28% of reach)" },
        { label: "Geographic focus", value: "US, India, Brazil, Indonesia" },
        { label: "Platform context", value: "YouTube Shorts + rewarded placements" },
      ],
      right: [
        { label: "Player type", value: "Casual session, short-burst gamer" },
        { label: "Motivation triggers", value: "Flow state, completion, score chasing" },
        { label: "Re-engagement signal", value: "New users dominant — youth acquisition" },
        { label: "Device split", value: "iOS 36% / Android 64%" },
      ],
    },
    installSignals: [
      { trend: "up", text: "Global installs (est.): +22% vs previous 30 days" },
      { trend: "up", text: "US App Store rank: Up to #2 Free (Arcade)" },
      { trend: "up", text: "Google Play installs (est.): +28% vs previous 30 days" },
    ],
    installContext:
      "Install spike correlates with the Tokyo World Tour seasonal launch and a Google UAC budget increase in the same window.",
    searchKeywords: [
      { keyword: "subway surfers tokyo", source: "Google", trend: "rising", volume: "High" },
      { keyword: "subway surfers download", source: "App Store", trend: "stable", volume: "High" },
      { keyword: "subway surfers high score", source: "TikTok", trend: "rising", volume: "Medium" },
      { keyword: "subway surfers world tour 2025", source: "Google", trend: "rising", volume: "Medium" },
      { keyword: "subway surfers hack", source: "Google", trend: "stable", volume: "Medium" },
      { keyword: "temple run vs subway surfers", source: "Google", trend: "declining", volume: "Low" },
    ],
    retentionHooks: [
      { name: "World tour rotation", description: "New city every few weeks creates anticipation cycle" },
      { name: "Daily challenges", description: "Token-based dailies create return habit" },
      { name: "Character + board collection", description: "Cosmetic completionism drives long retention" },
      { name: "Score progression visibility", description: "Personal best framing keeps short-session players engaged" },
    ],
    viralityVectors: [
      { name: "Split-screen TikTok meme", intensity: "High", description: "Subway Surfers gameplay used as background for any TikTok content" },
      { name: "World tour stamp sharing", intensity: "Medium", description: "Players post screenshots when unlocking new cities" },
      { name: "High-score brag posts", intensity: "Medium", description: "Speedrunners share leaderboard runs on Reddit" },
    ],
    concepts: {
      image: {
        title: "Tokyo Run",
        description:
          "Wide shot of Jake mid-grind on Tokyo rails with cherry blossoms and neon signs blurring past. Overlay text: 'Beat your best run.' CTA bottom right: Run Free.",
        tags: ["Chase-and-dodge", "World tour skin", "Vibrant palette"],
        src: "https://placehold.co/720x405/1a1d27/3da9fc?text=Subway+Surfers+Concept",
      },
      storyboard: {
        title: "Tokyo Tour in 30s",
        tags: ["30s format", "Chase-and-dodge arc", "Rewarded placement"],
        panels: [
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=1", caption: "0–3s: Cop chase starts on Tokyo line" },
          { src: "https://placehold.co/320x180/1a1d27/f59e0b?text=2", caption: "3–8s: Triple-jump grind on rail" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=3", caption: "8–15s: Hoverboard saves a near-miss" },
          { src: "https://placehold.co/320x180/1a1d27/3b82f6?text=4", caption: "15–22s: Mega coin streak begins" },
          { src: "https://placehold.co/320x180/1a1d27/10b981?text=5", caption: "22–27s: New high score celebration" },
          { src: "https://placehold.co/320x180/1a1d27/8b5cf6?text=6", caption: "27–30s: Logo + Run Free CTA" },
        ],
      },
      video: {
        title: "15s Tokyo Cut-down",
        src: "https://placehold.co/720x405/1a1d27/3da9fc?text=Subway+Surfers+Video",
        beats: [
          { time: "0–3s", text: "Aerial pan over Tokyo subway lines" },
          { time: "3–8s", text: "Player POV: rail grind, neon flashes" },
          { time: "8–12s", text: "High-score popup, confetti burst" },
          { time: "12–15s", text: "Logo + '1B+ downloads' + Run Free CTA" },
        ],
        tags: ["15s cut-down", "High energy", "Social proof CTA"],
      },
    },
  },
};

// ---------- Registry ----------

export const AD_DETAILS: Record<string, AdDetail> = {
  // Original sample (Clash of Clans)
  [SAMPLE_AD_DETAIL.id]: SAMPLE_AD_DETAIL,
  "CR-1042": { ...SAMPLE_AD_DETAIL, id: "CR-1042" },
  // New ads
  [ROYAL_MATCH_AD.id]: ROYAL_MATCH_AD,
  [COIN_MASTER_AD.id]: COIN_MASTER_AD,
  [SUBWAY_SURFERS_AD.id]: SUBWAY_SURFERS_AD,
};

export function getAdDetail(id: string | undefined): AdDetail {
  if (!id) return SAMPLE_AD_DETAIL;
  const found = AD_DETAILS[id];
  if (found) return found;
  // Fallback: keep the requested ID but use the sample content.
  return { ...SAMPLE_AD_DETAIL, id };
}
