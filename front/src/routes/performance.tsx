import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { PerformanceSignals } from "@/components/dashboard/PerformanceSignals";

export const Route = createFileRoute("/performance")({
  head: () => ({
    meta: [
      { title: "Performance Signals — Voodoo" },
      { name: "description", content: "Top creatives, performance scores, and run-vs-impressions analysis." },
    ],
  }),
  component: PerformancePage,
});

function PerformancePage() {
  return (
    <DashboardLayout title="Performance Signals">
      <PerformanceSignals />
    </DashboardLayout>
  );
}
