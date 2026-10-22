# director.json — контракт `studio.director/1`

Режиссёрский план эпизода: **замысел**, не реализация. Что сказать, какие кадры, движение, звук, метаданные
публикации. Приходит из LLM (API или мост через чат), каждая версия — отдельный неизменяемый файл
`data/projects/<channel>/<episode>/director/vNNN.json`.

Чего в нём **нет**:
- таймингов — длительность кадра задаёт голос по выравниванию, всё это в `project.json` (принцип 1);
- канона — стиль, эпоха и внешность живут в `data/channels/<channel>/canon/`, план ссылается на их версии
  через `canon_ref` (принципы 13, 14);
- стиля в промптах — `shot.image.prompt` описывает только действие, композицию и ракурс; стилевые токены
  отклоняет валидатор по стоп-листу `config/prompt_stoplist.yaml`.

Источник контракта — Pydantic-модели `backend/app/models/director.py`. Из них генерируется
`docs/director.schema.json` (`PYTHONPATH=backend uv run python -m app.tools.gen_schema`; тест следит, что файл
не отстаёт от кода). Этот документ описывает те же поля словами.

**Точка входа:** `app.models.validators.validate_director(data) -> Director`. При ошибках поднимает
`DirectorValidationError` со списком `errors` — все ошибки разом, по строке на каждую, формат
`кадр s047: <что не так>, ожидалось <что>`. Те же ошибки структурно — `items` (M4.3), в том же порядке:
`{shot_id, path, message}`, где `message` — строка из `errors`, `shot_id` — кадр или `null` (ошибка не по кадру),
`path` — поле внутри кадра (`image.prompt`, `motion.strength`) или от корня плана (`meta.episode_id`,
`music.0.section`). По `items` JSON-редактор ставит ссылки «к кадру». Доменные проверки встроены в модель `Director`,
так что `Director.model_validate` их тоже выполняет — но сообщения там сырые, pydantic-овские.

Лишние поля запрещены на всех уровнях (`additionalProperties: false`): контракт — ровно этот скелет.

## Корень

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `schema` | const `"studio.director/1"` | да | версия контракта; в Python-модели поле называется `schema_version` (алиас `schema`) |
| `meta` | `Meta` | да | что за эпизод |
| `brief` | `Brief` | да | идея, угол, обещание хука, источники |
| `canon_ref` | `CanonRef` \| null | часть 1 — да | ссылки на версии канона |
| `voice` | `VoiceCfg` \| null | часть 1 — да | голос закадра |
| `sections` | `Section[]` | да | разделы (в every_rank — ранги), порядок = порядок в ролике |
| `shots` | `Shot[]` | да | кадры, порядок = таймлайн |
| `music` | `MusicCue[]` | нет, `[]` | музыка по разделам |
| `thumbnail` | `Thumbnail` | да | концепты обложки |
| `publish` | `PublishMeta` | да | метаданные YouTube |
| `facts` | `Fact[]` | нет, `[]` | утверждения на проверку |

## `meta`

| Поле | Тип | Обяз. | Диапазон / формат | Значение |
|---|---|---|---|---|
| `channel` | `"cursus"` \| `"otto"` | да | | канал |
| `episode_id` | string | да | `^[a-z0-9][a-z0-9-]*$` | становится именем папки эпизода |
| `working_title` | string | да | | рабочее название |
| `format` | `"every_rank"` \| `"host"` | да | | формат ролика |
| `language` | string | нет, `"en"` | | язык VO |
| `target_minutes` | int | да | 1…40 | целевая длительность |
| `part` | int | нет, `1` | ≥ 1, ≤ `parts_total` | номер части плана |
| `parts_total` | int | нет, `1` | ≥ 1 | сколько всего частей |

## `brief`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `idea` | string | да | идея эпизода |
| `angle` | string | да | угол подачи |
| `hook_promise` | string | да | что обещает хук |
| `reference_mode` | `"none"` \| `"structure_clone"` \| `"own_version"` | нет, `"none"` | режим работы с референсом (принцип 11) |
| `sources` | `Source[]` | нет, `[]` | `{ title: string, url: string }` |

## `canon_ref`

