export type Network = "Meta" | "Google" | "TikTok" | "ironSource";
export type Format = "Video" | "Static" | "Playable";
export type SpendTier = "Micro" | "Mid" | "Top";

export interface Creative {
  id: string;
  game: string;
  network: Network;
  format: Format;
  runDays: number;
  /** @deprecated synthetic value (= max(10k, share*50M)). UI no longer renders. */
  impressions: number;
  /** @deprecated synthetic 0–100 tier. UI no longer renders. */
  score: number;
  /** @deprecated synthetic 4% of synthetic impressions. UI no longer renders. */
  spendEstimate: number;
  startedAt: string;
  /** SensorTower S3 thumbnail (jpeg). May be null for some Static formats. */
  thumbUrl?: string | null;
  /** Original creative asset URL (mp4 for Video; image for Static). */
  creativeUrl?: string | null;
  /**
   * Real Share of Voice from SensorTower (0–1) within the queried
   * category × network × period. The only honest popularity metric.
   */
  sov?: number | null;
  /** Advertiser app's publisher (e.g. "Voodoo", "Playrix"). */
  publisherName?: string | null;
  /** Advertiser app's icon URL (App Store CDN). */
  appIconUrl?: string | null;
}

export interface CompetitorGame {
  game: string;
  subGenre: string;
  appStoreRank: number;
  monthlySpend: number; // USD
  spendTier: SpendTier;
  status: "Active" | "Monitoring";
  /** SensorTower app id (unified) — present on backend-driven rows; absent in static fixtures. */
  app_id?: string | null;
  /** App icon URL (App Store CDN). Used to render game thumbnails on Competitive Scope. */
  iconUrl?: string | null;
  /** Publisher name (e.g. "Voodoo"). */
  publisher?: string | null;
}

export const NETWORKS: Network[] = ["Meta", "Google", "TikTok", "ironSource"];
export const FORMATS: Format[] = ["Video", "Static", "Playable"];

export const NETWORK_HEX: Record<Network, string> = {
  Meta: "#1877f2",
  Google: "#34a853",
  TikTok: "#ff0050",
  ironSource: "#ff6b35",
};

export const FORMAT_HEX: Record<Format, string> = {
  Video: "#4f8ef7",
  Static: "#a78bfa",
  Playable: "#34d399",
};

export function abbrevNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
