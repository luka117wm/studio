# CLAUDE.md — Studio

## Что это
Локальное веб-приложение для производства англоязычных исторических YouTube-роликов из AI-кадров и закадрового голоса. Один пользователь, два изолированных канала: Otto's Timeline (ведущий-персонаж, 6–10 мин) и Cursus (every rank, рассказчик, 18–25 мин). Цель — выпуск раз в два дня при ≤ 3 ч внимания автора на ролик.

Пайплайн: идея → сценарий → director.json (режиссёрский план) → кадры + голос → таймлайн под голос (автозум, переходы, субтитры; по желанию анимация, SFX, музыка) → рендер и экспорт → публикация на YouTube.

## Карта документов
| Файл | Что это | Когда читать |
|---|---|---|
| `CLAUDE.md` | правила, принципы, стек, протокол работы | каждая сессия |
| `docs/roadmap.md` | линейный список модулей: текущий детально, следующий контуром, дальше по строке | выбор этапа; ☑ на финише |
| `docs/tasks/Mk.md` | устав модуля: что на выходе, чего нет, этапы, приёмка целиком, что следом | старт модуля; приёмка |
| `docs/tasks/Mk.x.md` | задание этапа: цель, что читать, что создать, приёмка | сессия этапа |
| `docs/drafts/` | черновики этапов, написанные до дизайна — материал для будущих модулей, не план | составление модуля |
| `docs/LESSONS.md` | журнал граблей, ≤ 150 строк | каждая сессия |
| `STATUS.md` | что сделано, хвосты, что дальше — контекст между сессиями | раздел «Дальше» на старте; обновить на финише |
| `design/CLAUDE.md` | палитра, типографика, плотность, состояния | все M-этапы |
| `design/handoff/README.md` | продукт, сквозной сценарий, 7 неизменяемых правил | первый M-этап экрана |
| `design/handoff/components.md`, `layout.md` | инвентарь компонентов; размеры панелей, поведение по ширине, клавиатура | этап компонента / экрана |
| `design/handoff/stack.md` | UI-стек, мост токенов, порядок экранов | споры о стеке фронта |
| `design/handoff/tokens.css` | единственный источник цветов и размеров; копия — `frontend/src/styles/tokens.css` | не читать — использовать утилиты из `theme.css` |
| `design/Studio - *.dc.html` | артборды, только чтение | по указанию task-файла |
| `docs/director_schema.md`, `docs/director.schema.json`, `docs/project_schema.md` | контракты director.json и project.json | появятся в M2 |
| `docs/canon_schema.md`, `docs/prompt_assembly.md` | схемы канона; порядок и разделители сборки промпта | появятся в модуле канона |
| `docs/motion_spec.md` | формулы движения камеры и переходов; менять только по правилу принципа 2 | появится в модуле движения |
| `docs/providers.md`, `config/providers.yaml`, `config/pricing.yaml` | этап → провайдер → модель; цены с датой проверки | появятся в M2 |
| `docs/api_keys.md` | где взять и куда положить ключи провайдеров и OAuth YouTube | перед M2.6; при смене провайдера |

## Стек
- **Frontend:** React 19, Vite, TypeScript strict, Tailwind v4 (токены через `@theme`, конфиг-файла нет), Zustand, TanStack Query, react-virtuoso, lucide-react; линтер oxlint, тесты vitest + Testing Library, e2e Playwright. Источник правды по UI-стеку и мосту токенов — `design/handoff/stack.md`, при расхождении в библиотеках и токенах прав он. Архитектура — по этому файлу: фронт ходит только в свой бэкенд, провайдеров и очереди во фронте нет.
- **Backend:** Python 3.12, FastAPI, Pydantic v2, SQLite (sqlite3 + свои миграции), httpx, tenacity, anthropic, google-genai, google-api-python-client + google-auth-oauthlib, OpenCV + NumPy (компоновщик), FFmpeg через subprocess (декод, энкод, аудио, субтитры), pyloudnorm, rapidfuzz, opentimelineio. Зависимости добавляются в своём этапе, не заранее.
- **Локальный GPU** (torch CUDA в WSL, фаза 3+): Real-ESRGAN, Depth Anything V2 Small, WhisperX.
- **Тулинг:** uv, pnpm, ruff, mypy, oxlint, pytest, vitest, Playwright.
- **Окружение:** Windows + WSL2 Ubuntu, RTX 4060 Laptop 8 ГБ, 16 ГБ RAM. Репозиторий и данные (`data/`, gitignored) — в файловой системе WSL, не в `/mnt/c`.

