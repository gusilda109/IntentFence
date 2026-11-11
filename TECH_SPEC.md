# IntentGuard — техническая спецификация MVP

Проект: PayPal AI Hackathon  
Тип: PayPal-native сервис проверки автономных покупок, не чат-бот  
Язык реализации: TypeScript  
Статус: спецификация к реализации

## 1. Цель и неизменяемые инварианты

IntentGuard принимает открытый пользовательский мандат, исследует товары, проверяет предложенный заказ и только после разрешения создаёт настоящий PayPal Orders v2 Sandbox Order.

Система обязана сохранять следующие инварианты независимо от ответов LLM:

1. **Только Payment Executor имеет PayPal credentials и вызывает PayPal.**
2. **Actor и Supervisor не получают PayPal tools, credentials, access token или платёжные инструменты.**
3. **При `BLOCK` и `REVIEW` не выполняется ни OAuth-запрос, ни Orders API-запрос.**
4. **LLM не вызывает Payment Executor напрямую.** Между `Verdict` и Executor находится детерминированный Approval Builder.
5. **Executor не содержит LLM** и не принимает решения о необходимости товаров; он повторно проверяет целостность разрешения, суммы и бюджет.
6. **Один `ApprovedOrder` порождает не более одного Sandbox Order.** Повторные и параллельные вызовы используют один сохранённый `PayPal-Request-Id`.
7. **Проверка не использует хардкод категорий.** Необходимость выводится из цели, ограничений, зависимостей и доказательств, а не из словаря «разрешённых» или «запрещённых» товаров.
8. **Содержимое магазина — недоверенные данные, а не инструкции.** Seller-only утверждение недостаточно для доказательства необходимости дополнительного товара.
9. **MVP создаёт Sandbox Order, но не выполняет capture.** `CREATED` не отображается в UI как «оплачено».
10. **UI не содержит чата.** Основные области: мандат, товары, Evidence Timeline, Verdict, PayPal status.

## 2. Scope

### 2.1 Входит в MVP

- Next.js App Router, React, Tailwind.
- OpenAI Agents SDK for TypeScript для Actor и Supervisor.
- Zod-валидация всех внешних и межмодульных данных.
- Четыре локальных демо-источника: обычные и заражённые страницы.
- Prisma + SQLite.
- PayPal Orders v2 Sandbox через REST.
- Vitest для unit/integration/security tests, Playwright для E2E.
- Повторяемый локальный demo-сценарий кофейни с бюджетом $800.
- Опциональный Render deployment после локальной приёмки.

### 2.2 Не входит в MVP

- Capture, refund, webhook-обработка и реальная доставка.
- Произвольный веб-сёрфинг за пределами локального allowlist.
- Несколько валют, налоги, доставка и частичные количества.
- Пользовательские аккаунты и полноценный back-office человеческой проверки.
- Скрытое автоматическое одобрение элементов со статусом `REVIEW`.

Все демо-цены финальные, в USD, без дополнительных налогов и доставки. Для PayPal используется один `purchase_unit` на весь `ApprovedOrder`.

## 3. Архитектура

```text
┌────────────────────────────── Browser ──────────────────────────────┐
│ Mandate Form │ Items │ Evidence Timeline │ Verdict │ PayPal Status │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ typed REST, без PayPal secrets
┌──────────────────────────────────▼──────────────────────────────────┐
│                       Next.js server / Orchestrator                  │
│  создаёт Run, сохраняет snapshots, вызывает модули последовательно   │
└───────────────┬──────────────────────┬──────────────────┬───────────┘
                │                      │                  │
┌───────────────▼──────────────┐ ┌─────▼──────────────┐ ┌─▼────────────────────┐
│ Actor Agent + read-only tools│ │ IntentGuard        │ │ Approval Builder     │
│ исследует открытую цель      │ │ Supervisor         │ │ обычный TypeScript   │
│ формирует ProposedOrder      │ │ + Policy Engine    │ │ строит ApprovedOrder │
│ НЕ имеет PayPal              │ │ ALLOW/BLOCK/REVIEW/│ │ из ALLOW-подмножества│
│                              │ │ PARTIAL_ALLOW      │ │ без LLM              │
└───────────────┬──────────────┘ └─────┬──────────────┘ └─┬────────────────────┘
                │ Evidence             │ Verdict          │ ApprovedOrder
┌───────────────▼──────────────┐       │                  │
│ Local demo stores + trusted  │       │                  │
│ capture/security metadata    │       │                  │
└──────────────────────────────┘       │                  │
                                       │        ┌─────────▼─────────────────────┐
                                       │        │ Payment Executor              │
                                       │        │ deterministic TypeScript      │
                                       │        │ единственный PayPal boundary  │
                                       │        │ OAuth + Orders v2 Sandbox     │
                                       │        └─────────┬─────────────────────┘
                                       │                  │
                                ┌──────▼──────────────────▼──────┐
                                │ Prisma + SQLite                │
                                │ Run / Evidence / PaymentExecution│
                                └────────────────────────────────┘
```

### 3.1 Три разных уровня доверия

1. **Недоверенные:** страницы магазинов, seller claims, скрытый HTML, свободный текст, выход Actor до валидации.
2. **Проверяемые:** структурированные `ProposedOrder`, `Evidence`, `Verdict`; их схемы и связи проверяются, но они ещё не являются платёжным разрешением.
3. **Детерминированные:** allowlist источников, content hashes, store registry, денежные расчёты, Approval Builder, Prisma uniqueness, Payment Executor.

### 3.2 Разделение LLM-ролей

- Actor и Supervisor — отдельные Agent instances с раздельными контекстами.
- Actor получает только read-only catalog/evidence tools.
- Supervisor не получает сетевых или PayPal tools. Он работает с мандатом, предложением, evidence metadata и security reports.
- Оба агента возвращают structured output через Zod `outputType`.
- Ни один agent output не передаётся в PayPal напрямую.
- Store content никогда не добавляется в system prompt как инструкция.

## 4. Поток данных