| Поле | Тип | Обяз. | Формат значения | Значение |
|---|---|---|---|---|
| `style` | string | да | `style/vNNN` | версия стиля канала |
| `periods` | `{ <period_id>: string }` | нет, `{}` | `periods/<id>/vNNN` | ключ — то, на что ссылается `shot.image.period` |
| `appearances` | `{ <appearance_id>: string }` | нет, `{}` | `characters/<id>/vNNN#<облик>` | ключ (`you@powder-monkey-11`) — то, на что ссылается `shot.image.appearances` |

Эпизод прибит к версиям: обновление канона не меняет старые планы (принцип 14).

**При мосте через чат блок пишет код, а не чат** (M4.2, принцип 13). Чат указывает в кадрах только id эпох и обликов;
`build_canon_ref` (`pipeline/script/plan_bridge.py`) собирает из них ссылки. Ключи — по кадрам всех частей: облик,
впервые появившийся в части 3, попадает в `canon_ref` части 1, которую берёт сборка. Присланный чатом `canon_ref`
заменяется, в ответе API об этом предупреждение.

**Откуда версии** (M5.2, устав M5, решение 3; `pipeline/canon/episode_canon.py`, `pin_*`). Для каждого id — стиля,
эпохи, облика — по порядку:

1. id есть в `canon_ref` текущей (прошлой) версии плана — ссылка оттуда, как есть, даже если опубликовано новее и
   даже если такой версии нет (заготовка);
2. иначе — последняя опубликованная версия: у эпохи и стиля — последний `vNNN.json`, у облика — последняя версия
   персонажа, где этот облик есть;
3. иначе — заготовка `v001`: `style/v001`, `periods/<id>/v001`, `characters/<персонаж>/v001#<облик>`. Файл появится
   по этому id; канон выпуска покажет `missing`, утверждение откажет (`docs/episodes.md`).

Новые версии канона план сам не подхватывает (принцип 14): перевод — явное действие «Перевести на новые версии»
(`docs/project_schema.md`, «Канон выпуска»).

**Ручной импорт и «Сохранить как версию»** (`POST …/director`, `POST …/director/validate`) принимают присланный блок
как есть — JSON-редактор шлёт `canon_ref` текущей версии, так прибитые версии и сохраняются. Код дописывает только
недостающее: ключ `style`, если его нет, и ключи эпох и обликов, на которые ссылаются кадры, а в блоке их нет, — по
правилу выше (`plan_bridge.fill_canon_ref`). Блока нет вовсе или он не объект — ничего не дописывается: ошибку
покажет валидация. Части 2…N без `canon_ref` не дополняются, как и раньше. Отсутствующий канон импорт не
останавливает — отказ только при утверждении.

## `voice`

| Поле | Тип | Обяз. | Диапазон | Значение |
|---|---|---|---|---|
| `provider` | string | да | | провайдер TTS (ID моделей и цены — в `config/*.yaml`, не здесь) |
| `voice_id` | string | да | | голос у провайдера |
| `model` | string | да | | модель TTS |
| `pace_wpm` | int | да | 100…200 | темп, слов в минуту |

При мосте через чат блок тоже пишет код (M4.2): `voice_id` и `pace_wpm` — из профиля канала
(`profile.json → voice`; без поля или с `pace_wpm: null` — темп пресета формата), `provider` и `model` — маршрут этапа
`voice` профиля по умолчанию в `config/providers.yaml` (принцип 5). Пока голос не выбран — `voice_id: "unset"`.

## `sections[]`

| Поле | Тип | Обяз. | Формат | Значение |
|---|---|---|---|---|
| `id` | string | да | `^[a-z][a-z0-9_-]*$`, уникален | ссылка для `shot.section` и `music.section` |
| `title` | string | да | | название раздела (глава YouTube) |
| `chapter` | bool | нет, `true` | | делать ли главу YouTube |
| `vo_direction` | string \| null | нет, `null` | | указание диктору для раздела |

