import { describe, expect, it, vi } from "vitest";
import type { ApprovedOrder } from "@/shared/contracts";
import {
  createPaymentExecutor,
  MockPayPalClient,
  PayPalClientError,
} from "@/modules/payment";
import { makeVerdict } from "./test-helpers";
import {
  InMemoryPaymentExecutionStore,
  makeApprovalContext,
  makeApprovedOrder,
  rehash,
} from "./test-helpers";

vi.mock("server-only", () => ({}));

function setup(handler?: ConstructorParameters<typeof MockPayPalClient>[0]) {
  const order = makeApprovedOrder();
  const store = new InMemoryPaymentExecutionStore(makeApprovalContext(order));
  const client = new MockPayPalClient(handler);
  const executor = createPaymentExecutor({
    store,
    paypalClient: client,
    pollIntervalMs: 1,
    waitTimeoutMs: 2_000,
  });
  return { order, store, client, executor };
}

describe("DeterministicPaymentExecutor", () => {
  it("creates one order for ALLOW and returns the persisted result on sequential retries", async () => {
    const { order, client, executor } = setup();
    const first = await executor.execute(order);
    const retries = await Promise.all([
      executor.execute(order),
      executor.execute(order),
      executor.execute(order),
    ]);

    expect(first.status).toBe("PAYPAL_CREATED");
    expect(first.paypalStatus).toBe("CREATED");
    expect(first.paypalOrderId).toMatch(/^MOCK-[A-F0-9]{24}$/);
    expect(retries).toEqual([first, first, first]);
    expect(client.oauthCalls).toBe(1);
    expect(client.ordersCalls).toBe(1);
    expect(client.requests[0]?.requestId).toBe(order.idempotencyKey);
    expect(Object.keys(first).sort()).toEqual([
      "createdAt",
      "paypalOrderId",
      "paypalStatus",
      "status",
      "updatedAt",
    ]);
  });

  it("uses one logical create and one result for 10 parallel executions", async () => {
    const { order, client, executor } = setup(async (_input, call) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { id: `ORDER-${call}`, status: "CREATED" };
    });

    const views = await Promise.all(Array.from({ length: 10 }, () => executor.execute(order)));

    expect(client.oauthCalls).toBe(1);
    expect(client.ordersCalls).toBe(1);
    expect(views.every((view) => view.paypalOrderId === "ORDER-1")).toBe(true);
    expect(new Set(views.map((view) => JSON.stringify(view))).size).toBe(1);
  });

  it("retries a retryable HTTP failure with the identical request ID and body", async () => {
    const { order, client, executor } = setup((_input, call) => {
      if (call === 1) throw new PayPalClientError("http", "PAYPAL_HTTP_503");
      return { id: "ORDER-AFTER-RETRY", status: "CREATED" };
    });

    const failed = await executor.execute(order);
    const succeeded = await executor.execute(order);
    await executor.execute(order);

    expect(failed).toMatchObject({ status: "PAYMENT_RETRYABLE", errorCode: "PAYPAL_HTTP_503" });
    expect(succeeded).toMatchObject({ status: "PAYPAL_CREATED", paypalOrderId: "ORDER-AFTER-RETRY" });
    expect(client.ordersCalls).toBe(2);
    expect(client.requests.map((request) => request.requestId)).toEqual([
      order.idempotencyKey,
      order.idempotencyKey,
    ]);
    expect(JSON.stringify(client.requests[0]?.payload)).toBe(JSON.stringify(client.requests[1]?.payload));
  });

  it("marks timeout UNKNOWN and retries with the same request ID and body", async () => {
    const { order, client, executor } = setup((_input, call) => {
      if (call === 1) throw new PayPalClientError("timeout", "PAYPAL_TIMEOUT");
      return { id: "ORDER-AFTER-TIMEOUT", status: "CREATED" };
    });

    const unknown = await executor.execute(order);
    const succeeded = await executor.execute(order);

    expect(unknown).toMatchObject({ status: "PAYMENT_UNKNOWN", errorCode: "PAYPAL_TIMEOUT" });
    expect(succeeded.status).toBe("PAYPAL_CREATED");
    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]).toEqual(client.requests[1]);
  });

  it.each([
    ["tampered approval hash", (order: ApprovedOrder) => ({ ...order, approvalHash: "f".repeat(64) })],
    ["tampered arithmetic", (order: ApprovedOrder) => rehash({
      ...order,
      total: { currency: "USD", amountMinor: order.total.amountMinor + 1 },
    })],
    ["BLOCK decision", (order: ApprovedOrder) => ({ ...order, verdictDecision: "BLOCK" })],
    ["REVIEW decision", (order: ApprovedOrder) => ({ ...order, verdictDecision: "REVIEW" })],
  ])("rejects %s before OAuth", async (_name, mutate) => {
    const { order, client, executor } = setup();
    const tampered = mutate(order) as ApprovedOrder;

    await expect(executor.execute(tampered)).rejects.toThrow();
    expect(client.oauthCalls).toBe(0);
    expect(client.ordersCalls).toBe(0);
  });

  it("rejects a changed persisted approval snapshot before OAuth", async () => {
    const { order, store, client, executor } = setup();
    store.context.approvedOrderJson = rehash({
      ...order,
      items: [{ ...order.items[0]!, name: "Changed after approval" }],
    });

    await expect(executor.execute(order)).rejects.toMatchObject({ code: "APPROVAL_SNAPSHOT_MISMATCH" });
    expect(client.oauthCalls).toBe(0);
    expect(client.ordersCalls).toBe(0);
  });

  it("rejects budget overage from the persisted mandate before OAuth", async () => {
    const { order, store, client, executor } = setup();
    store.context.mandateJson = { ...makeApprovalContext(order).mandateJson as object, budget: { currency: "USD", amountMinor: 1 } };

    await expect(executor.execute(order)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(client.oauthCalls).toBe(0);
    expect(client.ordersCalls).toBe(0);
  });

  it.each(["BLOCK", "REVIEW"] as const)("rejects a persisted %s verdict before OAuth", async (decision) => {
    const { order, store, client, executor } = setup();
    store.context.verdictJson = makeVerdict(order, decision);

    await expect(executor.execute(order)).rejects.toMatchObject({ code: "ORDER_NOT_APPROVABLE" });
    expect(client.oauthCalls).toBe(0);
    expect(client.ordersCalls).toBe(0);
  });

  it("requires reconciliation instead of blindly retrying an old UNKNOWN result", async () => {
    const { order, store, client, executor } = setup(() => {
      throw new PayPalClientError("timeout", "PAYPAL_TIMEOUT");
    });
    await executor.execute(order);
    store.record!.view.createdAt = "2020-01-01T00:00:00.000Z";

    await expect(executor.execute(order)).rejects.toMatchObject({
      code: "PAYMENT_RECONCILIATION_REQUIRED",
    });
    expect(client.oauthCalls).toBe(1);
    expect(client.ordersCalls).toBe(1);
  });

  it("returns only sanitized provider failures, never response bodies or thrown messages", async () => {
    const secret = "access-token-and-private-provider-body";
    const { order, executor } = setup(() => {
      throw new PayPalClientError("http", "PAYPAL_HTTP_500");
    });

    const view = await executor.execute(order);
    expect(view).toMatchObject({ status: "PAYMENT_RETRYABLE", errorCode: "PAYPAL_HTTP_500" });
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(Object.keys(view).sort()).toEqual(["createdAt", "errorCode", "status", "updatedAt"]);
  });

  it("sanitizes unexpected exceptions as PAYMENT_UNKNOWN", async () => {
    const { order, executor } = setup(() => {
      throw new Error("secret token must not escape");
    });

    const view = await executor.execute(order);
    expect(view).toEqual(expect.objectContaining({
      status: "PAYMENT_UNKNOWN",
      errorCode: "PAYPAL_REQUEST_UNKNOWN",
    }));
    expect(JSON.stringify(view)).not.toContain("secret token");
  });
});
