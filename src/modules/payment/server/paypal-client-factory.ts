import type { PayPalClient } from "../types";
import { createLivePayPalClientFromEnv } from "./live-paypal-client";
import { MockPayPalClient } from "./mock-paypal-client";

/** Mocking is opt-in only. Every non-mock value stays on the live Sandbox path. */
export function createPayPalClientFromEnv(): PayPalClient {
  if (process.env.PAYPAL_MODE === "mock") return new MockPayPalClient();
  return createLivePayPalClientFromEnv();
}
