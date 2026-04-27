import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GeoHeatmap } from "@/components/dashboard/GeoHeatmap";

export const Route = createFileRoute("/geo")({
  head: () => ({
    meta: [
      { title: "Global Market Map — Voodoo" },
      { name: "description", content: "Dot-grid heatmap of mobile ad market intensity across 34 countries." },
    ],
  }),
  component: GeoPage,
});

function GeoPage() {
  return (
    <DashboardLayout title="Global Market Map">
      <GeoHeatmap />
    </DashboardLayout>
  );
}
