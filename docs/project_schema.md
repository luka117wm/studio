# project.json — контракт `studio.project/1`

Реализация эпизода: что сделали с планом. Лежит в `data/projects/<channel>/<episode>/project.json`, создаётся
пустым при `POST /api/episodes`, дальше меняется только через `PATCH /api/projects/{episode_id}` (и пайплайн на
бэкенде). Каждая запись атомарна: temp-файл в той же папке → fsync → rename (L-003). Модели —
`backend/app/models/project.py`.

Чего в нём **нет**: замысла (он в `director/vNNN.json`, файл ссылается на версию через `director_version`),
канона, медиа (только относительные пути и хэши).

## Корень

| Поле | Тип | Описание |
|---|---|---|
| `schema` | `"studio.project/1"` | версия контракта |
| `episode_id` | `^[a-z0-9][a-z0-9-]*$` | совпадает с именем каталога и `meta.episode_id` плана |
| `channel` | `cursus \| otto` | канал |
| `director_version` | `vNNN` \| `null` | текущая версия плана; `null` — план ещё не импортирован |
| `shots` | `{shot_id: ShotState}` | состояние и ручные правки кадров |
| `assets` | `{asset_id: Asset}` | ассеты с версиями |
| `timings` | `{shot_id: Timing}` | фактические тайминги кадров (принцип 1) |
| `cost` | `{stage: int}` | потрачено по этапам, микродоллары (L-001) |
| `updated_at` | ISO 8601 UTC | ставит сервер при каждой записи |

Лишние поля запрещены. `schema`, `episode_id`, `channel` задаются при создании выпуска; PATCH с другими
значениями — 422.

## `shots{}` — ShotState

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| `status` | `todo \| queued \| generating \| done \| failed \| stale` | `todo` | `stale` — промпт или версия канона изменились, картинка не удалена (принцип 8) |
| `duration_locked` | bool | `false` | длина задана вручную, выравнивание голоса её не перезаписывает (принцип 1) |
| `prompt_locked` | bool | `false` | промпт не обновляется при импорте новой версии плана |
| `user_override` | объект \| `null` | `null` | ручные правки полей кадра поверх плана; импорт не затирает |

Ключ — `shot.id` плана (`s\d{3,}`).

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

## Правило мёрджа PATCH

Тело `PATCH /api/projects/{episode_id}` — произвольный JSON-объект. Словари сливаются рекурсивно, всё остальное
(скаляры, списки, `null`) заменяется. Поэтому коллекции в файле — объекты с ключом-идентификатором, а не массивы:
правка одного кадра — `{"shots": {"s007": {"duration_locked": true}}}` — не трогает остальные. Результат
проверяется целиком как `Project`; при ошибке — 422, файл не меняется. `updated_at` клиента игнорируется.
Дебаунс автосохранения (800 мс) — на фронте; бэкенд пишет сразу.

Тем же правилом M2.4 мёрджит импорт новой версии плана по `shot.id`.

## Пример

```json
{
  "schema": "studio.project/1",
  "episode_id": "c07-pirate-ship",
  "channel": "cursus",
  "director_version": "v002",
  "shots": {
    "s001": { "status": "done", "duration_locked": false, "prompt_locked": false, "user_override": null },
    "s002": { "status": "stale", "duration_locked": true, "prompt_locked": false,
              "user_override": { "motion": { "strength": 0.12 } } }
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
