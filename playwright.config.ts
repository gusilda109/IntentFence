import { defineConfig } from "@playwright/test";

const channel3UiLiveSmoke = process.env.CHANNEL3_UI_LIVE_SMOKE === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: channel3UiLiveSmoke ? 240_000 : 60_000,
  expect: { timeout: channel3UiLiveSmoke ? 30_000 : 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx prisma migrate deploy && npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: channel3UiLiveSmoke ? {
      APP_MODE: "live",
      PAYPAL_MODE: "live",
      DATABASE_URL: "file:./live-e2e.db",
    } : {
      APP_MODE: "replay",
      PAYPAL_MODE: "mock",
      DATABASE_URL: "file:./e2e.db",
      CHANNEL3_API_KEY: "",
    },
  },
});