1. UI отправляет открытый `goal`, бюджет и свободно сформулированные ограничения.
2. Orchestrator валидирует `Mandate`, создаёт `Run` и ключ идемпотентности запуска.
3. Actor через read-only tools изучает локальные каталоги и документы.
4. Evidence Acquisition Layer сохраняет для каждой страницы:
   - canonical URL и `publisherId` из trusted store registry;
   - visible text и отдельно security scan сырого HTML;
   - `retrievedAt`, locator, content hash;
   - класс источника по registry, а не по утверждению Actor.
5. Actor формирует `ProposedOrder` и ссылается на уже сохранённые `Evidence.id`. Самостоятельно выдуманные evidence IDs отклоняются.
6. Orchestrator проверяет Zod-схему, ссылки, hashes, арифметику и соответствие `mandateId`.
7. Supervisor и Policy Engine оценивают каждый item и заказ целиком.
8. `Verdict` сохраняется вместе с `inputHash`, `policyVersion` и item-level findings.
9. При `ALLOW` или viable `PARTIAL_ALLOW` Approval Builder:
   - выбирает только item IDs с `ALLOW`;
   - удаляет неразрешённые элементы;
   - повторно вычисляет dependency closure и сумму;
   - создаёт immutable `ApprovedOrder` с `approvalHash` и сохранённым `idempotencyKey`.
10. Payment Executor атомарно получает или создаёт `PaymentExecution`, повторно валидирует вход и только затем обращается к PayPal.
11. PayPal order ID, status, approval link и безопасная часть ответа сохраняются и отображаются в UI.
12. Повторный `execute` для того же `ApprovedOrder` возвращает существующий результат; новый PayPal Order не создаётся.

### 4.1 Семантика Verdict

- `ALLOW`: все items разрешены, нет unresolved critical findings, заказ можно создать целиком.
- `PARTIAL_ALLOW`: не менее одного item разрешено, остальные `BLOCK` или `REVIEW`; все явно запрошенные core-товары сохранены, разрешённое подмножество самостоятельно viable и не нарушает мандат.
- `REVIEW`: автоматически создавать заказ нельзя, но неопределённость потенциально разрешима человеком или новыми доказательствами.
- `BLOCK`: ни один безопасный viable заказ не разрешён либо обнаружено критическое нарушение мандата/безопасности.

Если удаление заблокированного элемента делает разрешённое подмножество бесполезным — например, остаётся аксессуар без обязательного базового устройства — нельзя выдавать `PARTIAL_ALLOW`. Используется `REVIEW` или `BLOCK` с `UNMET_DEPENDENCY`.

### 4.2 Состояния Run

```text
ACTOR_RUNNING
  → PROPOSED
  → SUPERVISOR_RUNNING
  → BLOCKED | REVIEW_REQUIRED | APPROVED
                                  → PAYMENT_PENDING
                                  → PAYPAL_CREATED
                                  → PAYMENT_RETRYABLE
                                  → PAYMENT_UNKNOWN
```

- `PAYMENT_UNKNOWN` означает timeout/неопределённый результат, а не отсутствие заказа.
- Повтор из `PAYMENT_RETRYABLE` и `PAYMENT_UNKNOWN` использует тот же `PayPal-Request-Id`.
- Переходы в `BLOCKED` и `REVIEW_REQUIRED` терминальны для текущего proposal и никогда не вызывают Executor.

## 5. Shared Zod-контракты

Расположение: `src/shared/contracts/`. Это locked surface: параллельные агенты не изменяют его.

Общие правила:

- Все object schemas `.strict()`: неизвестные поля, включая `card`, `paymentSource`, `accessToken`, `clientSecret`, отклоняются.
- Все деньги — integer minor units. В MVP $800 = `80000`; конвертацию в decimal string выполняет только Executor.
- Все timestamps — ISO 8601; IDs — UUID, кроме стабильных человекочитаемых `storeId`, `publisherId`, `captureId`.
- `schemaVersion: "1"` обязателен.
- `Evidence` создаётся только Evidence Acquisition Layer из trusted capture metadata. Actor включает в `ProposedOrder.evidenceIds` только ссылки и не возвращает собственные копии Evidence.
- Ниже — нормативные контракты, а не реализация приложения.

