import { randomUUID } from "node:crypto";
import type { ApprovedOrder, PaymentExecutionView } from "@/shared/contracts";
import { systemClock, type Clock, type PaymentExecutorPort } from "@/shared/ports";
import { validateApprovedOrder } from "./approval-context";
import { paymentError } from "./errors";
import { buildPayPalOrderPayload } from "./payload";
import { assertAutomaticUnknownRetryAllowed } from "./retry-policy";
import {
  PayPalClientError,
  type PaymentExecutionStore,
  type PaymentSettlement,
  type PayPalClient,
} from "./types";

export interface DeterministicPaymentExecutorOptions {
  store: PaymentExecutionStore;
  paypalClient: PayPalClient;
  clock?: Clock;
  leaseDurationMs?: number;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
}

export class DeterministicPaymentExecutor implements PaymentExecutorPort {
  private readonly clock: Clock;
  private readonly leaseDurationMs: number;
  private readonly pollIntervalMs: number;
  private readonly waitTimeoutMs: number;

  constructor(private readonly options: DeterministicPaymentExecutorOptions) {
    this.clock = options.clock ?? systemClock;
    this.leaseDurationMs = positiveDuration(options.leaseDurationMs, 60_000);
    this.pollIntervalMs = positiveDuration(options.pollIntervalMs, 25);
    this.waitTimeoutMs = positiveDuration(options.waitTimeoutMs, 65_000);
  }

  async execute(input: ApprovedOrder): Promise<PaymentExecutionView> {
    // This performs schema, arithmetic and approval-hash checks before any store or PayPal call.
    const order = validateApprovedOrder(input);
    const payload = buildPayPalOrderPayload(order);
    const now = this.clock.now();
    const existing = await this.options.store.get(order.id);
    if (existing) assertAutomaticUnknownRetryAllowed(existing.view, now);
    const leaseToken = randomUUID();
    const acquisition = await this.options.store.acquire(order, {
      token: leaseToken,
      now,
      expiresAt: new Date(now.getTime() + this.leaseDurationMs),
    });

    if (acquisition.kind === "complete") return acquisition.view;
    if (acquisition.kind === "busy") {
      return this.waitForOwner(order.id, acquisition.leaseToken, acquisition.view);
    }

    let settlement: PaymentSettlement;
    try {
      const result = await this.options.paypalClient.createOrder({
        requestId: order.idempotencyKey,
        payload,
      });
      settlement = {
        status: "PAYPAL_CREATED",
        paypalOrderId: result.id,
        paypalStatus: result.status,
        ...(result.approveUrl ? { approveUrl: result.approveUrl } : {}),
      };
    } catch (error) {
      settlement = sanitizeClientFailure(error);
    }

    return this.options.store.settle(order.id, leaseToken, settlement);
  }

  private async waitForOwner(
    approvedOrderId: string,
    observedLeaseToken: string | null,
    initialView: PaymentExecutionView,
  ): Promise<PaymentExecutionView> {
    if (observedLeaseToken === null) return initialView;

    const deadline = Date.now() + this.waitTimeoutMs;
    let latestView = initialView;
    while (Date.now() < deadline) {
      await delay(this.pollIntervalMs);
      const current = await this.options.store.get(approvedOrderId);
      if (!current) throw paymentError("PAYMENT_STATE_CONFLICT");
      latestView = current.view;
      if (
        current.view.paypalOrderId
        || current.leaseToken === null
        || current.leaseToken !== observedLeaseToken
      ) {
        return current.view;
      }
    }
    return latestView;
  }
}

function sanitizeClientFailure(error: unknown): PaymentSettlement {
  if (error instanceof PayPalClientError && error.kind === "http") {
    return { status: "PAYMENT_RETRYABLE", errorCode: safeErrorCode(error.code) };
  }
  if (error instanceof PayPalClientError) {
    return { status: "PAYMENT_UNKNOWN", errorCode: safeErrorCode(error.code) };
  }
  return { status: "PAYMENT_UNKNOWN", errorCode: "PAYPAL_REQUEST_UNKNOWN" };
}

function safeErrorCode(code: string): string {
  return /^[A-Z0-9_]{1,100}$/.test(code) ? code : "PAYPAL_REQUEST_UNKNOWN";
}

function positiveDuration(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw paymentError("PAYMENT_CONFIGURATION_INVALID");
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
