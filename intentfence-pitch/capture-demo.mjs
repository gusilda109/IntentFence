import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const media = path.join(here, "media");
const base = "http://127.0.0.1:3000";
await mkdir(media, { recursive: true });

const health = await fetch(`${base}/api/health`);
if (!health.ok) throw new Error(`Demo health check failed: ${health.status()}`);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });

  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Coffee shop example/ }).click();
  await page.screenshot({ path: path.join(media, "home.png"), fullPage: false });

  const response = await page.request.post(`${base}/api/runs`, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      goal: "Set up a tablet-based point of sale for a coffee shop so staff can take orders and print customer receipts.",
      budget: 80000,
      constraints: [
        { text: "Keep the complete order within the stated budget.", enforcement: "hard" },
        { text: "Only include equipment necessary for the stated checkout workflow.", enforcement: "hard" },
        { text: "Prefer compact equipment with documented compatibility.", enforcement: "soft" },
      ],
    },
  });
  if (!response.ok()) throw new Error(`Run creation failed: ${response.status()} ${await response.text()}`);
  const run = await response.json();
  console.log(JSON.stringify({
    id: run.id,
    verdict: run.verdict?.decision,
    proposedTotal: run.proposedOrder?.total,
    approvedTotal: run.approvedOrder?.total,
    itemDecisions: run.verdict?.itemDecisions,
    payment: run.payment,
    replay: run.replay,
  }, null, 2));

  await page.goto(`${base}/runs/${run.id}`, { waitUntil: "networkidle" });
  await page.locator("main").waitFor();
  await page.waitForTimeout(2500);
  console.log((await page.locator("body").innerText()).slice(0, 2000));
  await page.screenshot({ path: path.join(media, "review-top.png"), fullPage: false });
  await page.locator(".run-main-column .panel").nth(0).screenshot({ path: path.join(media, "order-items.png") });
  await page.locator(".run-main-column .panel").nth(1).screenshot({ path: path.join(media, "evidence.png") });
  await page.locator(".run-side-column .panel").nth(0).screenshot({ path: path.join(media, "verdict.png") });
} finally {
  if (browser) await browser.close();
}
