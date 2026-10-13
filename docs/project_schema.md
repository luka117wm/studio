# project.json — контракт `studio.project/1`

Реализация эпизода: что сделали с планом. Лежит в `data/projects/<channel>/<episode>/project.json`, создаётся
пустым при `POST /api/episodes`, дальше меняется только через `PATCH /api/projects/{episode_id}` (заявка и правки
кадров) и пайплайн на бэкенде. Каждая запись атомарна: temp-файл в той же папке → fsync → rename (L-003). Модели —
`backend/app/models/project.py`.

Чего в нём **нет**: замысла (он в `director/vNNN.json`, файл ссылается на версию через `director_version`),
канона, медиа (только относительные пути и хэши).

## Корень

| Поле | Тип | Описание |
|---|---|---|
| `schema` | `"studio.project/1"` | версия контракта |
| `episode_id` | `^[a-z0-9][a-z0-9-]*$` | совпадает с именем каталога и `meta.episode_id` плана |
| `channel` | `cursus \| otto` | канал |
| `brief` | `EpisodeBrief` \| `null` | заявка выпуска — вход промпта плана; `null` — ещё не заполнена (M4.1) |
| `director_version` | `vNNN` \| `null` | текущая версия плана; `null` — план ещё не импортирован |
| `director_versions` | `{vNNN: DirectorVersionInfo}` | индекс всех импортированных версий (файлы — `director/vNNN.json`) |
| `approved_version` | `vNNN`, поля нет — не утверждали | версия, утверждённая кнопкой «Утвердить план» (M4.6); новая версия плана её не трогает — утверждённая старше текущей, утвердить нужно снова |
| `approved_at` | ISO 8601 UTC, поля нет — не утверждали | когда утвердили |
| `shots` | `{shot_id: ShotState}` | состояние и ручные правки кадров |
| `assets` | `{asset_id: Asset}` | ассеты с версиями |
| `timings` | `{shot_id: Timing}` | фактические тайминги кадров (принцип 1) |
| `cost` | `{stage: int}` | потрачено по этапам, микродоллары (L-001) |
| `updated_at` | ISO 8601 UTC | ставит сервер при каждой записи |

Лишние поля запрещены. `schema`, `episode_id`, `channel` задаются при создании выпуска; в теле PATCH их быть не
может (M4.3), даже с теми же значениями — 422.

## `brief` — EpisodeBrief

Заявка выпуска (устав M4, решение 5): с чем выпуск идёт в чат за планом. Заполняется на экране 3 или из идеи
бэклога и референса и подставляется в промпт плана (`docs/bridge.md`). Её не путать с `director.brief` — это то, что
вернул чат.

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| `idea` | string | `""` | идея выпуска |
| `angle` | string | `""` | угол подачи |
| `hook_promise` | string | `""` | обещание хука — что зритель узнает |
| `notes` | string | `""` | заметки автора для чата |
| `sources` | `[{title, url}]` | `[]` | источники; лишние поля у источника запрещены |
| `idea_id` | string \| `null` | `null` | идея бэклога, из которой выпуск создан (M4.8) |
| `reference_id` | string \| `null` | `null` | референс, по которому выпуск создан (M4.10) |
| `reference_mode` | `none \| structure_clone \| own_version` | `none` | режим референса (принцип 11) |

Строки могут быть пустыми. Пустой проект — `brief: null`. Первый PATCH с `brief` создаёт заявку: недостающие поля
получают значения по умолчанию. Дальше заявка правится по общему правилу мёрджа: `{"brief": {"angle": "…"}}` не
трогает остальные поля, `sources` заменяется целиком, `{"brief": null}` сбрасывает заявку. Лишнее поле — 422.

## `shots{}` — ShotState

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| `status` | `todo \| queued \| generating \| done \| failed \| stale \| removed` | `todo` | `stale` — картинка перестала соответствовать плану или план конфликтует с блокировкой, картинка не удалена (принцип 8); `removed` — кадр убран из плана, ассеты на месте |
| `duration_locked` | bool | `false` | длина задана вручную, выравнивание голоса её не перезаписывает (принцип 1); план изменил `vo` — кадр `stale` с причиной |
| `prompt_locked` | bool | `false` | промпт не обновляется при импорте новой версии плана; план изменил промпт — кадр `stale` с причиной |
| `user_override` | `ShotOverride` \| `null` | `null` | ручные правки полей кадра поверх плана; импорт не затирает, конфликт с планом — `stale` с причиной |
| `stale_reasons` | string[] | `[]` | почему кадр `stale` / `removed`, человеческим языком; ставит импорт плана или ручная правка |

Ключ — `shot.id` плана (`s\d{3,}`). Правило `stale` и мёрджа — «Импорт и версии» в `docs/director_schema.md`.

### `user_override` — ShotOverride

Правки полей кадра с экрана 3 (лист сценария, таблица плана; устав M4, решение 6). Форма — как у кадра плана, но
каждое поле необязательно, и правка частичная: `{"motion": {"strength": 0.12}}` меняет только силу движения.
Пустые поля в файл не пишутся; правки нет — `user_override: null`.

