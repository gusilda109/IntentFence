# IntentFence

PayPal-native сервис проверки автономных покупок. IntentFence принимает открытый пользовательский мандат, исследует локальные demo fixtures или реальный каталог Channel3, формирует Evidence Timeline и только после детерминированного разрешения создаёт **настоящий PayPal Orders v2 Sandbox Order**. Capture, refund и реальная оплата не выполняются.

## Архитектура и гарантии

- **CatalogProvider** — независимый от `APP_MODE` и `PAYPAL_MODE` выбор `FixtureCatalogProvider` или `Channel3CatalogProvider`. Channel3 использует только Search и Product Detail; выбранные offers повторно проверяются перед вердиктом.
- **Actor** — OpenAI Agents SDK, read-only snapshot выбранного каталога и structured draft; сервер создаёт trusted EvidenceRecords из verbatim excerpts и формирует `ProposedOrder`. Channel3 в Replay использует детерминированный Actor без локальных fixtures.
- **Supervisor + Policy Engine** — отдельный OpenAI Agent для семантики плюс детерминированные проверки бюджета, evidence graph, publisher independence, prompt-injection quarantine и dependency closure.
- **Approval Builder** — обычный TypeScript без LLM; выбирает только item-level `ALLOW`, пересчитывает сумму и создаёт immutable `ApprovedOrder` с hash и idempotency key.
- **Payment Executor** — единственная PayPal-граница и единственный модуль, читающий PayPal credentials. Live-режим выполняет OAuth и `POST /v2/checkout/orders` только против Sandbox.
- **Prisma + SQLite** — immutable snapshots, run idempotency, unique `approvedOrderId` / `paypalRequestId` / `paypalOrderId` и conditional lease для параллельных retries.
- **Next.js UI без чата** — Mandate Form, Order Items, Evidence Timeline, Verdict и PayPal Status.

При `BLOCK` и `REVIEW` Executor не вызывается: ни OAuth, ни Orders API. Повторный и параллельный `execute` использует сохранённый `PayPal-Request-Id`; локальный успешный Order возвращается без нового HTTP-запроса. `PAYPAL_CREATED` означает только создание Sandbox Order, **не оплату и не capture**.

## Требования

- Node.js 24 или совместимая актуальная LTS;
- npm;
- Chromium для Playwright (`npx playwright install chromium`);
- для Live: OpenAI API key и PayPal **Sandbox** REST app credentials.

## Установка

```bash
npm install
npm run dev
```

Для локального preview `.env` не требуется: development по умолчанию использует Replay и `DATABASE_URL=file:./dev.db`, а миграции применяются автоматически. Для Live скопируйте `.env.example` в `.env` и заполните credentials.

При изменении схемы вручную доступны команды:

```bash
npm run db:deploy
npm run db:migrate
```

## Значения `.env`

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | SQLite URL, по умолчанию `file:./dev.db`. |
| `APP_MODE` | `live` — настоящие Actor/Supervisor и PayPal; `replay` — сохранённые deterministic agent fixtures. |
| `OPENAI_API_KEY` | Только для Live Actor/Supervisor. Не передаётся в браузер. |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL. Для Qwen: `https://deepcode.ci.nsu.ru/api`; SDK добавляет `/chat/completions`. |
| `OPENAI_MODEL_ACTOR` | Модель Live Actor, например `Qwen3.8-27B`. |
| `OPENAI_MODEL_SUPERVISOR` | Модель Live Supervisor, например `qwen3.8-flash-next`. |
| `PAYPAL_MODE` | `live` для настоящего Sandbox REST; `mock` разрешён только вместе с `APP_MODE=replay`. |
| `PAYPAL_CLIENT_ID` | Client ID PayPal Sandbox REST app. Читается только Payment Executor server boundary. |
| `PAYPAL_CLIENT_SECRET` | Secret PayPal Sandbox REST app. Читается только Payment Executor server boundary. |
| `PAYPAL_API_BASE_URL` | `https://api-m.sandbox.paypal.com`; production endpoints отклоняются. |
| `PAYPAL_TIMEOUT_MS` | Timeout Sandbox HTTP, по умолчанию `15000`. |
| `CHANNEL3_API_KEY` | Нужен только для источника `Channel3 · live data`; читается исключительно серверным Channel3 client. |
| `CHANNEL3_TIMEOUT_MS` | Timeout одного Channel3 HTTP-запроса, по умолчанию `10000`, максимум `60000`. |

Не коммитьте `.env`. В Live не нужны и не используются mock PayPal-ответы. В Replay не нужны OpenAI/PayPal credentials, а UI явно маркирует PayPal-результат как simulated. Для Channel3 в Replay нужен только `CHANNEL3_API_KEY`.

## Запуск Replay demo

```bash
npm run dev
```

В development Replay выбирается автоматически. Явная конфигурация не нужна; при желании её можно закрепить в `.env` значениями `APP_MODE="replay"`, `PAYPAL_MODE="mock"` и `DATABASE_URL="file:./dev.db"`.

