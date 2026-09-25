# Провайдеры, цены и бюджеты

Контракт платных вызовов (принципы 5, 6, 8). Появился в M2.6.
Код: `backend/app/providers/` (`base.py` — контракт, `registry.py` — маршруты, `gateway.py` — единая точка вызова,
`fake.py`, `anthropic.py`, `gemini.py`, `elevenlabs.py`), `backend/app/cost/` (`pricing.py` — прайс и расчёт,
`ledger.py` — журнал, `budget.py` — лимиты), роутер `backend/app/api/cost.py`, миграция `003_cost.sql`.
Конфиги: `config/providers.yaml` (маршруты), `config/pricing.yaml` (цены). Ключи — `docs/api_keys.md`.

Пайплайн не знает ID моделей и цен: он называет этап и передаёт запрос. Модель выбирает `registry.py` по
`providers.yaml`, деньги считает только `cost/pricing.py` (L-001).

## Этапы и маршруты (`config/providers.yaml`)

| Этап | Вид запроса | Провайдер | economy | standard | premium |
|---|---|---|---|---|---|
| `research` | text (+ поиск) | anthropic | claude-sonnet-5 | claude-opus-5 | claude-opus-5-5 |
| `script` | text | anthropic | claude-sonnet-5 | claude-opus-5 | claude-opus-5-5 |
| `images` | image | gemini | gemini-3.1-flash-lite-image 1K | gemini-3.1-flash-image 1K | gemini-3-pro-image 2K |
| `voice` | speech | elevenlabs | eleven_flash_v2_5 | eleven_multilingual_v2 | eleven_v3 |
| `animate` | video | gemini (Veo) | veo-3.1-lite 720p | veo-3.1-lite 720p | veo-3.1-fast 720p |

Таблица — снимок на 2026-09-25, источник правды — сам YAML. У этапа есть:

- `kind` — вид запроса: `text | image | speech | video`. Он задаёт единицы учёта и модель запроса
  (`TextRequest`, `ImageRequest`, `SpeechRequest`, `VideoRequest` в `providers/base.py`).
- `catalog` — **разрешённые** модели: ключ → `{provider, model, params}`. В `params` лежит то, что меняет цену и
  результат: `size` картинки (1K, 2K, 4K), `resolution` видео (720p, 1080p, 4K).
- `profiles` — ключ каталога для каждого профиля качества `economy`, `standard`, `premium`. Все три обязательны.

`default_profile` — профиль по умолчанию. Профиль меняет только выбор модели; код от него не зависит.
Путь анимации (M8) ещё не выбран, но каталог `animate` нужен уже сейчас: по нему считается лимит «анимация на
выпуск».

**Запрещённые модели.** `forbidden_models` — шаблоны fnmatch без учёта регистра: `gemini-2.5-flash-image*` и
`sora-2*` (их API закрываются осенью 2026, `CLAUDE.md`). Если модель каталога попала под шаблон, бэкенд не стартует.

### Выбор модели

`registry.resolve(stage, profile=None, override=None)`:

1. `override` — выбор пользователя на пачку или кадр: ключ каталога или ID модели из каталога этапа. Модели вне
   каталога — `RouteError` (422) со списком доступных. Новая модель сначала добавляется в каталог вместе с ценой.
2. Иначе `profile`, иначе `default_profile`.

Где хранится выбор пользователя (настройки канала на экране 9, пачка на экране 4, кадр на экране 6), решают модули
этих экранов (M6–M8). Сюда он приходит как `override`.

**Модель голоса** (решение M2.6; код — в M7). Порядок выбора такой:

1. выбор на пачку;
2. `director.json → voice`;
3. голос канала из профиля;
4. маршрут профиля качества.

План выпуска стоит выше голоса канала: выпуск закреплён за голосом так же, как за версией канона (принцип 14), и
смена голоса канала не переозвучивает старые выпуски. Модель на любом уровне проверяется по каталогу `voice`.

## Единицы и цены (`config/pricing.yaml`)

| Единица | Что считается | Оценка до вызова |
|---|---|---|
| `token_in` | входные токены LLM | `ceil(символы / 3)`: ≈ 4 символа на токен, новый токенизатор Claude даёт на ~30 % больше |
| `token_out` | выходные токены LLM | `max_output_tokens` — верхняя граница |
| `search` | веб-поиск LLM | `max_searches` |
| `image` | картинка | 1 за вызов; вариант цены — `params.size` |
| `char` | символ текста голоса | `len(text)` |
| `second` | секунда видео | `seconds`; вариант цены — `params.resolution` |

Формат записи:

