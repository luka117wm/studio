# Studio — состояние проекта

Обновлено: 2026-09-20. Файл для Claude Code: что уже сделано, где что лежит,
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

Было два несведённых плана: «B-блоки» (11.09, до дизайна) и «M» (после импорта дизайна). Решение — **один
линейный порядок модулей**: `docs/roadmap.md` (текущий модуль детально, следующий контуром, дальше по строке),
устав модуля `docs/tasks/Mk.md` + этапы `Mk.x.md`; следующий модуль составляется после закрытия текущего по
итогам отсюда. Старые B-файлы — в `docs/drafts/` как материал (README там объясняет, куда какой пойдёт).
`docs/M1_prompts.md` разрезан на `docs/tasks/M1.md` + `M1.2`–`M1.6` и удалён. `CLAUDE.md` переписан: карта
документов, один протокол сессии, структура фронта как в этапах M1, без ссылок на несуществующие файлы.
`.claude/settings.json`: `Write(./design/**)` в deny. Данные — `./data` (gitignored) в ФС WSL.

**Хвосты:** состав модулей после M2 — направление, не план (уточняется при составлении); хвосты M0
(`tests/`, ruff/mypy, лишний `src/studio/`) — закрыть в M2; `README.md` пустой, `frontend/README.md` — шаблон Vite.

### 5. M1.2 — UI-кит: примитивы (2026-09-18, коммит `743bf12`)

- `frontend/src/ui/` — 28 компонентов, по файлу на каждый, реэкспорт из `index.ts`. По `components.md`: Button,
  IconButton, Input, Textarea, NumberInput, Select, SegmentedControl, Slider, Toggle, Checkbox, Radio, Chip,
  StatusGlyph, StatusBadge, Toast + ToastStack, Dialog, EmptyState. Плюс девять из списка задания, которых в
  `components.md` нет — сделаны по решению пользователя, по аналогии с токенами и плотностью: Tooltip, Popover,
  DropdownMenu, Tabs + TabPanel, ProgressBar, Skeleton, Divider, ScrollArea, KeyHint.
- Рядом: `cn.ts` (clsx), `format.ts` (`formatPrice`, half-up до цента), `status.ts` (`Status`, подписи, цвета
  подписей), `kit.css` (keyframes бегущей штриховки), `internal/` — Portal, useFocusTrap, useOutsidePointer,
  useAnchorPosition + `layerStyle`, классы кнопок/полей, литералы штриховки.
- Решения: UI-библиотек нет. Оверлеи — в портале, `position: fixed`, замер в layout-эффекте, переворот вверх при
  нехватке места. Escape ловит сам слой (`onKeyDown`) — вложенные закрываются изнутри наружу; клик вне — слушатель
  на документе. Select держит фокус на поле (`aria-activedescendant`). Пропсы явные, варианты — union-типы,
  `className` только для раскладки, `style` — только внутренняя геометрия (координаты, проценты). Фокус-кольцо —
  глобальное из `base.css`, в компонентах не дублируется.
- Тесты: `src/ui/__tests__/` — 12 файлов, 92 теста (jsdom + Testing Library, `vitest.setup.ts` с cleanup, конфиг
  в `vite.config.ts`). Ловушка фокуса Dialog, клавиатура Select/DropdownMenu/Tabs/SegmentedControl/Slider,
  автоскрытие тостов, экспорт каждого компонента, отсутствие hex. Визуально сверено в Chrome через Playwright
  (временная галерея в `App.tsx`, в репозиторий не вошла).
- Хвосты: `className` не мёржит конфликтующие утилиты (tailwind-merge нет) — ширину задаёт вызывающий, базовые
  `w-full` только у полей; у Toast нет кнопки закрытия (в спецификации нет — действие + автоскрытие); девять
  компонентов вне `components.md` сверить с handoff, когда там появятся; `components.md` просит фокус `outline`
  2px accent, `base.css` даёт `box-shadow: var(--focus-ring)` — оставлено как в M1.1; тест «каждый класс из
  `src/ui` даёт CSS» (скрипт был разовый, см. L-009) — закрепить в M1.6; HotkeysOverlay — M1.4 на Dialog.

