import { expect, test } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";

test("fixture is the default and both demo buttons explicitly restore it", async ({ page }) => {
  await page.goto("/");
  const fixtures = page.getByTestId("catalog-source-fixtures");
  const channel3 = page.getByTestId("catalog-source-channel3");
  await expect(fixtures).toHaveAttribute("aria-pressed", "true");

  await channel3.click();
  await expect(channel3).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Coffee shop example · $800" }).click();
  await expect(fixtures).toHaveAttribute("aria-pressed", "true");

  await channel3.click();
  await page.getByTestId("incompatible-printer-example").click();
  await expect(fixtures).toHaveAttribute("aria-pressed", "true");
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
  await page.getByRole("button", { name: "Coffee shop example · $800" }).click();
  await page.getByTestId("submit-run").click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByTestId("catalog-source-result")).toHaveText("Demo fixtures");
  await expect(page.getByTestId("evidence-timeline")).toContainText("Catalog: Demo fixtures");

  const runId = page.url().split("/").at(-1)!;
  const response = await request.get(`/api/runs/${runId}`);
  const run = RunViewSchema.parse(await response.json());
  expect(run.catalogSource).toBe("fixtures");
});
