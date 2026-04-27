import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { VoodooPortfolio } from "@/components/dashboard/VoodooPortfolio";

export const Route = createFileRoute("/voodoo")({
  head: () => ({
    meta: [
      { title: "Voodoo Portfolio — Voodoo" },
      {
        name: "description",
        content:
          "Voodoo's top mobile games with their currently-running ad creatives across SensorTower-tracked networks.",
      },
    ],
  }),
  component: VoodooPortfolioPage,
});

function VoodooPortfolioPage() {
  return (
    <DashboardLayout title="Voodoo Portfolio">
      <VoodooPortfolio />
    </DashboardLayout>
  );
}