### 6. M1.3 — Оболочка и навигация (2026-09-18, коммит `44ebee8`)

- Роутер свой, на History API (`app/navigation.ts`: `navigate`, `usePathname` через `useSyncExternalStore`;
  `app/Link.tsx`; таблица `app/routes.ts`: `matchRoute`, `paths`) — в `stack.md` библиотеки маршрутизации нет.
  11 маршрутов: `/episodes`, `/ideas`, `/episodes/:id/{script,generate,edit,export,publish}`,
  `/episodes/:id/edit/:shot` (экран 6), `/settings`, `/states`, `/canon`; `/` → выпуски, неизвестный путь и
  неизвестный выпуск — свои EmptyState. Артборд 11 — служебный, маршрута нет (решение пользователя).
  `document.title` = «<Экран> — Studio»; выпуск открывается из параметра маршрута.
- Оболочка `app/`: `AppShell` (TopBar 44 / StageRail 56 + экран / StatusBar 24), `TopBar` (логотип-ссылка,
  `Select` канала, название выпуска + этап, индикатор сохранения, расход месяца на `ProgressBar`, «?», настройки),
  `StageRail` (6 этапов-ссылок, состояния todo/active/done/error, виден при открытом выпуске), `StatusBar`
  (процесс со `StatusGlyph`, предупреждение, `KeyHint` по экрану), `PanelHeader` 28, `ScreenLayout` — зоны
  заголовок 52 / левая панель / центр (min 640) / колонка лога ≥2560 / правая панель / нижняя панель.
  Ширины и поведение — по `layout.md`: библиотека 280 (→240 <1440), инспектор 320 (→280 <1440), метаданные 380,
  пресеты 320, навигация настроек 224, лист 760, таймлайн 260 (160 <1280, 320 ≥2560), подписи дорожек 72;
  <1280 боковые панели — полоса 40 с иконкой; сворачивание руками — через стор (`collapsed.left/right`).
  Замерено Playwright на 1200 / 1280 / 1400 / 1536 / 1920 / 2560 — совпадает.
- 11 заглушек `screens/*/index.tsx` с зонами и `EmptyState` (реальные тексты, платные действия с ценой из
  `mocks/fixtures.ts#estimates`); экран 6 переиспользует `EditLayout` монтажа. Один accent на экран.
- `store/uiStore.ts` (Zustand): канал, открытый выпуск, свёрнутость панелей, тосты. `app/providers.tsx`:
  `QueryClientProvider` без запросов + `ToastStack` на стор; тема одна — провайдера темы нет.
- `types/fixtures.ts` (временные, до typegen M2) и `mocks/fixtures.ts`: два канала ($61.40 из $150, ElevenLabs
  212 400 / 600 000), 9 выпусков с артборда 1 (пиратский: 19:48, 104 кадра, 3 060 слов, Карибы 1716, пять обликов
  «you»), слоты сентября, статус-строка. Сети нет — проверено тестом (`fetch` не вызывается) и в браузере.
- Шаблон Vite убран (`App.tsx`, `App.css`, `assets/`, `icons.svg`); `index.html` — `lang="ru"`, «Studio».
- Тесты: `app/__tests__/routes.test.ts`, `shell.test.tsx` — 24 теста (все маршруты по прямому URL и title,
  редирект, 404, рельс и переход по нему, переключение канала, сворачивание панели, статус-строка и тосты, сеть).
- Хвосты: токенов для ширин 380 / 320 / 420 (метаданные, пресеты, лог) нет — взяты из шкалы 4px (`w-95`, `w-80`,
  `w-105`), добавить в handoff новой версией; ниже 1280 кнопка «Развернуть» в CSS-свёрнутой полосе не действует;
  `stack.md` просит `strings.ru.ts` и `formatUsd` — тексты пока в компонентах, деньги форматирует `toFixed` в
  TopBar (`formatPrice` кита — с «~»); в `stack.md` структура `src/` отличается от `CLAUDE.md` (components/,
  domain/, providers/ во фронте) — правит `CLAUDE.md`; переименование выпуска и «Все каналы» в переключателе — M3;
  HotkeysOverlay по «?» и ⌥1/⌥3 — M1.4.