## Структура
```
frontend/src/
  app/            AppShell, router, providers, keyboard (реестр сочетаний), KeyboardHelp
  ui/             кит по components.md: по файлу на компонент, index.ts, cn.ts
  screens/        episodes, ideas, script, generate, edit, inspector, export, publish, settings, states, canon
  mocks/          fixtures.ts — пиратский выпуск для оболочки (до M2)
  timeline/  preview/
  engine/         motion.ts, renderFrame.ts, subtitles.ts
  store/  api/    uiStore.ts; client.ts, sse.ts (с M2)
  styles/         tokens.css (копия, не править), theme.css (мост @theme), base.css
  types/          сгенерировано — не править (до M2 — временные типы фикстур)
backend/app/
  main.py  api/   роутеры
  models/         director.py, project.py, channel.py
  jobs/           queue.py, worker.py, events.py
  providers/      base.py, anthropic.py, gemini.py, elevenlabs.py, kling.py, youtube.py, gateway.py, local/
  pipeline/       research, script, director_import, voice, alignment, images, animate, sfx_music, publish
  engine/         motion.py, compositor.py, audio_mix.py, subtitles_ass.py
  export/         mp4.py, fcp7.py, otio.py, srt.py
  prompts/        *.md с front-matter (id, version, model_hint); тексты промптов на английском
  cost/           ledger.py, budget.py
  storage/        paths.py, atomic.py, db.py
tests/fixtures/   director_pirate_10shots.json, motion_golden.json, alignment_*.json
data/             (gitignored)
  app.db
  channels/<channel>/
    profile.json  oauth/
    canon/
      style/v003.json                      стиль канала + глобальный negative
      periods/caribbean-1716/v002.json     палитра, материалы, свет, запрещённое
      characters/you/v004.json             персонаж и его облики
      anchors/you@powder-monkey-11/        лист опорных портретов (6 png) + chosen.json
      anchors/style/                       опорные кадры стиля канала
  projects/<channel>/<episode>/
    director/v001.json …   project.json   media/   cache/   exports/   publish/
```
Папки появляются в своём этапе; пустых «на будущее» не создаём.

## Данные: три уровня — три роли
- **Канон — визуальная константа.** Живёт на уровне канала, а не эпизода: `data/channels/<channel>/canon/`. Три слоя, каждый версионируется отдельно:
  - **Стиль канала** (`style/vNNN.json`) — рендер, оптика, освещение, палитра, грейн, композиционные правила, глобальный negative. Одинаков для всех эпизодов канала.
  - **Период** (`periods/<period_id>/vNNN.json`, например `england-1347`, `caribbean-1716`) — палитра и материалы эпохи, типы источников света, архитектура, одежда, предметы, и **список запрещённого** (анахронизмы). Переиспользуется между эпизодами.
  - **Персонаж** (`characters/<id>/vNNN.json`) — личность плюс набор **обликов** (`appearances`). Один персонаж — много обликов: Отто в 1347 и Отто в 1716 — это `otto` с `appearance_id` `otto@england-1347` и `otto@caribbean-1716`. В Cursus «you» проходит все ранги: `you@powder-monkey-11`, `you@quartermaster-28`, `you@captain-35`. Каждому облику принадлежит **лист опорных портретов** (anchor sheet): 6 отобранных вручную кадров (фас, три четверти, профиль, в рост, в действии, крупный план рук/деталей), которые дальше подаются как reference images в каждый кадр с этим персонажем.
