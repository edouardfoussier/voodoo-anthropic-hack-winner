/**
 * Colored, accessible progress bar primitive used to surface the three
 * NON-OBVIOUS signals (velocity, derivative_spread, freshness) in
 * ArchetypesTable. The shadcn `<Progress>` is locked to `bg-primary`,
 * so we render a small custom bar that takes an explicit hex color.
 */
interface SignalBarProps {
  label: string;
  value: number;
  pct: number;
  color: string;
  formatValue?: (v: number) => string;
  ariaLabel?: string;
}

export function SignalBar({
  label,
  value,
  pct,
  color,
  formatValue,
  ariaLabel,
}: SignalBarProps) {
  const display = formatValue ? formatValue(value) : value.toFixed(2);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className="text-xs font-semibold tabular-nums"
          style={{ color }}
        >
          {display}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}
