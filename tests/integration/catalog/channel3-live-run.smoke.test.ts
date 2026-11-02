import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { RunOrchestrator } from "@/modules/orchestration/run-orchestrator";

vi.mock("server-only", () => ({}));

describe.skipIf(process.env.CHANNEL3_LIVE_SMOKE !== "1")("Channel3 full-run live smoke", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("runs real catalog evidence through policy and simulated PayPal", async () => {
    expect(process.env.APP_MODE).toBe("replay");
    expect(process.env.PAYPAL_MODE).toBe("mock");

    const { run, created } = await new RunOrchestrator().createRun({
      goal: "Buy a point of sale tablet",
      budget: 80_000,
      constraints: [],
      catalogSource: "channel3",
    }, randomUUID());

    expect(created).toBe(true);
    expect(run.catalogSource).toBe("channel3");
    expect(run.replay).toBe(true);
    expect(run.proposedOrder?.items.length).toBeGreaterThan(0);
    expect(run.evidence.length).toBeGreaterThan(0);
    expect(run.evidence.every((record) => record.evidence.source.sourceClass === "aggregator")).toBe(true);
    expect(run.verdict?.decision).toMatch(/^(ALLOW|PARTIAL_ALLOW)$/);
    expect(run.approvedOrder?.items.length).toBeGreaterThan(0);
    expect(run.status).toBe("PAYPAL_CREATED");
    expect(run.payment).toMatchObject({ status: "PAYPAL_CREATED", paypalStatus: "CREATED" });
    expect(run.payment?.paypalOrderId).toMatch(/^MOCK-/);

    console.info("Channel3 full-run live smoke result:", JSON.stringify({
      runId: run.id,
      catalogSource: run.catalogSource,
      proposedItems: run.proposedOrder?.items.length,
      evidenceRecords: run.evidence.length,
      verdict: run.verdict?.decision,
      approvedItems: run.approvedOrder?.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        priceUsd: (item.unitPrice.amountMinor / 100).toFixed(2),
      })),
      approvedTotalUsd: run.approvedOrder ? (run.approvedOrder.total.amountMinor / 100).toFixed(2) : null,
      paymentStatus: run.payment?.status,
      paypalOrderId: run.payment?.paypalOrderId,
    }));
  }, 90_000);
});