| Поле | Тип | Что правит |
|---|---|---|
| `vo` | string | текст закадрового голоса |
| `image` | `{prompt?, shot_size?}` | промпт кадра (только действие и композиция) и крупность |
| `motion` | `{type?, strength?, ease?}` | движение камеры |
| `transition_in` | `{type?, duration?}` | переход в кадр |
| `animate` | `{recommended?, reason?, prompt?, seconds?}` | анимация |
| `sfx` | `SfxSpec[]` | SFX кадра — список заменяется целиком; `[]` — тоже правка |

Эпоху и облики (`image.period`, `image.appearances`) правкой не поменять — их меняет новая версия плана (принцип 14).

**Проверка.** Действующий кадр (кадр текущей версии с наложенной правкой) проходит те же проверки, что кадр плана:
`Shot` (типы, литералы, диапазоны: `motion.strength` 0…0.25, `transition_in.duration` 0…1.5, `animate.seconds` 2…10)
и `validators.check_shot` (непустой `vo` и промпт, стоп-лист в промпте, `animate.prompt` при `recommended`).
Ошибка — 422 с текстом плана: `кадр s003: в image.prompt стилевой токен «cinematic lighting» (lighting), …`,
`кадр s003: motion.strength = 0.3 вне диапазона, ожидалось ≤ 0.25`. Ошибки берутся только по поправленным полям.

**Ручной `stale`.** У кадра с картинкой (`done`, а также уже `stale`) правка, сменившая действующие `image.prompt` или
`image.shot_size`, ставит `stale` и добавляет причину «Промпт изменён вручную» / «Крупность изменена вручную».
Правка VO, движения, перехода, анимации и SFX картинку не трогает. У кадров без картинки (`todo`, `queued`) статус не
меняется — правка войдёт в генерацию.

## `director_versions{}` — DirectorVersionInfo

| Поле | Тип | Описание |
|---|---|---|
| `version` | `vNNN` | равен ключу |
| `hash` | `sha256:…` | канонический JSON плана; тот же план второй раз версию не создаёт |
| `imported_at` | ISO 8601 UTC | первый импорт этой версии |
| `parts` | int ≥ 1 | из скольких частей собран план |
| `source` | `bridge \| manual \| api` | откуда версия пришла впервые: мост через чат, ручной импорт или правка JSON, Claude API (M4.2); записи без поля читаются как `manual` |
| `shots` | int | кадров в версии |
| `added`, `changed`, `removed` | int | итог последнего мёрджа этой версии в проект |

## `assets{}` — Asset

| Поле | Тип | Описание |
|---|---|---|
| `id` | str | равен ключу |
| `shot_id` | `s\d{3,}` \| `null` | кадр; `null` для ассетов эпизода (музыка, рендер, обложка) |
| `kind` | `image \| voice \| animation \| sfx \| music \| thumbnail \| render` | |
| `version` | int ≥ 1 | версия ассета этого кадра и вида |
| `path` | str | относительно каталога выпуска: `media/s001/v002.png` |
| `hash` | str | хэш входов (принцип 8); по нему ищется готовый ассет в `assets` SQLite |
| `status` | `ok \| stale \| failed` | |

## `timings{}` — Timing

| Поле | Тип | Описание |
|---|---|---|
| `shot_id` | `s\d{3,}` | равен ключу |
| `start` | float ≥ 0 | секунды от начала эпизода |
| `duration` | float > 0 | секунды; в рендере квантуется `round(t * fps)` |
| `source` | `voice \| locked \| estimate` | по выравниванию голоса / ручная (`duration_locked`) / оценка по словам до озвучки |

## PATCH — ProjectPatch

Тело `PATCH /api/projects/{episode_id}` — `ProjectPatch` (M4.3): только то, что правит человек.

| Поле | Что |
|---|---|
| `brief` | заявка выпуска, частично (см. `brief`) |
| `shots` | `{shot_id: {duration_locked?, prompt_locked?, user_override?}}` |

Остальное пишет пайплайн. Поле корня из `Project` — 422 «Поле director_version меняется пайплайном, не через PATCH —
уберите его из запроса.» (так же `director_versions`, `approved_version`, `approved_at`, `assets`, `timings`, `cost`,
`updated_at`), поля
идентичности — «Поле channel задаётся при создании выпуска и не меняется — …», неизвестное поле — «Лишнее поле nope —
уберите его из запроса.». Внутри кадра `status` и `stale_reasons` — «кадр s003: поле status меняется пайплайном, не
через PATCH — …».

**Мёрдж.** Словари сливаются рекурсивно, всё остальное (скаляры, списки, `null`) заменяется. Поэтому коллекции в
файле — объекты с ключом-идентификатором, а не массивы: правка одного кадра —
`{"shots": {"s007": {"duration_locked": true}}}` — не трогает остальные. В правке кадра `null` у поля — сброс этой
правки (`{"user_override": {"vo": null}}`), опустевшие блоки убираются, `{"user_override": null}` сбрасывает все
правки кадра. Результат проверяется целиком как `Project`; при ошибке — 422, файл не меняется.