## `shots[]`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `id` | string | да | `^s\d{3,}$`, уникален; по нему мёрджатся версии плана (M2.4) |
| `section` | string | да | id существующего раздела |
| `vo` | string | да | текст закадра кадра, непустой; задаёт длительность кадра |
| `image` | `ImageSpec` | да | см. ниже |
| `motion` | `Motion` | да | см. ниже |
| `transition_in` | `Transition` | нет, `{cut, 0}` | переход **в** кадр |
| `animate` | `AnimateSpec` | нет, `{false, null, null, 4}` | рекомендация анимировать |
| `sfx` | `SfxSpec[]` | нет, `[]` | звуковые эффекты |
| `overlay` | null | нет, `null` | зарезервировано: в схеме 1 форма не определена, допустим только `null` |

### `shot.image`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `prompt` | string | да | **только действие, композиция, ракурс**; непустой; без стилевых токенов из стоп-листа |
| `period` | string | да | ключ из `canon_ref.periods` |
| `appearances` | string[] | нет, `[]` | ключи из `canon_ref.appearances`; пусто — кадр без персонажа |
| `shot_size` | `"establishing"` \| `"action"` \| `"reaction"` \| `"detail"` | да | крупность |

Итоговый промпт собирает код: `style_block + period_block + appearance_block(и) + shot.image.prompt + negative`
(`pipeline/images/prompt_builder.py`, принцип 13).

### `shot.motion`

| Поле | Тип | Обяз. | Диапазон | Значение |
|---|---|---|---|---|
| `type` | `push_in` \| `pull_out` \| `pan_left` \| `pan_right` \| `tilt_up` \| `tilt_down` \| `static` \| `drift` | да | | тип движения камеры |
| `strength` | float | да | 0…0.25 | сила движения (доля кадра); для `static` — 0 |
| `ease` | `linear` \| `in_out_sine` \| `in_out_cubic` \| `in_cubic` \| `out_cubic` | да | | кривая; формулы — `docs/motion_spec.md` (модуль движения) |

### `shot.transition_in`

| Поле | Тип | Обяз. | Диапазон | Значение |
|---|---|---|---|---|
| `type` | `cut` \| `crossfade` \| `dip` | нет, `cut` | | переход в кадр |
| `duration` | float | нет, `0.0` | 0…1.5 с | для `cut` — 0 |

### `shot.animate`

| Поле | Тип | Обяз. | Диапазон | Значение |
|---|---|---|---|---|
| `recommended` | bool | нет, `false` | | стоит ли анимировать кадр |
| `reason` | string \| null | нет, `null` | | почему |
| `prompt` | string \| null | обязателен при `recommended = true` | | описание движения для модели анимации |
| `seconds` | int | нет, `4` | 2…10 | длительность клипа |

### `shot.sfx[]`

| Поле | Тип | Обяз. | Диапазон | Значение |
|---|---|---|---|---|
| `prompt` | string | да | | описание звука |
| `offset` | float | нет, `0.0` | ≥ 0 | смещение от начала кадра, с |
| `duration` | float | да | > 0 | длительность, с |
| `gain_db` | float | да | −40…0 | громкость |

## `music[]`

| Поле | Тип | Обяз. | Диапазон | Значение |
|---|---|---|---|---|
| `section` | string | да | | id существующего раздела |
| `mood` | string | да | | описание для генерации |
| `gain_db` | float | да | −40…0 | громкость |

## `thumbnail`

`concepts: { prompt: string, text: string }[]` — концепты обложки: промпт картинки и текст поверх.

## `publish`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `titles` | string[] | да | варианты названия |
| `description` | string | да | описание |
| `tags` | string[] | да | теги |
| `category_id` | string | да | категория YouTube (`"27"` — Education) |
| `synthetic_media` | bool | да | флаг синтетического контента |
| `made_for_kids` | bool | да | флаг «для детей» |

## `facts[]`

| Поле | Тип | Обяз. | Значение |
|---|---|---|---|
| `claim` | string | да | утверждение |
| `status` | `verified` \| `disputed` \| `not_found` | да | результат проверки |
| `source_url` | string \| null | нет, `null` | источник |
| `shot_id` | string \| null | нет | кадр, чей VO делает утверждение (факт-чек на экране 3, M4.2); `^s\d{3,}$`, кадр должен быть в плане |

