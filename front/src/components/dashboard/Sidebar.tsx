import { Link } from "@tanstack/react-router";
import {
  LayoutGrid,
  Activity,
  Target,
  Sparkles,
  Compass,
  Gamepad2,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGame } from "@/lib/game-context";

interface SubItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}
interface Section {
  label: string;
  items: SubItem[];
}

/**
 * Three sections following the PM's mental model:
 *   Portfolio  — my games + AI insights (core daily workflow)
 *   Intelligence — ad library + competitive landscape
 *   Market     — performance signals + geo spend map
 */
const SECTIONS: Section[] = [
  {
    label: "Portfolio",
    items: [
      { label: "My Games", to: "/voodoo", icon: Gamepad2 },
      { label: "Ad Library", to: "/ads", icon: LayoutGrid },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Weekly Brief", to: "/weekly", icon: Newspaper },
      { label: "Insights", to: "/insights", icon: Sparkles },
      { label: "Performance Signals", to: "/performance", icon: Activity },
    ],
  },
  {
    label: "Market study",
    items: [
      { label: "Competitive Scope", to: "/competitive", icon: Target },
      { label: "Global Market Map", to: "/geo", icon: Compass },
    ],
  },
];

interface SidebarProps {
  activePath: string;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ activePath, collapsed, onToggle }: SidebarProps) {
  const { setGameName } = useGame();

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-14" : "w-60"
      )}
    >
      {/* Logo + collapse toggle. Logo is a link to the home/landing
          page so users can always click "out" of any nested view. */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-3 gap-2">
        <Link
          to="/"
          onClick={() => setGameName("")}
          className="flex items-center gap-2 flex-1 min-w-0 rounded-md transition-opacity hover:opacity-80"
          aria-label="VoodRadar — back to home"
          title="Back to home"
        >
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white font-black"
            style={{ background: "#0f172a", fontSize: "1.1rem", lineHeight: 1 }}
            aria-hidden
          >
            V
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
                VoodRadar
              </span>
              <span className="text-[10px] text-sidebar-foreground/50">
                by Voodoo
              </span>
            </div>
          )}
        </Link>
        <button
          onClick={onToggle}
          className="ml-auto shrink-0 p-1 rounded-md text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-5 overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                {section.label}
              </p>
            )}
            {collapsed && (
              <div className="mb-1.5 mx-2 h-px bg-sidebar-border" />
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.to === activePath;
                const isInsightsTab = item.to === "/insights";
                return (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      onClick={() => { if (isInsightsTab) setGameName(""); }}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-primary font-medium"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive ? "text-sidebar-primary" : "text-sidebar-foreground/40"
                        )}
                      />
                      {!collapsed && item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom branding */}
      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <p className="text-[10px] text-sidebar-foreground/40">© 2026 Voodoo · VoodRadar</p>
        </div>
      )}
    </aside>
  );
}
