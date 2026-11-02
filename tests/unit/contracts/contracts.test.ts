import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApprovedOrderSchema,
  EvidenceSchema,
  MandateSchema,
  ProposedOrderSchema,
  VerdictSchema,
} from "@/shared/contracts";

const now = new Date().toISOString();
const id = randomUUID();
const money = { currency: "USD", amountMinor: 80_000 } as const;

const validMandate = {
  schemaVersion: "1", id, goal: "Set up a coffee shop checkout", budget: money,
  constraints: [], createdAt: now,
};

describe("locked shared contracts", () => {
  it("accepts the normative mandate", () => {
    expect(MandateSchema.parse(validMandate)).toEqual(validMandate);
  });

  it.each([
    ["Mandate", MandateSchema, validMandate],
    ["Evidence", EvidenceSchema, {
      schemaVersion: "1", id, captureId: "capture-1", source: {
        storeId: "store", publisherId: "publisher", url: "http://localhost:3000/stores/store/item", sourceClass: "seller",
      }, locator: "main", excerpt: "Product details", claims: [{ kind: "price", text: "Price is final" }], contentHash: "a".repeat(64), retrievedAt: now,
    }],
    ["ProposedOrder", ProposedOrderSchema, {
      schemaVersion: "1", id, mandateId: id, items: [{ id: randomUUID(), storeId: "store", productUrl: "http://localhost:3000/stores/store/item", name: "Item", description: "Description", quantity: 1, unitPrice: money, purpose: "Purpose", necessityEvidenceIds: [id], compatibility: [] }], evidenceIds: [id], total: money, assumptions: [], createdAt: now,
    }],
    ["Verdict", VerdictSchema, {
      schemaVersion: "1", id, mandateId: id, proposedOrderId: id, decision: "BLOCK", itemDecisions: [{ itemId: id, decision: "BLOCK", reasons: [{ code: "OTHER", severity: "critical", message: "Blocked", evidenceIds: [] }] }], findings: [], summary: "Blocked", policyVersion: "1", inputHash: "a".repeat(64), evaluatedAt: now,
    }],
    ["ApprovedOrder", ApprovedOrderSchema, {
      schemaVersion: "1", id, mandateId: id, proposedOrderId: id, verdictId: id, verdictDecision: "ALLOW", items: [{ sourceItemId: id, storeId: "store", productUrl: "http://localhost:3000/stores/store/item", name: "Item", quantity: 1, unitPrice: money }], total: money, approvalHash: "a".repeat(64), idempotencyKey: id, createdAt: now,
    }],
  ] as const)("rejects unknown payment fields in %s", (_name, schema, value) => {
    expect(schema.safeParse({ ...value, accessToken: "forbidden" }).success).toBe(false);
    expect(schema.safeParse({ ...value, paymentSource: {} }).success).toBe(false);
  });

  it.each([
    ["ProposedOrder", ProposedOrderSchema],
    ["Verdict", VerdictSchema],
  ] as const)("does not emit format constraints in %s wire schema", (_name, schema) => {
    const assertCompatible = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(assertCompatible);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      expect(record.format).toBeUndefined();
      Object.values(record).forEach(assertCompatible);
    };

    assertCompatible(z.toJSONSchema(schema));
  });
});