`shot_id` появился в M4.2. Планы без него читаются, а пустое поле в файл версии не выгружается: хэш старого плана
не меняется. В части (`parts_total > 1`) ссылку проверяет сборка целого плана — факт может ссылаться на кадр другой
части.

## Правило частей

Длинный план LLM отдаёт частями: `meta.part` / `meta.parts_total`, `part ≤ parts_total`.
- **Часть 1** — полный документ: `canon_ref` и `voice` обязательны.
- **Части 2…N** — `canon_ref` и `voice` можно не передавать (`null` или отсутствуют): при импорте они берутся из
  части 1 (сам мёрдж — M2.4). Остальные блоки (`meta`, `brief`, `sections`, `shots`, `thumbnail`, `publish`)
  передаются как обычно. Пока `canon_ref` в части нет, ссылки `image.period` и `image.appearances` не
  проверяются — проверка пройдёт после подстановки при импорте.

## Импорт и версии

`POST /api/projects/{episode_id}/director` — тело: план целиком или одна часть. Роутер — `backend/app/api/director.py`,
чистая логика — `backend/app/pipeline/director_import/` (`merge.py`: сборка, хэш, diff, мёрдж; `stale.py`: словарь
изменений и правило `stale`).

**Версии.** Каждый импорт пишет `director/vNNN.json` один раз атомарно; файл дальше не меняется. Хэш — sha256
канонического JSON (`model_dump(by_alias)`, ключи отсортированы, без пробелов): тот же план с другим порядком ключей
версию не создаёт. Индекс версий (`hash`, `imported_at`, `parts`, `source`, счётчики) — `project.json → director_versions`;
следующий номер = max по индексу + 1; файл с таким номером без записи в индексе — 409, не перезапись. Хэш совпал
с не текущей версией — она переиспользуется и мёрджится как обычный импорт; совпал с текущей — ответ с нулями и
`created: false`. `meta.episode_id`/`meta.channel` не совпали с выпуском из URL — 422.

**Общий путь импорта** — `import_plan(paths, db, episode, director, source)` в `api/director.py` (M4.2). Его зовут ручной
`POST …/director?source=…` (по умолчанию `manual`: ручной импорт и «Сохранить как версию» из JSON-редактора, M4.3) и
мост через чат (`source: bridge`, `api/plan.py`); неполный набор частей
функция возвращает (`PartsPending`), ручной путь отдаёт его как 409, мост — как принятую часть. `source` версии
(`bridge | manual | api`) — откуда она пришла впервые, как `imported_at`; записи индекса до M4.2 читаются как
`manual`. Успешный импорт переводит выпуск из стадии `idea` в `script` (`docs/episodes.md`).

**Части.** `parts_total > 1` → часть валидируется и кладётся в `cache/director_parts/part-NN.json`. Часть 1 начинает
новый набор (старые файлы стираются); часть 2…N без части 1 или с другим `parts_total` — 409. Неполный набор — 409
`{"detail": {"received": [1], "missing": [2, 3], "message": "…"}}`. После последней части `assemble_parts`: из части
1 — `meta` (с `part = parts_total = 1`), `brief`, `canon_ref`, `voice`, `thumbnail`, `publish`; `shots`, `music`,
`facts` — конкатенация по порядку частей; `sections` — конкатенация с дедупом по `id` (один `id` с разным
содержимым — 422). Собранный план проходит `validate_director` целиком — здесь проверяются ссылки на канон частей
2…N; ошибка сборки — 422, части остаются на месте: исправленную часть можно прислать одну. На диск ложится
цельный план — хэш тот же, что при импорте целиком.

**Мёрдж по `shot.id`** (`merge_into_project`) меняет в `project.json → shots[id]` только `status` и `stale_reasons`;
`duration_locked`, `prompt_locked`, `user_override`, ассеты и тайминги не трогаются. Ручная правка переживает новую
версию: действующий план (`GET …/plan`, `docs/project_schema.md`) показывает её поверх новой версии, а если план
изменил поправленное поле — кадр `stale` с причиной «План изменил vo, но действует ручная правка vo». В новую версию
правки автоматически не сливаются: новая версия — только импорт или «Сохранить как версию».

