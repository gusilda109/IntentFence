import type { PaymentExecutionView } from "@/shared/contracts";
import { paymentError } from "./errors";

/** A deliberately conservative local window; PayPal retention is finite and not assumed here. */
export const UNKNOWN_RETRY_WINDOW_MS = 60 * 60 * 1_000;

export function assertAutomaticUnknownRetryAllowed(
  view: PaymentExecutionView,
  now: Date,
): void {
  if (view.status !== "PAYMENT_UNKNOWN") return;
  const createdAt = Date.parse(view.createdAt);
  if (!Number.isFinite(createdAt) || now.getTime() - createdAt > UNKNOWN_RETRY_WINDOW_MS) {
    throw paymentError("PAYMENT_RECONCILIATION_REQUIRED");
  }
}
