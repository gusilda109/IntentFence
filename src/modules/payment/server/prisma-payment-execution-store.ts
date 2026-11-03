import "server-only";
import type { PaymentExecution, PrismaClient } from "@prisma/client";
import {
  PaymentExecutionViewSchema,
  type ApprovedOrder,
  type PaymentExecutionView,
} from "@/shared/contracts";
import { db } from "@/server/db";
import { validatePersistedApprovalContext } from "../approval-context";
import { paymentError } from "../errors";
import { assertAutomaticUnknownRetryAllowed } from "../retry-policy";
import type {
  AcquirePaymentExecutionResult,
  PaymentExecutionRecord,
  PaymentExecutionStore,
  PaymentLease,
  PaymentSettlement,
} from "../types";

// SQLite has one writer. Serialize interactive transactions in-process so queued
// BEGIN IMMEDIATE statements cannot occupy every Prisma worker and starve COMMIT.
let transactionQueue: Promise<void> = Promise.resolve();

function serializeTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const result = transactionQueue.then(operation, operation);
  transactionQueue = result.then(() => undefined, () => undefined);
  return result;
}

export class PrismaPaymentExecutionStore implements PaymentExecutionStore {
  constructor(private readonly prisma: PrismaClient = db) {}

  async acquire(order: ApprovedOrder, lease: PaymentLease): Promise<AcquirePaymentExecutionResult> {
    return serializeTransaction(() => this.prisma.$transaction(async (tx) => {
      const run = await tx.run.findUnique({
        where: { approvedOrderId: order.id },
        include: { payment: true },
      });
      if (!run) throw paymentError("APPROVAL_NOT_FOUND");

      validatePersistedApprovalContext(order, {
        status: run.status,
        mandateJson: run.mandateJson,
        verdictJson: run.verdictJson,
        approvedOrderJson: run.approvedOrderJson,
        approvalHash: run.approvalHash,
      });

      // Unique approvedOrderId/runId/paypalRequestId make this a single logical execution.
      let execution = run.payment ?? await tx.paymentExecution.upsert({
        where: { approvedOrderId: order.id },
        create: {
          runId: run.id,
          approvedOrderId: order.id,
          approvalHash: order.approvalHash,
          paypalRequestId: order.idempotencyKey,
          status: "PAYMENT_PENDING",
        },
        update: {},
      });
      assertExecutionMatches(order, execution.runId, run.id, execution);

      if (execution.paypalOrderId) {
        return { kind: "complete", view: toPaymentView(execution) };
      }
      assertAutomaticUnknownRetryAllowed(toPaymentView(execution), lease.now);
      if (isLeaseActive(execution, lease.now)) {
        return {
          kind: "busy",
          leaseToken: execution.leaseToken,
          view: toPaymentView(execution),
        };
      }

      // This conditional update is the cross-process lease; a local mutex is not sufficient.
      const claimed = await tx.paymentExecution.updateMany({
        where: {
          id: execution.id,
          paypalOrderId: null,
          OR: [
            { leaseToken: null },
            { leaseExpiresAt: { lte: lease.now } },
          ],
        },
        data: {
          leaseToken: lease.token,
          leaseExpiresAt: lease.expiresAt,
          status: "PAYMENT_PENDING",
          errorCode: null,
        },
      });

      if (claimed.count === 1) {
        await tx.run.update({ where: { id: run.id }, data: { status: "PAYMENT_PENDING" } });
        return { kind: "acquired", leaseToken: lease.token };
      }

      execution = await tx.paymentExecution.findUniqueOrThrow({ where: { id: execution.id } });
      if (execution.paypalOrderId) {
        return { kind: "complete", view: toPaymentView(execution) };
      }
      return {
        kind: "busy",
        leaseToken: execution.leaseToken,
        view: toPaymentView(execution),
      };
    }, { maxWait: 10_000, timeout: 15_000 }));
  }

  async get(approvedOrderId: string): Promise<PaymentExecutionRecord | null> {
    const execution = await this.prisma.paymentExecution.findUnique({ where: { approvedOrderId } });
    return execution ? toPaymentRecord(execution) : null;
  }

  async settle(
    approvedOrderId: string,
    leaseToken: string,
    settlement: PaymentSettlement,
  ): Promise<PaymentExecutionView> {
    return serializeTransaction(() => this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentExecution.findUnique({ where: { approvedOrderId } });
      if (!current) throw paymentError("PAYMENT_STATE_CONFLICT");

      const updated = await tx.paymentExecution.updateMany({
        where: { id: current.id, leaseToken, paypalOrderId: null },
        data: {
          status: settlement.status,
          paypalOrderId: settlement.status === "PAYPAL_CREATED" ? settlement.paypalOrderId : null,
          paypalStatus: settlement.status === "PAYPAL_CREATED" ? settlement.paypalStatus : null,
          approveUrl: settlement.status === "PAYPAL_CREATED" ? settlement.approveUrl ?? null : null,
          errorCode: settlement.status === "PAYPAL_CREATED" ? null : settlement.errorCode,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });

      if (updated.count === 0) {
        if (current.paypalOrderId) return toPaymentView(current);
        throw paymentError("PAYMENT_LEASE_LOST");
      }

      await tx.run.update({ where: { id: current.runId }, data: { status: settlement.status } });
      const execution = await tx.paymentExecution.findUniqueOrThrow({ where: { id: current.id } });
      return toPaymentView(execution);
    }));
  }
}

function assertExecutionMatches(
  order: ApprovedOrder,
  executionRunId: string,
  runId: string,
  execution: PaymentExecution,
): void {
  if (
    executionRunId !== runId
    || execution.approvalHash !== order.approvalHash
    || execution.paypalRequestId !== order.idempotencyKey
  ) {
    throw paymentError("PAYMENT_STATE_CONFLICT");
  }
}

function isLeaseActive(execution: PaymentExecution, now: Date): boolean {
  if (!execution.leaseToken) return false;
  return execution.leaseExpiresAt === null || execution.leaseExpiresAt > now;
}

function toPaymentRecord(execution: PaymentExecution): PaymentExecutionRecord {
  return {
    view: toPaymentView(execution),
    leaseToken: execution.leaseToken,
    leaseExpiresAt: execution.leaseExpiresAt,
  };
}

function toPaymentView(execution: PaymentExecution): PaymentExecutionView {
  return PaymentExecutionViewSchema.parse({
    status: execution.status,
    ...(execution.paypalOrderId ? { paypalOrderId: execution.paypalOrderId } : {}),
    ...(execution.paypalStatus ? { paypalStatus: execution.paypalStatus } : {}),
    ...(execution.approveUrl ? { approveUrl: execution.approveUrl } : {}),
    ...(execution.errorCode ? { errorCode: execution.errorCode } : {}),
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  });
}