| Кадр | Что происходит |
|---|---|
| есть в плане, нет в проекте | `todo`, в отчёте `added` (до M6.1 — `queued`) |
| был `removed`, снова в плане | `todo`, «Кадр вернулся в план»; с выбранной картинкой — `stale` с причиной «Кадр снова в плане vNNN: картинка — от прежнего кадра, сверьте её» и `stale: true` в отчёте: прежнего содержания кадра мёрдж не видит |
| нет в новом плане | `removed`, причина «Кадр убран из плана vNNN»; файлы не удаляются (принцип 8) |
| изменён | в отчёте `changed`; `stale` — по правилу ниже |
| не изменён | как был |

**Правило `stale`** (`stale.py`): кадр становится `stale`, если картинка перестала соответствовать плану — изменились
`image.prompt`, `image.period`, `image.appearances`, `image.shot_size` или версии канона (`canon_ref.style` — все
кадры; версия периода — кадры этой эпохи; версия облика — кадры с ним; принцип 14) — либо план конфликтует с ручной
правкой: `prompt_locked` и промпт изменён; `duration_locked` и `vo` изменён («План изменил текст VO (длительность),
но длительность заблокирована»); `user_override` покрывает изменённое поле. Смена `vo`, `section`, `motion`,
`transition_in`, `animate`, `sfx` без блокировки — изменение для отчёта, статус не меняет: голос и рендер увидят её
по хэшу входов (принцип 8). `stale_reasons` — только причины, сделавшие кадр `stale`; для промпта и VO — словарный
diff: «Промпт: добавлено „a lantern in his hand“; убрано „…“», сильно переписанный текст — «Промпт переписан».

**Кадр без картинки** (`image_version` нет, M6.1) `stale` не становится ни от изменения плана, ни от смены версий
канона, ни от конфликта с блокировкой: устаревать нечему. Статус остаётся прежним (`todo`), причины дописываются в
`stale_reasons` как история — без повторов, в отчёте `stale: false`. Первая выбранная версия картинки историю
очищает (`docs/generation.md`, «Версии кадра»).

**Ответ** `ImportResult`: `version`, `created`, `added`, `changed`, `removed`, `changes[]` —
`{shot_id, section, kind: added|changed|removed, change, fields, stale, drawn_at, price}` в порядке таймлайна нового
плана, убранные — в конце. `drawn_at` и `price` пока всегда `null` — дата и цена выбранной версии появятся в M6.11.
Ошибки валидации — 422 `{"detail": {"errors": [...], "items": [...]}}` в формате раздела ниже (`items` — с M4.3; у
ошибок сборки частей — только `errors`).

`GET …/director/versions` — индекс версий по порядку; `GET …/director/vNNN` — файл версии как есть, 404 если нет.

**Проверка без записи** — `POST /api/projects/{episode_id}/director/validate` (M4.3, `api/plan.py`). Тело — как у
импорта: план целиком или часть. Те же проверки — `validate_director` и совпадение `meta.episode_id`/`meta.channel` с
выпуском, — но ничего не пишется: ни версия, ни набор частей, ни `project.json`. Ответ всегда 200
`PlanCheck {ok, errors[], items[]}`. `canon_ref` и `voice` полного плана проверяются как есть — JSON-редактор
присылает их из текущей версии; недостающие ключи `canon_ref` дописываются, как при импорте (M5.2). Части не
собираются, ссылки на канон части 2…N без `canon_ref` не проверяются.

## Доменные проверки и сообщения

Порядок стабильный; собираются все ошибки, не первая.