### 7. M1.4 — Клавиатура и фокус (2026-09-18, коммит `3a63737`)

- Реестр `app/keyboard.ts` — единственное место: сочетание, область (`global` / `screen` / `modal`), группа,
  описание, обработчик, `when`, `inInputs`, `inModal`, `hint`. Один слушатель `keydown` на документе (`dispatch`);
  при открытом модальном слое срабатывают только `modal`-записи (и «?» с `inModal`); в полях ввода сочетания без
  модификаторов пропускаются; `Mod+W/T/N/Q` отвергаются при регистрации. `Mod` = ⌘ на Mac, Ctrl иначе; цифры, буквы
  и Space матчатся по `event.code` (раскладка не влияет), «?» и служебные — по `event.key`; `formatKeys` рисует
  клавиши по платформе. Хуки `app/useHotkey.ts`: `useHotkey` / `useHotkeySet` (регистрация на маунт, обработчик через
  ref), `useRegisteredHotkeys`, `useModalScope`, `useKeyboardDispatcher`.
- Регистрация там, где живёт действие: `StageRail` — ⌘1…⌘6 (при открытом выпуске), `ScreenLayout.SideZone` —
  ⌥1/⌥3 только для сворачиваемых панелей экрана, `KeyboardHelp` — «?» (открыть/закрыть, одна запись) и `Esc`
  (`modal`, «закрыть верхний слой»). Больше ничего: у канала и поиска в handoff клавиш нет — не придумывал.
- `app/KeyboardHelp.tsx` на `Dialog` кита (lg): группы «Этапы» / «Панели» / «Помощь» из реестра, только включённые
  сейчас; `helpOpen` в `uiStore`, кнопка «?» в шапке и клавиша открывают одно окно. Подсказки `StatusBar` — тоже из
  реестра (`hint`), захардкоженная карта удалена. Skip-link «Перейти к рабочей области» первым в DOM, фокусирует
  `main#main` без hash-навигации. Порядок Tab — визуальный, кольцо фокуса — глобальное из `base.css` (проверено в
  Chrome: `box-shadow` accent 2px на ссылках рельса и кнопках).
- Тесты `app/__tests__/keyboard.test.tsx` — 11: матчинг по платформам и раскладке, `formatKeys`, отказ на
  браузерные, `isEditable`; «?» → окно со списком из реестра (тестовая запись видна, выключенная по `when` — нет),
  «?»/Esc закрывают с возвратом фокуса; при открытом окне ⌘1 и ⌥3 молчат; «?» в поиске игнорируется; ⌘1…⌘6 ведут по
  этапам и молчат без выпуска; ⌥1/⌥3 на монтаже и не на «Выпусках»; skip-link; порядок Tab по зонам.
  Всего 15 файлов / 127 тестов. В Chrome через Playwright прогнаны те же сценарии.
- Хвосты: окно помощи в артборде 1000px с колонками по группам и подвалом «Сочетания меняются в настройках» —
  у `Dialog` кита максимум lg 640, сделал две колонки; расширять `Dialog` (size xl) — правка кита, отдельным решением;
  подсказки «⌘K команды» / «⌘N новый выпуск» с артборда 1 убраны (обработчиков нет, ⌘N браузерное) — расхождение с
  макетом; монтажные сочетания из `layout.md` (Space, J/K/L, S, D, Del, Ctrl+Z, R, A, M, Ctrl+E) регистрируются в
  своих модулях через `useHotkey`; будущие диалоги должны вызывать `useModalScope(open)`, иначе глобальные сочетания
  сработают сквозь них; ниже 1280 автосвёрнутые панели ⌥1/⌥3 переключают стор, но CSS держит полосу.

### 8. M1.5 — Каталог состояний (2026-09-19, коммит `b7d4cb2`)

- `screens/states/` — рабочий каталог на `/states`, только dev-сборка: маршрут добавляется в `app/routes.ts` при
  `import.meta.env.DEV`, экран подключён в `router.tsx` через `lazy` под тем же флагом — в production-бандле кода
  каталога нет (проверено: `dist/assets` без чанка и строк каталога, `pnpm preview` → «Нет такого экрана»).