**Кадры.** Править можно только кадры текущей версии плана: плана ещё нет, кадра нет в версии или он убран — 422
(`кадр s099: нет в плане v001, ожидалось id кадра текущей версии`). Затем — проверка и ручной `stale` из раздела
`user_override`.

**Ошибки.** `detail` — список в форме FastAPI (`{type, loc, msg, …}`), `msg` — по-русски. У правок кадра —
`кадр s003: …`, как у ошибок плана; у частых правок заявки — «Лишнее поле brief.title — уберите его из запроса.»,
«Нет обязательного поля brief.sources[0].url.», недопустимое значение с перечнем допустимых, «… должно быть строкой».
`updated_at` ставит сервер. Дебаунс автосохранения (800 мс) — на фронте; бэкенд пишет сразу.

Импорт новой версии плана (M2.4) идёт мимо PATCH: `merge_into_project` меняет в `shots` только `status` и
`stale_reasons`, добавляет запись в `director_versions` и переставляет `director_version`. `approved_*` пишет только
`POST /api/episodes/{id}/approve` (`docs/episodes.md`, «Утверждение плана»).

## Действующий план — `GET /api/projects/{episode_id}/plan`

Текущая версия плана с наложенными ручными правками (устав M4, решение 6): экран 3 получает его готовым и сам правки
не накладывает. Считает одна чистая функция `pipeline/director_import/effective.py → effective_plan(director, project,
removed_shots)`: на копию кадра версии правка накладывается тем же правилом мёрджа; диск читает только роутер.
План ещё не импортирован — 200 и `null`.

`EffectivePlan`:

| Поле | Описание |
|---|---|
| `version` | текущая версия `vNNN` |
| `source` | откуда версия: `bridge \| manual \| api` |
| `approved_version` | утверждённая версия из `project.json`; `null` — не утверждали; не равна `version` — утверждена старая версия, план нужно утвердить снова |
| `meta`, `sections`, `facts` | из версии как есть |
| `shots` | `PlanShot[]`: кадры версии по таймлайну, затем убранные |

`PlanShot` — поля кадра плана с наложенной правкой плюс `status`, `stale_reasons`, `duration_locked`, `prompt_locked`
и `overridden` — какие поля поправлены вручную, из `vo`, `image.prompt`, `image.shot_size`, `motion`, `transition_in`,
`animate`, `sfx` (в этом порядке). Убранные кадры (`status: removed`) — в конце по id, с содержимым из последней
версии, где они были: их не теряем (принцип 8).

## Пример

```json
{
  "schema": "studio.project/1",
  "episode_id": "c07-pirate-ship",
  "channel": "cursus",
  "brief": { "idea": "Every rank on a pirate ship", "angle": "Ranks through a powder monkey's eyes",
             "hook_promise": "From powder monkey to captain in twenty minutes", "notes": "",
             "sources": [{ "title": "Pirate articles of 1720", "url": "https://example.org/articles" }],
             "idea_id": null, "reference_id": null, "reference_mode": "none" },
  "director_version": "v002",
  "director_versions": {
    "v001": { "version": "v001", "hash": "sha256:2f78…", "imported_at": "2026-09-20T18:02:11+00:00",
              "parts": 1, "shots": 10, "added": 10, "changed": 0, "removed": 0 },
    "v002": { "version": "v002", "hash": "sha256:5aa2…", "imported_at": "2026-09-21T02:40:57+00:00",
              "parts": 2, "shots": 10, "added": 1, "changed": 3, "removed": 1 }
  },
  "shots": {
    "s001": { "status": "done", "duration_locked": false, "prompt_locked": false, "user_override": null,
              "stale_reasons": [] },
    "s002": { "status": "stale", "duration_locked": true, "prompt_locked": false,
              "user_override": { "motion": { "strength": 0.12 } },
              "stale_reasons": ["Промпт: добавлено „his small silhouette framed by the low doorway“"] },
    "s006": { "status": "removed", "duration_locked": false, "prompt_locked": false, "user_override": null,
              "stale_reasons": ["Кадр убран из плана v002"] }
  },
  "assets": {
    "img-s001-v1": { "id": "img-s001-v1", "shot_id": "s001", "kind": "image", "version": 1,
                     "path": "media/s001/v001.png", "hash": "3f9a…", "status": "ok" }
  },
  "timings": {
    "s001": { "shot_id": "s001", "start": 0.0, "duration": 5.84, "source": "voice" },
    "s002": { "shot_id": "s002", "start": 5.84, "duration": 4.0, "source": "locked" }
  },
  "cost": { "script": 380000, "images": 6970000 },
  "updated_at": "2026-09-21T02:43:04+00:00"
}
```
