export class PaymentExecutorError extends Error {
  readonly name = "PaymentExecutorError";

  constructor(readonly code: string) {
    super(code);
  }
}

export function paymentError(code: string): PaymentExecutorError {
  return new PaymentExecutorError(code);
}
