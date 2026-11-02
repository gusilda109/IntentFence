export {
  PaymentExecutionViewSchema,
  RunStatusSchema,
  RunViewSchema,
} from "@/shared/contracts";
export type {
  PaymentExecutionView,
  RunStatus,
  RunView,
} from "@/shared/contracts";

export type ApiErrorCode =
  | "CONTRACT_VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_APPROVABLE"
  | "APPROVAL_HASH_MISMATCH"
  | "PAYMENT_CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
