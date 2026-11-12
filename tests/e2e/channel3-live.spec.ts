import { expect, test } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";
import { expectRunRegions } from "./support";

test.skip(process.env.CHANNEL3_UI_LIVE_SMOKE !== "1", "Explicit opt-in is required for live Channel3 and PayPal Sandbox requests.");

test("Channel3 UI run creates an uncaptured PayPal Sandbox order", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("goal-input").fill("Buy a tablet");
  await page.getByTestId("budget-input").fill("800");

  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/runs",
  { timeout: 240_000 });
  await page.getByTestId("submit-run").click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const run = RunViewSchema.parse(await response.json());

  await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`));
  await expectRunRegions(page);
  await expect(page.getByTestId("catalog-source-result")).toHaveText("Channel3 · live data");
  await expect(page.getByTestId("evidence-timeline")).toContainText("Catalog: Channel3 · live data");
  await expect(page.getByTestId("paypal-status")).toContainText("PayPal Sandbox");
  await expect(page.getByTestId("paypal-status")).toContainText("Sandbox order created");
  await expect(page.getByTestId("paypal-status")).toContainText("NOT captured");

  expect(run.replay).toBe(false);
  expect(run.catalogSource).toBe("channel3");
  expect(run.evidence.length).toBeGreaterThan(0);
  expect(run.evidence.every((record) => record.evidence.source.sourceClass === "aggregator")).toBe(true);
  expect(run.verdict?.decision).toMatch(/^(ALLOW|PARTIAL_ALLOW)$/);
  expect(run.payment).toMatchObject({ status: "PAYPAL_CREATED", paypalStatus: "CREATED" });
  expect(run.payment?.paypalOrderId).toBeTruthy();
  expect(run.payment?.paypalOrderId).not.toMatch(/^MOCK-/);
  expect(run.payment?.approveUrl).toBeTruthy();
  expect(new URL(run.payment!.approveUrl!).hostname.endsWith("sandbox.paypal.com")).toBe(true);
  await expect(page.getByTestId("paypal-status")).toContainText(run.payment!.paypalOrderId!);

  console.info("Channel3 UI live smoke result:", JSON.stringify({
    runId: run.id,
    verdict: run.verdict?.decision,
    proposedItems: run.proposedOrder?.items.length,
    approvedItems: run.approvedOrder?.items.length,
    evidenceRecords: run.evidence.length,
    paymentStatus: run.payment?.status,
    paypalOrderId: run.payment?.paypalOrderId,
    paypalStatus: run.payment?.paypalStatus,
    captured: false,
  }));
});
