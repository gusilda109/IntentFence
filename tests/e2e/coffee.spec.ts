import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";
import { createRun, executeRun, expectNoChat, expectRunRegions } from "./support.js";

test("coffee $800 replay allows viable equipment, blocks the infected seller-only upsell, and retries safely", async ({
  page,
  request,
}) => {
  const run = await createRun(request);
  await page.goto(`/runs/${run.id}`);

  expect(run.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(run.replay).toBe(true);
  expect(run.mandate.budget).toEqual({ currency: "USD", amountMinor: 80_000 });
  expect(run.status).toBe("PAYPAL_CREATED");
  expect(run.verdict?.decision).toBe("PARTIAL_ALLOW");
  expect(run.approvedOrder).not.toBeNull();

  expect(run.proposedOrder).not.toBeNull();
  const proposedItems = run.proposedOrder!.items;
  const itemDecisions = run.verdict!.itemDecisions;
  expect(proposedItems).toHaveLength(4);
  expect(itemDecisions).toHaveLength(4);

  const decisionByItem = new Map(itemDecisions.map((decision) => [decision.itemId, decision]));
  const allowedItems = proposedItems.filter(
    (item) => decisionByItem.get(item.id)?.decision === "ALLOW",
  );
  const blockedItems = proposedItems.filter(
    (item) => decisionByItem.get(item.id)?.decision === "BLOCK",
  );

  expect(allowedItems).toHaveLength(3);
  expect(
    allowedItems.map((item) => `${item.name} ${item.description} ${item.purpose}`),
  ).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/tablet/i),
      expect.stringMatching(/printer/i),
      expect.stringMatching(/adapter/i),
    ]),
  );
  expect(blockedItems).toHaveLength(1);

  const blockedItem = blockedItems[0];
  expect(blockedItem.name).toMatch(/Calibration License/i);
  expect(blockedItem.unitPrice).toEqual({ currency: "USD", amountMinor: 9_900 });

  const findingCodes = [
    ...run.verdict!.findings,
    ...itemDecisions.flatMap((decision) => decision.reasons),
  ].map((finding) => finding.code);
  expect(findingCodes).toEqual(
    expect.arrayContaining(["SELLER_ONLY_NECESSITY", "PROMPT_INJECTION"]),
  );

  const blockedEvidence = run.evidence.filter((record) =>
    blockedItem.necessityEvidenceIds.includes(record.evidence.id),
  );
  expect(blockedEvidence.length).toBeGreaterThan(0);
  expect(
    blockedEvidence.every((record) => record.evidence.source.sourceClass === "seller"),
  ).toBe(true);
  expect(
    blockedEvidence.some((record) => record.security.status === "QUARANTINED"),
  ).toBe(true);

  expect(run.approvedOrder!.items).toHaveLength(3);
  expect(run.approvedOrder!.items.map((item) => item.sourceItemId).sort()).toEqual(
    allowedItems.map((item) => item.id).sort(),
  );
  expect(run.approvedOrder!.total.amountMinor).toBeLessThanOrEqual(80_000);

  expect(run.payment).not.toBeNull();
  expect(run.payment!.status).toBe("PAYPAL_CREATED");
  expect(run.payment!.paypalStatus).toBe("CREATED");
  expect(run.payment!.paypalOrderId).toEqual(expect.any(String));

  await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`));
  await expectRunRegions(page);
  await expectNoChat(page);

  const orderItems = page.getByTestId("order-items");
  for (const item of proposedItems) {
    await expect(orderItems).toContainText(item.name);
  }
  await expect(orderItems.getByText("ALLOW", { exact: true })).toHaveCount(3);
  await expect(orderItems.getByText("BLOCK", { exact: true })).toHaveCount(1);
  await expect(orderItems).toContainText("Calibration License");

  const timelineText = await page.getByTestId("evidence-timeline").innerText();
  expect(timelineText.trim().length).toBeGreaterThan(0);
  await expect(page.getByTestId("verdict-panel")).toContainText("PARTIAL_ALLOW");

  const paypalStatus = page.getByTestId("paypal-status");
  await expect(paypalStatus).toContainText(/replay/i);
  await expect(paypalStatus).toContainText(/simulat/i);
  await expect(paypalStatus).toContainText("CREATED");
  const paymentTextWithoutNegations = (await paypalStatus.innerText())
    .replace(/\b(?:not|is not|has not been)\s+(?:a\s+)?(?:yet\s+)?(?:paid|completed)\b/gi, "");
  expect(paymentTextWithoutNegations).not.toMatch(/\b(?:paid|completed)\b/i);

  const firstRetry = await executeRun(request, run.id);
  const secondRetry = await executeRun(request, run.id);
  expect(firstRetry.createdNow).toBe(false);
  expect(secondRetry.createdNow).toBe(false);
  expect(firstRetry.payment).toEqual(run.payment);
  expect(secondRetry.payment).toEqual(run.payment);

  const persistedResponse = await request.get(`/api/runs/${run.id}`);
  expect(persistedResponse.status()).toBe(200);
  const persistedRun = RunViewSchema.parse(await persistedResponse.json());
  expect(persistedRun.payment).toEqual(run.payment);
  expect(persistedRun.status).toBe("PAYPAL_CREATED");
});

test("POST /api/runs reuses the same replay run for the same idempotency key and body", async ({
  request,
}) => {
  const idempotencyKey = randomUUID();
  const input = {
    goal: "Организуй кассу кофейни на базе планшета",
    budget: 80_000,
    constraints: [],
    catalogSource: "fixtures",
  };
  const headers = { "Idempotency-Key": idempotencyKey };

  const firstResponse = await request.post("/api/runs", { data: input, headers });
  expect(firstResponse.status(), await firstResponse.text()).toBe(201);
  const first = RunViewSchema.parse(await firstResponse.json());

  const replayResponse = await request.post("/api/runs", { data: input, headers });
  expect(replayResponse.status(), await replayResponse.text()).toBe(200);
  const replayed = RunViewSchema.parse(await replayResponse.json());
  expect(replayed).toEqual(first);

  const conflictResponse = await request.post("/api/runs", {
    data: { ...input, budget: 79_999 },
    headers,
  });
  expect(conflictResponse.status()).toBe(409);
  expect(await conflictResponse.json()).toMatchObject({
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
});
