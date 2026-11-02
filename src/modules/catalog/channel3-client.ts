import "server-only";
import { z } from "zod";

export const CHANNEL3_API_BASE_URL = "https://api.trychannel3.com";

const PriceSchema = z.object({
  price: z.number().finite().nonnegative(),
  currency: z.string().min(1).max(3),
  compare_at_price: z.number().finite().nonnegative().nullish(),
});

const OfferSchema = z.object({
  url: z.string().max(2_048),
  domain: z.string().min(1).max(255),
  price: PriceSchema,
  availability: z.enum(["InStock", "OutOfStock"]),
  condition: z.enum(["new", "used", "refurbished"]).nullish(),
  // Deliberately omit max_commission_rate: monetization cannot affect selection.
});

const VariantSchema = z.object({
  options: z.array(z.object({
    name: z.string().max(200),
    values: z.array(z.object({
      label: z.string().max(500),
      exists: z.boolean(),
      available: z.enum(["InStock", "OutOfStock"]).nullish(),
      product_id: z.string().max(500).nullish(),
      thumbnail_url: z.string().max(2_048).nullish(),
    })).max(100),
  })).max(50),
  selected: z.array(z.object({
    name: z.string().max(200),
    label: z.string().max(500),
  })).max(50),
});

export const Channel3ProductSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(2_000),
  description: z.string().max(20_000).nullish(),
  brands: z.array(z.object({ id: z.string().max(500), name: z.string().max(500) })).max(20).optional(),
  key_features: z.array(z.string().max(2_000)).max(100).nullish(),
  offers: z.array(OfferSchema).max(200).optional(),
  variants: VariantSchema.nullish(),
  structured_attributes: z.record(z.string().max(200), z.array(z.string().max(1_000)).max(100)).optional(),
});

export const Channel3SearchResponseSchema = z.object({
  products: z.array(Channel3ProductSchema).max(30),
  next_page_token: z.string().max(4_000).nullish(),
});

export type Channel3Product = z.infer<typeof Channel3ProductSchema>;
export type Channel3ErrorCode =
  | "CHANNEL3_UNAVAILABLE"
  | "CHANNEL3_UNAUTHORIZED"
  | "CHANNEL3_RATE_LIMITED"
  | "CHANNEL3_TIMEOUT"
  | "CHANNEL3_EMPTY"
  | "CHANNEL3_NO_OFFERS"
  | "CHANNEL3_NOT_FOUND"
  | "CHANNEL3_INVALID_RESPONSE"
  | "CHANNEL3_PRODUCT_CHANGED"
  | "CHANNEL3_API_ERROR";

const safeMessages: Record<Channel3ErrorCode, string> = {
  CHANNEL3_UNAVAILABLE: "Channel3 is not configured on the server. Add CHANNEL3_API_KEY or use Demo fixtures.",
  CHANNEL3_UNAUTHORIZED: "Channel3 rejected the server API key. Check the server configuration; fixtures were not used as a fallback.",
  CHANNEL3_RATE_LIMITED: "Channel3 rate limit was reached. No order was created; try again later.",
  CHANNEL3_TIMEOUT: "Channel3 did not respond in time. No order was created; try again.",
  CHANNEL3_EMPTY: "Channel3 found no products for this goal. No fixtures or payment were substituted.",
  CHANNEL3_NO_OFFERS: "Channel3 returned no suitable in-stock USD offers. No order was created.",
  CHANNEL3_NOT_FOUND: "The selected Channel3 product is no longer available.",
  CHANNEL3_INVALID_RESPONSE: "Channel3 returned invalid product data. No order was created.",
  CHANNEL3_PRODUCT_CHANGED: "A Channel3 price or availability changed during review. No order was created; start a new review.",
  CHANNEL3_API_ERROR: "Channel3 is temporarily unavailable. No order was created and no fixture fallback was used.",
};

export class Channel3Error extends Error {
  constructor(readonly code: Channel3ErrorCode, options?: ErrorOptions) {
    super(safeMessages[code], options);
    this.name = "Channel3Error";
  }
}

interface Channel3ClientOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class Channel3Client {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: Channel3ClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.CHANNEL3_API_KEY;
    if (!apiKey?.trim()) throw new Channel3Error("CHANNEL3_UNAVAILABLE");
    this.apiKey = apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? positiveIntegerEnv("CHANNEL3_TIMEOUT_MS", 10_000);
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 200;
  }

  async search(goal: string, budgetMinor: number): Promise<Channel3Product[]> {
    const response = await this.request("/v1/search", {
      method: "POST",
      body: JSON.stringify({
        query: goal,
        limit: 6,
        config: { country: "US", currency: "USD", language: "en" },
        filters: {
          availability: ["InStock"],
          price: { max_price: budgetMinor / 100 },
        },
      }),
    });
    const parsed = Channel3SearchResponseSchema.safeParse(response);
    if (!parsed.success) throw new Channel3Error("CHANNEL3_INVALID_RESPONSE");
    if (parsed.data.products.length === 0) throw new Channel3Error("CHANNEL3_EMPTY");
    return parsed.data.products;
  }

  async getProduct(productId: string): Promise<Channel3Product> {
    const query = new URLSearchParams({ country: "US", currency: "USD", language: "en" });
    const response = await this.request(`/v1/products/${encodeURIComponent(productId)}?${query}`, { method: "GET" });
    const parsed = Channel3ProductSchema.safeParse(response);
    if (!parsed.success) throw new Channel3Error("CHANNEL3_INVALID_RESPONSE");
    return parsed.data;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${CHANNEL3_API_BASE_URL}${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 401 || response.status === 403) throw new Channel3Error("CHANNEL3_UNAUTHORIZED");
        if (response.status === 404) throw new Channel3Error("CHANNEL3_NOT_FOUND");
        if (response.status === 429) {
          lastError = new Channel3Error("CHANNEL3_RATE_LIMITED");
          if (attempt < this.maxRetries) {
            await delay(retryAfterMs(response.headers.get("retry-after"), this.retryDelayMs));
            continue;
          }
          throw lastError;
        }
        if (response.status >= 500) {
          lastError = new Channel3Error("CHANNEL3_API_ERROR");
          if (attempt < this.maxRetries) {
            await delay(this.retryDelayMs);
            continue;
          }
          throw lastError;
        }
        if (!response.ok) throw new Channel3Error("CHANNEL3_API_ERROR");
        try {
          return await response.json();
        } catch (error) {
          throw new Channel3Error("CHANNEL3_INVALID_RESPONSE", { cause: error });
        }
      } catch (error) {
        if (error instanceof Channel3Error) throw error;
        lastError = error;
        if (attempt < this.maxRetries) {
          await delay(this.retryDelayMs);
          continue;
        }
        if (controller.signal.aborted) throw new Channel3Error("CHANNEL3_TIMEOUT", { cause: error });
        throw new Channel3Error("CHANNEL3_API_ERROR", { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Channel3Error("CHANNEL3_API_ERROR", { cause: lastError });
  }
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= 60_000 ? value : fallback;
}

function retryAfterMs(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1_000, 2_000) : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
