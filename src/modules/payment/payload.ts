import type { ApprovedOrder } from "@/shared/contracts";
import type { PayPalMoney, PayPalOrderPayload } from "./types";

/** Convert integer cents to PayPal's two-decimal representation without floats. */
export function minorUnitsToDecimal(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("INVALID_MINOR_UNITS");
  }
  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  return `${major}.${String(minor).padStart(2, "0")}`;
}

function usd(amountMinor: number): PayPalMoney {
  return { currency_code: "USD", value: minorUnitsToDecimal(amountMinor) };
}

export function buildPayPalOrderPayload(order: ApprovedOrder): PayPalOrderPayload {
  const total = order.items.reduce(
    (sum, item) => sum + item.unitPrice.amountMinor * item.quantity,
    0,
  );

  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: order.id,
      custom_id: order.approvalHash,
      amount: {
        ...usd(total),
        breakdown: {
          item_total: usd(total),
        },
      },
      items: order.items.map((item) => ({
        name: item.name,
        quantity: String(item.quantity),
        unit_amount: usd(item.unitPrice.amountMinor),
      })),
    }],
  };
}
