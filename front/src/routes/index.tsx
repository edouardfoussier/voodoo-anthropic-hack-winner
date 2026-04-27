import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Sparkles, LayoutGrid, Target, Compass, ArrowRight } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { useReportList, useVoodooPortfolio } from "@/lib/api";
import { useGame } from "@/lib/game-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "VoodRadar — Mobile Ad Intelligence" }],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const { setGameName } = useGame();
  const [query, setQuery] = useState("");
  const { data: reports } = useReportList();
  const { data: portfolio } = useVoodooPortfolio(50);

  const totalAds = portfolio?.apps.reduce((s, a) => s + a.ads_total, 0) ?? 0;
  const totalGames = portfolio?.apps.length ?? 0;
  const totalArchetypes = reports?.reduce((s, r) => s + r.num_archetypes, 0) ?? 0;

  function launch(name: string) {
    if (!name.trim()) return;
    setGameName(name.trim());
    navigate({ to: "/insights", search: { launch: "1" } as never });
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-12 py-8">

        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Voodoo Hack 2026 · Track 3
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            Vood<span className="text-indigo-600">Radar</span>
          </h1>
          <p className="text-base text-slate-500 max-w-xl mx-auto">
            Scan competitor mobile-game ads, detect breakout creative
            archetypes, and generate ready-to-test briefs — in seconds.
          </p>
        </div>

        {/* Search / launch */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && launch(query)}
                placeholder="e.g. Candy Crush Saga, Subway Surfers…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
              />
            </div>
            <Button
              onClick={() => launch(query)}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5"
            >
              <Sparkles className="h-4 w-4" />
              Analyze
            </Button>
          </div>

          {/* Recent reports as quick-pick chips */}
          {reports && reports.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-slate-400 self-center">Recent:</span>
              {reports.slice(0, 6).map((r) => (
                <button
                  key={r.app_id}
                  onClick={() => launch(r.name)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
                >
                  {r.icon_url && (
                    <img src={r.icon_url} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" />
                  )}
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Voodoo games tracked", value: totalGames, color: "text-indigo-600" },
            { label: "Live ads scanned", value: totalAds.toLocaleString(), color: "text-emerald-600" },
            { label: "Archetypes detected", value: totalArchetypes, color: "text-violet-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
              <div className={`text-3xl font-bold tabular-nums ${color}`}>{value}</div>
              <div className="mt-1 text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        {/* Quick-access cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              icon: LayoutGrid,
              title: "Ad Library",
              desc: "Browse every competitor creative by network.",
              to: "/ads",
            },
            {
              icon: Target,
              title: "Competitive Scope",
              desc: "Who spends what, where and on which network.",
              to: "/competitive",
            },
            {
              icon: Compass,
              title: "Global Market Map",
              desc: "Worldwide UA spend intensity heatmap.",
              to: "/geo",
            },
          ].map(({ icon: Icon, title, desc, to }) => (
            <button
              key={to}
              onClick={() => navigate({ to })}
              className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <Icon className="h-5 w-5 text-indigo-400 group-hover:text-indigo-600 transition-colors" />
              <div className="mt-2 text-sm font-semibold text-slate-800">{title}</div>
              <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
              <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
                Open <ArrowRight className="h-3 w-3" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
