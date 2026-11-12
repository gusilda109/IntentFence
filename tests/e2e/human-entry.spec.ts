import { expect, test, type Page } from "@playwright/test";
import { RunViewSchema } from "../../src/shared/contracts/index.js";
import { expectRunRegions } from "./support.js";

async function loadCoffeeReplay(page: Page) {
  await page.getByTestId("catalog-source-fixtures").click();
  await page.getByTestId("goal-input").fill("Set up a coffee shop checkout based on a tablet");
  await page.getByTestId("budget-input").fill("800");
}

function createRunResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/runs",
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) - root.clientWidth;
  })).toBeLessThanOrEqual(0);
}

test("desktop home exposes the human entry and starts the coffee replay", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: "What can we help you buy?",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Let’s start with what you need",
    exact: true,
  })).toBeVisible();
  await expect(page.getByLabel("What do you need?", { exact: true })).toBeVisible();
  await expect(page.getByLabel("What’s your spending limit?", { exact: true })).toBeVisible();

  for (const testId of [
    "mandate-form",
    "catalog-source-fixtures",
    "catalog-source-channel3",
    "goal-input",
    "budget-input",
    "channel3-example-home-office-mouse",
    "channel3-example-home-podcast-microphone",
    "channel3-example-college-laptop-requirements",
    "channel3-example-unclear-online-audio",
    "submit-run",
  ]) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  const submit = page.getByTestId("submit-run");
  await expect(page.getByRole("button", {
    name: "Review my purchase",
    exact: true,
  })).toBeVisible();

  await loadCoffeeReplay(page);
  await expect(page.getByTestId("goal-input")).toHaveValue(/coffee shop/i);
  await expect(page.getByTestId("budget-input")).toHaveValue("800");

  const responsePromise = createRunResponse(page);
  await submit.click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const run = RunViewSchema.parse(await response.json());
  expect(run.replay).toBe(true);

  await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`));
  await expect(page.getByRole("heading", {
    name: "Your purchase review",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Decision & reasoning",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Recommended items",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Evidence behind the recommendation",
    exact: true,
  })).toBeVisible();
  await expectRunRegions(page);
});

test("mobile home and coffee run stay within the viewport and keep controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const goal = page.getByTestId("goal-input");
  const budget = page.getByTestId("budget-input");
  const submit = page.getByTestId("submit-run");
  const channel3Example = page.getByTestId("channel3-example-home-office-mouse");

  await expectNoHorizontalOverflow(page);
  await expect(goal).toBeVisible();
  await expect(goal).toBeEditable();
  await expect(budget).toBeVisible();
  await expect(budget).toBeEditable();
  await expect(channel3Example).toBeVisible();
  await expect(channel3Example).toBeEnabled();
  await expect(submit).toBeVisible();
  await expect(submit).toBeEnabled();

  await loadCoffeeReplay(page);
  await expect(goal).toHaveValue(/coffee shop/i);
  await expect(budget).toHaveValue("800");

  const responsePromise = createRunResponse(page);
  await submit.click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const run = RunViewSchema.parse(await response.json());
  expect(run.replay).toBe(true);

  await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`));
  await expectRunRegions(page);
  await expectNoHorizontalOverflow(page);

  const refresh = page.getByRole("button", { name: "Refresh run snapshot", exact: true });
  await expect(refresh).toBeVisible();
  await expect(refresh).toBeEnabled();
  const refreshResponsePromise = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === `/api/runs/${run.id}`,
  );
  await refresh.click();
  expect((await refreshResponsePromise).status()).toBe(200);
  await expect(refresh).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

test("a delayed create request keeps submit disabled and does not duplicate the POST", async ({ page }) => {
  let createPostCount = 0;
  let releaseCreate!: () => void;
  const createDelay = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });

  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createPostCount += 1;
    await createDelay;
    await route.continue();
  });

  await page.goto("/");
  await loadCoffeeReplay(page);
  const submit = page.getByTestId("submit-run");
  const responsePromise = createRunResponse(page);

  await submit.dblclick();
  await expect(submit).toBeDisabled();
  const status = page.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText(/review|purchase|evidence|order/i);
  expect(createPostCount).toBe(1);

  releaseCreate();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/runs\//);
  expect(createPostCount).toBe(1);
});

test("an empty form shows validation instead of starting a run", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("submit-run").click();

  const error = page.locator(".form-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/need|goal|purchase/i);
  await expect(page).toHaveURL("/");
});
