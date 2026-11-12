import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PaymentExecutionViewSchema,
  RunViewSchema,
  type RunView,
} from "../../src/shared/contracts/index.js";
import { CHANNEL3_EXAMPLES } from "../../src/components/channel3-examples.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 120_000;

function getExample() {
  const example = CHANNEL3_EXAMPLES.find((candidate) => candidate.id === "home-office-mouse");
  if (!example) throw new Error("The home-office-mouse Channel3 example is missing.");
  return example;
}

const EXAMPLE = getExample();

class DemoError extends Error {}

function usage(): never {
  console.log("Usage: npm run demo -- [--base-url http://127.0.0.1:3000]");
  console.log("Environment alternative: INTENTGUARD_BASE_URL");
  process.exit(0);
}

function resolveBaseUrl(): string {
  const args = process.argv.slice(2);
  let value = process.env.INTENTGUARD_BASE_URL ?? process.env.INTENTFENCE_BASE_URL ?? DEFAULT_BASE_URL;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument === "--base-url") {
      const next = args[index + 1];
      if (!next) throw new DemoError("Demo failed: --base-url requires a value.");
      value = next;
      index += 1;
    } else if (argument.startsWith("--base-url=")) {
      value = argument.slice("--base-url=".length);
    } else {
      throw new DemoError(`Demo failed: unsupported argument ${argument}.`);
    }
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DemoError("Demo failed: base URL is invalid.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new DemoError("Demo failed: base URL must be HTTP(S) without embedded credentials.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response, operation: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DemoError(`Demo failed: ${operation} returned a non-JSON response.`);
  }
}

async function createRun(baseUrl: string): Promise<RunView> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        goal: EXAMPLE.goal,
        budget: Math.round(Number(EXAMPLE.budget) * 100),
        constraints: EXAMPLE.constraints,
        catalogSource: "channel3",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DemoError("Demo failed: POST /api/runs did not complete.");
  }

  const body = await responseJson(response, "POST /api/runs");
  if (response.status !== 201 && response.status !== 200) {
    throw new DemoError(`Demo failed: POST /api/runs returned HTTP ${response.status}.`);
  }
  try {
    return RunViewSchema.parse(body);
  } catch {
    throw new DemoError("Demo failed: POST /api/runs returned an invalid RunView.");
  }
}

async function executeApprovedOrder(baseUrl: string, run: RunView): Promise<RunView> {
  if (!run.approvedOrder || run.payment) return run;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/runs/${run.id}/execute`, {
      method: "POST",
      headers: { "Idempotency-Key": run.approvedOrder.idempotencyKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DemoError("Demo failed: payment execution did not complete.");
  }

  const body = await responseJson(response, "POST execute");
  if (response.status !== 200) {
    throw new DemoError(`Demo failed: POST execute returned HTTP ${response.status}.`);
  }
  try {
    const result = z.object({
      payment: PaymentExecutionViewSchema,
      createdNow: z.boolean(),
    }).strict().parse(body);
    return { ...run, payment: result.payment, status: result.payment.status };
  } catch {
    throw new DemoError("Demo failed: POST execute returned an invalid payment view.");
  }
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const created = await createRun(baseUrl);
  const run = await executeApprovedOrder(baseUrl, created);
  const paypalStatus = run.payment?.paypalStatus ?? "NOT_REQUESTED";

  if (run.replay) {
    console.log("Mode: Replay — PayPal is simulated; no real Sandbox order was created.");
  } else {
    console.log("Mode: Live — PayPal Sandbox order creation is enabled.");
  }
  console.log(`Run ID: ${run.id}`);
  console.log(`Verdict: ${run.verdict?.decision ?? "UNAVAILABLE"}`);
  console.log(`PayPal order status: ${paypalStatus}${run.replay && run.payment ? " (simulated)" : ""}`);
  if (run.payment?.approveUrl) console.log(`Approve URL: ${run.payment.approveUrl}`);

  if (run.catalogSource !== "channel3") {
    throw new DemoError("Demo failed: expected the Channel3 catalog source.");
  }
  if (run.verdict?.decision !== "ALLOW") {
    throw new DemoError("Demo failed: expected ALLOW for the home-office mouse scenario.");
  }
  if (run.payment?.status !== "PAYPAL_CREATED" || paypalStatus !== "CREATED") {
    throw new DemoError("Demo failed: expected a CREATED PayPal order.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DemoError ? error.message : "Demo failed unexpectedly.");
  process.exitCode = 1;
});
