import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Insights } from "@/components/dashboard/Insights";

interface InsightsSearch {
  /** When ``"1"``, the page auto-opens the LaunchAnalysisModal on mount.
   *  Used by the navbar's "Launch new analysis" CTA. */
  launch?: string;
}

export const Route = createFileRoute("/insights")({
  validateSearch: (search): InsightsSearch => ({
    launch: typeof search.launch === "string" ? search.launch : undefined,
  }),
  component: InsightsPage,
});

function InsightsPage() {
  const { launch } = Route.useSearch();
  return (
    <DashboardLayout title="Insights">
      <Insights autoLaunch={launch === "1"} />
    </DashboardLayout>
  );
}
