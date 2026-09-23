# Джобы и события SSE

Контракт очереди долгих операций (принцип 7) и потока событий `GET /api/events`. Появился в M2.5.
Код: `backend/app/jobs/` (`queue.py` — очередь, `worker.py` — пул и контекст обработчика, `events.py` — журнал и
SSE), роутер `backend/app/api/jobs.py`, миграция `storage/migrations/002_jobs.sql`.

Очередь живёт только в SQLite: процесс можно убить в любой момент, после запуска всё продолжится. Celery, Redis,
очереди в памяти и WebSocket не используются: прогресс идёт в одну сторону.

## Статусы

```
queued ──claim──▶ running ──▶ done | failed | cancelled
   ▲                 │
   └─────────────────┘  перезапуск после аварии; штатная остановка бэкенда
queued ──cancel──▶ cancelled
```

Каждый переход — условный `UPDATE … WHERE status = <ожидаемый>` и строка в `job_events` в одной транзакции.
Опоздавший воркер не затрёт чужой статус, а журнал событий не разойдётся со строкой джоба.

## Поля джоба (`GET /api/jobs/{id}`)

| Поле | Что это |
|---|---|
| `id` | uuid4 hex |
| `kind` | тип обработчика, например `sleep_job` |
| `status` | `queued` · `running` · `done` · `failed` · `cancelled` |
| `progress`, `message` | 0…1 и строка для интерфейса; при отмене и сбое сохраняются как были |
| `payload` | вход, нормализован Pydantic-моделью обработчика (значения по умолчанию подставлены) |
| `result` | `dict` или `null`; при отмене — то, что обработчик успел вернуть |
| `error` | `"<ТипОшибки>: <текст>"`, до 2000 знаков |
| `attempts` | сколько раз обработчик запускался: старты и ретраи; аварийный перезапуск не обнуляет |
| `cancel_requested` | флаг отмены для `running` |
| `episode_id`, `batch_id` | выпуск (FK на `episodes`) и пачка |
| `idempotency_key` | уникален во всей таблице; `null` — без дедупликации |
| `created_at`, `started_at`, `finished_at` | ISO 8601 UTC, до секунды |

## API

| Запрос | Ответ |
|---|---|
| `POST /api/jobs` `{kind, payload, idempotency_key?, episode_id?, batch_id?}` | 201 — новый джоб; 200 — джоб с этим ключом уже есть, возвращается он (в любом статусе); 422 — неизвестный `kind` или невалидный `payload`; 404 — нет выпуска |
| `GET /api/jobs?batch=&episode=&status=&kind=&limit=200` | `{items, summary, last_event_id}`: последние `limit` джобов по фильтру в порядке постановки, `summary` — счётчики по статусам по всему фильтру (сводка пачки), `last_event_id` — курсор журнала для подписки |
| `GET /api/jobs/{id}` | джоб или 404 |
| `POST /api/jobs/{id}/cancel` | `queued` → `cancelled` сразу; `running` → флаг, ответ со `status: running, cancel_requested: true`; повтор для `cancelled` — 200; `done`/`failed` — 409 |
| `GET /api/events` | поток SSE, ниже |

Пайплайн ставит джобы из Python напрямую: `queue.enqueue` / `queue.enqueue_many` (одна транзакция на пачку), затем
`JobPool.kick()` в потоке event loop.

**Ключ идемпотентности вечный.** Постановка с ключом упавшего или отменённого джоба вернёт его же. Для повтора нужен
новый ключ или отдельная операция «повторить» (её пока нет). Ключ строится из входов, например
`image:<episode>:<shot>:<input_hash>`, тогда повторная постановка того же не создаёт дубль ни до, ни после
перезапуска.

## Обработчик

```python
SPEC = HandlerSpec(kind="sleep_job", fn=sleep_job, payload_model=SleepPayload, resource="cpu")

def sleep_job(ctx: JobContext, payload: SleepPayload) -> dict[str, int]:
    for step in range(1, payload.steps + 1):
        if ctx.cancelled():
            return {"steps_done": step - 1}          # сделанное — в result
        ...
        ctx.progress(step / payload.steps, f"Шаг {step} из {payload.steps}")
    return {"steps_done": payload.steps}
```

- Регистрация — строка в `jobs/handlers/__init__.py → builtin_handlers()`. `create_app(handlers=…)` принимает свой
  набор (тесты).
- `fn` синхронная (идёт в пул потоков, размер = `job_workers`) или `async` (выполняется в event loop). Возвращает
  `dict` или `None`.
- **Идемпотентность.** После аварии джоб перезапускается с начала. Уже оплаченное обработчик пропускает по кэшу
  входов (принцип 8), а не по прогрессу.
- `ctx.progress(fraction, message)` пишет в БД и SSE не чаще раза в 200 мс. Последнее значение не теряется: его
  записывает конечный переход. `fraction = 1.0` пишется всегда.
- `ctx.cancelled()` возвращает `True`, если пользователь отменил джоб (флаг в БД, проверка не чаще раза в 100 мс) или
  бэкенд останавливается. Проверять между шагами, при `True` — вернуть сделанное. Если обработчик закончил работу, не
  заметив отмены, джоб получает статус `done`.
