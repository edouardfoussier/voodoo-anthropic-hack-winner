import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { WeeklyReport } from "@/components/dashboard/WeeklyReport";

export const Route = createFileRoute("/weekly")({
  head: () => ({
    meta: [
      { title: "Weekly Market Brief — VoodRadar" },
      {
        name: "description",
        content:
          "Aggregated view of every Gemini-deconstructed mobile-game ad — what's running this week, by hook type.",
      },
    ],
  }),
  component: WeeklyPage,
});

function WeeklyPage() {
  return (
    <DashboardLayout title="Weekly Market Brief">
      <WeeklyReport />
    </DashboardLayout>
  );
}