- Реестр `registry.ts`: тип `UiComponentName` выводится из экспортов `src/ui` (функции с заглавной), `groups` из
  шести файлов `demos/*.tsx` (управление 14, ввод 4, слои 4, обратная связь 7, пустые 3, ошибки 7 — 39 демонстраций),
  `productStates` — 16 карточек с текстами артборда 10 (пустые 5, процесс 4, ошибки 5, конфликт 2).
  Карточки ProcessCard / ErrorCard / ConflictBar / таблица расхождений собраны из примитивов в
  `demos/productCards.tsx` — в ките их нет. Секция «Клавиатура» — из реестра M1.4 (`useRegisteredHotkeys`).
- Экран: заголовок 52 с `Tabs` на 8 секций, прокручиваемый центр, карточки «компонент · состояние». Живые
  демонстрации (диалоги, поповер, меню, стек тостов через `pushToast`) — `demos/live.tsx`.
- Тесты: `coverage.test.ts` (каждый компонент кита в реестре — проверено, что падает при удалении демонстрации;
  реестр без несуществующих имён; семь продуктовых состояний из задания), `catalog.test.tsx` (каждая из 39 + 16
  демонстраций рендерится; вкладки, продукт, клавиатура из реестра; `/states` отсутствует при `DEV=false`).
  Всего 17 файлов / 188 тестов.
- Список расхождений и дефектов кита — `docs/m1_review_list.md` (12 расхождений, 13 дефектов, кандидаты в кит).
- Хвосты: `Tabs` в заголовке без нижней границы через `className="border-b-0"` (K3/K4); статус-строка каталога не
  контекстная (тексты по группам лежат в `productSections`); `registry.ts` без JSX, демонстрации в `.tsx`.

### 9. M1.6 — Визуальная приёмка (2026-09-19, коммит `b0ebf4e`)

- Попарная сверка с артбордами 1–10, 12 на 1536 (снимки и замеры DOM с обеих сторон) — `docs/visual_review.md`:
  22 строки по оболочке, 18 по киту; каждая с решением «исправлено / осознанно / макет». Открытых по раскладке и киту нет.
- Исправлено в оболочке: полоса очередей 72 на всю ширину (`ScreenLayout.strip`, экран 4), нижняя зона `queue` 216
  (экран 7), ручка таймлайна 4px (экран 5), правая панель «Загрузка» (экран 8), «Идеи» — панели 300 / 340
  (`seeds`, `clusters`), «Канон» без левой панели с переключателем слоёв в заголовке, подпись про ⌘N убрана.
- Исправлено в ките: `Dialog` `size="xl"` 1000 и `note` (оверлей клавиш — три колонки, как в артбордах 5/10),
  `EmptyState` иконка 24/44 и описание 12, `Toast` «Скрыть» без действия, `Button.priceNote`, `IconButton.pressed`,
  `KeyHint size="md"`, `Tabs border`. Тесты кита и демонстрации каталога обновлены.
- Регрессия: `pnpm -C frontend e2e` — Playwright, три проекта-ширины (1536 / 1920 / 2560), 44 эталона в
  `frontend/e2e/__screenshots__/` (11 экранов × 3 + оверлей клавиш, меню, тосты, 8 вкладок каталога на 1536).
  Сервер — dev (каталог только там), `page.clock.install()` и `animations: 'disabled'` против флаки;
  порог `threshold 0.2, maxDiffPixels 100`. Три прогона подряд — без расхождений. Vitest исключает `e2e/`.
- Хвосты: `ChannelSwitcher` с аватаром и «Все каналы» — M3; подвал оверлея про настройки — после M11; эталоны
  привязаны к Linux-рендеру шрифтов (`-linux` в имени), на другой ОС нужны свои; предупреждение о дубле сочетания в
  `keyboard.register()` — когда появится второй источник сочетаний (M4).
