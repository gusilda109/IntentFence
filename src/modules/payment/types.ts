import type { ApprovedOrder, PaymentExecutionView } from "@/shared/contracts";

export interface PayPalMoney {
  currency_code: "USD";
  value: string;
}

export interface PayPalOrderItem {
  name: string;
  quantity: string;
  unit_amount: PayPalMoney;
}

export interface PayPalOrderPayload {
  intent: "CAPTURE";
  purchase_units: [{
    reference_id: string;
    custom_id: string;
    amount: PayPalMoney & {
      breakdown: {
        item_total: PayPalMoney;
      };
    };
    items: PayPalOrderItem[];
  }];
}

export interface CreatePayPalOrderInput {
  requestId: string;
  payload: PayPalOrderPayload;
}

export interface PayPalOrderResult {
  id: string;
  status: string;
  approveUrl?: string;
}

export interface PayPalClient {
  createOrder(input: CreatePayPalOrderInput): Promise<PayPalOrderResult>;
}

export type PayPalClientErrorKind = "http" | "timeout" | "network" | "invalid_response";

/** An error with a deliberately small, non-sensitive public surface. */
export class PayPalClientError extends Error {
  readonly name = "PayPalClientError";

  constructor(
    readonly kind: PayPalClientErrorKind,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface PaymentExecutionRecord {
  view: PaymentExecutionView;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

export interface PaymentLease {
  token: string;
  now: Date;
  expiresAt: Date;
}

export type AcquirePaymentExecutionResult =
  | { kind: "complete"; view: PaymentExecutionView }
  | { kind: "acquired"; leaseToken: string }
  | { kind: "busy"; leaseToken: string | null; view: PaymentExecutionView };

export type PaymentSettlement =
  | {
      status: "PAYPAL_CREATED";
      paypalOrderId: string;
      paypalStatus: string;
      approveUrl?: string;
    }
  | {
      status: "PAYMENT_RETRYABLE" | "PAYMENT_UNKNOWN";
      errorCode: string;
    };

export interface PaymentExecutionStore {
  acquire(order: ApprovedOrder, lease: PaymentLease): Promise<AcquirePaymentExecutionResult>;
  get(approvedOrderId: string): Promise<PaymentExecutionRecord | null>;
  settle(approvedOrderId: string, leaseToken: string, settlement: PaymentSettlement): Promise<PaymentExecutionView>;
}
