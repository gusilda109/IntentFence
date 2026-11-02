import { sha256 } from "@/server/canonical-json";
import {
  type ApprovedOrder,
  type Mandate,
  type PaymentExecutionView,
  type Verdict,
} from "@/shared/contracts";
import {
  validatePersistedApprovalContext,
  type PersistedApprovalContext,
} from "@/modules/payment/approval-context";
import { paymentError } from "@/modules/payment/errors";
import { assertAutomaticUnknownRetryAllowed } from "@/modules/payment/retry-policy";
import type {
  AcquirePaymentExecutionResult,
  PaymentExecutionRecord,
  PaymentExecutionStore,
  PaymentLease,
  PaymentSettlement,
} from "@/modules/payment/types";

export const orderId = "11111111-1111-4111-8111-111111111111";
export const mandateId = "22222222-2222-4222-8222-222222222222";
export const proposedOrderId = "33333333-3333-4333-8333-333333333333";
export const verdictId = "44444444-4444-4444-8444-444444444444";
export const itemId = "55555555-5555-4555-8555-555555555555";
export const idempotencyKey = "66666666-6666-4666-8666-666666666666";

export function makeApprovedOrder(overrides: Partial<ApprovedOrder> = {}): ApprovedOrder {
  const base = {
    schemaVersion: "1",
    id: orderId,
    mandateId,
    proposedOrderId,
    verdictId,
    verdictDecision: "ALLOW",
    items: [{
      sourceItemId: itemId,
      storeId: "tablet-hub",
      productUrl: "https://stores.local/tablet-hub/tablet",
      name: "Point of sale tablet",
      quantity: 2,
      unitPrice: { currency: "USD", amountMinor: 12_345 },
    }],
    total: { currency: "USD", amountMinor: 24_690 },
    approvalHash: "0".repeat(64),
    idempotencyKey,
    createdAt: "2026-01-01T00:00:00.000Z",
  } satisfies ApprovedOrder;
  return rehash({ ...base, ...overrides });
}

export function rehash(order: ApprovedOrder): ApprovedOrder {
  return {
    ...order,
    approvalHash: sha256({
      mandateId: order.mandateId,
      proposedOrderId: order.proposedOrderId,
      verdictId: order.verdictId,
      items: order.items,
      total: order.total,
    }),
  };
}

export function makeMandate(order: ApprovedOrder, budget = 80_000): Mandate {
  return {
    schemaVersion: "1",
    id: order.mandateId,
    goal: "Equip the coffee shop point of sale",
    budget: { currency: "USD", amountMinor: budget },
    constraints: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeVerdict(order: ApprovedOrder, decision: Verdict["decision"] = "ALLOW"): Verdict {
  return {
    schemaVersion: "1",
    id: order.verdictId,
    mandateId: order.mandateId,
    proposedOrderId: order.proposedOrderId,
    decision,
    itemDecisions: order.items.map((item) => ({
      itemId: item.sourceItemId,
      decision: decision === "BLOCK" ? "BLOCK" : decision === "REVIEW" ? "REVIEW" : "ALLOW",
      reasons: [],
    })),
    findings: [],
    summary: "Deterministic test verdict",
    policyVersion: "test-1",
    inputHash: "a".repeat(64),
    evaluatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeApprovalContext(order: ApprovedOrder): PersistedApprovalContext {
  return {
    status: "APPROVED",
    mandateJson: makeMandate(order),
    verdictJson: makeVerdict(order),
    approvedOrderJson: structuredClone(order),
    approvalHash: order.approvalHash,
  };
}

interface MemoryRecord extends PaymentExecutionRecord {
  approvedOrderId: string;
  approvalHash: string;
  paypalRequestId: string;
}

/** Atomic in-memory store for unit tests; production uniqueness is covered by Prisma integration tests. */
export class InMemoryPaymentExecutionStore implements PaymentExecutionStore {
  record: MemoryRecord | null = null;

  constructor(public context: PersistedApprovalContext) {}

  async acquire(order: ApprovedOrder, lease: PaymentLease): Promise<AcquirePaymentExecutionResult> {
    validatePersistedApprovalContext(order, this.context);
    if (!this.record) {
      this.record = {
        approvedOrderId: order.id,
        approvalHash: order.approvalHash,
        paypalRequestId: order.idempotencyKey,
        leaseToken: null,
        leaseExpiresAt: null,
        view: pendingView(lease.now),
      };
    }
    const record = this.record;
    if (record.approvalHash !== order.approvalHash || record.paypalRequestId !== order.idempotencyKey) {
      throw paymentError("PAYMENT_STATE_CONFLICT");
    }
    if (record.view.paypalOrderId) return { kind: "complete", view: cloneView(record.view) };
    assertAutomaticUnknownRetryAllowed(record.view, lease.now);
    if (record.leaseToken && (!record.leaseExpiresAt || record.leaseExpiresAt > lease.now)) {
      return {
        kind: "busy",
        leaseToken: record.leaseToken,
        view: cloneView(record.view),
      };
    }

    record.leaseToken = lease.token;
    record.leaseExpiresAt = new Date(lease.expiresAt);
    record.view = { ...record.view, status: "PAYMENT_PENDING", errorCode: undefined, updatedAt: lease.now.toISOString() };
    return { kind: "acquired", leaseToken: lease.token };
  }

  async get(approvedOrderId: string): Promise<PaymentExecutionRecord | null> {
    if (!this.record || this.record.approvedOrderId !== approvedOrderId) return null;
    return {
      view: cloneView(this.record.view),
      leaseToken: this.record.leaseToken,
      leaseExpiresAt: this.record.leaseExpiresAt ? new Date(this.record.leaseExpiresAt) : null,
    };
  }

  async settle(
    approvedOrderId: string,
    leaseToken: string,
    settlement: PaymentSettlement,
  ): Promise<PaymentExecutionView> {
    const record = this.record;
    if (!record || record.approvedOrderId !== approvedOrderId || record.leaseToken !== leaseToken) {
      throw paymentError("PAYMENT_LEASE_LOST");
    }
    const updatedAt = new Date().toISOString();
    record.view = settlement.status === "PAYPAL_CREATED"
      ? {
          status: settlement.status,
          paypalOrderId: settlement.paypalOrderId,
          paypalStatus: settlement.paypalStatus,
          ...(settlement.approveUrl ? { approveUrl: settlement.approveUrl } : {}),
          createdAt: record.view.createdAt,
          updatedAt,
        }
      : {
          status: settlement.status,
          errorCode: settlement.errorCode,
          createdAt: record.view.createdAt,
          updatedAt,
        };
    record.leaseToken = null;
    record.leaseExpiresAt = null;
    return cloneView(record.view);
  }
}

function pendingView(now: Date): PaymentExecutionView {
  return {
    status: "PAYMENT_PENDING",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function cloneView(view: PaymentExecutionView): PaymentExecutionView {
  return structuredClone(view);
}
