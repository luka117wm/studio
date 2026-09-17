# Studio — состояние проекта

Обновлено: 2026-09-17. Файл для Claude Code: что уже сделано, где что лежит,
что делать дальше. Обновлять при каждом значимом шаге.

## Что это за проект

Локальное desktop-приложение (браузер на ноутбуке) — производственный пульт для
исторических YouTube-роликов из AI-кадров и закадрового голоса. Один пользователь,
два канала (Cursus, Otto's Timeline), цель — выпуск раз в два дня.
Подробный контекст и неизменяемые правила продукта — `design/handoff/README.md`.

## Сделано

### 1. Импорт дизайн-прототипов из claude.ai/design (2026-09-15)

Источник: проект `311a30dc-0e41-4b22-b261-8a7c488bcbd7`
(https://claude.ai/design/p/311a30dc-0e41-4b22-b261-8a7c488bcbd7).
Перенесён через DesignSync MCP (`list_files` + `get_file`) в папку `design/`.

Перенесено 21 из 23 файлов:

| Путь | Что это |
|---|---|
| `Studio - 1 Выпуски.dc.html` … `Studio - 12 Канон.dc.html` | 12 кликабельных артбордов 1536×864, все взаимные ссылки между экранами проверены |
| `support.js` | dc-runtime; артборды подключают его как `./support.js` — открывать из этой папки |
| `CLAUDE.md` | палитра, типографика, плотность, правила состояний — для всех экранов Studio |
| `handoff/README.md` | контекст продукта, сквозной сценарий, 7 неизменяемых правил |
| `handoff/tokens.css` | единственный источник цветов/типографики/размеров, CSS variables |
| `handoff/components.md` | инвентарь компонентов: варианты, состояния, пропсы |
| `handoff/layout.md` | размеры панелей, поведение при 1536 / 1920 / 2560, клавиатура |
| `handoff/stack.md` | стек, мост токенов в Tailwind, структура `src/`, доменные инварианты, порядок реализации |
| `uploads/pasted-1789349888377-0.png` (2240×682), `uploads/pasted-1789350166383-0.png` (1040×394) | референсные скриншоты |

**Не перенесено** (2 файла): `uploads/pasted-1789350266949-0.png` (2746×1612) и
`uploads/pasted-1789350695579-0.png` (2878×1446). `get_file` в DesignSync обрезает ответ на
256 КиБ без возможности дочитать; оба пришли с `truncated: true`, битые части удалены.
Если нужны — скачать вручную из проекта на claude.ai/design в `design/uploads/`.

Проверки: 10 файлов, прошедших через контекст (4 артборда, CLAUDE.md, 5 файлов handoff),
сверены `cmp` с оригиналом — побайтно идентичны; остальные записаны напрямую из JSON-ответов.

Источник истины для макетов — проект в claude.ai/design. Локальные `.dc.html` не править:
при повторном импорте они будут перезаписаны.

### 2. M0 — каркас проекта (2026-09-17, коммит `5a47c51`)

Корневые `CLAUDE.md`, `README.md`, `run.sh`, `.nvmrc`, `.python-version`, `pyproject.toml` + `uv.lock`;
`backend/app/main.py` (FastAPI-заглушка), `backend/.env.example`, `config/`; `frontend/` — Vite 8 +
React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`), Zustand, TanStack Query, react-virtuoso,
lucide-react, vitest, Playwright, oxlint. Папка прототипов переименована в `design/`.

### 3. M1.1 — токены и типографика (2026-09-17, коммит `b0db367`)

- `frontend/scripts/sync-tokens.mjs` копирует `design/handoff/tokens.css` → `frontend/src/styles/tokens.css`
  (`pnpm -C frontend tokens:sync` / `tokens:check`). Копию руками не править.
- `src/styles/theme.css` — мост в Tailwind (`@theme inline reference`, только `var()` из tokens).
  Дефолтные палитра, `text-sm/base`, радиусы и тени Tailwind **отключены**: `bg-red-500`, `text-sm`
  не компилируются. Имена утилит — по `design/handoff/stack.md`: `bg-app/panel/strip/raised/hover`,
  `text-ink/muted/disabled`, `border-line/line-strong`, `text-11…18`, `text-script`, `font-ui/dense/script`,
  `rounded-control/panel/clip`, `shadow-overlay/dialog/focus`, `bg-track-*`, статусы `bg-queued/generating/ready`,
  `text-warning/failed-text`, размеры оболочки `h-shell-topbar`, `w-shell-inspector`…, `h-row-md`, `size-icon`,
  `p-1..4` = 4/8/12/16.
- `src/styles/base.css` — `color-scheme: dark`, типографика `html` из токенов, фокус-кольцо, скроллбары.
- `src/index.css`: tailwind → `@fontsource` (Plex Sans 400/500/600 latin+cyrillic, Plex Sans Condensed 400/500,
  Courier Prime 400; у последних двух кириллицы нет, фолбэк в tokens) → tokens → theme → base. Оффлайн, без Google Fonts.
- Тесты `src/styles/__tests__/tokens.test.ts`: копия синхронна, нет hex вне tokens.css, все `var()` в theme
  существуют, утилиты компилируются в ссылки на токены. `pnpm -C frontend test` заведён.
- Починена сборка M0: невалидные записи в `tsconfig.json` → `strict` и `noUncheckedIndexedAccess` в
  `tsconfig.app.json`; `vite.config.ts` использует `import.meta.dirname`.
- Хвосты: в `tokens.css` нет `text.faint #5A5C60` и цвета `::selection` (есть в `design/CLAUDE.md`) —
  добавлять только через новую версию handoff. Tailwind сканирует `.ts` тестов как источник классов.

### 4. Наведён порядок в документации (2026-09-17)

Было два несведённых плана: **B-блоки** (11.09, до дизайна: `CLAUDE.md`, `docs/TASKS.md`, `LESSONS.md`) и
**M-блоки** (после импорта дизайна: `STATUS.md`, `M1.1`, коммиты). Теперь: **B** — что система умеет,
**M** — что пользователь видит; единый список — `docs/roadmap.md`. `CLAUDE.md` переписан: карта документов,
один протокол сессии, убраны заметки редактора и ссылки на несуществующие файлы. `docs/TASKS.md` разрезан на
`docs/tasks/*.md` и удалён; B0.1 помечен «выполнен как M0, хвосты», B0.6 переписан (остался typegen).
`.claude/settings.json`: `Write(./design/**)` в deny. Данные — `./data` (gitignored) в ФС WSL.

**Хвосты:** порядок этапов после M1 в roadmap предложен, не утверждён; состав блоков B1–B7 неизвестен;
хвосты B0.1 (`tests/`, ruff/mypy, `src/studio/`); `README.md` пустой, `frontend/README.md` — шаблон Vite.

## Дальше

Следующий этап и порядок — `docs/roadmap.md` («Предлагаемый порядок»). Ближайший: **M1.2** — AppShell
(TopBar 44, StageRail 56, StatusBar 24, инспектор 320, роутинг). Task-файл `docs/tasks/M1.2.md` ещё не написан.

## Как смотреть прототипы

Открыть любой `design/Studio - *.dc.html` в браузере. Шрифты (IBM Plex Sans,
IBM Plex Sans Condensed, Courier Prime) грузятся с Google Fonts — нужна сеть.
Карта переходов и указатель на файлы передачи — экран 11 (`Studio - 11 Прототип и передача.dc.html`).
