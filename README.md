# IntentFence

A PayPal-native service for validating autonomous purchases. IntentFence accepts an open-ended user mandate, explores local demo fixtures or the live Channel3 catalog, builds an Evidence Timeline, and creates a **real PayPal Orders v2 Sandbox Order** only after deterministic approval. Capture, refunds, and actual payments are not performed.

## Architecture and Guarantees

- **CatalogProvider** — selects `FixtureCatalogProvider` or `Channel3CatalogProvider` independently of `APP_MODE` and `PAYPAL_MODE`. Channel3 uses only Search and Product Detail; selected offers are revalidated before the verdict.
- **Actor** — uses the OpenAI Agents SDK, a read-only snapshot of the selected catalog, and a structured draft. The server creates trusted EvidenceRecords from verbatim excerpts and builds a `ProposedOrder`. In Replay mode, Channel3 uses a deterministic Actor without local fixtures.
- **Supervisor + Policy Engine** — a separate OpenAI Agent for semantic evaluation, plus deterministic checks for the budget, evidence graph, publisher independence, prompt-injection quarantine, and dependency closure.
- **Approval Builder** — plain TypeScript without an LLM; selects only item-level `ALLOW` decisions, recalculates the total, and creates an immutable `ApprovedOrder` with a hash and idempotency key.
- **Payment Executor** — the only PayPal boundary and the only module that reads PayPal credentials. Live mode performs OAuth and `POST /v2/checkout/orders` exclusively against Sandbox.
- **Prisma + SQLite** — immutable snapshots, run idempotency, unique `approvedOrderId` / `paypalRequestId` / `paypalOrderId`, and conditional leases for parallel retries.
- **Next.js UI without a chat interface** — Mandate Form, Order Items, Evidence Timeline, Verdict, and PayPal Status.

For `BLOCK` and `REVIEW`, the Executor is not invoked: neither OAuth nor the Orders API is called. Repeated and parallel `execute` requests use the stored `PayPal-Request-Id`; a locally successful Order is returned without a new HTTP request. `PAYPAL_CREATED` means only that a Sandbox Order was created, **not that it was paid for or captured**.

## Requirements

- Node.js 24 or a compatible current LTS release;
- npm;
- Chromium for Playwright (`npx playwright install chromium`);
- for Live mode: an OpenAI API key and PayPal **Sandbox** REST app credentials.

## Installation

```bash
npm install
npm run dev
```

No `.env` file is required for a local preview: development defaults to Replay mode and `DATABASE_URL=file:./dev.db`, with migrations applied automatically. For Live mode, copy `.env.example` to `.env` and fill in the credentials.

The following commands are available when changing the schema manually:

```bash
npm run db:deploy
npm run db:migrate
```

## `.env` Values

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite URL; defaults to `file:./dev.db`. |
| `APP_BASE_URL` | Public HTTP(S) origin for demo fixture links. Optional on Render, where `RENDER_EXTERNAL_URL` is detected automatically; otherwise defaults to `http://localhost:3000`. |
| `APP_MODE` | `live` — real Actor/Supervisor and PayPal; `replay` — stored deterministic agent fixtures. |
| `OPENAI_API_KEY` | Used only by the Live Actor/Supervisor. Never sent to the browser. |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL. For Qwen: `https://deepcode.ci.nsu.ru/api`; the SDK appends `/chat/completions`. |
| `OPENAI_MODEL_ACTOR` | Live Actor model, for example `Qwen3.8-27B`. |
| `OPENAI_MODEL_SUPERVISOR` | Live Supervisor model, for example `qwen3.8-flash-next`. |
| `PAYPAL_MODE` | `live` for real Sandbox REST requests; `mock` is allowed only with `APP_MODE=replay`. |
| `PAYPAL_CLIENT_ID` | Client ID of the PayPal Sandbox REST app. Read only within the Payment Executor server boundary. |
| `PAYPAL_CLIENT_SECRET` | Secret of the PayPal Sandbox REST app. Read only within the Payment Executor server boundary. |
| `PAYPAL_API_BASE_URL` | `https://api-m.sandbox.paypal.com`; production endpoints are rejected. |
| `PAYPAL_TIMEOUT_MS` | Sandbox HTTP timeout; defaults to `15000`. |
| `CHANNEL3_API_KEY` | Required only for the `Channel3 · live data` source; read exclusively by the server-side Channel3 client. |
| `CHANNEL3_TIMEOUT_MS` | Timeout for a single Channel3 HTTP request; defaults to `10000`, maximum `60000`. |

Never commit `.env`. Live mode neither needs nor uses mock PayPal responses. Replay mode requires no OpenAI/PayPal credentials, and the UI explicitly labels the PayPal result as simulated. Channel3 in Replay mode requires only `CHANNEL3_API_KEY`.

## Running the Replay Demo

```bash
npm run dev
```

Replay is selected automatically in development. No explicit configuration is required; if desired, you can pin it in `.env` with `APP_MODE="replay"`, `PAYPAL_MODE="mock"`, and `DATABASE_URL="file:./dev.db"`.

