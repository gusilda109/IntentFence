import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const PUBLIC_ORIGIN = "https://intentfence.onrender.com";
const TABLET_PATH = "/stores/tablet-hub/products/hubtab-s10";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("public demo store origin", () => {
  it("uses the Render external URL and canonicalizes legacy localhost URLs", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", PUBLIC_ORIGIN);
    vi.resetModules();

    const { LOCAL_STORE_ORIGIN, canonicalizeStoreUrl } = await import("@/modules/demo-stores/registry");

    expect(LOCAL_STORE_ORIGIN).toBe(PUBLIC_ORIGIN);
    expect(canonicalizeStoreUrl(`http://localhost:3000${TABLET_PATH}`)).toBe(`${PUBLIC_ORIGIN}${TABLET_PATH}`);
    expect(canonicalizeStoreUrl(`${PUBLIC_ORIGIN}${TABLET_PATH}/`)).toBe(`${PUBLIC_ORIGIN}${TABLET_PATH}`);
    expect(() => canonicalizeStoreUrl(`https://example.com${TABLET_PATH}`)).toThrow(/outside/);
  });

  it("uses the configured origin throughout Replay proposals and evidence", async () => {
    vi.stubEnv("APP_BASE_URL", PUBLIC_ORIGIN);
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://ignored.onrender.com");
    vi.resetModules();

    const { createCoffeeReplay } = await import("@/modules/actor/replay");
    const result = createCoffeeReplay({
      schemaVersion: "1",
      id: randomUUID(),
      goal: "Set up a coffee shop checkout.",
      budget: { currency: "USD", amountMinor: 80000 },
      constraints: [],
      createdAt: new Date().toISOString(),
    });

    expect(result.proposal.items.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.proposal.items.every((item) => item.productUrl.startsWith(`${PUBLIC_ORIGIN}/stores/`))).toBe(true);
    expect(result.evidence.every((record) => record.evidence.source.url.startsWith(`${PUBLIC_ORIGIN}/stores/`))).toBe(true);
  });
});
