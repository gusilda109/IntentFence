import type { Metadata } from "next";
import { RunDashboard } from "@/components/run-dashboard";

export const metadata: Metadata = {
  title: "Purchase review",
};

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDashboard runId={runId} />;
}