```yaml
gemini:                                   # провайдер
  gemini-3.1-flash-image:                 # модель — как в providers.yaml
    checked_at: 2026-09-23                # обязательно: когда цену сверяли
    source: https://ai.google.dev/gemini-api/docs/pricing
    prices:
      image: {variants: {1K: "0.067", 2K: "0.101", 4K: "0.151"}}   # цена по параметру маршрута
anthropic:
  claude-opus-5:
    checked_at: 2026-09-25
    source: https://platform.claude.com/docs/en/about-claude/pricing
    prices:
      token_in: {usd: "5.00", per: 1000000}                       # $ за `per` единиц
```

- Цена — **строка в кавычках**. Float из YAML теряет точность ещё до Decimal, поэтому число без кавычек — ошибка
  старта.
- Расчёт: `usd × 10⁶ × quantity / per` в Decimal, одно округление до целого микродоллара (ROUND_HALF_UP) на строку.
  До центов округляет только `format_usd` на выходе API.
- При старте у каждой модели каталога проверяются цены всех единиц её вида и, если цена задана вариантами, вариант
  из `params`. Чего-то нет — бэкенд не стартует: без цены нет «цены до клика».
- Если `checked_at` старше `PRICING_STALE_DAYS` (60 дней), в логе появляется предупреждение, в сводке — строка в
  `stale_pricing`, у оценки — флаг `stale_pricing: true`.
- Скидка Batch API не учтена: оценка сверху. ElevenLabs учитывается по долларовой цене API (Pay As You Go). Символы
  месячного пакета — отдельная квота, её показывает проверка ключа.

**Как обновить цену.**

1. Сверить цену на странице `source`.
2. Поправить значение, `checked_at` и при необходимости `source`.
3. Перезапустить бэкенд.

Строки журнала пересчитывать не нужно: в них лежит цена на момент вызова. Эпизоды к ценам не привязаны.

**Как добавить модель.**

1. Запись в `catalog` этапа.
2. Цена в `pricing.yaml`.
3. При желании — ссылка из профиля.

Код не меняется. Тест `test_shipped_config_is_valid_and_model_ids_live_only_there` падает, если ID модели из конфига
появится в коде бэкенда.

**Как добавить провайдера.**

1. Класс в `providers/` по протоколу `Provider`: `usage()` без сети; `call()` и `check()` делают один запрос без
   повторов.
2. Строка в `gateway.default_providers()`.

Ошибки провайдер переводит через `status_error()`:

- 429 → `RateLimited(retry_after)`;
- 5xx и сеть → `TransientError`;
- 401, 402, 403 и прочие 4xx → `ProviderError` с текстом «что случилось и что сделать».

## Путь вызова (`Gateway.call`)

```
маршрут → оценка → input_hash → кэш? ─да─▶ строки cached ($0), файл из кэша
                                   └нет─▶ бюджет ─отказ─▶ строки refused, BudgetExceeded
                                            └ok─▶ резерв estimated → provider.call ─сбой─▶ failed ($0), исключение дальше
                                                                           └ok─▶ charged (факт) → media/<этап>/…, строка assets
```

- Бюджет и резерв выполняются одной транзакцией `BEGIN IMMEDIATE`, поэтому два воркера не пройдут в лимит вдвоём.
- Факт считается по `Result.usage` провайдера той же функцией `Pricing.cost`, что и оценка.
- Файл результата записывается атомарно (`storage/atomic.py::write_bytes_atomic`) в
  `projects/<канал>/<выпуск>/media/<этап>/<кадр>-<хэш16>.<ext>`. Строка `assets` (`kind` = этап, `input_hash`,
  `status = ready`, путь относительно `data/`) служит индексом кэша. Связь ассета с кадром в `project.json` делают
  модули генерации.

### Кэш по хэшу входов (принцип 8)

`input_hash` — sha256 канонического JSON (`sort_keys`, без пробелов) из:

- провайдера и модели;
- `params` маршрута;
- всего запроса.

Для картинки в запрос входят версии канона (`canon`), итоговый промпт, negative, референсы (хэши файлов) и seed.
Смена версии канона даёт другой хэш, и кадр перерисовывается. Если в `assets` есть строка с тем же `kind` и хэшем и
файл на месте, пишется строка `cached` с $0 и возвращается путь. Файл пропал — вызов идёт платно. Кэш текстов LLM
появится в M4.

## Журнал расходов (`cost_ledger`)

Одна строка — одна единица учёта одного вызова. Строки вызова связаны `call_id`.

