import { expect, test } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";
import { CHANNEL3_EXAMPLES } from "../../src/components/channel3-examples.js";

test("every real Channel3 example fills its mandate and selects the live catalog", async ({ page }) => {
  await page.goto("/");
  const fixtures = page.getByTestId("catalog-source-fixtures");
  const channel3 = page.getByTestId("catalog-source-channel3");
  await expect(fixtures).toHaveAttribute("aria-pressed", "true");

  for (const example of CHANNEL3_EXAMPLES) {
    await page.getByTestId(`channel3-example-${example.id}`).click();
    await expect(channel3).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("goal-input")).toHaveValue(example.goal);
    await expect(page.getByTestId("budget-input")).toHaveValue(example.budget);
    await expect(page.locator(".constraint-row")).toHaveCount(example.constraints.length);
  }
});

test("unconfigured Channel3 returns a readable error without fixture fallback", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("catalog-source-channel3").click();
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
  await expect(page.getByTestId("catalog-source-channel3")).toHaveAttribute("aria-pressed", "true");
});

test("fixture run persists and displays its selected catalog source", async ({ page, request }) => {
  await page.goto("/");
  await page.getByTestId("goal-input").fill("Set up a coffee shop checkout based on a tablet");
  await page.getByTestId("budget-input").fill("800");
  await page.getByTestId("submit-run").click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByTestId("catalog-source-result")).toHaveText("Demo fixtures");
  await expect(page.getByTestId("evidence-timeline")).toContainText("Catalog: Demo fixtures");

  const runId = page.url().split("/").at(-1)!;
  const response = await request.get(`/api/runs/${runId}`);
  const run = RunViewSchema.parse(await response.json());
  expect(run.catalogSource).toBe("fixtures");
});