| Проверка | Пример сообщения |
|---|---|
| `part ≤ parts_total` | `meta: part = 2 больше parts_total = 1, ожидалось part ≤ parts_total` |
| `canon_ref`, `voice` в части 1 | `canon_ref: блок отсутствует, ожидалось обязательный блок в части 1` |
| формат ссылок канона | `canon_ref: periods[caribbean-1716] = «caribbean-1716», ожидалось periods/<id>/vNNN` |
| уникальность `section.id` | `раздел r1: id повторяется, ожидалось уникальный id раздела` |
| уникальность `shot.id` | `кадр s002: id повторяется, ожидалось уникальный id кадра` |
| `shot.section` существует | `кадр s003: раздел «r9» не найден, ожидалось один из r1, r2` |
| `vo` непустой | `кадр s002: пустой vo, ожидалось текст закадрового голоса` |
| `image.prompt` непустой | `кадр s004: пустой image.prompt, ожидалось действие и композиция кадра` |
| `animate.prompt` при `recommended` | `кадр s003: animate.recommended = true без animate.prompt, ожидалось описание движения для анимации` |
| `image.period` в `canon_ref.periods` | `кадр s001: image.period «england-1347» нет в canon_ref.periods, ожидалось один из caribbean-1716` |
| `image.appearances` в `canon_ref.appearances` | `кадр s002: облик «you@captain-35» нет в canon_ref.appearances, ожидалось один из you@powder-monkey-11` |
| стоп-лист в `image.prompt` | `кадр s003: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, композиция и ракурс — стиль задаёт канон` |
| `music[].section` существует | `music[1]: раздел «r9» не найден, ожидалось один из r1, r2` |
| `facts[].shot_id` существует | `facts[0]: кадр «s099» не найден, ожидалось id кадра этого плана` |

Структурные ошибки (тип, литерал, диапазон, формат, лишнее или отсутствующее поле) переводятся в тот же
формат с ID кадра: `кадр s002: motion.strength = 0.4 вне диапазона, ожидалось ≤ 0.25`,
`кадр s001: нет поля vo, ожидалось обязательное поле`, `meta: target_minutes = 'twenty' не того типа,
ожидалось целое число`. Структурные ошибки проверяются первыми; доменные — когда структура цела.

Стоп-лист (`config/prompt_stoplist.yaml`) сравнивается без учёта регистра, по целым словам и фразам:
`Anime` ловится, `animated` — нет; `8k` ловится, `18k` — нет. Категории: `render`, `lighting`, `optics`,
`medium`, `artists`.

## Примеры кадра

Общий план без персонажа, с эмбиентом:

```json
{
  "id": "s001",
  "section": "r1",
  "vo": "You are eleven years old, and the first thing you learn on this ship is where the gunpowder lives.",
  "image": {
    "prompt": "a sloop at anchor in a shallow turquoise bay at dawn, seen from the beach, small figures moving on deck",
    "period": "caribbean-1716",
    "appearances": [],
    "shot_size": "establishing"
  },
  "motion": { "type": "push_in", "strength": 0.06, "ease": "in_out_cubic" },
  "transition_in": { "type": "cut", "duration": 0.0 },
  "animate": { "recommended": false, "reason": null, "prompt": null, "seconds": 4 },
  "sfx": [
    { "prompt": "gentle waves lapping a wooden hull, distant gulls", "offset": 0.0, "duration": 6.0, "gain_db": -20 }
  ],
  "overlay": null
}
```

Кадр действия с персонажем, рекомендацией анимировать и эффектом:

```json
{
  "id": "s003",
  "section": "r1",
  "vo": "Your job is to run. Cartridge case in both arms, up the ladder, along the gun deck, and back down before the gun captain shouts your name again.",
  "image": {
    "prompt": "sprints along a crowded gun deck hugging a leather cartridge case to his chest, glancing back over his shoulder, gun crews at work on both sides",
    "period": "caribbean-1716",
    "appearances": ["you@powder-monkey-11"],
    "shot_size": "action"
  },
  "motion": { "type": "pan_right", "strength": 0.10, "ease": "in_out_sine" },
  "transition_in": { "type": "cut", "duration": 0.0 },
  "animate": {
    "recommended": true,
    "reason": "the run is the whole point of the rank; a still frame reads as posed",
    "prompt": "the boy runs toward the camera along the deck, crew members lean aside, the case bounces against his chest",
    "seconds": 5
  },
  "sfx": [
    { "prompt": "bare feet slapping on wooden planks, rope creaking", "offset": 0.5, "duration": 4.0, "gain_db": -18 }
  ],
  "overlay": null
}
```

Полный пример — `tests/fixtures/director_pirate_10shots.json` (10 кадров, 2 раздела); битые примеры с
ожидаемыми сообщениями — `tests/fixtures/director_broken_*.json` и `tests/test_director_schema.py`.
