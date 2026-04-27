/**
 * Configure-then-launch dialog for a HookLens pipeline run.
 *
 * Mentor guidance baked in: GLOBAL by default (all networks × all curated
 * countries) so Gemini sees the broadest hook diversity and clusters get
 * granular. Filters exist to drill down later.
 *
 * On submit, this modal closes and the parent opens RunAnalysisDialog with
 * the assembled (gameName, config) tuple.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, Loader2, PlayCircle, Search, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { PipelineRunConfig } from "./RunAnalysisDialog";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

/** Mirror of `app/pipeline.py` ALL_NETWORKS — order matters for display. */
const NETWORK_OPTIONS = ["TikTok", "Facebook", "Instagram"] as const;
type NetworkOption = (typeof NETWORK_OPTIONS)[number];

/** Mirror of `app/pipeline.py` ALL_COUNTRIES. */
const COUNTRY_OPTIONS: { code: string; flag: string; label: string }[] = [
  { code: "US", flag: "🇺🇸", label: "United States" },
  { code: "GB", flag: "🇬🇧", label: "United Kingdom" },
  { code: "DE", flag: "🇩🇪", label: "Germany" },
  { code: "FR", flag: "🇫🇷", label: "France" },
  { code: "JP", flag: "🇯🇵", label: "Japan" },
  { code: "BR", flag: "🇧🇷", label: "Brazil" },
  { code: "KR", flag: "🇰🇷", label: "South Korea" },
];

const PERIOD_OPTIONS = [
  { value: "month", label: "Last 30 days" },
  { value: "week", label: "Last 7 days" },
  { value: "quarter", label: "Last 90 days" },
];

interface VoodooApp {
  app_id: string;
  name: string;
  publisher_name: string;
  icon_url: string;
  categories: (number | string)[];
  description?: string;
}

/**
 * iOS App Store game category IDs (from docs/sensortower-api.md §9.1).
 * 6014 = Games root, 7001–7019 = sub-genres. Voodoo's catalog includes a few
 * non-game apps (e.g. BeReal, social) — filtering these out keeps the
 * modal's quick-pick row demo-relevant.
 */
const IOS_GAME_CATEGORY_IDS = new Set<number>([
  6014, 7001, 7002, 7003, 7004, 7005, 7006, 7009, 7011, 7012, 7013, 7014, 7015,
  7016, 7017, 7018, 7019,
]);

function isGameApp(app: VoodooApp): boolean {
  return app.categories.some((c) => {
    const n = typeof c === "number" ? c : Number(c);
    return Number.isFinite(n) && IOS_GAME_CATEGORY_IDS.has(n);
  });
}

interface CachedReport {
  app_id: string;
  name: string;
  num_archetypes: number;
  num_variants: number;
}

interface LaunchAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialGameName?: string;
  initialConfig?: Partial<PipelineRunConfig> & { period?: string };
  /** Called with the user's choice on Launch click. Modal closes itself. */
  onLaunch: (
    gameName: string,
    config: PipelineRunConfig & { period: string },
  ) => void;
}