- `ctx.attempt` — номер текущей попытки с учётом прошлых стартов.
- В БД обработчик сам не пишет: переходы статусов делает только пул.

## Ретраи

`tenacity` вокруг вызова обработчика: экспоненциальная задержка `job_retry_wait_s × 2^(n−1)` (1, 2, 4 … с, не больше
30 с), всего не больше `job_max_attempts` = 3 попыток.

| Ошибка | Повтор |
|---|---|
| `TransientError` (своё исключение; провайдеры переводят в него ошибки SDK без HTTP-статуса) | да |
| `httpx.TransportError` (соединение, таймауты), встроенные `ConnectionError`, `TimeoutError` | да |
| любое исключение с HTTP-статусом 5xx в `status_code` или `response.status_code` | да |
| 4xx, включая 429 (пересмотр в M2.6 вместе с `Retry-After`) | нет, сразу `failed` |
| всё остальное (ошибки в коде, валидация) | нет |

Отменённый или останавливаемый джоб не повторяется. Перед повтором `attempts + 1`, в `message` — «Повтор 2/3 через 2 с: …»
(событие `job.progress`).

## Перезапуск и остановка

- **Старт** (`JobPool.start` в lifespan): все `running` переводятся в `queued`, `attempts` сохраняются (события
  `job.queued`), события старше 24 ч удаляются.
- **Джоб, роняющий бэкенд.** Если при взятии `attempts` > `job_max_attempts`, джоб сразу `failed` с объяснением.
  Отличает аварийный перезапуск от штатного тот же счётчик.
- **Штатная остановка** (Ctrl+C, `--reload`): `ctx.cancelled()` → `True`, джоб возвращается в `queued`, попытка не
  засчитывается. Кто не уложился в 5 с, остаётся `running` и вернётся в очередь при следующем старте.
- **Один процесс.** Пул живёт в процессе uvicorn; `--workers N` запрещён: каждый процесс при старте вернул бы в
  очередь джобы соседа.

## Пауза GPU (принцип 12)

`HandlerSpec.resource`: `cpu` · `gpu` · `render`. Пока выполняется хоть один `render`-джоб или поднят
`JobPool.gpu_paused`, пул не берёт `gpu`-джобы; уже идущие доделывают. Остальные виды идут как обычно.
`job_workers` ≤ 4 — рендер не больше 4 воркеров.

## Поток SSE: `GET /api/events`

Один поток на клиента, в нём все события всех джобов и heartbeat.

```
retry: 3000

id: 42
event: job.progress
data: {"job_id": "…", "kind": "sleep_job", "status": "running", "progress": 0.5, "message": "Шаг 2 из 4", "attempts": 1, "cancel_requested": false, "episode_id": null, "batch_id": null, "error": null}

event: heartbeat
data: {"ts": "2026-09-23T06:24:21+00:00"}
```

| `event` | Когда |
|---|---|
| `job.queued` | постановка; возврат в очередь после перезапуска или остановки |
| `job.started` | воркер взял джоб (`progress` = 0, `attempts` уже увеличен) |
| `job.progress` | `ctx.progress`, повтор после ошибки, флаг отмены у `running` |
| `job.done` · `job.failed` · `job.cancelled` | конечный статус |
| `heartbeat` | раз в `sse_heartbeat_s` = 15 с, без `id` — не сдвигает `Last-Event-ID` |

- `data` — состояние джоба без `payload` и `result`, их отдаёт `GET /api/jobs/{id}`. Состояние в событии полное, так
  что клиент заменяет его целиком; повтор события безвреден.
- `id` — строка таблицы `job_events` (`AUTOINCREMENT`, не переиспользуется), растёт строго. Поэтому догон работает
  и после перезапуска бэкенда.
- **Курсор.** `Last-Event-ID` в заголовке (EventSource шлёт его сам при переподключении) или `?last_event_id=` (первое
  подключение). Заголовок новее и побеждает. Без курсора приходят только новые события.
- **Подписка без пропусков:** `GET /api/jobs` → `last_event_id` → `new EventSource('/api/events?last_event_id=N')`.
  Курсор снимается раньше списка: событие на стыке придёт дважды, но не пропадёт.
- Журнал хранит сутки. Клиент, пропавший дольше, берёт снимок заново.
- Заголовки: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Прокси Vite
  (`/api` → `:8000`) пропускает поток без буферизации (проверено `curl -N localhost:5173/api/events`).
- **Uvicorn и открытый поток.** При остановке uvicorn ждёт закрытия всех соединений до шага lifespan shutdown, и
  открытый поток SSE вешает Ctrl+C и `--reload` навсегда. В `run.sh` стоит `--timeout-graceful-shutdown 3` (L-016).

## Настройки (`backend/.env`)

| Переменная | По умолчанию | Что |
|---|---|---|
| `JOB_WORKERS` | 3 | воркеров, 0…4; 0 — очередь без исполнения (тесты API) |
| `JOB_MAX_ATTEMPTS` | 3 | попыток на джоб, включая аварийные перезапуски |
| `JOB_RETRY_WAIT_S` | 1.0 | база экспоненты задержки ретраев |
| `SSE_HEARTBEAT_S` | 15 | интервал heartbeat |
