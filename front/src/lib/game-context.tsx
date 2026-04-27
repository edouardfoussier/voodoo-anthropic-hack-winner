import { createContext, useContext, useState } from "react";

/**
 * App-wide period selection driven by the TopNav time dropdown.
 *
 * Values map to the SensorTower ``period`` query param:
 * - ``week``    → Last 7 days (default — favours the Weekly Brief
 *                 narrative + keeps Ad Library focused on freshly
 *                 trending creatives)
 * - ``month``   → Last 30 days
 * - ``quarter`` → Last 90 days OR Year-to-date (front sets period_date
 *                 = Jan 1 in YTD mode, but the SensorTower bucket is
 *                 still ``quarter``)
 */
export type PeriodValue = "week" | "month" | "quarter";

export const PERIOD_OPTIONS: { label: string; value: PeriodValue; ytd?: boolean }[] = [
  { label: "Last 7 days", value: "week" },
  { label: "Last 30 days", value: "month" },
  { label: "Last 90 days", value: "quarter" },
  { label: "Year to date", value: "quarter", ytd: true },
];

interface GameContextValue {
  gameName: string;
  setGameName: (name: string) => void;
  period: PeriodValue;
  periodLabel: string;
  setPeriodByLabel: (label: string) => void;
}

const GameContext = createContext<GameContextValue>({
  gameName: "",
  setGameName: () => {},
  period: "month",
  periodLabel: "Last 7 days",
  setPeriodByLabel: () => {},
});

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameName, setGameName] = useState("");
  const [periodLabel, setPeriodLabel] = useState<string>("Last 7 days");
  const period = (PERIOD_OPTIONS.find((p) => p.label === periodLabel)?.value ??
    "month") as PeriodValue;

  function setPeriodByLabel(label: string) {
    setPeriodLabel(label);
  }

  return (
    <GameContext.Provider
      value={{ gameName, setGameName, period, periodLabel, setPeriodByLabel }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