Откройте `http://localhost:3000`, нажмите кнопку coffee example или введите цель «Организуй кассу кофейни на базе планшета» и бюджет `800`. Сценарий исследует Tablet Hub, POS Supply, Maker Docs и Checkout Bundles. Ожидаемый результат — `PARTIAL_ALLOW`: планшет, совместимый принтер и adapter разрешены; seller-only `Calibration License` за $99 с quarantined prompt injection заблокирована. Approved subset создаёт один simulated Replay Order с сохранённым request ID.

Демо-страницы доступны под `/stores/...`; заражённая fixture page визуально помечена для оператора, а скрытая инструкция существует только в raw HTML.

CLI-сценарий против уже запущенного сервера:

```bash
npm run demo -- --base-url http://localhost:3000
```

Скрипт печатает только безопасные run ID, verdict, режим и PayPal status/link.

## Проверка Channel3

1. Добавьте серверный ключ в `.env`:

```dotenv
CHANNEL3_API_KEY="..."
CHANNEL3_TIMEOUT_MS="10000"
```

2. Запустите `npm run dev`, выберите `Channel3 · live data`, введите открытую цель и USD-бюджет. В Replay исследование и Policy Engine детерминированы, а PayPal остаётся simulated; в Live используются LLM Actor/Supervisor и PayPal Sandbox согласно их собственным настройкам.
3. На странице run проверьте badge `Channel3 · live data` и Evidence Timeline с классом `Aggregator`. Channel3 не получает статус manufacturer или independent reference, а commission rate не участвует в ranking/verdict.

Интеграция вызывает только `POST https://api.trychannel3.com/v1/search` и `GET https://api.trychannel3.com/v1/products/{product_id}` с locale `US/USD`. Channel3 Checkout не используется. Пустой поиск, отсутствие in-stock USD offers, невалидный ответ, timeout, rate limit или изменение цены/availability останавливают run с читаемой ошибкой. Silent fallback на fixtures отсутствует, ApprovedOrder при таких ошибках не создаётся.

## Запуск Live Sandbox

1. Создайте PayPal Developer **Sandbox** REST app и используйте только Sandbox credentials.
2. Укажите в `.env`:

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

Qwen вызывается только server-side через OpenAI Agents SDK в режиме Chat Completions. `Qwen3.8-27B` назначен Actor для исследования read-only snapshot и формирования structured draft, а быстрый `qwen3.8-flash-next` — Supervisor для semantic evaluation. Trusted evidence создаётся локально из verbatim excerpts; это исключает нестабильный многошаговый tool loop внешнего OpenAI-compatible endpoint. Детерминированный Policy Engine по-прежнему проверяет результат независимо от модели. При необходимости модель Supervisor можно заменить на `Qwen3.8-27B`.

3. Запустите:

```bash
npm run db:deploy
npm run dev
```

4. Выполните coffee demo. В Live Actor и Supervisor вызывают OpenAI Agents SDK, а Payment Executor создаёт настоящий Sandbox Order через Orders v2 REST. Повтор `execute` должен вернуть тот же order ID. Capture endpoint отсутствует.

Ручной checklist для ALLOW/BLOCK/REVIEW, последовательных и параллельных retries находится в `scripts/demo/live-sandbox.md`. После smoke test фиксируйте только безопасные order ID, status и request ID — без credentials и access token. Live smoke выполняется только после локальной настройки `.env` и не входит в автоматический тестовый прогон.

## Тесты и качество

```bash
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm test` включает unit, integration и security tests: contracts, seller-only necessity, renamed upsell и другую товарную область, injection quarantine, dependency matrix, Sandbox payload, minor-unit arithmetic, tampered approvals, нулевые OAuth/Orders calls при невалидном решении, последовательные и 10 параллельных retries.

Playwright автоматически применяет миграции к отдельной `e2e.db`, запускает и останавливает test server. E2E покрывает coffee `PARTIAL_ALLOW`, UI пяти областей, безопасный `CREATED`, повторные execute, run idempotency/conflict, `BLOCK` и `REVIEW`.

Production build и запуск:

```bash
npm run build
npm run start
```

## API

- `POST /api/runs` — требует `Idempotency-Key` и JSON `{ goal, budget, constraints, catalogSource }`; бюджет передаётся в integer minor units, `catalogSource` — `fixtures` (по умолчанию) или `channel3`.
- `GET /api/runs/:runId` — безопасный `RunView` без raw HTML, prompts, credentials и полного PayPal response.
- `POST /api/runs/:runId/execute` — идемпотентное исполнение сохранённого `ApprovedOrder`.
- `GET /api/health` — только `{ "status": "ok" }`.

## Ограничения MVP

Только USD и финальные цены выбранных offers, один purchase unit, без налогов/доставки/capture/refund/webhooks. Replay с fixtures поддерживает сохранённые coffee/printer inputs; открытые цели в Replay доступны через Channel3, а с fixtures требуют Live. Render deployment не настроен. Для старого `PAYMENT_UNKNOWN` за пределами окна PayPal idempotency требуется ручная сверка, а не автоматическое создание нового Order.
