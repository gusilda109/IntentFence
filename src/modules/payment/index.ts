import { systemClock, type PaymentExecutorPort } from "@/shared/ports";
import { DeterministicPaymentExecutor } from "./executor";
import { createPayPalClientFromEnv } from "./server/paypal-client-factory";
import { PrismaPaymentExecutionStore } from "./server/prisma-payment-execution-store";
import type { PaymentExecutionStore, PayPalClient } from "./types";
import type { Clock } from "@/shared/ports";

export interface CreatePaymentExecutorOptions {
  store?: PaymentExecutionStore;
  paypalClient?: PayPalClient;
  clock?: Clock;
  leaseDurationMs?: number;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
}

export function createPaymentExecutor(options: CreatePaymentExecutorOptions = {}): PaymentExecutorPort {
  return new DeterministicPaymentExecutor({
    store: options.store ?? new PrismaPaymentExecutionStore(),
    paypalClient: options.paypalClient ?? createPayPalClientFromEnv(),
    clock: options.clock ?? systemClock,
    leaseDurationMs: options.leaseDurationMs,
    pollIntervalMs: options.pollIntervalMs,
    waitTimeoutMs: options.waitTimeoutMs,
  });
}

export { PrismaPaymentExecutionStore } from "./server/prisma-payment-execution-store";
export { MockPayPalClient } from "./server/mock-paypal-client";
export { PaymentExecutorError } from "./errors";
export { PayPalClientError } from "./types";
export type {
  PaymentExecutionStore,
  PaymentExecutionRecord,
  PaymentLease,
  PaymentSettlement,
  AcquirePaymentExecutionResult,
  PayPalClient,
  PayPalOrderPayload,
  CreatePayPalOrderInput,
  PayPalOrderResult,
} from "./types";