```ts
import { z } from "zod";

const Id = z.string().uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDateTime = z.string().datetime({ offset: true });
const Text = (max: number) => z.string().trim().min(1).max(max);

export const MoneySchema = z.object({
  currency: z.literal("USD"),
  amountMinor: z.number().int().nonnegative().max(10_000_000),
}).strict();

export const MandateConstraintSchema = z.object({
  id: Text(100),
  text: Text(500),
  enforcement: z.enum(["hard", "soft"]),
}).strict();

export const MandateSchema = z.object({
  schemaVersion: z.literal("1"),
  id: Id,
  goal: Text(2_000),
  budget: MoneySchema,
  constraints: z.array(MandateConstraintSchema).max(20),
  createdAt: IsoDateTime,
}).strict();

export const EvidenceClaimSchema = z.object({
  kind: z.enum(["necessity", "compatibility", "price", "feature", "risk"]),
  text: Text(1_000),
}).strict();

export const EvidenceSourceSchema = z.object({
  storeId: Text(100),
  publisherId: Text(100),
  url: z.string().url().max(2_048),
  sourceClass: z.enum([
    "seller",
    "manufacturer",
    "independent_reference",
    "user",
  ]),
}).strict();

export const EvidenceSchema = z.object({
  schemaVersion: z.literal("1"),
  id: Id,
  captureId: Text(100),
  itemId: Id.optional(),
  source: EvidenceSourceSchema,
  locator: Text(500),
  excerpt: Text(4_000),
  claims: z.array(EvidenceClaimSchema).min(1).max(20),
  contentHash: Hash,
  retrievedAt: IsoDateTime,
}).strict();

export const CompatibilityClaimSchema = z.object({
  withItemId: Id.nullable(),
  requirement: Text(1_000),
  evidenceIds: z.array(Id).min(1).max(20),
}).strict();

export const ProposedOrderItemSchema = z.object({
  id: Id,
  storeId: Text(100),
  productUrl: z.string().url().max(2_048),
  name: Text(120),
  description: Text(1_000),
  quantity: z.number().int().min(1).max(20),
  unitPrice: MoneySchema,
  purpose: Text(1_000),
  necessityEvidenceIds: z.array(Id).min(1).max(20),
  compatibility: z.array(CompatibilityClaimSchema).max(20),
}).strict();

export const ProposedOrderSchema = z.object({
  schemaVersion: z.literal("1"),
  id: Id,
  mandateId: Id,
  items: z.array(ProposedOrderItemSchema).min(1).max(20),
  evidenceIds: z.array(Id).min(1).max(100),
  total: MoneySchema,
  assumptions: z.array(Text(500)).max(20),
  createdAt: IsoDateTime,
}).strict();

export const PolicyFindingSchema = z.object({
  code: z.enum([
    "BUDGET_EXCEEDED",
    "MANDATE_CONFLICT",
    "INSUFFICIENT_NECESSITY",
    "SELLER_ONLY_NECESSITY",
    "INSUFFICIENT_COMPATIBILITY",
    "INCOMPATIBLE",
    "PROMPT_INJECTION",
    "UNTRUSTED_EVIDENCE",
    "INVALID_ARITHMETIC",
    "UNMET_DEPENDENCY",
    "OTHER",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  message: Text(1_000),
  itemId: Id.optional(),
  evidenceIds: z.array(Id).max(20),
}).strict();

export const ItemDecisionSchema = z.object({
  itemId: Id,
  decision: z.enum(["ALLOW", "BLOCK", "REVIEW"]),
  reasons: z.array(PolicyFindingSchema).max(20),
}).strict();

export const VerdictSchema = z.object({
  schemaVersion: z.literal("1"),
  id: Id,
  mandateId: Id,
  proposedOrderId: Id,
  decision: z.enum(["ALLOW", "BLOCK", "REVIEW", "PARTIAL_ALLOW"]),
  itemDecisions: z.array(ItemDecisionSchema).min(1).max(20),
  findings: z.array(PolicyFindingSchema).max(50),
  summary: Text(2_000),
  policyVersion: Text(100),
  inputHash: Hash,
  evaluatedAt: IsoDateTime,
}).strict();

export const ApprovedOrderItemSchema = z.object({
  sourceItemId: Id,
  storeId: Text(100),
  productUrl: z.string().url().max(2_048),
  name: Text(120),
  quantity: z.number().int().min(1).max(20),
  unitPrice: MoneySchema,
}).strict();

export const ApprovedOrderSchema = z.object({
  schemaVersion: z.literal("1"),
  id: Id,
  mandateId: Id,
  proposedOrderId: Id,
  verdictId: Id,
  verdictDecision: z.enum(["ALLOW", "PARTIAL_ALLOW"]),
  items: z.array(ApprovedOrderItemSchema).min(1).max(20),
  total: MoneySchema,
  approvalHash: Hash,
  idempotencyKey: Id,
  createdAt: IsoDateTime,
}).strict();

export type Mandate = z.infer<typeof MandateSchema>;
export type ProposedOrder = z.infer<typeof ProposedOrderSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type ApprovedOrder = z.infer<typeof ApprovedOrderSchema>;
```

### 5.1 Дополнительные referential invariants

Zod object shape недостаточен; shared validation также проверяет:

- `ProposedOrder.mandateId` совпадает с текущим мандатом.
- Item IDs уникальны; `ProposedOrder.evidenceIds` не содержит дубликатов и включает все necessity/compatibility evidence references; каждый ID существует в trusted EvidenceRecord.
- `productUrl` принадлежит указанному `storeId` и локальному allowlist.
- `total.amountMinor` равен сумме `unitPrice.amountMinor × quantity`.
- `Evidence.captureId`, `contentHash`, `publisherId`, `sourceClass` совпадают с trusted capture metadata.
- `itemId` в Evidence, если задан, ссылается на существующий item.
- `Verdict.inputHash` вычислен от канонических `{mandate, proposedOrder, trustedEvidenceMetadata, securityReports}`.
- `itemDecisions` покрывает каждый item ровно один раз; decision соответствует матрице из раздела 4.1.
- Любой `BLOCK`/`REVIEW` имеет хотя бы одну причину.
- Все `ApprovedOrder.items` имеют item-level `ALLOW`; состав и цены побайтово соответствуют исходному proposal.
- `approvalHash` вычислен от канонических `{mandateId, proposedOrderId, verdictId, items, total}`.
- `ApprovedOrder.total ≤ Mandate.budget`, валюта совпадает.

### 5.2 Внутренние порты модулей

Сигнатуры фиксируются в shared types, но не дают доступа к credentials:

```ts
interface ActorPort {
  propose(mandate: Mandate): Promise<ProposedOrder>;
}

interface SupervisorPort {
  evaluate(mandate: Mandate, proposedOrder: ProposedOrder): Promise<Verdict>;
}

interface PaymentExecutorPort {
  execute(approvedOrder: ApprovedOrder): Promise<PaymentExecutionView>;
}
```

`PaymentExecutionView` — безопасный read model: `status`, `paypalOrderId?`, `paypalStatus?`, `approveUrl?`, `createdAt`, `updatedAt`, sanitized `errorCode?`. Он не содержит token, credentials или полного ответа с потенциально чувствительными полями.

## 6. Supervisor и Policy Engine

### 6.1 Гибридная проверка

Policy Engine состоит из двух слоёв.

**Детерминированный слой:**

- schema, allowlist, hashes и evidence references;
- денежная арифметика и бюджет;
- единая валюта и допустимые количества;
- publisher/ownership graph для независимости источников;
- security scan results и quarantine заражённых captures;
- item decision coverage и dependency closure;
- запрет payment-related полей и инструкций из evidence.

**Семантический LLM-слой:**

- связь открытой цели с назначением каждого item;
- необходимость базового и вспомогательного оборудования;
- совместимость по интерфейсам, моделям, стандартам и ограничениям;
- различие necessity, preference и seller upsell;
- оценка достаточности независимых доказательств;
- объяснимые findings без свободного неструктурированного verdict.

