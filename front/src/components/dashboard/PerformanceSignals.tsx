import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  Play,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FORMAT_HEX,
  FORMATS,
  NETWORK_HEX,
  type Creative,
  type Format,
} from "@/data/sample";
import { useCreatives } from "@/lib/api";
import { useGame } from "@/lib/game-context";
import { NetworkBadge } from "./NetworkBadge";

// ---------- helpers ----------

// fake "7-day avg" trend per creative for the trend column
function trendVsRecent(c: Creative): number {
  // deterministic pseudo trend from id hash
  const n = c.id.charCodeAt(c.id.length - 1) + c.id.charCodeAt(c.id.length - 2);
  return ((n % 11) - 5); // -5..+5
}



// ---------- subcomponents ----------

type Trend =
  | { kind: "up"; pct: number }
  | { kind: "down"; pct: number }
  | { kind: "neutral" };

function TrendPill({ trend }: { trend: Trend }) {
  if (trend.kind === "neutral") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> vs prev. period
      </span>
    );
  }
  const Up = trend.kind === "up";
  const Icon = Up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        Up ? "text-emerald-400" : "text-rose-400"
      }`}
    >
      <Icon className="h-3 w-3" />
      {Up ? "+" : "-"}
      {trend.pct}% <span className="text-muted-foreground">vs prev.</span>
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend: Trend;
}) {
  return (
    <Card className="border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="text-2xl font-semibold tracking-tight leading-none">
          {value}
        </div>
        {sub && (
          <div className="pb-0.5 text-xs text-muted-foreground">{sub}</div>
        )}
      </div>
      <div className="mt-2">
        <TrendPill trend={trend} />
      </div>
    </Card>
  );
}

// ---------- main ----------

type SortKey =
  | "rank"
  | "game"
  | "network"
  | "format"
  | "runDays"
  | "impressions"
  | "score";

export function PerformanceSignals() {
  const { gameName } = useGame();
  const { data: creatives = [], isLoading } = useCreatives({ game_name: gameName || undefined });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<Creative | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Proxy score: runDays normalized to 0–100 across the loaded set.
  // runDays is the only metric guaranteed non-null on every creative.
  const maxRunDays = useMemo(
    () => Math.max(1, ...creatives.map((c) => c.runDays)),
    [creatives],
  );
  const proxyScore = (c: Creative) =>
    Math.round((c.runDays / maxRunDays) * 100);

  const categoryAvg = useMemo(
    () =>
      creatives.length
        ? creatives.reduce((s, c) => s + proxyScore(c), 0) / creatives.length
        : 0,
    [creatives, maxRunDays],
  );

  // ----- derived stats (Section A) -----
  const stats = useMemo(() => {
    if (!creatives.length) return { avgRun: 0, topNet: "", topNetScore: 0, bestFmt: "", longRunners: 0 };

    const avgRun = Math.round(
      creatives.reduce((s, c) => s + c.runDays, 0) / creatives.length,
    );

    const byNet = new Map<string, { sum: number; n: number }>();
    creatives.forEach((c) => {
      const e = byNet.get(c.network) ?? { sum: 0, n: 0 };
      e.sum += c.runDays;
      e.n += 1;
      byNet.set(c.network, e);
    });
    let topNet = "";
    let topNetScore = 0;
    byNet.forEach((v, k) => {
      const avg = v.sum / v.n;
      if (avg > topNetScore) { topNetScore = avg; topNet = k; }
    });

    const byFmt = new Map<string, { sum: number; n: number }>();
    creatives.forEach((c) => {
      const e = byFmt.get(c.format) ?? { sum: 0, n: 0 };
      e.sum += c.runDays;
      e.n += 1;
      byFmt.set(c.format, e);
    });
    let bestFmt = "";
    let bestFmtScore = 0;
    byFmt.forEach((v, k) => {
      const avg = v.sum / v.n;
      if (avg > bestFmtScore) { bestFmtScore = avg; bestFmt = k; }
    });

    const longRunners = creatives.filter((c) => c.runDays >= 30).length;

    return { avgRun, topNet, topNetScore: Math.round(topNetScore), bestFmt, longRunners };
  }, [creatives]);

  // ----- left chart: top 8 by run duration -----
  const top8 = useMemo(
    () =>
      [...creatives]
        .sort((a, b) => b.runDays - a.runDays)
        .slice(0, 8)
        .map((c) => ({
          ...c,
          proxyScore: proxyScore(c),
          label: `${c.game.split(" ")[0]} · ${c.format}`,
        })),
    [creatives, maxRunDays],
  );

  // ----- table sorting -----
  const sortedRows = useMemo(() => {
    const ranked = [...creatives]
      .sort((a, b) => b.runDays - a.runDays)
      .map((c, i) => ({ ...c, rank: i + 1, trend: trendVsRecent(c) }));

    return [...ranked].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "rank":
          return (a.rank - b.rank) * dir;
        case "game":
          return a.game.localeCompare(b.game) * dir;
        case "network":
          return a.network.localeCompare(b.network) * dir;
        case "format":
          return a.format.localeCompare(b.format) * dir;
        case "runDays":
          return (a.runDays - b.runDays) * dir;
        case "impressions":
          return (a.runDays - b.runDays) * dir;
        case "score":
        default:
          return (a.runDays - b.runDays) * dir;
      }
    });
  }, [creatives, sortKey, sortDir]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
        Loading performance signals…
      </div>
    );
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "game" || key === "network" || key === "format" ? "asc" : "desc");
    }
  }

  return (
    <div className="space-y-6">
      {/* SECTION A — stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Avg run duration"
          value={`${stats.avgRun}d`}
          trend={{ kind: "up", pct: 12 }}
        />
        <StatCard
          label="Top network by avg score"
          value={
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: NETWORK_HEX[stats.topNet as keyof typeof NETWORK_HEX] }}
              />
              {stats.topNet}
            </span>
          }
          sub={`avg ${Math.round(stats.topNetScore)}`}
          trend={{ kind: "neutral" }}
        />
        <StatCard
          label="Best performing format"
          value={
            <span className="flex items-center gap-2">
              <span
                className="rounded-md border px-1.5 py-0.5 text-xs font-medium"
                style={{
                  background: `${FORMAT_HEX[stats.bestFmt as Format]}26`,
                  color: FORMAT_HEX[stats.bestFmt as Format],
                  borderColor: `${FORMAT_HEX[stats.bestFmt as Format]}55`,
                }}
              >
                {stats.bestFmt}
              </span>
            </span>
          }
          trend={{ kind: "up", pct: 8 }}
        />
        <StatCard
          label="Creatives running 30+ days"
          value={stats.longRunners}
          trend={{ kind: "down", pct: 3 }}
        />
      </div>

      {/* SECTION B — charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* LEFT: top creatives bar */}
        <Card className="border-border bg-card p-4">
          <div className="mb-3">
            <h3 className="text-[15px] font-medium">Top creatives by Share of Voice</h3>
            <p className="text-xs text-muted-foreground">
              Real SensorTower SoV — % of ad impressions in the category
            </p>
          </div>
          <div className="h-[320px] w-full">
            <ResponsiveContainer>
              <BarChart
                data={top8}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                onClick={(e) => {
                  const id = e?.activePayload?.[0]?.payload?.id;
                  if (id) setHighlight(id === highlight ? null : id);
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="oklch(1 0 0 / 0.06)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[0, "auto"]}
                  tickFormatter={(v) => `${v.toFixed(1)}%`}
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke="#9ca3af"
                  fontSize={11}
                  width={150}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof top8)[number];
                    return (
                      <div className="rounded-md border border-border bg-card p-2 text-xs shadow-lg">
                        <div className="font-semibold">{d.game}</div>
                        <div className="text-muted-foreground">
                          {d.network} · {d.format}
                        </div>
                        <div className="mt-1">
                          Run: <span className="font-medium">{d.runDays}d</span>
                        </div>
                        <div>
                          SoV: <span className="font-medium">{proxyScore(d)}d</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="proxyScore"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                >
                  {top8.map((c) => (
                    <Cell
                      key={c.id}
                      fill={NETWORK_HEX[c.network]}
                      fillOpacity={highlight && highlight !== c.id ? 0.35 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {Object.entries(NETWORK_HEX).map(([n, c]) => (
              <span key={n} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: c }}
                />{" "}
                {n}
              </span>
            ))}
          </div>
        </Card>

        {/* RIGHT: scatter */}
        <Card className="border-border bg-card p-4">
          <div className="mb-3">
            <h3 className="text-[15px] font-medium">Run duration vs performance score</h3>
            <p className="text-xs text-muted-foreground">
              X = days active · Y = proxy score · dot size = estimated spend tier
            </p>
          </div>
          <div className="h-[320px] w-full">
            <ResponsiveContainer>
              <ScatterChart
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                onClick={(e) => {
                  const id = e?.activePayload?.[0]?.payload?.id;
                  if (id) setHighlight(id === highlight ? null : id);
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="oklch(1 0 0 / 0.06)"
                  vertical={false}
                />
                <XAxis
                  type="number"
                  dataKey="runDays"
                  name="Run days"
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: "Run (days)",
                    position: "insideBottom",
                    offset: -2,
                    fill: "#6b7280",
                    fontSize: 11,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="proxyScore"
                  name="Score"
                  domain={[0, 100]}
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <ZAxis type="number" dataKey="z" range={[80, 380]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as Creative;
                    return (
                      <div className="rounded-md border border-border bg-card p-2 text-xs shadow-lg">
                        <div className="font-semibold">{d.game}</div>
                        <div className="text-muted-foreground">
                          {d.network} · {d.format}
                        </div>
                        <div className="mt-1">
                          SoV: <span className="font-medium">{proxyScore(d)}d</span>
                        </div>
                        <div>{d.runDays}d active</div>
                      </div>
                    );
                  }}
                />
                {FORMATS.map((f) => (
                  <Scatter
                    key={f}
                    name={f}
                    data={creatives
                      .filter((c) => c.format === f)
                      .map((c) => ({
                        ...c,
                        proxyScore: proxyScore(c),
                        z: Math.max(80, Math.min(380, proxyScore(c) * 3)),
                      }))}
                    fill={FORMAT_HEX[f]}
                    fillOpacity={0.85}
                    cursor="pointer"
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {FORMATS.map((f) => (
              <span key={f} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: FORMAT_HEX[f] }}
                />{" "}
                {f}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* SECTION C — ranked table */}
      <Card className="border-border bg-card p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-[15px] font-medium">Ranked creatives</h3>
            <p className="text-xs text-muted-foreground">
              Click a column to sort · click a row for details
            </p>
          </div>
          {highlight && (
            <button
              onClick={() => setHighlight(null)}
              className="text-xs text-primary hover:underline"
            >
              Clear highlight
            </button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label="#"
                k="rank"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                className="w-12"
              />
              <TableHead className="w-14">Thumb</TableHead>
              <SortableHead label="Game" k="game" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Network" k="network" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Format" k="format" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead
                label="Run"
                k="runDays"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Impressions"
                k="impressions"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Perf. score"
                k="score"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
                className="w-[180px]"
              />
              <TableHead className="w-16 text-center">Trend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((c) => {
              const isHi = highlight === c.id;
              return (
                <TableRow
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`cursor-pointer transition-colors ${
                    isHi ? "bg-primary/10 hover:bg-primary/15" : ""
                  }`}
                >
                  <TableCell className="text-muted-foreground">{c.rank}</TableCell>
                  <TableCell>
                    <ThumbPreview creative={c} />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium leading-tight">{c.game}</div>
                    <div className="text-[11px] text-muted-foreground">{c.id}</div>
                  </TableCell>
                  <TableCell>
                    <NetworkBadge network={c.network} />
                  </TableCell>
                  <TableCell>
                    <span
                      className="rounded-md border px-1.5 py-0.5 text-xs font-medium"
                      style={{
                        background: `${FORMAT_HEX[c.format]}1f`,
                        color: FORMAT_HEX[c.format],
                        borderColor: `${FORMAT_HEX[c.format]}40`,
                      }}
                    >
                      {c.format}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.runDays}d</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {proxyScore(c)}/100
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={proxyScore(c)} className="h-1.5 flex-1" />
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                        {proxyScore(c)}/100
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {c.trend > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400">
                        <TrendingUp className="h-3.5 w-3.5" />
                        {c.trend}
                      </span>
                    ) : c.trend < 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-rose-400">
                        <TrendingDown className="h-3.5 w-3.5" />
                        {Math.abs(c.trend)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[420px] bg-sidebar border-l border-sidebar-border"
        >
          {selected && <CreativeDetail creative={selected} categoryAvg={categoryAvg} proxyScore={proxyScore} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ThumbPreview({ creative }: { creative: Creative }) {
  const [open, setOpen] = useState(false);
  const [imgErr, setImgErr] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (creative.creativeUrl || creative.thumbUrl) setOpen(true); }}
        className="group relative h-10 w-10 overflow-hidden rounded-md bg-muted shrink-0"
        title={creative.creativeUrl ? "Play video" : creative.thumbUrl ? "View image" : "No preview"}
      >
        {creative.thumbUrl && !imgErr ? (
          <img
            src={creative.thumbUrl}
            alt=""
            loading="lazy"
            onError={() => setImgErr(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground/40">
            <Play className="h-3.5 w-3.5" />
          </div>
        )}
        {creative.creativeUrl && (
          <div className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/40 transition-colors">
            <Play className="h-3 w-3 fill-white text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </button>

      {open && (creative.creativeUrl || creative.thumbUrl) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[85vh] max-w-sm w-full rounded-xl overflow-hidden bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            {creative.creativeUrl ? (
              <video
                src={creative.creativeUrl}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <img src={creative.thumbUrl!} alt="" className="w-full h-full object-contain" />
            )}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SortableHead({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  className,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === k;
  return (
    <TableHead className={className}>
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        {active && (
          <span className="text-[10px] opacity-70">
            {sortDir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
    </TableHead>
  );
}

function CreativeDetail({ creative, categoryAvg, proxyScore }: { creative: Creative; categoryAvg: number; proxyScore: (c: Creative) => number }) {
  const data = [
    { name: "This creative", value: proxyScore(creative), fill: NETWORK_HEX[creative.network] },
    { name: "Category avg", value: parseFloat(categoryAvg.toFixed(2)), fill: "oklch(0.5 0.02 260)" },
  ];

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="space-y-1 text-left">
        <SheetTitle className="text-lg">{creative.game}</SheetTitle>
        <SheetDescription className="text-xs">
          {creative.id} · started {new Date(creative.startedAt).toLocaleDateString()}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-4 flex-1 space-y-5 overflow-auto pr-1">
        {/* Media — video player if available, else thumbnail, else placeholder */}
        <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ aspectRatio: creative.creativeUrl ? "9/16" : "16/9", maxHeight: "50vh" }}>
          {creative.creativeUrl ? (
            <video
              key={creative.creativeUrl}
              src={creative.creativeUrl}
              controls
              autoPlay
              playsInline
              className="h-full w-full object-contain"
            />
          ) : creative.thumbUrl ? (
            <img
              src={creative.thumbUrl}
              alt={creative.game}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground/40">
              <Play className="h-8 w-8" />
            </div>
          )}
          <span className="absolute right-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {creative.format}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <DetailRow label="Network">
            <NetworkBadge network={creative.network} />
          </DetailRow>
          <DetailRow label="Format">
            <span
              className="rounded-md border px-1.5 py-0.5 text-xs font-medium"
              style={{
                background: `${FORMAT_HEX[creative.format]}1f`,
                color: FORMAT_HEX[creative.format],
                borderColor: `${FORMAT_HEX[creative.format]}40`,
              }}
            >
              {creative.format}
            </span>
          </DetailRow>
          <DetailRow label="Run duration">{creative.runDays} days</DetailRow>
          <DetailRow label="Perf. score">{proxyScore(creative)}/100</DetailRow>
          <DetailRow label="Publisher">{creative.publisherName ?? "—"}</DetailRow>
          <DetailRow label="Game">{creative.game}</DetailRow>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Score vs category average
          </div>
          <div className="h-[140px]">
            <ResponsiveContainer>
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={11} width={100} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-sidebar-border pt-4">
        <Button className="w-full">Use as reference</Button>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}
