import { sha256 } from "@/server/canonical-json";
import type {
  CreatePayPalOrderInput,
  PayPalClient,
  PayPalOrderResult,
} from "../types";

export type MockPayPalHandler = (
  input: CreatePayPalOrderInput,
  callNumber: number,
) => PayPalOrderResult | Promise<PayPalOrderResult>;

/** Replay-only client. It never performs network I/O and exposes deterministic call counters. */
export class MockPayPalClient implements PayPalClient {
  oauthCalls = 0;
  ordersCalls = 0;
  readonly requests: CreatePayPalOrderInput[] = [];

  constructor(private readonly handler?: MockPayPalHandler) {}

  async createOrder(input: CreatePayPalOrderInput): Promise<PayPalOrderResult> {
    this.oauthCalls += 1;
    this.ordersCalls += 1;
    const snapshot = structuredClone(input);
    this.requests.push(snapshot);
    if (this.handler) return this.handler(snapshot, this.ordersCalls);

    return {
      id: `MOCK-${sha256(input.requestId).slice(0, 24).toUpperCase()}`,
      status: "CREATED",
    };
  }
}
