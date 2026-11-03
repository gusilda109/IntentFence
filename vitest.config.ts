import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/{unit,integration,security}/**/*.test.ts"],
    environment: "node",
    testTimeout: 45_000,
    hookTimeout: 20_000,
    env: {
      APP_MODE: "replay",
      PAYPAL_MODE: "mock",
      DATABASE_URL: "file:./test.db",
    },
  },
});
