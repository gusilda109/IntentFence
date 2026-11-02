import { PaymentExecutorError } from "@/modules/payment";
import { Channel3Error } from "@/modules/catalog/channel3-client";
import { IdempotencyConflictError, RunNotFoundError, isContractError } from "./run-orchestrator";

export function errorResponse(error: unknown) {
  if (error instanceof Channel3Error) {
    const status = error.code === "CHANNEL3_RATE_LIMITED" ? 429
      : error.code === "CHANNEL3_TIMEOUT" ? 504
        : error.code === "CHANNEL3_PRODUCT_CHANGED" ? 409
          : error.code === "CHANNEL3_EMPTY" || error.code === "CHANNEL3_NO_OFFERS" ? 422
            : error.code === "CHANNEL3_INVALID_RESPONSE" ? 502
              : 503;
    return Response.json({ error: { code: error.code, message: error.message } }, { status });
  }
  if (error instanceof Error && error.message === "CHANNEL3_NO_OFFERS") {
    return Response.json({ error: { code: error.message, message: "Channel3 returned no suitable offers within the budget. No order was created." } }, { status: 422 });
  }
  if (isContractError(error)) {
    return Response.json({ error: { code: "CONTRACT_VALIDATION_ERROR", message: "The request or agent output failed contract validation." } }, { status: 422 });
  }
  if (error instanceof IdempotencyConflictError) {
    return Response.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "This idempotency key was already used with a different request body." } }, { status: 409 });
  }
  if (error instanceof RunNotFoundError) {
    return Response.json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } }, { status: 404 });
  }
  if (error instanceof PaymentExecutorError) {
    if (error.code === "APPROVAL_HASH_MISMATCH" || error.code === "APPROVAL_SNAPSHOT_MISMATCH") {
      return Response.json({ error: { code: "APPROVAL_HASH_MISMATCH", message: "The persisted approval snapshot does not match." } }, { status: 409 });
    }
    if (["ORDER_NOT_APPROVABLE", "RUN_NOT_APPROVABLE", "BUDGET_EXCEEDED"].includes(error.code)) {
      return Response.json({ error: { code: "RUN_NOT_APPROVABLE", message: "The current run is not approvable." } }, { status: 409 });
    }
  }
  if (error instanceof Error && ["RUN_NOT_APPROVABLE", "ORDER_NOT_APPROVABLE", "UNMET_DEPENDENCY", "BUDGET_EXCEEDED"].includes(error.message)) {
    return Response.json({ error: { code: "RUN_NOT_APPROVABLE", message: "The current run is not approvable." } }, { status: 409 });
  }
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "The operation could not be completed safely." } }, { status: 500 });
}
