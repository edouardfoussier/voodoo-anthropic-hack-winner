import { ChevronDown, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReportSummary } from "@/types/hooklens";
import { formatGenerated } from "./utils";

interface ReportPickerProps {
  reports: ReportSummary[];
  currentName: string;
  onPick: (name: string) => void;
}

export function ReportPicker({ reports, currentName, onPick }: ReportPickerProps) {
  if (!reports.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <History className="h-3.5 w-3.5 opacity-70" />
          <span className="text-muted-foreground">Cached reports</span>
          <span className="font-semibold">{reports.length}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[280px]">
        <DropdownMenuLabel className="text-xs">
          Cached analyses
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {reports.map((r) => (
          <DropdownMenuItem
            key={r.app_id}
            onClick={() => onPick(r.name)}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span
                className={`text-sm font-medium ${
                  r.name === currentName ? "text-primary" : ""
                }`}
              >
                {r.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {r.num_archetypes}a · {r.num_variants}v
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {formatGenerated(r.generated_at)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
