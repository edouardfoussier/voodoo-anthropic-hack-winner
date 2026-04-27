import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { CompetitiveScope } from "@/components/dashboard/CompetitiveScope";

export const Route = createFileRoute("/competitive")({
  head: () => ({
    meta: [
      { title: "Competitive Scope — Voodoo" },
      { name: "description", content: "Tracked competitor games with rank, spend tier, and status." },
    ],
  }),
  component: CompetitivePage,
});

function CompetitivePage() {
  return (
    <DashboardLayout title="Competitive Scope">
      <CompetitiveScope />
    </DashboardLayout>
  );
}
