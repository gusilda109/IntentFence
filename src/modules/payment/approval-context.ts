import {
  ApprovedOrderSchema,
  MandateSchema,
  VerdictSchema,
  type ApprovedOrder,
} from "@/shared/contracts";
import { canonicalJson, sha256 } from "@/server/canonical-json";
import { paymentError } from "./errors";

export interface PersistedApprovalContext {
  status: string;
  mandateJson: unknown;
  verdictJson: unknown;
  approvedOrderJson: unknown;
  approvalHash: string | null;
}

const payableRunStatuses = new Set([
  "APPROVED",
  "PAYMENT_PENDING",
  "PAYPAL_CREATED",
  "PAYMENT_RETRYABLE",
  "PAYMENT_UNKNOWN",
]);

export function validateApprovedOrder(input: ApprovedOrder): ApprovedOrder {
  const parsed = ApprovedOrderSchema.safeParse(input);
  if (!parsed.success) throw paymentError("INVALID_APPROVED_ORDER");

  const order = parsed.data;
  if (new Set(order.items.map((item) => item.sourceItemId)).size !== order.items.length) {
    throw paymentError("INVALID_APPROVED_ORDER");
  }

  const calculatedTotal = order.items.reduce(
    (sum, item) => sum + item.unitPrice.amountMinor * item.quantity,
    0,
  );
  if (calculatedTotal !== order.total.amountMinor) {
    throw paymentError("INVALID_ARITHMETIC");
  }

  const expectedHash = sha256({
    mandateId: order.mandateId,
    proposedOrderId: order.proposedOrderId,
    verdictId: order.verdictId,
    items: order.items,
    total: order.total,
  });
  if (expectedHash !== order.approvalHash) {
    throw paymentError("APPROVAL_HASH_MISMATCH");
  }

  return order;
}

/** Re-check the immutable server-side authorization, never just caller-provided data. */
export function validatePersistedApprovalContext(
  order: ApprovedOrder,
  context: PersistedApprovalContext,
): void {
  if (context.status === "BLOCKED" || context.status === "REVIEW_REQUIRED") {
    throw paymentError("ORDER_NOT_APPROVABLE");
  }
  if (!payableRunStatuses.has(context.status)) {
    throw paymentError("APPROVAL_CONTEXT_INVALID");
  }

  const persistedResult = ApprovedOrderSchema.safeParse(context.approvedOrderJson);
  if (!persistedResult.success || canonicalJson(persistedResult.data) !== canonicalJson(order)) {
    throw paymentError("APPROVAL_SNAPSHOT_MISMATCH");
  }
  if (context.approvalHash !== order.approvalHash) {
    throw paymentError("APPROVAL_HASH_MISMATCH");
  }

  const mandateResult = MandateSchema.safeParse(context.mandateJson);
  if (!mandateResult.success || mandateResult.data.id !== order.mandateId) {
    throw paymentError("APPROVAL_CONTEXT_INVALID");
  }
  const mandate = mandateResult.data;
  if (mandate.budget.currency !== order.total.currency) {
    throw paymentError("APPROVAL_CONTEXT_INVALID");
  }
  if (order.total.amountMinor > mandate.budget.amountMinor) {
    throw paymentError("BUDGET_EXCEEDED");
  }

  const verdictResult = VerdictSchema.safeParse(context.verdictJson);
  if (!verdictResult.success) throw paymentError("APPROVAL_CONTEXT_INVALID");
  const verdict = verdictResult.data;
  if (verdict.decision === "BLOCK" || verdict.decision === "REVIEW") {
    throw paymentError("ORDER_NOT_APPROVABLE");
  }
  if (
    verdict.id !== order.verdictId
    || verdict.mandateId !== order.mandateId
    || verdict.proposedOrderId !== order.proposedOrderId
    || verdict.decision !== order.verdictDecision
  ) {
    throw paymentError("APPROVAL_CONTEXT_INVALID");
  }

  const decisions = new Map(verdict.itemDecisions.map((item) => [item.itemId, item.decision]));
  if (decisions.size !== verdict.itemDecisions.length) {
    throw paymentError("APPROVAL_CONTEXT_INVALID");
  }
  if (order.items.some((item) => decisions.get(item.sourceItemId) !== "ALLOW")) {
    throw paymentError("ORDER_NOT_APPROVABLE");
  }
}
