import "server-only";
import { paymentError } from "../errors";
import {
  PayPalClientError,
  type CreatePayPalOrderInput,
  type PayPalClient,
  type PayPalOrderResult,
} from "../types";

const SANDBOX_ORIGIN = "https://api-m.sandbox.paypal.com";

type FetchImplementation = typeof fetch;

export interface LivePayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
  now?: () => number;
}

interface OAuthToken {
  value: string;
  expiresAt: number;
}

export class LivePayPalClient implements PayPalClient {
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private cachedToken: OAuthToken | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(private readonly options: LivePayPalClientOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw paymentError("PAYPAL_CONFIGURATION_INVALID");
    }
    this.baseUrl = validateSandboxBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw paymentError("PAYPAL_CONFIGURATION_INVALID");
    }
  }

  async createOrder(input: CreatePayPalOrderInput): Promise<PayPalOrderResult> {
    const accessToken = await this.getAccessToken();
    const response = await this.request(`${this.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": input.requestId,
        Prefer: "return=representation",
      },
      body: JSON.stringify(input.payload),
    });

    if (!response.ok) {
      throw new PayPalClientError("http", `PAYPAL_HTTP_${response.status}`);
    }
    const body: unknown = await parseJson(response);
    return parseOrderResult(body);
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }
    if (this.tokenRequest) return this.tokenRequest;

    this.tokenRequest = this.fetchAccessToken();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }

  private async fetchAccessToken(): Promise<string> {
    const response = await this.request(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      throw new PayPalClientError("http", `PAYPAL_OAUTH_HTTP_${response.status}`);
    }

    const body: unknown = await parseJson(response);
    if (!isRecord(body) || typeof body.access_token !== "string" || !body.access_token) {
      throw new PayPalClientError("invalid_response", "PAYPAL_INVALID_OAUTH_RESPONSE");
    }
    const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(0, body.expires_in)
      : 300;
    this.cachedToken = {
      value: body.access_token,
      expiresAt: this.now() + Math.max(1, expiresIn - 60) * 1_000,
    };
    return body.access_token;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) {
        throw new PayPalClientError("timeout", "PAYPAL_TIMEOUT");
      }
      throw new PayPalClientError("network", "PAYPAL_NETWORK_UNKNOWN");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLivePayPalClientFromEnv(): LivePayPalClient {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw paymentError("PAYPAL_CONFIGURATION_INVALID");

  const timeoutText = process.env.PAYPAL_TIMEOUT_MS ?? "15000";
  const timeoutMs = Number(timeoutText);
  return new LivePayPalClient({
    clientId,
    clientSecret,
    baseUrl: process.env.PAYPAL_API_BASE_URL ?? SANDBOX_ORIGIN,
    timeoutMs,
  });
}

export function validateSandboxBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw paymentError("PAYPAL_CONFIGURATION_INVALID");
  }
  if (
    url.origin !== SANDBOX_ORIGIN
    || (url.pathname !== "" && url.pathname !== "/")
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw paymentError("PAYPAL_CONFIGURATION_INVALID");
  }
  return SANDBOX_ORIGIN;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PayPalClientError("invalid_response", "PAYPAL_INVALID_RESPONSE");
  }
}

function parseOrderResult(body: unknown): PayPalOrderResult {
  if (
    !isRecord(body)
    || typeof body.id !== "string"
    || !body.id
    || body.id.length > 200
    || typeof body.status !== "string"
    || !body.status
    || body.status.length > 100
  ) {
    throw new PayPalClientError("invalid_response", "PAYPAL_INVALID_ORDER_RESPONSE");
  }

  const links = Array.isArray(body.links) ? body.links : [];
  const approveLink = links.find((link) => isRecord(link) && link.rel === "approve");
  const approveUrl = isRecord(approveLink) && typeof approveLink.href === "string"
    ? sanitizeApproveUrl(approveLink.href)
    : undefined;

  return { id: body.id, status: body.status, approveUrl };
}

function sanitizeApproveUrl(value: string): string | undefined {
  if (value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.sandbox.paypal.com") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