- **director.json — замысел:** что сказать, какие кадры, движение, звук, метаданные. Приходит из LLM (API или мост через чат). Каждая версия — отдельный неизменяемый файл. **Канон внутри не лежит** — только ссылка `canon_ref` на конкретные версии стиля, периода и обликов.
- **project.json — реализация:** ассеты и их версии, выравнивание голоса, фактические тайминги, ручные правки, статусы, стоимость. Автосохранение с дебаунсом 800 мс, атомарная запись (temp → rename).
- Импорт новой версии плана мёрджится по `shot.id`. Ручные правки (поля `*_locked`, `user_override`) не затираются. Изменённый промпт помечает кадр `stale`, картинку не удаляет.
- Таймингов в director.json нет. Время — float секунды; в рендере квантуется к кадру `round(t * fps)`.

Скелет director.json (полная схема и правила — `docs/director_schema.md`; в частях 2…N блоки `canon` и `voice` не передаются):
```jsonc
{
  "schema": "studio.director/1",
  "meta": { "channel": "cursus", "episode_id": "c07-pirate-ship", "working_title": "Every Rank on a Pirate Ship",
            "format": "every_rank", "language": "en", "target_minutes": 20, "part": 1, "parts_total": 4 },
  "brief": { "idea": "…", "angle": "…", "hook_promise": "…",
             "reference_mode": "none",              // none | structure_clone | own_version
             "sources": [{ "title": "…", "url": "…" }] },
  "canon_ref": { "style": "style/v003",             // прибито к версии: обновление канона не ломает старые эпизоды
                 "periods": { "caribbean-1716": "periods/caribbean-1716/v002" },
                 "appearances": { "you@powder-monkey-11": "characters/you/v004#powder-monkey-11",
                                  "you@captain-35":      "characters/you/v004#captain-35" } },
  "voice": { "provider": "elevenlabs", "voice_id": "…", "model": "eleven_multilingual_v2", "pace_wpm": 150 },
  "sections": [{ "id": "r1", "title": "Powder monkey", "chapter": true, "vo_direction": "calm, dry irony" }],
  "shots": [{
    "id": "s001", "section": "r1",
    "vo": "You are eleven years old, and the first thing you learn on this ship is where the gunpowder lives.",
    "image": { "prompt": "carries a leather cartridge case down the gun deck, glancing back over his shoulder",
               // ТОЛЬКО действие, композиция, ракурс. Стиль, эпоха, внешность — из канона, их подставляет код
               "period": "caribbean-1716",
               "appearances": ["you@powder-monkey-11"],
               "shot_size": "action" },                               // establishing | action | reaction | detail
    "motion": { "type": "push_in", "strength": 0.08, "ease": "in_out_cubic" },
    "transition_in": { "type": "cut", "duration": 0.0 },               // cut | crossfade | dip
    "animate": { "recommended": false, "reason": null, "prompt": null, "seconds": 4 },
    "sfx": [{ "prompt": "creaking wooden hull", "offset": 0.0, "duration": 3.0, "gain_db": -18 }],
    "overlay": null
  }],
  "music": [{ "section": "r1", "mood": "tense low strings, sparse", "gain_db": -24 }],
  "thumbnail": { "concepts": [{ "prompt": "…", "text": "POWDER MONKEY TO CAPTAIN" }] },
  "publish": { "titles": ["…", "…", "…"], "description": "…", "tags": ["…"],
               "category_id": "27", "synthetic_media": true, "made_for_kids": false },
  "facts": [{ "claim": "…", "status": "verified", "source_url": "…" }]  // verified | disputed | not_found
}
```

