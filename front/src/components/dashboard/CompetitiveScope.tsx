import { ExternalLink, Info } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { abbrevNumber, type SpendTier } from "@/data/sample";
import { useAdvertisers, useAdvertiserRanks } from "@/lib/api";
import { useGame } from "@/lib/game-context";

// Short labels keep the per-row chip strip compact even with 4 networks.
const NETWORK_SHORT: Record<string, string> = {
  Facebook: "FB",
  TikTok: "TT",
  Admob: "Admob",
  Applovin: "AppLov",
};
const NETWORK_ORDER = ["Facebook", "TikTok", "Admob", "Applovin"];

const TIER_STYLE: Record<SpendTier, string> = {
  Top: "bg-primary/15 text-primary border-primary/30",
  Mid: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Micro: "bg-muted text-muted-foreground border-border",
};

const STATUS_STYLE: Record<string, string> = {
  Active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Monitoring: "bg-muted text-muted-foreground border-border",
};

const SPEND_COLORS = ["#4f8ef7", "#a78bfa", "#34d399", "#fb923c"];

export function CompetitiveScope() {
  const { gameName } = useGame();
  const { data: competitors = [], isLoading } = useAdvertisers({ game_name: gameName || undefined });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
        Loading competitors…
      </div>
    );
  }

  const data = [...competitors]
    .map((c, i) => ({ name: c.game, spend: c.monthlySpend, fill: SPEND_COLORS[i % SPEND_COLORS.length] }))
    .sort((a, b) => b.spend - a.spend);

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Game</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">
                <span
                  title="Rank in SensorTower's top-advertisers list, sorted by Share of Voice (SoV) — not an App Store ranking."
                  className="inline-flex items-center gap-1"
                >
                  SoV rank
                  <Info className="h-3 w-3 opacity-60" />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span
                  title="Estimated from Share of Voice. SensorTower exposes SoV but not USD spend, so this is a heuristic (sov × $8M reference budget)."
                  className="inline-flex items-center gap-1"
                >
                  Est. monthly spend
                  <Info className="h-3 w-3 opacity-60" />
                </span>
              </TableHead>
              <TableHead>Spend tier</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competitors.map((c) => (
              <TableRow key={c.game} className="group">
                <TableCell className="font-medium">
                  <div className="flex items-start gap-2.5">
                    {c.iconUrl ? (
                      <img
                        src={c.iconUrl}
                        alt={c.game}
                        loading="lazy"
                        className="mt-0.5 h-9 w-9 flex-shrink-0 rounded-md object-cover ring-1 ring-border"
                      />
                    ) : (
                      <div
                        className="mt-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-muted text-[10px] font-semibold uppercase text-muted-foreground ring-1 ring-border"
                        aria-hidden
                      >
                        {c.game.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 flex-col gap-1">
                      {c.app_id ? (
                        <Link
                          to="/competitor/$appId"
                          params={{ appId: c.app_id }}
                          className="inline-flex items-center gap-1 truncate text-foreground transition-colors hover:text-primary"
                          title={`View every cached ad for ${c.game}`}
                        >
                          <span className="truncate">{c.game}</span>
                          <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                        </Link>
                      ) : (
                        <div className="truncate">{c.game}</div>
                      )}
                      {c.publisher && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          by {c.publisher}
                        </div>
                      )}
                      {c.app_id ? (
                        <div className="mt-0.5">
                          <NetworkRankChips appId={c.app_id} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.subGenre}</TableCell>
                <TableCell className="text-right">#{c.appStoreRank}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  ${abbrevNumber(c.monthlySpend)}
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TIER_STYLE[c.spendTier]}`}
                  >
                    {c.spendTier}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${c.status === "Active" ? "bg-emerald-400" : "bg-muted-foreground"}`}
                    />
                    {c.status}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              Estimated monthly spend distribution
            </h3>
            <p className="text-xs text-muted-foreground">
              Tracked competitor games · sorted by SoV
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
            title="Spend is a SoV-based heuristic, not real USD spend from SensorTower."
          >
            <Info className="h-3 w-3" /> Heuristic
          </span>
        </div>
        {/* Height scales with row count (32px/row + 32px chrome) so 10
            advertisers don't collide with the chart top, and long game
            names get a 200px Y-axis lane to fully render. */}
        <div
          className="w-full"
          style={{ height: Math.max(280, data.length * 32 + 40) }}
        >
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="oklch(1 0 0 / 0.08)"
                horizontal={false}
              />
              <XAxis
                type="number"
                stroke="oklch(0.7 0.02 260)"
                fontSize={11}
                tickFormatter={(v) => "$" + abbrevNumber(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="oklch(0.7 0.02 260)"
                fontSize={11}
                width={200}
                interval={0}
                tick={{ textAnchor: "end" }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number) => [
                  "$" + abbrevNumber(v),
                  "Est. monthly spend",
                ]}
              />
              <Bar dataKey="spend" radius={[0, 4, 4, 0]}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

interface NetworkRankChipsProps {
  appId: string;
}

/** Small contextual chips: e.g. `FB #3 · TT #12 · Admob #127`. Shown next to
 *  each competitor on the Competitive Scope table. Quietly empties when the
 *  app has no rank data — long-tail Voodoo titles routinely fall outside
 *  SensorTower's tracked rankings. */
function NetworkRankChips({ appId }: NetworkRankChipsProps) {
  const { data, isLoading } = useAdvertiserRanks(appId);

  if (isLoading) {
    return (
      <span className="text-[10px] text-muted-foreground/60">ranking…</span>
    );
  }

  const ranks = data ?? {};
  // Stable, predictable ordering across rows so the eye can scan vertically.
  const present = NETWORK_ORDER.filter((n) => ranks[n]?.rank != null);
  if (present.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {present.map((net) => {
        const r = ranks[net];
        return (
          <span
            key={net}
            title={`${net} · #${r.rank} in ${r.country}${r.date ? ` · ${r.date}` : ""}`}
            className="inline-flex items-center gap-1 rounded-sm border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
          >
            <span>{NETWORK_SHORT[net] ?? net}</span>
            <span className="font-medium tabular-nums text-foreground/80">
              #{r.rank}
            </span>
          </span>
        );
      })}
    </div>
  );
}
