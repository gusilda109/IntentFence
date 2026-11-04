import { expect, test } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";
import {
  coffeeInput,
  createRun,
  expectNoChat,
  expectRunRegions,
} from "./support.js";

test("an over-budget coffee run is BLOCK and cannot reach payment execution", async ({
  page,
  request,
}) => {
  const run = await createRun(request, coffeeInput({ budget: 100 }));

  expect(run.replay).toBe(true);
  expect(run.status).toBe("BLOCKED");
  expect(run.verdict?.decision).toBe("BLOCK");
  expect(run.approvedOrder).toBeNull();
  expect(run.payment).toBeNull();
  expect(
    [
      ...(run.verdict?.findings ?? []),
      ...(run.verdict?.itemDecisions.flatMap((decision) => decision.reasons) ?? []),
    ].some((finding) => finding.code === "BUDGET_EXCEEDED"),
  ).toBe(true);

  await page.goto(`/runs/${run.id}`);
  await expectRunRegions(page);
  await expectNoChat(page);
  await expect(page.getByTestId("verdict-panel")).toContainText("BLOCK");
  await expect(page.getByTestId("paypal-status")).toContainText(/NOT_REQUESTED|not requested/i);

  const executeResponse = await request.post(`/api/runs/${run.id}/execute`);
  expect(executeResponse.status()).toBe(409);
  expect(await executeResponse.json()).toMatchObject({
    error: { code: "RUN_NOT_APPROVABLE" },
  });
});

test("an over-budget coffee replay pays only the exact-budget equipment subset", async ({
  request,
}) => {
  const run = await createRun(request, coffeeInput({ budget: 55_700 }));

  expect(run.replay).toBe(true);
  expect(run.status).toBe("PAYPAL_CREATED");
  expect(run.verdict?.decision).toBe("PARTIAL_ALLOW");
  expect(run.proposedOrder?.total.amountMinor).toBe(65_600);
  expect(run.approvedOrder?.total.amountMinor).toBe(55_700);
  expect(run.payment?.status).toBe("PAYPAL_CREATED");

  const proposedItems = run.proposedOrder!.items;
  const itemDecisions = run.verdict!.itemDecisions;
  const decisionByItem = new Map(itemDecisions.map((decision) => [decision.itemId, decision]));
  const allowedItems = proposedItems.filter((item) =>
    decisionByItem.get(item.id)?.decision === "ALLOW");
  expect(allowedItems.map((item) => item.name)).toEqual(expect.arrayContaining([
    "HubTab S10",
    "RP-80 Thermal Receipt Printer",
    "LinkBridge USB-C Receipt Adapter",
  ]));
  expect(allowedItems).toHaveLength(3);

  const license = proposedItems.find((item) => item.name === "Calibration License");
  expect(license).toBeDefined();
  const licenseDecision = decisionByItem.get(license!.id);
  expect(licenseDecision?.decision).toBe("BLOCK");
  expect(licenseDecision?.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
    "SELLER_ONLY_NECESSITY",
    "PROMPT_INJECTION",
  ]));
  expect(run.approvedOrder!.items.map((item) => item.sourceItemId).sort()).toEqual(
    allowedItems.map((item) => item.id).sort(),
  );
  expect(run.verdict!.findings.some((finding) =>
    finding.code === "BUDGET_EXCEEDED" && finding.itemId === undefined)).toBe(true);
});

test("a hard human-review constraint yields REVIEW and prevents automatic payment", async ({
  page,
  request,
}) => {
  const run = await createRun(
    request,
    coffeeInput({
      constraints: [
        {
          text: "Require human review before any purchase; do not create an order automatically.",
          enforcement: "hard",
        },
      ],
    }),
  );

  expect(run.replay).toBe(true);
  expect(run.status).toBe("REVIEW_REQUIRED");
  expect(run.verdict?.decision).toBe("REVIEW");
  expect(run.approvedOrder).toBeNull();
  expect(run.payment).toBeNull();

  await page.goto(`/runs/${run.id}`);
  await expectRunRegions(page);
  await expectNoChat(page);
  await expect(page.getByTestId("verdict-panel")).toContainText("REVIEW");
  await expect(page.getByTestId("paypal-status")).toContainText(/NOT_REQUESTED|not requested/i);

  const executeResponse = await request.post(`/api/runs/${run.id}/execute`);
  expect(executeResponse.status()).toBe(409);
  expect(await executeResponse.json()).toMatchObject({
    error: { code: "RUN_NOT_APPROVABLE" },
  });
});

test("the incompatible printer demo blocks payment with manufacturer evidence", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByTestId("incompatible-printer-example").click();
  await expect(page.getByTestId("budget-input")).toHaveValue("250");

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/runs",
  );
  await page.getByTestId("submit-run").click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const run = RunViewSchema.parse(await createResponse.json());

  expect(run.replay).toBe(true);
  expect(run.status).toBe("BLOCKED");
  expect(run.verdict?.decision).toBe("BLOCK");
  expect(run.verdict?.itemDecisions).toHaveLength(1);
  expect(run.verdict?.itemDecisions[0].reasons.map((reason) => reason.code)).toContain("INCOMPATIBLE");
  expect(run.approvedOrder).toBeNull();
  expect(run.payment).toBeNull();

  await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`));
  await expectRunRegions(page);
  await expectNoChat(page);
  await expect(page.getByTestId("order-items")).toContainText("RP-90 Serial Receipt Printer");
  await expect(page.getByTestId("order-items")).toContainText("INCOMPATIBLE");
  await expect(page.getByTestId("evidence-timeline")).toContainText(/incompatible/i);
  await expect(page.getByTestId("paypal-status")).toContainText(/NOT_REQUESTED|not requested/i);

  const executeResponse = await request.post(`/api/runs/${run.id}/execute`);
  expect(executeResponse.status()).toBe(409);
  expect(await executeResponse.json()).toMatchObject({
    error: { code: "RUN_NOT_APPROVABLE" },
  });
});