## Принципы (нарушение = баг)
1. **Голос — мастер-дорожка.** Длительность кадра = отрезок его VO по выравниванию. `duration_locked` защищает ручную длину.
2. **Одна математика движения.** `docs/motion_spec.md` → `engine/motion.ts` и `engine/motion.py`. Общие golden-фикстуры (матрицы в 20 точках) гоняются и в vitest, и в pytest. Порядок изменения: спека → TS → Python → golden → WYSIWYG-тест.
3. **Движение считает компоновщик** (OpenCV warpAffine, float-матрицы), а не ffmpeg zoompan — у zoompan целочисленный дребезг. FFmpeg — только декод, энкод, аудио, субтитры.
4. **Цвет:** кадры в sRGB, энкод в yuv420p BT.709 с явными флагами colorspace/primaries/trc, иначе рендер разойдётся по цвету с превью.
5. **Внешние вызовы — только через `providers/`.** Пайплайн не знает ID моделей и цен: они в `config/*.yaml`.
6. **Цена до клика.** Каждый платный вызов пишет строку в cost_ledger (провайдер, модель, единицы, $, выпуск, этап, job_id). Бюджеты (месяц / выпуск / анимация) проверяются до постановки в очередь; превышение — явный отказ, не тихий фолбэк на другую модель.
7. **Долгое — это job.** Джобы в SQLite, идемпотентны, переживают перезапуск, прогресс по SSE, отмена работает. Сбой одного кадра = `failed` у кадра, пачка продолжается.
8. **Кэш по хэшу входов:** (style_version, period_version, appearance_versions, prompt, anchor_refs, model, params, seed) → картинка; (text, voice, model, settings) → аудио; (asset, motion, duration, crop, transition) → сегмент рендера. Одно и то же дважды не оплачиваем и не рендерим. Смена версии канона делает кадры `stale`, но ничего не удаляет.
9. **Секреты** только в `backend/.env` и `data/channels/*/oauth`. Фронт ходит только в свой бэкенд. Каналы изолированы: отдельные токены, профили, папки.
10. **Человек в петле.** Пакетная генерация — только после «Утвердить план». Публикация — только после чеклиста. Полной автопубликации без подтверждения нет.
11. **Референсы не копируются.** Референс-режим извлекает структуру. Перед утверждением сценария — n-gram-сходство с референсом ниже порога из конфига.
12. **Память.** Превью держит декодированными текущий кадр ±3; миниатюры webp 160/320px; рендер — не больше 4 воркеров; на время рендера GPU-джобы на паузе.
13. **Промпт изображения собирает код, а не LLM.** Итоговый промпт = `style_block` (версия канала) + `period_block` (эпоха) + `appearance_block` (облик каждого персонажа в кадре) + `shot.image.prompt` (только действие и композиция) + negative (глобальный ∪ периода ∪ облика). Порядок и разделители фиксированы в `pipeline/images/prompt_builder.py`. LLM описывает, что происходит в кадре, и никогда — как это выглядит: валидатор отклоняет `shot.image.prompt`, содержащий стилевые токены из стоп-листа (`photorealistic`, `cinematic lighting`, `8k`, `anime`, `oil painting`, названия объективов, имена художников). Референсы — только опорные портреты облика и опорные кадры стиля, никаких случайных картинок.
14. **Канон версионируется, эпизод прибит к версии.** Изменение стиля создаёт `style/v004`, старые эпизоды продолжают ссылаться на `v003` и выглядят как выглядели. Перевод эпизода на новую версию — явное действие пользователя, после которого затронутые кадры помечаются `stale`.

## Соглашения
- Код, имена, коммиты — английский. Комментарии и docs — русский. UI — русский, sentence case. Промпты к моделям — английский.
- Python: ruff + mypy, logging вместо print, async для I/O, Pydantic-модели на границах API.
- TS: strict, без `any` в `engine/` и `store/`; стили — Tailwind + CSS variables из `design/`.
- Типы фронта: `pnpm -C frontend typegen` (Pydantic → JSON Schema → TS). `src/types/` руками не трогать.
- Тесты: сеть замокана. Реальные вызовы — только `pytest -m live`, запускаются вручную и стоят центы.
- Ошибка для пользователя: что случилось и что сделать. Без извинений.