Open `http://localhost:3000`, click the coffee example button, or enter the goal “Set up a coffee shop checkout based on a tablet” with a budget of `800`. The scenario explores Tablet Hub, POS Supply, Maker Docs, and Checkout Bundles. The expected result is `PARTIAL_ALLOW`: the tablet, compatible printer, and adapter are allowed; the seller-only `Calibration License` for $99 with quarantined prompt injection is blocked. The approved subset creates one simulated Replay Order with a stored request ID.

Demo pages are available under `/stores/...`; the infected fixture page is visually marked for the operator, while the hidden instruction exists only in the raw HTML.

Run the CLI scenario against an already running server:

```bash
npm run demo -- --base-url http://localhost:3000
```

The script prints only safe run IDs, the verdict, the mode, and the PayPal status/link.

## Testing Channel3

1. Add the server-side key to `.env`:

```dotenv
CHANNEL3_API_KEY="..."
CHANNEL3_TIMEOUT_MS="10000"
```

2. Run `npm run dev`, select `Channel3 · live data`, and enter an open-ended goal and a USD budget. In Replay mode, research and the Policy Engine are deterministic, while PayPal remains simulated; in Live mode, the LLM Actor/Supervisor and PayPal Sandbox are used according to their respective settings.
3. On the run page, check the `Channel3 · live data` badge and the Evidence Timeline with the `Aggregator` class. Channel3 is never assigned manufacturer or independent-reference status, and the commission rate does not affect ranking or the verdict.

The integration calls only `POST https://api.trychannel3.com/v1/search` and `GET https://api.trychannel3.com/v1/products/{product_id}` with the `US/USD` locale. Channel3 Checkout is not used. Empty search results, no in-stock USD offers, an invalid response, a timeout, rate limiting, or a price/availability change stops the run with a readable error. There is no silent fallback to fixtures, and no ApprovedOrder is created for these errors.

## Running Live Sandbox

1. Create a PayPal Developer **Sandbox** REST app and use only Sandbox credentials.
2. Set the following values in `.env`:

```dotenv
APP_MODE="live"
OPENAI_API_KEY="..."
OPENAI_BASE_URL="https://deepcode.ci.nsu.ru/api"
OPENAI_MODEL_ACTOR="Qwen3.8-27B"
OPENAI_MODEL_SUPERVISOR="qwen3.8-flash-next"
PAYPAL_MODE="live"
PAYPAL_API_BASE_URL="https://api-m.sandbox.paypal.com"
PAYPAL_CLIENT_ID="..."
PAYPAL_CLIENT_SECRET="..."
```

Qwen is called only server-side through the OpenAI Agents SDK in Chat Completions mode. `Qwen3.8-27B` is assigned to the Actor for read-only snapshot research and structured draft generation, while the faster `qwen3.8-flash-next` is assigned to the Supervisor for semantic evaluation. Trusted evidence is created locally from verbatim excerpts, avoiding an unstable multi-step tool loop on the external OpenAI-compatible endpoint. The deterministic Policy Engine still validates the result independently of the model. If necessary, the Supervisor model can be replaced with `Qwen3.8-27B`.

3. Run:

```bash
npm run db:deploy
npm run dev
```

4. Run the coffee demo. In Live mode, the Actor and Supervisor call the OpenAI Agents SDK, and the Payment Executor creates a real Sandbox Order through the Orders v2 REST API. Repeating `execute` must return the same order ID. There is no capture endpoint.

A manual checklist for ALLOW/BLOCK/REVIEW and sequential/parallel retries is available in `scripts/demo/live-sandbox.md`. After a smoke test, record only safe order IDs, statuses, and request IDs—never credentials or access tokens. The Live smoke test runs only after local `.env` configuration and is not included in the automated test suite.

## Testing and Quality

```bash
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm test` includes unit, integration, and security tests: contracts, seller-only necessity, renamed upsells and other product domains, injection quarantine, the dependency matrix, Sandbox payloads, minor-unit arithmetic, tampered approvals, zero OAuth/Orders calls for invalid decisions, sequential retries, and 10 parallel retries.

Playwright automatically applies migrations to a separate `e2e.db` and starts and stops the test server. E2E coverage includes coffee `PARTIAL_ALLOW`, the UI in all five areas, safe `CREATED`, repeated execution, run idempotency/conflicts, `BLOCK`, and `REVIEW`.

Production build and startup:

```bash
npm run build
npm run start
```

## API

- `POST /api/runs` — requires `Idempotency-Key` and JSON `{ goal, budget, constraints, catalogSource }`; the budget is passed in integer minor units, and `catalogSource` is `fixtures` (default) or `channel3`.
- `GET /api/runs/:runId` — returns a safe `RunView` without raw HTML, prompts, credentials, or the full PayPal response.
- `POST /api/runs/:runId/execute` — idempotently executes the stored `ApprovedOrder`.
- `GET /api/health` — returns only `{ "status": "ok" }`.

## MVP Limitations

USD only, final prices of selected offers only, one purchase unit, and no taxes, shipping, capture, refunds, or webhooks. Replay with fixtures supports stored coffee/printer inputs; open-ended goals in Replay are available through Channel3, while fixtures require Live mode. Render deployment is not configured. An old `PAYMENT_UNKNOWN` outside the PayPal idempotency window requires manual reconciliation rather than automatic creation of a new Order.
