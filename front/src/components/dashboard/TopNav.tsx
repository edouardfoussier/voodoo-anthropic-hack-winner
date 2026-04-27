import { Calendar, ChevronDown, Sparkles, PanelLeftOpen } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERIOD_OPTIONS, useGame } from "@/lib/game-context";

interface TopNavProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function TopNav({ sidebarOpen = true, onToggleSidebar }: TopNavProps) {
  const { periodLabel, setPeriodByLabel } = useGame();
  const navigate = useNavigate();

  function launchAnalysis() {
    navigate({ to: "/insights", search: { launch: "1" } as never });
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-4 gap-3">
      {!sidebarOpen && onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
              <Calendar className="h-3.5 w-3.5" />
              <span>{periodLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {PERIOD_OPTIONS.map((r) => (
              <DropdownMenuItem key={r.label} onClick={() => setPeriodByLabel(r.label)}>
                {r.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          onClick={launchAnalysis}
          className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Launch new analysis
        </Button>
      </div>
    </header>
  );
}
