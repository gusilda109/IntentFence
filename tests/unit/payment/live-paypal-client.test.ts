import { describe, expect, it, vi } from "vitest";
import {
  LivePayPalClient,
  validateSandboxBaseUrl,
} from "@/modules/payment/server/live-paypal-client";
import { buildPayPalOrderPayload } from "@/modules/payment/payload";
import { makeApprovedOrder } from "./test-helpers";

vi.mock("server-only", () => ({}));

function orderInput() {
  const order = makeApprovedOrder();
  return { requestId: order.idempotencyKey, payload: buildPayPalOrderPayload(order) };
}

describe("LivePayPalClient", () => {
  it("performs real Sandbox OAuth and Orders REST calls without capture", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/oauth2/token")) {
        return Response.json({ access_token: "private-oauth-token", expires_in: 3600 });
      }
      return Response.json({
        id: "LIVE-SANDBOX-ORDER",
        status: "CREATED",
        links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=LIVE-SANDBOX-ORDER" }],
        accessToken: "must-not-be-returned",
      }, { status: 201 });
    });
    const client = new LivePayPalClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl,
    });
    const input = orderInput();

    const first = await client.createOrder(input);
    await client.createOrder(input);

    expect(first).toEqual({
      id: "LIVE-SANDBOX-ORDER",
      status: "CREATED",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=LIVE-SANDBOX-ORDER",
    });
    expect(JSON.stringify(first)).not.toContain("private");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
    ]);
    const orderCall = calls[1]!;
    expect(orderCall.init?.method).toBe("POST");
    expect(orderCall.init?.headers).toMatchObject({
      "PayPal-Request-Id": input.requestId,
      "Content-Type": "application/json",
    });
    expect(orderCall.init?.body).toBe(JSON.stringify(input.payload));
    expect(calls.some((call) => call.url.includes("/capture"))).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("classifies retryable HTTP without exposing the provider body", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "secret", expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ secret: "private-body" }), { status: 503 }));
    const client = new LivePayPalClient({
      clientId: "id",
      clientSecret: "secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl,
    });

    const error = await client.createOrder(orderInput()).catch((value: unknown) => value);
    expect(error).toMatchObject({ kind: "http", code: "PAYPAL_HTTP_503" });
    expect(String(error)).not.toContain("private-body");
  });

  it("classifies an aborted Orders request as timeout", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return Response.json({ access_token: "secret", expires_in: 3600 });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const client = new LivePayPalClient({
      clientId: "id",
      clientSecret: "secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(client.createOrder(orderInput())).rejects.toMatchObject({
      kind: "timeout",
      code: "PAYPAL_TIMEOUT",
    });
  });

  it.each([
    "https://api-m.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com/v2",
    "https://api-m.sandbox.paypal.com.evil.example",
  ])("rejects non-Sandbox or non-root API base URL %s", (baseUrl) => {
    expect(() => validateSandboxBaseUrl(baseUrl)).toThrow("PAYPAL_CONFIGURATION_INVALID");
  });
});