| Поле | Что это |
|---|---|
| `ts` | ISO 8601 UTC |
| `channel`, `episode_id`, `stage`, `job_id` | чей вызов |
| `provider`, `model` | куда |
| `unit`, `quantity`, `variant` | единица, количество, вариант цены (разрешение) |
| `cost_micro_usd` | целые микродоллары, см. статус |
| `status` | ниже |
| `call_id`, `input_hash` | вызов и хэш входов |

| Статус | Сумма | В потраченном |
|---|---|---|
| `estimated` | оценка — резерв на время вызова | да |
| `charged` | факт по ответу провайдера | да |
| `cached` | 0; количество — сколько сэкономлено | нет |
| `refused` | сумма, которую не стали тратить | нет |
| `failed` | 0: за неуспешный запрос провайдеры не берут | нет |

После ответа резерв `estimated` превращается в `charged` в той же строке, а при сбое — в `failed`. Единица, которой в
факте нет (поиск не понадобился), становится `charged` с нулём.

## Бюджеты

Лимиты берутся из `data/channels/<канал>/profile.json → budgets` (`monthly_usd`, `per_episode_usd`,
`animation_usd`). Проверяются три уровня по очереди:

| Уровень | Что входит |
|---|---|
| `month` | канал, календарный месяц UTC |
| `episode` | выпуск целиком |
| `animation` | этап `animate` выпуска |

Занятым считается `charged` и `estimated` из журнала **плюс оценки платных джобов в очереди**
(`jobs.cost_usd_micro` у `queued`). Поэтому пачка из многих `POST /api/jobs` упирается в лимит на том джобе, который
его превышает, а не после оплаты. Отмена джоба освобождает его оценку. Бесплатное (оценка $0) не проверяется.

Бюджет проверяется дважды:

1. **До постановки** — `POST /api/jobs` для платного вида (у `HandlerSpec` есть `estimate`). Превышение даёт 409,
   джоб не создаётся, в журнал пишется строка `refused`.
2. **В момент вызова** — `Gateway.call`, на случай если лимит заняли, пока джоб ждал. Превышение даёт
   `BudgetExceeded`, джоб становится `failed` без повтора.

Тихого перехода на модель дешевле нет ни там, ни там.

Тело 409:

```json
{"detail": {"code": "budget_exceeded", "level": "month", "limit_usd_micro": 150000000,
            "spent_usd_micro": 151200000, "queued_usd_micro": 0, "cost_usd_micro": 67000,
            "message": "Месячный лимит $150 исчерпан, потрачено $151.20; поднять лимит можно в настройках канала."}}
```

Тело описано моделью `BudgetRefusal` (`cost/budget.py`); во фронте — тип `@/types/cost` и помощник
`budgetRefusal(error)` из `src/api/client.ts`.

Если лимит ещё не исчерпан, текст такой: «Лимит на выпуск $0.20: потрачено $0, в очереди $0.13, операция — $0.07, не
хватает <$0.01; поднять лимит можно в настройках канала.»

## API

Деньги в ответах — пара `{usd_micro, usd}`: по первому считать, второй показывать (`$151.20`, `$150`, `<$0.01`).

| Запрос | Ответ |
|---|---|
| `GET /api/cost/summary?channel=` | `{channel, month: "2026-09", budget, by_stage: [{stage, spent}], stale_pricing: [{provider, model, checked_at, age_days}]}`; 404 — канала нет |
| `GET /api/providers/status?refresh=` | `[KeyStatus]` по провайдерам конфига: `configured`, `ok`, `message`, `missing_models`, `quota` (остаток символов ElevenLabs для шапки). Бесплатные запросы, ответ держится 60 с; `refresh=true` — проверить заново |
| `GET /api/cost/ledger?episode=&channel=&limit=500` | `{items: [строки журнала + usd], episode_budget, animation_budget}` (лимиты — только с `episode`); 422 без `episode` и `channel` |

`budget` = `{limit, charged, reserved, queued, remaining}`, где `remaining = max(limit − занятое, 0)`.

## Проверка ключей

`Provider.check(expected_models)` делает один бесплатный запрос без повторов:

| Провайдер | Запрос | Что показывает |
|---|---|---|
| Anthropic | `models.list` | принят ли ключ; какие модели каталога ключ не видит |
| Gemini | `models.list` | принят ли ключ; какие модели каталога ключ не видит |
| ElevenLabs | `/v1/user/subscription` | тариф и остаток символов (`KeyStatus.quota`); ключу нужно право User → Read |

`Gateway.check_keys()` проверяет всех провайдеров конфига параллельно; его же отдаёт `GET /api/providers/status`. `uv run pytest -m live -v -rP` проверяет ключи из
`backend/.env`: без ключа — `skip` с причиной, отказ — `fail` с текстом, что сделать.
