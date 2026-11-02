import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const noPaymentBoundary = {
  "no-restricted-imports": ["error", {
    patterns: [
      { group: ["**/modules/payment/**", "@/modules/payment/**"], message: "Only orchestration may access the Payment Executor boundary." },
    ],
  }],
  "no-restricted-syntax": ["error", {
    selector: "MemberExpression[property.name=/^(PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET)$/]",
    message: "PayPal credentials are confined to src/modules/payment/server/.",
  }],
};

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["src/modules/actor/**/*", "src/modules/supervisor/**/*", "src/components/**/*", "src/app/page.tsx", "src/app/runs/**/*"],
    rules: noPaymentBoundary,
  },
  globalIgnores([".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
]);
