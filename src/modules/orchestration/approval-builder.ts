import { randomUUID } from "node:crypto";
import {
  ApprovedOrderSchema,
  type ApprovedOrder,
  type Mandate,
  type ProposedOrder,
  type Verdict,
} from "@/shared/contracts";
import { canonicalJson, sha256 } from "@/server/canonical-json";

export function buildApprovedOrder(
  mandate: Mandate,
  proposal: ProposedOrder,
  verdict: Verdict,
  now = new Date(),
): ApprovedOrder {
  if (verdict.decision !== "ALLOW" && verdict.decision !== "PARTIAL_ALLOW") {
    throw new Error("ORDER_NOT_APPROVABLE");
  }
  if (
    verdict.mandateId !== mandate.id
    || verdict.proposedOrderId !== proposal.id
    || proposal.mandateId !== mandate.id
  ) {
    throw new Error("APPROVAL_CONTEXT_INVALID");
  }

  const allowedIds = new Set(
    verdict.itemDecisions.filter((item) => item.decision === "ALLOW").map((item) => item.itemId),
  );
  if (verdict.decision === "ALLOW" && allowedIds.size !== proposal.items.length) {
    throw new Error("APPROVAL_CONTEXT_INVALID");
  }

  const selected = proposal.items.filter((item) => allowedIds.has(item.id));
  if (selected.length === 0 || selected.length !== allowedIds.size) {
    throw new Error("APPROVAL_CONTEXT_INVALID");
  }

  for (const item of selected) {
    const missingDependency = item.compatibility.some((claim) =>
      claim.withItemId !== null && !allowedIds.has(claim.withItemId));
    if (missingDependency) throw new Error("UNMET_DEPENDENCY");
  }

  const items = selected.map((item) => ({
    sourceItemId: item.id,
    storeId: item.storeId,
    productUrl: item.productUrl,
    name: item.name,
    quantity: item.quantity,
    unitPrice: { ...item.unitPrice },
  }));
  const amountMinor = items.reduce(
    (sum, item) => sum + item.unitPrice.amountMinor * item.quantity,
    0,
  );
  if (amountMinor > mandate.budget.amountMinor) throw new Error("BUDGET_EXCEEDED");

  const total = { currency: "USD" as const, amountMinor };
  const base = {
    mandateId: mandate.id,
    proposedOrderId: proposal.id,
    verdictId: verdict.id,
    items,
    total,
  };
  const approval: ApprovedOrder = {
    schemaVersion: "1",
    id: randomUUID(),
    ...base,
    verdictDecision: verdict.decision,
    approvalHash: sha256(base),
    idempotencyKey: randomUUID(),
    createdAt: now.toISOString(),
  };

  return ApprovedOrderSchema.parse(deepFreeze(approval));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export function approvalMatchesProposal(approval: ApprovedOrder, proposal: ProposedOrder): boolean {
  const sourceItems = proposal.items.filter((item) =>
    approval.items.some((approved) => approved.sourceItemId === item.id));
  return canonicalJson(sourceItems.map((item) => ({
    sourceItemId: item.id,
    storeId: item.storeId,
    productUrl: item.productUrl,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }))) === canonicalJson(approval.items);
}