- **Правки handoff (отдельная короткая сессия перед M4, в проекте claude.ai/design → реимпорт DesignSync →
  `tokens:check` → строки `visual_review.md` в «совпадает»):** `layout.md` — «Опорные кадры (Канон) 480, тянется
  420–560» (в M5 → `right.kind: 'anchors'`), «Семена ниши (Идеи) 300, 260–340», «Идеи из кластеров (Идеи) 340,
  320–420»; артборд 3 — убрать ⌘1…⌘3 из статус-строки, клавиши вкладок решить в M4 (⌘⇧1…3 или без них);
  `components.md` — описать Tooltip, Popover, DropdownMenu, Tabs, ProgressBar, Skeleton, Divider, ScrollArea, KeyHint.

### 10. M2.1 — Каркас бэкенда и хвосты M0 (2026-09-20, коммит `082f563`, ветка `m2-backend`)

- `pyproject.toml`: убраны `[project.scripts]`, `uv_build`, `src/studio/`; `[tool.uv] package = false` — проект
  приложение, не пакет. Конфиги ruff (100, E/F/I/UP/B), mypy strict (`mypy_path = backend`), pytest (`pythonpath =
  backend`, `asyncio_mode = auto`, маркер `live`, `addopts = -m 'not live'` — живые вызовы только вручную).
- **Решение:** `app` — пакет верхнего уровня, `backend/` на `sys.path` (`--app-dir backend` в `run.sh`, `pythonpath`
  в pytest, `mypy_path`). Импорты — только `from app.… import`, никогда `backend.app` (L-013). Ради этого изменена
  одна строка `run.sh` вопреки «не трогать» в задании — иначе абсолютные импорты не работают под uvicorn.
- `app/settings.py`: `Settings` на pydantic-settings, `STUDIO_DATA_DIR` (по умолчанию `<repo>/data`, `expanduser().resolve()`),
  `LOG_LEVEL`, `cors_origins`, ключи провайдеров как `SecretStr` (не утекают в repr/логи), `env_file = backend/.env`,
  `env_ignore_empty` — пустая строка в `.env` = значение по умолчанию. `.env.example` приведён к `CLAUDE.md`
  (`data/` в репозитории), убран мусорный `EOF`.
- `app/main.py` — `create_app(settings)`, lifespan создаёт каталог данных; `app/api/` — агрегатор + `health.py`
  (`HealthResponse`); `app/log.py` — `dictConfig`, логгеры uvicorn без своих хендлеров → единый формат
  `время уровень модуль: сообщение` (проверено вживую).
- Тесты: `conftest.py` (`Settings(_env_file=None, studio_data_dir=tmp_path)` — изоляция от реального `.env`;
  `TestClient` как контекст → lifespan), `test_health.py`, `test_settings.py` (default, env с `~`, `.env`-файл, пустое
  значение, создание каталога, секреты в repr). 7 зелёных; ruff, ruff format, mypy чисты.
- Приёмка: `./run.sh` → health по curl напрямую и через прокси Vite, Ctrl+C гасит оба без сирот;
  `STUDIO_DATA_DIR` во временном `backend/.env` переопределяет путь, каталог создаётся.
- Хвосты: `starlette.testclient` предупреждает, что `httpx` в TestClient deprecated в пользу `httpx2` — решить,
  когда httpx понадобится провайдерам (M2.6); `run.sh` при перенаправлении в файл теряет хвост логов из-за
  буферизации `sed` (в терминале не проявляется) — не трогали.

## Дальше

Модуль **M2 — Бэкенд-фундамент** (`docs/tasks/M2.md`), ветка `m2-backend`. Следующий этап — **M2.2 Контракт
director.json** (`docs/tasks/M2.2.md`). Ключи провайдеров понадобятся в M2.6 — `docs/api_keys.md`. После M2.7 —
приёмка и тег `m2`, затем устав M3 отдельной сессией. Перед M4 — сессия правок handoff (раздел M1.6 выше).

## Как смотреть прототипы

Открыть любой `design/Studio - *.dc.html` в браузере. Шрифты (IBM Plex Sans,
IBM Plex Sans Condensed, Courier Prime) грузятся с Google Fonts — нужна сеть.
Карта переходов и указатель на файлы передачи — экран 11 (`Studio - 11 Прототип и передача.dc.html`).
