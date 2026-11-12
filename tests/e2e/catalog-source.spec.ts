import { expect, test } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";
import { CHANNEL3_EXAMPLES } from "../../src/components/channel3-examples.js";
import { createRun } from "./support.js";

test("Channel3 is the only product source and every real example fills its mandate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("catalog-source-channel3")).toHaveText("Live products · Channel3");
  await expect(page.getByTestId("catalog-source-fixtures")).toHaveCount(0);

  for (const example of CHANNEL3_EXAMPLES) {
    await page.getByTestId(`channel3-example-${example.id}`).click();
    await expect(page.getByTestId("goal-input")).toHaveValue(example.goal);
    await expect(page.getByTestId("budget-input")).toHaveValue(example.budget);
    await expect(page.locator(".constraint-row")).toHaveCount(example.constraints.length);
  }
});

test("unconfigured Channel3 returns a readable error without fixture fallback", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("goal-input").fill("Buy a point of sale tablet");
  await page.getByTestId("budget-input").fill("800");

  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/runs");
  await page.getByTestId("submit-run").click();
  const response = await responsePromise;

  expect(response.status()).toBe(503);
  expect(response.request().postDataJSON()).toMatchObject({ catalogSource: "channel3" });
  const payload = await response.json();
  expect(payload.error.code).toBe("CHANNEL3_UNAVAILABLE");
  expect(JSON.stringify(payload)).not.toContain("x-api-key");
  await expect(page.locator(".form-error")).toContainText("Channel3 is not configured");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("catalog-source-channel3")).toBeVisible();
});

test("a saved fixture run remains readable as an internal regression fixture", async ({ page, request }) => {
  const run = await createRun(request);
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByTestId("catalog-source-result")).toHaveText("Demo fixtures");
  await expect(page.getByTestId("evidence-timeline")).toContainText("Catalog: Demo fixtures");

  const response = await request.get(`/api/runs/${run.id}`);
  const persistedRun = RunViewSchema.parse(await response.json());
  expect(persistedRun.catalogSource).toBe("fixtures");
});
