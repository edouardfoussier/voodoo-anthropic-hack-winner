import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { AdLibrary } from "@/components/dashboard/AdLibrary";

export const Route = createFileRoute("/ads")({
  head: () => ({
    meta: [
      { title: "Ad Library — VoodRadar" },
      { name: "description", content: "Browse competitor ad creatives across networks and formats." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <DashboardLayout title="Ad Library">
      <AdLibrary />
    </DashboardLayout>
  );
}
