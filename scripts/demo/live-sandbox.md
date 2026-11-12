# Live PayPal Sandbox smoke checklist

Этот checklist выполняется оператором с локальным `.env`. Не добавляйте в репозиторий реальные credentials, access tokens, PayPal order ID, request ID или approve URL. Ниже используются только placeholders.

## 1. Подготовка

- [ ] Скопируйте `.env.example` в локальный `.env` и заполните `CHANNEL3_API_KEY` и Sandbox credentials только на своей машине.
- [ ] Убедитесь, что PayPal API base URL указывает на Sandbox, а `APP_MODE=live` и `PAYPAL_MODE=live`.
- [ ] Выполните установку, Prisma migration и запустите приложение в отдельном терминале. Demo script сам сервер не запускает.
- [ ] Перед Live smoke отдельно проверьте Replay: UI и вывод script должны явно содержать `Replay` и `simulated`. Поиск товаров в обоих режимах идёт через Channel3.

```bash
INTENTGUARD_BASE_URL=http://127.0.0.1:3000 npm run demo
```

## 2. Home office mouse

- [ ] Запустите Channel3 demo против Live API с новым `Idempotency-Key` (script генерирует его автоматически).
- [ ] Вывод начинается с `Mode: Live`; нет утверждения, что результат simulated.
- [ ] Run ID имеет UUID-формат; verdict — `ALLOW`.
- [ ] В ProposedOrder и ApprovedOrder содержится подходящая беспроводная мышь без навязанных дополнений.
- [ ] Итоговая сумма ApprovedOrder не превышает `5000` minor units.
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

Следующие coffee-сценарии используют локальные fixtures только как внутренние регрессионные тесты; в пользовательском интерфейсе доступен только Channel3.

- [ ] Внутренний over-budget coffee run завершается `BLOCK`; execute возвращает `409 RUN_NOT_APPROVABLE`.
- [ ] Внутренний fixture-run с hard constraint на обязательное человеческое review завершается `REVIEW`; execute возвращает `409 RUN_NOT_APPROVABLE`.
- [ ] В server telemetry для BLOCK/REVIEW нет OAuth- или Orders API-вызовов. Не копируйте логи с чувствительными значениями в репозиторий.
- [ ] `GET /api/health` возвращает только `{ "status": "ok" }`; API и browser source не раскрывают env, tokens или полный PayPal response.
- [ ] Capture route отсутствует; UI содержит mandate, items, Evidence Timeline, Verdict и PayPal Status, но не chat.

## 5. Завершение

- [ ] При необходимости зафиксируйте результат только в защищённом операционном журнале: safe order ID/status/request ID, без credentials и tokens.
- [ ] Остановите dev server штатно и убедитесь, что demo/test процессы не остались запущенными.