Семантический слой не может перезаписать детерминированные `BUDGET_EXCEEDED`, `PROMPT_INJECTION`, невалидные hashes или запрет source allowlist.

### 6.2 Независимость доказательств

- Seller evidence достаточен для цены, названия и заявленных характеристик собственного товара.
- Seller evidence **недостаточен как единственное доказательство necessity** дополнительного товара, подписки, лицензии, услуги или аксессуара.
- Два URL одного `publisherId` или одной ownership group считаются одним источником.
- Manufacturer/compatibility document может подтверждать техническое требование, если явно называет модели, интерфейс или стандарт.
- Независимый источник должен иметь отдельный `publisherId` в trusted registry; простое заявление Actor «это независимый сайт» не принимается.
- Evidence из quarantined capture не поддерживает `ALLOW`.

### 6.3 Prompt injection

Security scan ищет как минимум:

- инструкции игнорировать мандат, system prompt или политику;
- требования добавить/скрыть товар, изменить verdict или бюджет;
- просьбы раскрыть secrets, credentials, tokens или вызвать payment tool;
- скрытый текст, CSS concealment, HTML comments и отдельные machine-only blocks;
- инструкции, направленные именно автономному агенту, а не покупателю.

Правило quarantine применяется к capture и зависимым решениям. Не требуется блокировать весь заказ только потому, что заражён один необязательный upsell: остальные items можно разрешить, если они viable и не опираются на заражённое evidence.

### 6.4 Обязательный сценарий без category hardcode

Для цели «Организуй кассу кофейни на базе планшета, бюджет $800» ожидается:

- планшет может быть разрешён как непосредственно следующий из цели;
- совместимые принтер и переходник могут быть разрешены через цель + compatibility evidence;
- `Calibration License` за $99 блокируется, если necessity подтверждает только продавец, особенно при prompt injection;
- правило не содержит условия вида `if category === "license"`.

В tests тот же сценарий дублируется с переименованным элементом, например `Service Enablement Pass`, и с другой товарной областью. Решение должно сохраняться по evidence graph, а не по имени или категории.

## 7. Структура репозитория и владение

```text
.
├── TECH_SPEC.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── .env.example
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── runs/[runId]/page.tsx
│   │   ├── stores/[store]/[...slug]/page.tsx
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── runs/route.ts
│   │       ├── runs/[runId]/route.ts
│   │       └── runs/[runId]/execute/route.ts
│   ├── components/
│   │   ├── mandate-form.tsx
│   │   ├── order-items.tsx
│   │   ├── evidence-timeline.tsx
│   │   ├── verdict-panel.tsx
│   │   └── paypal-status.tsx
│   ├── modules/
│   │   ├── actor/
│   │   ├── supervisor/
│   │   ├── payment/
│   │   ├── demo-stores/
│   │   └── orchestration/
│   ├── server/
│   │   ├── db.ts
│   │   ├── run-repository.ts
│   │   └── canonical-json.ts
│   └── shared/
│       ├── contracts/
│       └── views/
└── tests/
    ├── unit/
    ├── integration/
    ├── security/
    ├── fixtures/
    └── e2e/
```

### 7.1 Матрица записи

