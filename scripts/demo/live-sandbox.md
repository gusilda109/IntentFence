# Live PayPal Sandbox smoke checklist

Этот checklist выполняется оператором с локальным `.env`. Не добавляйте в репозиторий реальные credentials, access tokens, PayPal order ID, request ID или approve URL. Ниже используются только placeholders.

## 1. Подготовка

- [ ] Скопируйте `.env.example` в локальный `.env` и заполните Sandbox credentials только на своей машине.
- [ ] Убедитесь, что PayPal API base URL указывает на Sandbox, а `APP_MODE=live` и `PAYPAL_MODE=live`.
- [ ] Выполните установку, Prisma migration и запустите приложение в отдельном терминале. Demo script сам сервер не запускает.
- [ ] Перед Live smoke отдельно проверьте Replay: UI и вывод script должны явно содержать `Replay` и `simulated`.

```bash
INTENTFENCE_BASE_URL=http://127.0.0.1:3000 npm run demo
```

## 2. Coffee $800

- [ ] Запустите coffee demo против Live API с новым `Idempotency-Key` (script генерирует его автоматически).
- [ ] Вывод начинается с `Mode: Live`; нет утверждения, что результат simulated.
- [ ] Run ID имеет UUID-формат; verdict — `PARTIAL_ALLOW`.
- [ ] В заказе три ALLOW equipment item: tablet, receipt printer и interface adapter.
- [ ] `Calibration License` имеет item-level `BLOCK`; findings объясняют seller-only necessity и prompt-injection quarantine.
- [ ] ApprovedOrder содержит только три ALLOW item, а total не превышает `80000` minor units.
- [ ] PayPal status — `CREATED`; UI не называет заказ оплаченным или completed.
- [ ] Approve URL ведёт на PayPal Sandbox. Не выполняйте capture: он не входит в MVP.

## 3. Идемпотентность

Задайте `RUN_ID` локально значением из текущего smoke run; не записывайте его в этот файл.

```bash
curl --fail-with-body --request POST \
  "http://127.0.0.1:3000/api/runs/${RUN_ID}/execute"
```

- [ ] Повторный `execute` возвращает HTTP 200, `createdNow=false` и тот же безопасный PaymentExecutionView.
- [ ] Последовательные и параллельные повторы оставляют один logical PayPal Order, один order ID и один request ID.
- [ ] При `PAYMENT_UNKNOWN` retry использует тот же request ID; новый автоматический create не выполняется.
- [ ] Повтор `POST /api/runs` с тем же ключом и canonical body возвращает HTTP 200 и существующий run; изменённый body с тем же ключом возвращает `409 IDEMPOTENCY_CONFLICT`.

## 4. Негативные проверки

- [ ] Over-budget coffee run завершается `BLOCK`; execute возвращает `409 RUN_NOT_APPROVABLE`.
- [ ] Hard constraint с обязательным человеческим review завершается `REVIEW`; execute возвращает `409 RUN_NOT_APPROVABLE`.
- [ ] В server telemetry для BLOCK/REVIEW нет OAuth- или Orders API-вызовов. Не копируйте логи с чувствительными значениями в репозиторий.
- [ ] `GET /api/health` возвращает только `{ "status": "ok" }`; API и browser source не раскрывают env, tokens или полный PayPal response.
- [ ] Capture route отсутствует; UI содержит mandate, items, Evidence Timeline, Verdict и PayPal Status, но не chat.

## 5. Завершение

- [ ] При необходимости зафиксируйте результат только в защищённом операционном журнале: safe order ID/status/request ID, без credentials и tokens.
- [ ] Остановите dev server штатно и убедитесь, что demo/test процессы не остались запущенными.
