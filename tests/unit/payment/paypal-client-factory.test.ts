import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClientFromEnv } from "@/modules/payment/server/paypal-client-factory";
import { LivePayPalClient } from "@/modules/payment/server/live-paypal-client";
import { MockPayPalClient } from "@/modules/payment/server/mock-paypal-client";

vi.mock("server-only", () => ({}));

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("PayPal client mode boundary", () => {
  it("uses the network-free mock only when PAYPAL_MODE is exactly mock", () => {
    process.env.PAYPAL_MODE = "mock";
    expect(createPayPalClientFromEnv()).toBeInstanceOf(MockPayPalClient);
  });

  it("does not silently replace live mode with a mock", () => {
    process.env.PAYPAL_MODE = "live";
    process.env.PAYPAL_CLIENT_ID = "test-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    process.env.PAYPAL_API_BASE_URL = "https://api-m.sandbox.paypal.com";
    expect(createPayPalClientFromEnv()).toBeInstanceOf(LivePayPalClient);
  });

  it("fails closed for live mode without credentials", () => {
    process.env.PAYPAL_MODE = "live";
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    expect(() => createPayPalClientFromEnv()).toThrow("PAYPAL_CONFIGURATION_INVALID");
  });
});