| Владелец | Разрешённые пути |
|---|---|
| Integrator / lead | Root config, `TECH_SPEC.md`, `src/shared/**`, `src/server/**`, `src/modules/orchestration/**`, `src/app/api/**`, `prisma/schema.prisma` |
| PayPal Backend agent | `src/modules/payment/**`, `tests/unit/payment/**`, `tests/integration/payment/**` |
| Actor + demo stores agent | `src/modules/actor/**`, `src/modules/demo-stores/**`, `src/app/stores/**`, `tests/unit/actor/**`, `tests/fixtures/stores/**` |
| Supervisor + Policy Engine agent | `src/modules/supervisor/**`, `tests/unit/supervisor/**`, `tests/fixtures/policy/**` |
| Frontend agent | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/runs/**`, `src/components/**`, `src/app/globals.css` |
| QA + demo agent | `tests/e2e/**`, `tests/security/**`, `scripts/demo/**`, demo documentation section в `README.md` по запросу integrator |

Агенты могут читать весь репозиторий, но писать только в свои пути. `package.json`, Prisma schema и shared contracts меняет integrator по явному запросу; агент не должен обходить это локальными копиями типов.

## 8. API endpoints

### `POST /api/runs`

Создаёт мандат и синхронно выполняет Actor → Supervisor →, если разрешено, Executor.

- Headers: `Idempotency-Key` обязателен; `Content-Type: application/json`.
- Body: `{ goal, budget, constraints }` без server-generated `id` и `createdAt`.
- `201`: новый `RunView`.
- Повтор с тем же key и тем же canonical body: `200` с существующим `RunView`, без повторного запуска/PayPal.
- Тот же key с другим body: `409 IDEMPOTENCY_CONFLICT`.
- `422 CONTRACT_VALIDATION_ERROR`: невалидный вход или agent output; PayPal не вызывается.

MVP использует синхронный запрос; UI показывает этапы выполнения без чата и streaming-транскрипта модели.

### `GET /api/runs/:runId`

Возвращает `RunView`:

- текущий status;
- `Mandate`;
- `ProposedOrder` и item states;
- Evidence Timeline с timestamps, source, excerpt, findings;
- `Verdict`;
- `ApprovedOrder`, если создан;
- `PaymentExecutionView`, если была попытка исполнения.

`404` для неизвестного ID. Ответ не содержит raw HTML, prompts, credentials, access tokens или полного PayPal response.

### `POST /api/runs/:runId/execute`

Идемпотентно исполняет уже существующий `ApprovedOrder`.

- `200`: `{ payment, createdNow }`; и при первом успехе, и при повторе.
- `409 RUN_NOT_APPROVABLE`: текущий Verdict `BLOCK`/`REVIEW` или approval отсутствует.
- `409 APPROVAL_HASH_MISMATCH`: snapshot изменён; PayPal не вызывается.
- PayPal timeout возвращается как сохранённый `PAYMENT_UNKNOWN` с возможностью retry, а не как новый заказ.

### `GET /api/health`

Возвращает только `{ status: "ok" }`. Не раскрывает env, наличие credentials или PayPal response.

### Локальные store routes

`GET /stores/:store/...` — обычные HTML-страницы демо-магазинов. Это не payment API. Они доступны только Actor tools и browser demo navigation; скрытые заражённые блоки существуют только в явно обозначенных fixture pages.

## 9. Границы модулей

### Actor

Может: читать мандат, вызывать catalog/evidence tools, формировать `ProposedOrder`.  
Не может: импортировать payment module, читать PayPal env, выполнять fetch вне allowlist, создавать `ApprovedOrder`, менять source metadata.

### Supervisor

Может: читать мандат, proposal, trusted evidence metadata, security reports; возвращать `Verdict`.  
Не может: получать сетевые/payment tools, менять proposal, создавать PayPal payload, выбирать цены вне proposal.

### Approval Builder

Может: детерминированно выбрать ALLOW items, пересчитать closure/total/hash, создать `ApprovedOrder`.  
Не может: вызывать LLM, добавлять новые items, переосмысливать policy.

### Payment Executor

Может: прочитать PayPal env внутри своего server-only модуля, получить OAuth token, создать/повторить Orders v2 request, сохранить sanitized result.  
Не может: вызывать LLM, менять состав заказа, принимать raw `ProposedOrder` вместо `ApprovedOrder`, выполнять capture в MVP.

### Frontend

Может: вызывать typed REST API и отображать read models.  
Не может: импортировать server-only modules, получать credentials, конструировать `ApprovedOrder`, самостоятельно решать, что Verdict разрешает оплату.

Границы поддерживаются `server-only`, ESLint restricted imports и security tests. Общий Node.js процесс сам по себе не считается защитой от произвольного вредоносного кода; запрет обеспечивается архитектурной изоляцией, ревью и статическими проверками.

## 10. Persistence и идемпотентность

Минимальные Prisma-сущности:

- `Run`: IDs, status, timestamps, run idempotency key, immutable JSON snapshots мандата/proposal/verdict/approval, hashes.
- `EvidenceRecord`: run ID, evidence ID, capture ID, source metadata, excerpt, content hash, security status, timestamps.
- `PaymentExecution`: run ID, approved order ID, approval hash, `paypalRequestId`, PayPal order ID, status, sanitized response/error, timestamps.
- `PolicyEvent`: ordered findings для Evidence Timeline и объяснимого UI.

Уникальные ограничения:

- `Run.runIdempotencyKey`;
- `PaymentExecution.approvedOrderId`;
- `PaymentExecution.paypalRequestId`;
- не-null `PaymentExecution.paypalOrderId`.

### 10.1 Алгоритм Executor

1. Валидировать `ApprovedOrder` и сверить с persisted snapshots до OAuth.
2. В транзакции получить или создать execution с сохранённым `paypalRequestId = approvedOrder.idempotencyKey` и атомарно захватить in-flight lease через conditional status update.
3. Если уже есть PayPal order ID — вернуть его без HTTP.
4. Если lease принадлежит другому вызову, ожидать/перечитать тот же execution; не создавать вторую logical operation. Локальный mutex может дополнять, но не заменяет DB uniqueness и lease.
5. Вызвать OAuth и `POST https://api-m.sandbox.paypal.com/v2/checkout/orders` с `PayPal-Request-Id`.
6. При успехе сохранить `id`, `status`, `approve` link и вернуть `PAYPAL_CREATED`.
7. При timeout/сетевой неопределённости сохранить `PAYMENT_UNKNOWN`; retry повторяет тот же request body и тот же request ID.
8. Никогда не генерировать новый request ID для retry того же `ApprovedOrder`.

PayPal-идемпотентность не заменяет локальную uniqueness: оба механизма обязательны. Срок хранения idempotency key на стороне PayPal ограничен. После успеха локальный повтор возвращает сохранённый Order независимо от этого срока. Если результат остался `PAYMENT_UNKNOWN`, а окно идемпотентности PayPal могло истечь, слепой automatic create запрещён: требуется ручная сверка/разрешение неопределённости, а не новый request ID. В integration tests мокируется HTTP и проверяется один create при последовательных и параллельных вызовах.

### 10.2 PayPal payload

- `intent: "CAPTURE"` описывает будущий checkout intent, но MVP не вызывает capture endpoint.
- Один `purchase_unit`; `reference_id = ApprovedOrder.id`, `custom_id = approvalHash`.
- `amount.value` и `breakdown.item_total.value` равны пересчитанному total.
- Каждый item содержит name, string quantity и `unit_amount` в decimal USD.
- Decimal strings формируются из minor units без float arithmetic.
- Credentials читаются только внутри `src/modules/payment/server/`; token кэшируется только server-side и не логируется.

## 11. Демо-источники

1. **Tablet Hub** — обычные страницы планшетов и характеристик.
2. **POS Supply** — обычные страницы receipt printer и interface adapter.
3. **Maker Docs** — независимые manufacturer/compatibility documents с отдельным publisher identity.
4. **Checkout Bundles** — нормальные listing pages и отдельная заражённая страница с `Calibration License` и скрытой инструкцией агенту.

Fixtures должны быть разнообразными по названиям и структуре, чтобы Policy Engine не проходил demo через keyword matching. Заражённые fixture pages визуально помечаются в demo catalog для оператора, но скрытая инструкция не отображается как обычный текст покупателю.

Для надежной презентации допускаются два явно разделённых режима:

- **Live:** настоящие Actor/Supervisor calls и настоящий Sandbox Order.
- **Replay:** сохранённые agent inputs для unit/E2E determinism; PayPal при этом мокируется и UI/логи не выдают его за настоящий Sandbox результат.

## 12. План интеграции

### Этап 0 — Skeleton и contract freeze

Integrator создаёт Next.js skeleton, зависимости, Prisma models, shared contracts, ports и API route shells. Добавляет contract tests и ownership rules. До завершения этапа параллельная реализация не начинается.

### Этап 1 — Пять параллельных workstreams

Каждый агент работает только в своих файлах и использует mocks для соседних портов. Результат каждого workstream проходит собственные unit tests без изменения shared contracts.

### Этап 2 — Orchestration

Integrator соединяет Run repository, Actor, Supervisor, Approval Builder и Executor. Включает persisted snapshots, state machine и API idempotency. На этом этапе PayPal HTTP мокируется.

### Этап 3 — Security и policy integration

Прогоняются injection fixtures, seller-only necessity, dependency closure, tampered approvals и static secret-boundary tests. При любом fail PayPal mock call count должен быть нулём.

### Этап 4 — Live PayPal Sandbox

С реальными Sandbox credentials выполняется ручной smoke test: ALLOW создаёт настоящий Order; повтор и параллельные retries оставляют один PayPal order ID и один request ID. BLOCK отдельно проверяется без OAuth/Orders calls.

### Этап 5 — UI/E2E и репетиция demo

Playwright проходит мандат → items → timeline → verdict → PayPal status. Проверяются ALLOW, PARTIAL_ALLOW, BLOCK и retry. После этого опционально добавляется Render config без изменения архитектурных границ.

## 13. Definition of Done

### Контракты и policy

- [ ] Все пять Zod-контрактов строгие, типизированы и используются на границах.
- [ ] Нет платёжных полей в Mandate/ProposedOrder/Evidence/Verdict.
- [ ] Coffee demo решается без category/product keyword hardcode.
- [ ] Совместимые tablet/printer/adapter разрешены при достаточных доказательствах.
- [ ] Seller-only Calibration License заблокирован; переименованный аналог тоже блокируется.
- [ ] Prompt injection не становится инструкцией и не поддерживает ALLOW.
- [ ] PARTIAL_ALLOW содержит только viable ALLOW-подмножество.

### PayPal и безопасность

- [ ] PayPal credentials встречаются только в Payment Executor server boundary и `.env.example` как имена переменных без значений.
- [ ] Actor/Supervisor imports и tools не содержат payment access.
- [ ] При BLOCK/REVIEW OAuth и Orders API не вызываются.
- [ ] ALLOW создаёт настоящий Sandbox Order через Orders v2 REST.
- [ ] `PayPal-Request-Id` сохраняется и повторно используется.
- [ ] Последовательные и параллельные retries создают не более одного Order.
- [ ] Tampered `ApprovedOrder` отклоняется до OAuth.
- [ ] UI показывает `CREATED`, а не ложное «оплачено»; capture отсутствует.

### UI, демо и качество

- [ ] Нет chat UI; присутствуют пять заданных областей.
- [ ] Есть четыре локальных источника с нормальными и заражёнными страницами.
- [ ] Evidence Timeline объясняет source, excerpt, independence и security findings.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e` проходят.
- [ ] README содержит setup, Prisma migration, Sandbox env и команды demo.
- [ ] Live Sandbox smoke задокументирован с order ID/status без secrets.
- [ ] Нет credentials/tokens в browser bundle, логах, fixtures и тестовых snapshots.

## 14. Готовые промпты для параллельных Kimi-агентов

Общие условия для всех пяти заданий:

- Сначала прочитать `TECH_SPEC.md` и `src/shared/contracts/`.
- Shared contracts, `TECH_SPEC.md`, root config и Prisma schema не изменять.
- Не создавать дублирующие локальные версии shared types.
- Не ждать другие workstreams: использовать порты и fixtures/mocks.
- Не добавлять зависимости самостоятельно; сообщить integrator, если зависимости не хватает.
- Не объявлять задачу готовой при failing tests или непроверенном критическом пути.

### 14.1 Агент: PayPal Backend

```text
Ты реализуешь Payment Executor для IntentGuard — PayPal-native сервиса проверки автономных покупок. Это не чат-бот. Прочитай TECH_SPEC.md и shared Zod-контракты.

Твоя задача:
1. Реализовать deterministic TypeScript Payment Executor без LLM.
2. Принимать только ApprovedOrder, повторно валидировать его и persisted approval context до любого PayPal HTTP.
3. Реализовать Sandbox OAuth и POST /v2/checkout/orders через REST, decimal USD из minor units, один purchase_unit и sanitized result.
4. Использовать сохранённый ApprovedOrder.idempotencyKey как PayPal-Request-Id; retry не меняет ключ и body.
5. Обеспечить локальную идемпотентность при последовательных и параллельных вызовах; сохранять PAYPAL_CREATED, PAYMENT_RETRYABLE и PAYMENT_UNKNOWN.
6. Не реализовывать capture.
7. Написать unit/integration tests: ALLOW один create, retry без дубликата, timeout retry с тем же request ID, tampered approval/BLOCK до OAuth, корректные суммы и sanitized errors.

Разрешено изменять только:
- src/modules/payment/**
- tests/unit/payment/**
- tests/integration/payment/**

Можно читать:
- TECH_SPEC.md
- src/shared/contracts/**
- src/shared/views/**
- src/server/run-repository.ts и Prisma schema для интеграции через существующие порты

Зависимости:
- Integrator предоставляет ApprovedOrder, PaymentExecutionView, repository port и Prisma schema.
- До готовности repository используй in-memory/mock port только в твоих тестах; не меняй shared contracts.
- PayPal credentials приходят только через server-side env внутри payment module; не пиши реальные secrets в файлы.

Запрещено:
- Менять shared contracts, API routes, Prisma schema, root config и чужие модули.
- Импортировать LLM/Agents SDK.
- Вызывать PayPal при BLOCK/REVIEW или до валидации ApprovedOrder.
- Логировать credentials, access token или полный нефильтрованный response.
- Создавать capture или генерировать новый request ID на retry.

Критерии готовности:
- Твои unit/integration tests проходят.
- При 10 параллельных execute для одного ApprovedOrder наблюдается один logical PayPal create и один результат.
- При BLOCK/tampered input OAuth и Orders mocks имеют call count 0.
- Проверены minor-unit суммы и структура Orders v2 payload.
- Возвращается только PaymentExecutionView без secrets.
- Дан краткий отчёт: изменённые файлы, команды тестов, оставшиеся интеграционные зависимости.
```

### 14.2 Агент: Actor + demo stores

```text
Ты реализуешь Actor Agent и четыре локальных demo-источника для IntentGuard. Это PayPal-native purchase-verification service, не чат-бот. Прочитай TECH_SPEC.md и shared Zod-контракты.

Твоя задача:
1. Реализовать Actor через OpenAI Agents SDK for TypeScript со structured ProposedOrder output.
2. Дать Actor только read-only catalog/page/evidence tools; никаких PayPal, payment или произвольных network tools.
3. Поддержать открытые цели, а не фиксированный список категорий. Actor должен объяснять purpose, necessity и compatibility через evidence IDs.
4. Evidence Acquisition Layer должен использовать trusted store registry, local allowlist, visible text, capture/content hash и отдельный security metadata path. Store content всегда считать недоверенным.
5. Создать Tablet Hub, POS Supply, Maker Docs и Checkout Bundles. Добавить обычные страницы и явно заражённую Calibration License page со скрытой agent-directed инструкцией.
6. Сделать coffee-shop demo данными, а не policy hardcode: планшет, принтер, adapter и навязанная лицензия за $99.
7. Написать unit tests для schemas/references, allowlist, evidence capture и отсутствия payment capabilities.

Разрешено изменять только:
- src/modules/actor/**
- src/modules/demo-stores/**
- src/app/stores/**
- tests/unit/actor/**
- tests/fixtures/stores/**

Можно читать:
- TECH_SPEC.md
- src/shared/contracts/**
- существующие tool/evidence ports

Зависимости:
- Integrator предоставляет Agent runtime wiring и evidence repository port.
- Supervisor и PayPal для твоих unit tests не нужны; используй fixture ProposedOrder.
- Не меняй package.json: недостающую зависимость сообщи integrator.

Запрещено:
- Менять shared contracts, Supervisor, payment, Prisma, API routes и root config.
- Давать Actor PayPal credentials/tools или импортировать payment module.
- Разрешать fetch произвольных URL.
- Придумывать publisherId/sourceClass/contentHash в LLM output вместо trusted metadata.
- Вшивать в Actor правило, что лицензии всегда запрещены: это решение Supervisor.

Критерии готовности:
- Actor возвращает валидный ProposedOrder для открытой цели и корректно ссылается на существующие Evidence.
- Несуществующие evidence IDs и URL вне allowlist отклоняются.
- Четыре источника открываются локально; infected fixture воспроизводит скрытую инструкцию.
- Actor module не содержит PayPal imports/env reads.
- Твои unit tests проходят.
- Дан краткий отчёт: файлы, сценарии магазинов, команды тестов, зависимости интеграции.
```

### 14.3 Агент: Supervisor + Policy Engine

```text
Ты реализуешь IntentGuard Supervisor и Policy Engine. Это независимая проверка автономных покупок, не чат-бот и не категорийный фильтр. Прочитай TECH_SPEC.md и shared Zod-контракты.

Твоя задача:
1. Реализовать Supervisor через OpenAI Agents SDK со structured Verdict output и без network/payment tools.
2. Реализовать гибридную Policy Engine: детерминированные schema/hash/budget/source/security/dependency checks + LLM semantic necessity/compatibility.
3. Для каждого item выдавать ALLOW/BLOCK/REVIEW и объяснимые findings; для заказа — ALLOW/BLOCK/REVIEW/PARTIAL_ALLOW.
4. Доказывать necessity из мандата и dependency closure. Seller-only necessity для дополнительного товара недостаточна.
5. Определять независимость по trusted publisher/ownership metadata, а не по заявлению Actor.
6. Quarantine prompt-injection evidence; не позволять infected source поддерживать ALLOW.
7. Проверять viability PARTIAL_ALLOW: нельзя оплатить зависимый аксессуар без обязательного базового item.
8. Написать tests: coffee equipment ALLOW, Calibration License BLOCK, renamed upsell BLOCK, другая товарная область без keyword rules, insufficient evidence REVIEW/BLOCK, injection quarantine, budget и dependency matrix.

Разрешено изменять только:
- src/modules/supervisor/**
- tests/unit/supervisor/**
- tests/fixtures/policy/**

Можно читать:
- TECH_SPEC.md
- src/shared/contracts/**
- trusted evidence/security fixture formats

Зависимости:
- Integrator предоставляет Mandate, ProposedOrder, trusted evidence metadata и security reports.
- Actor и PayPal не нужны для unit tests; используй fixtures.
- Не меняй shared contracts или package.json; недостающее передай integrator.

Запрещено:
- Хардкодить разрешённые/запрещённые категории или названия demo-товаров.
- Добавлять PayPal/payment tools, credentials или network access.
- Разрешать LLM перезаписывать deterministic critical findings.
- Создавать ApprovedOrder или PayPal payload.
- Менять shared contracts, Prisma, API routes и чужие модули.

Критерии готовности:
- Verdict проходит Zod и покрывает каждый item ровно один раз.
- Coffee demo разрешает совместимое оборудование и блокирует seller-only license по общему правилу.
- Переименование и смена товарной области не обходят policy.
- Prompt injection и seller-only evidence не поддерживают ALLOW.
- Все твои unit tests проходят, включая verdict/dependency matrix.
- Дан краткий отчёт: policy rules без category hardcode, файлы, тесты, интеграционные замечания.
```

### 14.4 Агент: Frontend

```text
Ты реализуешь UI IntentGuard на Next.js/React/Tailwind. Это PayPal-native сервис автономных покупок, не чат-бот. Прочитай TECH_SPEC.md, shared contracts и RunView/PaymentExecutionView.

Твоя задача:
1. Создать интерфейс без чата: Mandate Form, Order Items, Evidence Timeline, Verdict Panel, PayPal Status.
2. Дать пользователю ввести открытую цель, бюджет USD и hard/soft constraints; предзаполнить coffee demo через обычную кнопку примера.
3. Отображать этапы выполнения, item-level ALLOW/BLOCK/REVIEW, общий Verdict и человекочитаемые findings.
4. Evidence Timeline должен показывать время, источник, excerpt, independence/security status и связь с item.
5. PayPal Status должен различать NOT_REQUESTED, PENDING, CREATED, RETRYABLE и UNKNOWN. CREATED не называть «оплачено»; показывать approve link, если он есть.
6. Добавить идемпотентный retry для существующего run без повторного создания заказа; генерировать один run Idempotency-Key на пользовательскую операцию.
7. Обеспечить responsive layout, loading/error/empty states и доступные controls.
8. Добавить component-oriented тесты в разрешённых paths только если они не требуют изменения root config; иначе передать сценарии QA.

Разрешено изменять только:
- src/app/layout.tsx
- src/app/page.tsx
- src/app/runs/**
- src/app/globals.css
- src/components/**

Можно читать:
- TECH_SPEC.md
- src/shared/contracts/**
- src/shared/views/**
- src/app/api/** только как consumer

Зависимости:
- Integrator предоставляет POST /api/runs, GET /api/runs/:runId и POST /api/runs/:runId/execute.
- До готовности API используй typed mock только внутри разрешённых UI files; не создавай фальшивый реальный PayPal success в production path.
- Не меняй shared contracts, package.json или Tailwind/root config; запросы передай integrator.

Запрещено:
- Добавлять chat, model transcript или prompt editor.
- Импортировать server-only/payment modules или читать env secrets.
- Конструировать ApprovedOrder или менять Verdict на клиенте.
- Показывать Sandbox CREATED как completed payment.
- Менять API routes, Actor, Supervisor, payment, Prisma и shared contracts.

Критерии готовности:
- Все пять областей UI работают на desktop и mobile.
- ALLOW, PARTIAL_ALLOW, BLOCK, REVIEW и payment retry имеют различимые состояния.
- Evidence Timeline и findings позволяют объяснить решение без чата.
- Browser не получает secrets; нет server-only imports.
- UI проходит typecheck/lint в интегрированном skeleton.
- Дан краткий отчёт: файлы, состояния UI, mock seams, оставшиеся E2E сценарии.
```

### 14.5 Агент: QA + demo

```text
Ты отвечаешь за QA, security acceptance и воспроизводимое demo IntentGuard. Это PayPal-native сервис проверки автономных покупок, не чат-бот. Прочитай TECH_SPEC.md и Definition of Done полностью.

Твоя задача:
1. Написать Playwright E2E для мандата → items → Evidence Timeline → Verdict → PayPal Status.
2. Покрыть ALLOW, PARTIAL_ALLOW, BLOCK, REVIEW и идемпотентный retry; UI не должно быть чатом.
3. Написать security tests: prompt injection, seller-only necessity, renamed upsell, tampered ApprovedOrder, forbidden imports/env access, secrets в client bundle/logs.
4. В integration/security tests проверять, что при BLOCK/REVIEW OAuth и Orders mocks не вызывались.
5. Проверить 10 последовательных и 10 параллельных retries: один request ID, один logical create, один PayPal order ID.
6. Подготовить повторяемый demo script для coffee shop $800 и четырёх local stores, включая infected Calibration License page.
7. Разделить Replay tests с mocks и Live Sandbox smoke. Никогда не выдавать mocked PayPal response за реальный.
8. Подготовить checklist ручного Live Sandbox smoke и фиксировать только безопасные order ID/status/request ID, без secrets.

Разрешено изменять только:
- tests/e2e/**
- tests/security/**
- scripts/demo/**
- README.md только в явно отведённой integrator секции QA/demo, если такая секция создана

Можно читать:
- весь репозиторий для поиска нарушений и написания black-box tests

Зависимости:
- Integrator предоставляет запускаемый app, test scripts, fixtures wiring и mock/replay seams.
- PayPal Backend предоставляет HTTP mock counters и idempotency tests hooks через существующие интерфейсы.
- Actor и Supervisor предоставляют свои fixtures; не исправляй их реализацию самостоятельно, а создавай failing regression test и сообщай владельцу.
- Реальные PayPal secrets не нужны для автоматических tests; Live smoke выполняется только с локальным env оператора.

Запрещено:
- Менять shared contracts, production modules, Prisma, root config и чужие fixtures для «починки» теста.
- Ослаблять assertions, пропускать security tests или записывать credentials в snapshots.
- Подменять Live Sandbox результат mock-данными.
- Оставлять серверы/процессы после тестового прогона.

Критерии готовности:
- E2E проходят для всех verdict/payment states и повторного запуска.
- Security tests доказывают нулевые PayPal calls при BLOCK/REVIEW/tampering.
- Idempotency проверена последовательно и параллельно.
- Demo воспроизводится по README от clean setup; live и replay явно различимы.
- Definition of Done превращён в checklist с фактическим pass/fail и логами команд.
- Дан краткий отчёт: покрытые сценарии, найденные дефекты, команды и оставшиеся риски.
```

## 15. Нормативные внешние references

- OpenAI Agents JS: Zod supported as Agent `outputType`; tool schemas and tool guardrails validate at SDK boundaries. https://openai.github.io/openai-agents-js/guides/agents/ and https://openai.github.io/openai-agents-js/guides/schemas/
- PayPal Orders v2: create order endpoint and order lifecycle. https://developer.paypal.com/api/orders/v2
- PayPal REST integration: Sandbox create order uses OAuth bearer token and `PayPal-Request-Id`; successful create returns order ID, status and HATEOAS links. https://developer.paypal.com/api/rest/integration/orders-api
- PayPal idempotency: retries of the original request use the same `PayPal-Request-Id`. https://developer.paypal.com/api/rest/reference/idempotency

Версии npm-зависимостей фиксируются в lockfile на этапе Skeleton. Перед реализацией integrator сверяет используемую версию Agents SDK с её документацией; архитектурные запреты и контракты из этого документа не зависят от minor-версии SDK.