export function LaunchAnalysisModal({
  open,
  onOpenChange,
  initialGameName = "",
  initialConfig,
  onLaunch,
}: LaunchAnalysisModalProps) {
  const [gameName, setGameName] = useState(initialGameName);
  const [networks, setNetworks] = useState<NetworkOption[] | "all">(
    initialConfig?.networks?.[0] === "all" || !initialConfig?.networks
      ? "all"
      : (initialConfig.networks as NetworkOption[]),
  );
  const [countries, setCountries] = useState<string[] | "all">(
    initialConfig?.countries?.[0] === "all" || !initialConfig?.countries
      ? "all"
      : initialConfig.countries,
  );
  const [period, setPeriod] = useState(initialConfig?.period ?? "month");
  const [maxCreatives, setMaxCreatives] = useState(initialConfig?.maxCreatives ?? 8);
  const [topKArchetypes, setTopKArchetypes] = useState(
    initialConfig?.topKArchetypes ?? 5,
  );
  const [topKVariants, setTopKVariants] = useState(
    initialConfig?.topKVariants ?? 3,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reset to current props each time the modal re-opens — supports re-run flow.
  useEffect(() => {
    if (open) {
      setGameName(initialGameName);
    }
  }, [open, initialGameName]);

  const { data: voodooApps = [], isLoading: voodooLoading, isError: voodooError } =
    useQuery<VoodooApp[]>({
      queryKey: ["voodooApps"],
      queryFn: async () => {
        const res = await fetch(`${API_BASE}/api/voodoo/apps`);
        if (!res.ok) throw new Error(`API → ${res.status}`);
        return res.json() as Promise<VoodooApp[]>;
      },
      staleTime: 30 * 60 * 1000,
      retry: 1,
      // Don't error-toast — the endpoint may not exist yet (sub-agent shipping).
      // We just fall back to cached-reports suggestions in that case.
    });

  const { data: cachedReports = [] } = useQuery<CachedReport[]>({
    queryKey: ["reports"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/reports`);
      if (!res.ok) throw new Error(`API → ${res.status}`);
      return res.json() as Promise<CachedReport[]>;
    },
    staleTime: 60 * 1000,
  });

  const trimmed = gameName.trim();

  // Filter Voodoo apps to mobile games only (drops BeReal & friends), then
  // narrow further by the user's typing.
  const filteredVoodooApps = useMemo(() => {
    if (!voodooApps.length) return [] as VoodooApp[];
    const games = voodooApps.filter(isGameApp);
    if (!trimmed) return games.slice(0, 8);
    const q = trimmed.toLowerCase();
    return games.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [voodooApps, trimmed]);

  function handleSubmit() {
    if (!trimmed) return;
    const cfg: PipelineRunConfig & { period: string } = {
      countries: countries === "all" ? ["all"] : countries,
      networks: networks === "all" ? ["all"] : networks,
      maxCreatives,
      topKArchetypes,
      topKVariants,
      period,
    };
    onLaunch(trimmed, cfg);
  }

  const submitDisabled = !trimmed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Launch new analysis
          </DialogTitle>
          <DialogDescription>
            Pick a game and (optionally) narrow the market scan. Default is
            worldwide × all networks — broader signal for finer Gemini
            clusters.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-5">
          {/* Game name + Voodoo autocomplete */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Game
            </label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
                placeholder="Game name… (e.g. Mob Control)"
                className="h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>

            {voodooLoading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading Voodoo catalog…
              </p>
            )}

            {!voodooLoading && filteredVoodooApps.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Voodoo titles
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {filteredVoodooApps.map((app) => (
                    <button
                      key={app.app_id}
                      type="button"
                      onClick={() => setGameName(app.name)}
                      className="group flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      {app.icon_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={app.icon_url}
                          alt=""
                          className="h-4 w-4 rounded-sm"
                        />
                      ) : null}
                      <span className="font-medium">{app.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Fallback when Voodoo catalog is unavailable — surface the
                cached reports as a sane suggestion list. */}
            {!voodooLoading && voodooError && cachedReports.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Recently analyzed
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {cachedReports.slice(0, 6).map((r) => (
                    <button
                      key={r.app_id}
                      type="button"
                      onClick={() => setGameName(r.name)}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Networks */}
          <ScopeChips
            label="Networks"
            allLabel="All networks"
            options={NETWORK_OPTIONS as readonly string[]}
            value={networks === "all" ? "all" : (networks as string[])}
            onChange={(v) =>
              setNetworks(v === "all" ? "all" : (v as NetworkOption[]))
            }
          />

          {/* Countries */}
          <ScopeChips
            label="Countries"
            allLabel="All countries"
            allIcon={<Globe className="h-3.5 w-3.5" />}
            options={COUNTRY_OPTIONS.map((c) => c.code)}
            renderOption={(code) => {
              const c = COUNTRY_OPTIONS.find((o) => o.code === code);
              return c ? `${c.flag} ${c.code}` : code;
            }}
            value={countries === "all" ? "all" : countries}
            onChange={(v) => setCountries(v === "all" ? "all" : v)}
          />

          {/* Briefs preset (presented as a 3-way segmented control because
              this decision matters more for run cost / focus than the rest) */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Briefs to generate
            </label>
            <div className="mt-1.5 inline-flex rounded-md border border-border bg-card p-0.5">
              {[
                { v: 1, label: "Focus", help: "Top archetype only · 1 brief, fastest" },
                { v: 3, label: "Multi", help: "Top 3 archetypes · 3 briefs (default)" },
                { v: 5, label: "Wide", help: "Top 5 archetypes · 5 briefs" },
              ].map((opt) => {
                const active = topKVariants === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setTopKVariants(opt.v)}
                    title={opt.help}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                    <span className="ml-1 text-[10px] opacity-80">×{opt.v}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {topKVariants === 1
                ? "Generates a single brief on the top-scoring market hook (fastest, cheapest)."
                : `Generates ${topKVariants} briefs across the highest-scoring archetypes — useful for A/B testing.`}
            </p>
          </div>

          {/* Period */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Period
            </label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="mt-1.5 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Advanced */}
          <details
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Advanced
            </summary>
            <div className="mt-3 space-y-4 rounded-md border border-border bg-muted/20 p-4">
              <SliderRow
                label="Max creatives to deconstruct"
                value={maxCreatives}
                onChange={setMaxCreatives}
                min={4}
                max={16}
                step={1}
                help="Higher → richer clusters but slower (Gemini is the bottleneck). 8 is the sweet spot."
              />
              <SliderRow
                label="Top archetypes to surface"
                value={topKArchetypes}
                onChange={setTopKArchetypes}
                min={3}
                max={8}
                step={1}
                help="How many distinct creative patterns we score against your Game DNA."
              />
              <SliderRow
                label="Briefs to generate (fine-grained)"
                value={topKVariants}
                onChange={setTopKVariants}
                min={1}
                max={5}
                step={1}
                help="Same as the Briefs segmented control above. Slide for non-preset values (e.g. 2 or 4)."
              />
            </div>
          </details>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitDisabled}>
            <PlayCircle className="mr-1.5 h-4 w-4" />
            Launch analysis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScopeChipsProps {
  label: string;
  allLabel: string;
  allIcon?: React.ReactNode;
  options: readonly string[];
  value: "all" | string[];
  onChange: (v: "all" | string[]) => void;
  renderOption?: (v: string) => string;
}

/**
 * Multi-select pill row with an "All" toggle on the left. Picking "All"
 * clears the list. Picking any individual option turns "All" off.
 */
function ScopeChips({
  label,
  allLabel,
  allIcon,
  options,
  value,
  onChange,
  renderOption,
}: ScopeChipsProps) {
  const isAll = value === "all";
  const set = isAll ? new Set<string>() : new Set(value);

  function toggle(opt: string) {
    const next = new Set(set);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next.size === 0 || next.size === options.length ? "all" : Array.from(next));
  }

  return (
    <div>
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            isAll
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
          )}
        >
          {allIcon}
          {allLabel}
        </button>
        <span className="text-muted-foreground/50">|</span>
        {options.map((opt) => {
          const active = set.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {renderOption ? renderOption(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  help?: string;
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  help,
}: SliderRowProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-primary">
          {value}
        </span>
      </div>
      <Slider
        className="mt-2"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
      {help && <p className="mt-1.5 text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}
