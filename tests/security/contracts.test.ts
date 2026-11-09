import { describe, expect, it } from "vitest";
import {
  ApprovedOrderItemSchema,
  ApprovedOrderSchema,
  CreateRunInputSchema,
  EvidenceSchema,
  MandateSchema,
  PaymentExecutionViewSchema,
  ProposedOrderItemSchema,
  ProposedOrderSchema,
  RunViewSchema,
  VerdictSchema,
} from "../../src/shared/contracts/index.js";

interface ObjectShape {
  shape: Record<string, unknown>;
}

function expectExactKeys(schema: ObjectShape, expected: string[]) {
  expect(Object.keys(schema.shape).sort()).toEqual([...expected].sort());
}

describe("payment-free contracts and safe read models", () => {
  it("mandate, proposal, evidence, verdict, and approval schemas expose only their locked fields", () => {
    expectExactKeys(MandateSchema, [
      "schemaVersion",
      "id",
      "goal",
      "budget",
      "constraints",
      "createdAt",
    ]);
    expectExactKeys(ProposedOrderSchema, [
      "schemaVersion",
      "id",
      "mandateId",
      "items",
      "evidenceIds",
      "total",
      "assumptions",
      "createdAt",
    ]);
    expectExactKeys(ProposedOrderItemSchema, [
      "catalogListing",
      "id",
      "storeId",
      "productUrl",
      "imageUrl",
      "name",
      "description",
      "quantity",
      "unitPrice",
      "purpose",
      "necessityEvidenceIds",
      "compatibility",
    ]);
    expectExactKeys(EvidenceSchema, [
      "schemaVersion",
      "id",
      "captureId",
      "itemId",
      "source",
      "locator",
      "excerpt",
      "claims",
      "contentHash",
      "retrievedAt",
    ]);
    expectExactKeys(VerdictSchema, [
      "schemaVersion",
      "id",
      "mandateId",
      "proposedOrderId",
      "decision",
      "itemDecisions",
      "findings",
      "summary",
      "policyVersion",
      "inputHash",
      "evaluatedAt",
    ]);
    expectExactKeys(ApprovedOrderSchema, [
      "schemaVersion",
      "id",
      "mandateId",
      "proposedOrderId",
      "verdictId",
      "verdictDecision",
      "items",
      "total",
      "approvalHash",
      "idempotencyKey",
      "createdAt",
    ]);
    expectExactKeys(ApprovedOrderItemSchema, [
      "sourceItemId",
      "storeId",
      "productUrl",
      "name",
      "quantity",
      "unitPrice",
    ]);
  });

  it("run creation and payment/run views cannot acquire credential or raw-response fields", () => {
    expectExactKeys(CreateRunInputSchema, ["goal", "budget", "constraints", "catalogSource"]);
    expectExactKeys(PaymentExecutionViewSchema, [
      "status",
      "paypalOrderId",
      "paypalStatus",
      "approveUrl",
      "createdAt",
      "updatedAt",
      "errorCode",
    ]);
    expectExactKeys(RunViewSchema, [
      "id",
      "status",
      "mandate",
      "catalogSource",
      "proposedOrder",
      "evidence",
      "verdict",
      "approvedOrder",
      "payment",
      "replay",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("strict input validation rejects payment fields instead of forwarding them", () => {
    const validInput = {
      goal: "Организуй кассу кофейни на базе планшета",
      budget: 80_000,
      constraints: [],
    };

    for (const paymentField of [
      { card: { number: "4111111111111111" } },
      { paymentSource: { card: {} } },
      { accessToken: "not-a-real-token" },
      { clientSecret: "not-a-real-secret" },
    ]) {
      expect(CreateRunInputSchema.safeParse({ ...validInput, ...paymentField }).success).toBe(false);
    }
  });
});
