import { describe, expect, it } from "vitest";
import { buildPayPalOrderPayload, minorUnitsToDecimal } from "@/modules/payment/payload";
import { makeApprovedOrder } from "./test-helpers";

describe("PayPal Orders v2 payload", () => {
  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [10, "0.10"],
    [105, "1.05"],
    [80_000, "800.00"],
    [10_000_000, "100000.00"],
  ])("converts %i minor units without float arithmetic", (minor, decimal) => {
    expect(minorUnitsToDecimal(minor)).toBe(decimal);
  });

  it("builds one purchase unit with recalculated item_total and string quantities", () => {
    const order = makeApprovedOrder({
      items: [
        {
          sourceItemId: "55555555-5555-4555-8555-555555555555",
          storeId: "store-a",
          productUrl: "https://stores.local/a/item",
          name: "Tablet",
          quantity: 3,
          unitPrice: { currency: "USD", amountMinor: 199 },
        },
        {
          sourceItemId: "77777777-7777-4777-8777-777777777777",
          storeId: "store-b",
          productUrl: "https://stores.local/b/item",
          name: "Adapter",
          quantity: 1,
          unitPrice: { currency: "USD", amountMinor: 1 },
        },
      ],
      total: { currency: "USD", amountMinor: 598 },
    });
    const payload = buildPayPalOrderPayload(order);

    expect(payload).toEqual({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: order.id,
        custom_id: order.approvalHash,
        amount: {
          currency_code: "USD",
          value: "5.98",
          breakdown: {
            item_total: { currency_code: "USD", value: "5.98" },
          },
        },
        items: [
          {
            name: "Tablet",
            quantity: "3",
            unit_amount: { currency_code: "USD", value: "1.99" },
          },
          {
            name: "Adapter",
            quantity: "1",
            unit_amount: { currency_code: "USD", value: "0.01" },
          },
        ],
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("capture");
  });
});
