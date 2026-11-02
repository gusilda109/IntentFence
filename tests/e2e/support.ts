import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import {
  PaymentExecutionViewSchema,
  RunViewSchema,
  type CreateRunInput,
  type RunView,
} from "../../src/shared/contracts/index.js";

export const coffeeRunInput = {
  goal: "Организуй кассу кофейни на базе планшета",
  budget: 80_000,
  constraints: [],
  catalogSource: "fixtures",
} satisfies CreateRunInput;

export function coffeeInput(overrides: Partial<CreateRunInput> = {}): CreateRunInput {
  return { ...coffeeRunInput, ...overrides };
}

export async function createRun(
  request: APIRequestContext,
  input: CreateRunInput = coffeeInput(),
): Promise<RunView> {
  const response = await request.post("/api/runs", {
    data: input,
    headers: { "Idempotency-Key": randomUUID() },
  });
  expect(response.status(), await response.text()).toBe(201);
  return RunViewSchema.parse(await response.json());
}

const ExecuteResponseSchema = z.object({
  payment: PaymentExecutionViewSchema,
  createdNow: z.boolean(),
}).strict();

export async function executeRun(request: APIRequestContext, runId: string) {
  const response = await request.post(`/api/runs/${runId}/execute`);
  expect(response.status(), await response.text()).toBe(200);
  return ExecuteResponseSchema.parse(await response.json());
}

export async function expectRunRegions(page: Page) {
  await expect(page.getByTestId("order-items")).toBeVisible();
  await expect(page.getByTestId("evidence-timeline")).toBeVisible();
  await expect(page.getByTestId("verdict-panel")).toBeVisible();
  await expect(page.getByTestId("paypal-status")).toBeVisible();
}

export async function expectNoChat(page: Page) {
  await expect(page.locator('[data-testid*="chat" i]')).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: /chat|message|model prompt|transcript/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^chat$|conversation|model transcript/i }),
  ).toHaveCount(0);
}