## Команды
```bash
./run.sh                                   # backend :8000 (WSL) + frontend :5173 с прокси /api
pnpm -C frontend dev | build | lint | test # vitest — с M1.1
pnpm -C frontend tokens:sync | tokens:check# копия tokens.css из design/handoff — M1.1
pnpm -C frontend typegen                   # Pydantic → JSON Schema → TS — появится в M2
pnpm -C frontend e2e                       # Playwright, скриншоты и WYSIWYG — появится в M1.6
uv run pytest                              # бэкенд — появится в M2
uv run pytest -m live                      # проверка ключей провайдеров (центы) — M2
uv run python -m app.tools.render_fixture  # рендер тестового выпуска из tests/fixtures — модуль рендера
```

## Чего не делать
- Docker, авторизация, Celery/Redis, Electron, ComfyUI, moviepy.
- ffmpeg zoompan для движения (см. принцип 3).
- Прошитые в коде ID моделей, цены, Windows-пути.
- Стилевые формулировки в `shot.image.prompt` и вообще любой стиль, пришедший из LLM (принцип 13).
- Генерация кадра с персонажем без опорных портретов облика. Нет anchor sheet — сначала лист портретов, потом кадры.
- Правка файлов канона прошлых версий. Только новая версия.
- Интеграция с подпиской Claude из кода. Автоматизация — только API-ключ; ручной обмен — «мост через чат».
- Подключать Sora 2 и gemini-2.5-flash-image: их API закрываются осенью 2026.
- Модели с некоммерческой лицензией (Depth Anything V2 Base/Large, многие сторонние апскейлеры).
- Рефакторинг вне текущего микроэтапа и «заодно улучшил».
- Правки в `design/` — папка перезаписывается импортом из claude.ai/design.
- Hex-цвета в классах и компонентах — только переменные из `tokens.css` через утилиты `theme.css` (проверяется тестом).

## Как работаем
- **Линейно, модулями.** Модуль `Mk` = устав `docs/tasks/Mk.md` + этапы `Mk.x`. Детально расписан только текущий модуль; следующий составляется после закрытия текущего по его итогам в `STATUS.md` (черновики — `docs/drafts/`); остальные — одной строкой в `docs/roadmap.md`. Направление известно, состав — нет: не расписывать модули впрок.
- **Одна сессия = один этап.** Старт: «Прочитай `CLAUDE.md`, `design/CLAUDE.md`, `docs/LESSONS.md` и `docs/tasks/Mk.x.md`» (`design/CLAUDE.md` — если этап касается UI). Больше ничего не читать, пока нет плана. Нужен файл вне списка «Читать» — сначала сказать.
- **План до кода** («да» в шапке этапа, все Opus-этапы): 6–10 пунктов и список файлов, ждать «ок». Рутина UI/CRUD — Sonnet, без плана.
- **Финиш этапа:** тесты зелёные → менялся контракт — обновить `docs/` → грабли — запись в `docs/LESSONS.md` → 5–10 строк в `STATUS.md` (сделано, решения, хвосты, дальше) → ☑ в `docs/roadmap.md` → коммит `Mk.x: <что сделано>`.
- **Финиш модуля:** приёмка из устава → `git tag mk` → составить устав и этапы следующего модуля отдельной сессией, по `STATUS.md`.
- Между этапами `/clear`, не `/compact`: контекст живёт в файлах, не в истории чата (L-006).
- Задача конфликтует с этим файлом или неясна — спросить, не угадывать. Приоритет документов при расхождении: `CLAUDE.md` → устав модуля → этап → `design/handoff/stack.md` (UI-стек) → остальное. Замеченное расхождение — в «Хвосты» `STATUS.md`, а не молча обойти.
