# Studio — состояние проекта

Обновлено: 2026-09-23. Файл для Claude Code: что уже сделано, где что лежит,
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
  Плюс находка M3: `tokens.css` — токен `status.published` (метка колонки и глиф «Опубликован» артборда 1; до него
  M3.5 берёт `ready`, и метка совпадает по цвету с «Монтажом»).

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

### 11. M2.2 — Контракт director.json (2026-09-20, коммит `aa08cfa`, ветка `m2-backend`)

- `backend/app/models/director.py` — 18 Pydantic-моделей строго по скелету `CLAUDE.md` (+ `ThumbnailConcept` для
  элементов `thumbnail.concepts`), все с `extra="forbid"`. Литералы: `channel`, `format`, `reference_mode`,
  `shot_size`, `motion.type` (8), `motion.ease` (`linear | in_out_sine | in_out_cubic | in_cubic | out_cubic` —
  списка в задании не было, уточнится в `motion_spec.md`), `transition.type`, `fact.status`. Диапазоны по заданию.
  Паттерны ID и ссылок канона (`episode_id`, `shot.id` `s\d{3,}`, `section.id`, `style/vNNN`, `periods/<id>/vNNN`,
  `characters/<id>/vNNN#<облик>`). `overlay` — только `null` (форма не определена, зарезервировано).
- **Решения:** поле `schema` конфликтует с `BaseModel.schema()` → `schema_version` с алиасом `schema`
  (`validate_by_name` + `validate_by_alias`; в JSON/JSON Schema — `schema`). Обязательны все блоки скелета, кроме
  `canon_ref`/`voice` при `part > 1`; дефолты только подразумеваемые скелетом (`part`, `parts_total`, `language`,
  `chapter=true`, `transition_in={cut,0}`, `animate`, списки). PyYAML добавлен сейчас (стоп-лист — `.yaml`),
  не в M2.6, как планировалось.
- `validators.py`: `check_director()` — доменные проверки (уникальность, ссылки на разделы/канон, `vo`,
  `animate.prompt`, стоп-лист, `part ≤ parts_total`, обязательность `canon_ref`/`voice` в части 1) встроены в
  `Director` через `model_validator` + `PydanticCustomError("director_domain", ctx.messages)` — обойти через
  `model_validate` нельзя. `validate_director(data)` — точка входа: структурные ошибки pydantic переводятся в
  русский с ID кадра по `loc` (`missing`, `extra_forbidden`, `literal_error`, диапазоны, типы, паттерны,
  `none_required`), доменные разворачиваются из `ctx`; всё одним списком в `DirectorValidationError.errors`.
  Структурные проверяются первыми, доменные — когда структура цела.
- `config/prompt_stoplist.yaml` — 5 категорий (`render`, `lighting`, `optics`, `medium`, `artists`), ~70 токенов;
  матчинг без регистра, по целым словам и фразам (`animated` ≠ `anime`, `18k` ≠ `8k`).
- `app/tools/gen_schema.py` → `docs/director.schema.json` (`$schema` 2020-12, `$id = studio.director/1`);
  запуск `PYTHONPATH=backend uv run python -m app.tools.gen_schema` (L-013); тест сверяет файл с генерацией.
- `docs/director_schema.md` — таблицы всех полей, правило частей, таблица доменных проверок с сообщениями, два
  примера кадра. Фикстуры: `director_pirate_10shots.json` (10 кадров, 2 раздела, реальные VO и промпты) и 5
  битых компактных. `tests/test_director_schema.py` — 22 теста; всего 29 зелёных, ruff/mypy чисты.
- Хвосты: `image.prompt` не проверяется на пустоту (в задании нет); `static` с `strength > 0` допустим —
  решить в модуле движения; сообщения для редких типов ошибок pydantic — английский `msg` как fallback.

### 12. M2.3 — Хранилище: пути, атомарная запись, SQLite, project.json (2026-09-21, ветка `m2-backend`)

- `storage/paths.py` — `StudioPaths(root)`: все пути `data/` одной точкой по дереву `CLAUDE.md`, id проверяются
  регуляркой до обращения к диску. `storage/atomic.py` — `write_json_atomic` (temp в той же папке → fsync →
  rename → fsync каталога), `read_json`; тест на 500 записей со сбоями в сериализации/`replace`/`fsync`.
- `storage/db.py` — `connect` (WAL, `foreign_keys=ON`, `busy_timeout` 5 с), `apply_migrations`/`migrate` по
  `schema_version` (файлы `migrations/NNN_*.sql`, каждая в транзакции, повторный запуск — no-op), `get_db`;
  `001_init.sql` — `channels`, `episodes`, `jobs`, `assets` (индекс кэша `(kind, input_hash)`), `cost_ledger`
  (микродоллары). Миграции накатываются в `lifespan`.
- **Решения:** соединение sqlite на запрос в потоке event loop — `get_db` и роутеры `async def`, без
  `check_same_thread=False` (L-014). Коллекции `project.json` (`shots`, `assets`, `timings`) — объекты с ключом-id,
  чтобы PATCH и импорт плана (M2.4) мёрджили одним правилом: словари рекурсивно, остальное заменой. Профиль канала
  (`profile.json`) — источник правды, таблица `channels` — реестр для FK. Id выпуска глобален (пути API без канала).
- `models/channel.py` (`ChannelProfile`: бюджеты месяц/выпуск/анимация в USD, квота голоса), `models/project.py`
  (`Project`, `empty_project`, `merge_patch`), `docs/project_schema.md`. `tools/seed.py` — `cursus`/`otto` с числами
  из фикстур оболочки (150/100 USD, 600 000 знаков); лимитов на выпуск/анимацию в макете нет — 15/5 и 8/3 USD.
- API: `GET /api/channels[/{id}]`, `GET /api/episodes?channel=`, `POST /api/episodes` (дерево + `project.json` +
  строка; 409 при повторе и при каталоге-сироте на диске), `GET /api/episodes/{id}`, `GET|PATCH /api/projects/{id}`
  (422 на невалидный результат и на смену `schema`/`episode_id`/`channel`). Списки — в порядке создания (`rowid`).
- Тесты: `test_storage.py` (14), `test_api_episodes.py` (11); всего 58 зелёных, ruff/mypy чисты. Проверено вживую
  через uvicorn + curl.
- Хвосты: `Episode.stage/status` — литералы из фикстур оболочки, уточнятся в M3; `jobs.payload/result` — форма в
  M2.5 (новой миграцией, 001 не править); `now_iso()` с точностью до секунды — порядок списков по `rowid`, не по
  времени.

### 13. M2.4 — Импорт версии плана: мёрдж по shot.id, stale, locked (2026-09-21, ветка `m2-backend`)

- `pipeline/director_import/merge.py` — `canonical_hash` (sha256 канонического JSON), `assemble_parts` (шапка из части
  1, `shots`/`music`/`facts` конкатенацией, `sections` с дедупом по id, валидация целиком), `diff_shots`/`diff_canon`
  (изменение = поле + причина по-русски, для промпта и VO — словарный diff через `difflib`), `merge_into_project`
  (меняет только `status` и `stale_reasons`; новые → `queued`, убранные → `removed`, ассеты и тайминги на месте).
  `stale.py` — `STALE_FIELDS`, причины по канону, конфликты с `*_locked`/`user_override`, `decide`.
- `api/director.py` — `POST /api/projects/{id}/director` (часть или целиком; 422 списком ошибок, 409 для частей),
  `GET …/director/versions`, `GET …/director/vNNN`. Части копятся в `cache/director_parts/part-NN.json`, часть 1
  начинает набор, после сборки папка чистится; ошибка сборки — 422, части остаются.
- **Решения:** `stale` только по картинке и конфликту с блокировкой, VO/движение/SFX — в отчёт без смены статуса
  (L-015). Индекс версий — `project.json → director_versions` (хэш, `imported_at`, части, счётчики), без миграции
  и mtime; повтор по хэшу версию не создаёт, совпадение со старой версией — откат к ней без нового файла.
  `ShotStatus` + `removed`, `ShotState.stale_reasons` — расширены модели M2.3, `docs/project_schema.md` обновлён.
- Фикстуры: `director_pirate_v2.json` (s002 промпт, s008 облик, s009 только VO, +s011, −s006),
  `director_pirate_part{1,2}.json` — v2 по разделам, часть 2 без `canon_ref`/`voice`. `tests/test_director_import.py`
  — 15 тестов; всего 73 зелёных, ruff/mypy чисты.
- Хвосты: `drawn_at`/`price` в отчёте всегда `null` — у `Asset` нет времени создания, цен нет до модуля cost;
  `changed` в отчёте считает и не-stale изменения (VO), ConflictBar должен показывать `stale` отдельно.

### 14. M2.5 — Очередь джобов и SSE (2026-09-23, ветка `m2-backend`)

- `jobs/queue.py` — очередь в SQLite: `enqueue[_many]` (`ON CONFLICT(idempotency_key) DO NOTHING` → существующий
  джоб), `claim` (FIFO, `UPDATE … RETURNING`, `attempts + 1`, без видов на паузе), `finish`, `requeue`,
  `recover_running`, `request_cancel`, `list_jobs` (сводка по статусам + курсор журнала). Каждый переход — условный
  UPDATE и строка `job_events` в одной транзакции. `002_jobs.sql`: `idempotency_key` (UNIQUE-индекс), `batch_id`,
  `attempts`, `cancel_requested`, `message`, таблица `job_events`.
- `jobs/worker.py` — `JobPool` (asyncio-задачи; синхронные обработчики — в пул потоков, async — в loop; `job_workers`
  0…4, по умолчанию 3), `HandlerSpec(kind, fn, payload_model, resource)`, `JobContext` (`progress` не чаще 200 мс,
  `cancelled()` — флаг в БД или остановка бэкенда), ретраи `tenacity`: `TransientError`, сеть, 5xx; 4xx — нет.
  Пауза GPU, пока идёт render-джоб или поднят `gpu_paused`. `jobs/events.py` — журнал, `EventBus`, генератор SSE.
  `jobs/handlers/sleep.py` — `sleep_job`. API: `POST|GET /api/jobs`, `GET /api/jobs/{id}`,
  `POST /api/jobs/{id}/cancel`, `GET /api/events`. Контракт — `docs/jobs.md` (строка в карте `CLAUDE.md`).
- **Решения:** SSE вручную через `StreamingResponse`, без sse-starlette. Источник событий — таблица, id события = её
  строка, поэтому `Last-Event-ID` работает и после перезапуска; курсор ещё и в `?last_event_id=`, а `GET /api/jobs`
  отдаёт `last_event_id` для подписки без пропусков. Сверх задания — события `job.queued`, `job.started`. Штатная
  остановка возвращает джоб в очередь без траты попытки; аварийные перезапуски тратят, джоб с `attempts` > 3 —
  `failed`. `httpx` — из dev в зависимости (классификатор ретраев). `run.sh`: `--timeout-graceful-shutdown 3` (L-016).
- Приёмка: kill -9 — автотест `test_kill_9_mid_batch_resumes_without_repeats` (uvicorn в подпроцессе, SIGKILL при
  ≥ 4 done, рестарт, повторная постановка тех же ключей → 200; сделанное до падения не перезапускалось, прерванные —
  `attempts` 2, по одному `job.done` на джоб). Вручную: `curl -N localhost:5173/api/events` через прокси Vite —
  шаги `sleep_job` приходят с интервалом 1 с без буферизации, heartbeat через 15 с. `test_jobs.py` (26),
  `test_sse.py` (4); всего 103 зелёных в трёх прогонах подряд, ruff/mypy чисты.
- Хвосты: 429 не ретраится — решить в M2.6 вместе с `Retry-After`; там же договориться, что провайдер сам не
  повторяет (иначе 3 × 3 вызова). Операции «повторить упавший» нет — ключ идемпотентности вечный. Отмены пачки целиком
  нет. `mypy tests` падает на `Settings(_env_file=…)` — давнее, проект проверяет только `backend`.

### 15. M2.6 — Провайдеры, цены и бюджеты (2026-09-25, ветка `m2-backend`)

- `providers/`: `base.py` — контракт (запросы `Text/Image/Speech/VideoRequest`, `Route`, `Usage`, `Cost`, `Result`,
  `KeyStatus`, ошибки `ProviderError`/`RateLimited`, `status_error()`); `registry.py` — каталог этапа, профили
  `economy/standard/premium`, `override`, запрет моделей по шаблонам; `gateway.py` — единая точка: оценка → хэш входов
  → кэш `cached` → бюджет и резерв в одной транзакции `BEGIN IMMEDIATE` → вызов → `charged`/`failed` → файл в
  `media/<этап>/` и строка `assets`; `fake.py`; `anthropic.py`, `gemini.py`, `elevenlabs.py` — только `usage()` и
  `check()`. `cost/`: `pricing.py` (Decimal, микродоллары, одно округление на строку, `format_usd` только в API),
  `ledger.py` (статусы `estimated|charged|cached|refused|failed`, `call_id`), `budget.py` (месяц UTC, выпуск,
  анимация). API `GET /api/cost/summary`, `GET /api/cost/ledger`. `003_cost.sql`. Контракт — `docs/providers.md`.
- **Решения:** провайдер отдаёт единицы (`usage`), деньги считает только `cost/pricing.py` — вместо
  `Provider.estimate` из задания (L-001: оценка и факт одной функцией). Добавлен статус `failed` ($0): резерв
  `estimated` пишется до вызова, чтобы параллельные воркеры не прошли в лимит вдвоём. Оценки платных джобов в очереди
  (`jobs.cost_usd_micro`) занимают бюджет — пачка упирается в лимит до оплаты; `HandlerSpec.estimate`,
  `ctx.gateway`, платный джоб только с `episode_id`. 429 повторяется с `Retry-After` (≤ 60 с), SDK без своих
  ретраев. `providers.yaml` = каталог + маршрут по умолчанию, выбор пользователя — `override` из каталога; порядок
  модели голоса: пачка → `director.json → voice` → канал → профиль (код — M7). Цены Claude сверены 2026-09-25,
  Gemini и ElevenLabs — 2026-09-23 (`docs/api_keys.md`).
- Приёмка: 10 вызовов → 10 строк, сумма = ручной расчёт из YAML (871 000 мкд); превышение → 409 с текстом, джоба нет;
  смена `default_profile` меняет модель, запрещённая модель и модель без цены — ошибка старта; повтор — `cached` $0.
  `test_cost.py` (21), `test_providers.py` (11), `test_jobs.py` +1; всего 136 зелёных, ruff/mypy чисты. `curl
  /api/cost/summary?channel=cursus` отвечает на живом uvicorn.
- **`-m live` не пройден — ключи:** Anthropic — skip (ключа нет); Gemini — `400 API key not valid` (ключ неверный:
  выпустить заново в AI Studio); ElevenLabs — у ключа нет права `user_read` (включить User → Read). Код проверки
  отработал: оба ответа разобраны в понятный текст (L-018). Повторить `uv run pytest -m live -v -rP`.
- Хвосты: квота символов ElevenLabs есть в `KeyStatus.quota`, но эндпоинта для шапки нет, а `voice_quota` в профиле
  канала бюджетом не используется — решить с шапкой (M2.7/M3). Кэш текстов LLM — M4. Пачка из многих POST держит
  бюджет оценками в очереди, отдельного эндпоинта пачки с общей суммой нет — M6. Claude Opus 5.5 ($4/$20) дешевле
  Opus 5 — добавить в каталог, если решите.

### 16. M2.7 — Typegen и API-клиент фронта (2026-09-25, ветка `m2-backend`)

- `tools/gen_schema.py` выгружает, кроме `docs/director.schema.json`, группы API в `docs/schema/{project,channel,
  episode,job,cost}.schema.json`: ответы — генератором `ApiJsonSchema` (поля с умолчанием обязательны), тела запросов —
  в режиме validation; `$id` на файл; `--stdout` — всё одним JSON без записи. `JobEventData` — Pydantic-модель
  данных SSE (`jobs/queue.py`).
- `frontend/scripts/typegen.mjs`: схемы из Python → json-schema-to-typescript по определению (заголовки полей
  сняты, стиль репозитория) → `src/types/{director,project,channel,episode,job,cost}.ts` с шапкой и sha256 тела.
  `pnpm typegen` пишет и удаляет устаревшие; `typegen:check` сверяет в памяти, без записи и без `git status`
  (решение из плана: честно и на грязном дереве). `@/*` в `tsconfig.app.json`.
- `src/api/client.ts` — `api.get/post/patch<T>`, таймаут 15 с, `ApiError {status, message, detail}`: текст из
  `detail` / `detail.message` / 422 по полям / `detail.errors`, свой текст — только без ответа (status 0).
  `src/api/sse.ts` — `subscribe(onEvent, {lastEventId, onState})`, переподключение закрытого потока 1…30 с с
  `?last_event_id=`, дедуп по id, после отписки событий нет.
- Приёмка: повторный `typegen` не меняет файлы; `typegen:check` падает на изменённой модели (поле в `Episode`,
  проверено и откачено); ручная правка в `src/types/` валит `types.test.ts`; `tsc -b` и oxlint чисты; vitest 211,
  e2e 44 (+22 пропуска по замыслу), эталоны не менялись; pytest 140.
- Хвосты: тело `PATCH /api/projects` — `dict`, типа нет (M3 решит, нужен ли `ProjectPatch`); тело 409 бюджета
  типизировано только в `ApiError.detail: unknown`. `fixtures.ts` и моки уходят в M3.

### 17. Приёмка M2 (2026-09-25, ветка `m2-backend`, тег `m2`)

- ☑ семь этапов, коммит на каждый (у M2.1 и M2.2 — ещё коммиты записи этапа).
- ☑ `uv run pytest` (142) · `ruff check .` · `mypy backend tests` — зелёные. ☑ `pytest -m live` после правки ключей
  пользователем: Gemini — принят, все модели каталога видны ключу; ElevenLabs — принят, Creator, 118 654 из 121 084
  символов; Anthropic — skip, ключа нет (заводится к M4, модули до M4 его не вызывают).
- ☑ фронт: vitest 211, oxlint, `build`, `typegen:check`, e2e 44 + 22 пропуска по замыслу; эталоны не переснимались.
- ☑ `./run.sh` поднимает оба процесса; `/api/health`, `/api/channels`, `/api/events` (200, `text/event-stream`)
  отвечают через прокси Vite. Реальная `data/app.db` при этом получила миграцию 003.
- ☑ фикстуры, 500 прерванных записей, `kill -9` посреди пачки, 409 бюджета, `cached` $0 — автотестами.
- ☑ документы-контракты на месте и в карте `CLAUDE.md` (снята устаревшая пометка «появятся в M2»).
- ☑ секретов в истории нет: значения ключей (`sk-ant-…`, `AIza…`, `*_KEY=<значение>`, `client_secret`) не
  найдены; буквальный `git log -p | grep -i api_key` не пуст — 99 строк с именами переменных (документы,
  `Settings`, `.env.example`), значений среди них нет. `backend/.env` в `.gitignore`.
- ☑ LESSONS пополнен (L-017…L-019), L-004…L-006 свёрнуты в архив — файл был у лимита 150 строк.

### 18. Хвосты, закрытые перед тегом `m2` (2026-09-25)

Закрыты:
- `mypy tests` — плагин `pydantic.mypy` в `pyproject.toml`; `uv run mypy backend tests` чист (было 11 ошибок
  `_env_file`).
- Предупреждение TestClient про `httpx` ушло само: `anthropic` 1.x принёс `httpx2`. Оставшееся стороннее про alias
  `anyio` в starlette — `filterwarnings` в pytest; прогоны без предупреждений.
- `YOUTUBE_OAUTH_CLIENT_SECRET_*` убраны из `Settings` и `.env.example` — секрет канала только в
  `data/channels/<channel>/oauth/client_secret.json` (M10). В `backend/.env` эти строки пустые, их можно удалить.
- `run.sh`: `sed -u` — хвост логов не теряется при перенаправлении в файл.
- Пустой `image.prompt` — доменная ошибка с ID кадра (`validators.py`, фикстура `director_broken_empty_prompt.json`,
  строка в `docs/director_schema.md`).
- Тело 409 бюджета — модель `BudgetRefusal`, тип `@/types/cost`, помощник `budgetRefusal(error)` во фронте.
- Квота символов для шапки — `GET /api/providers/status` (`KeyStatus` с `quota`, кэш 60 с, `?refresh=true`), типы
  `@/types/provider`.
- Проверка Gemini подсказывает про ID проекта: живой прогон показал, что в `GEMINI_API_KEY` лежит
  `gen-lang-client-…` (26 символов), а не ключ `AIza…` (39) — проверено булевыми признаками, значение не выводилось.

Остаются, со своим модулем: `voice_quota` в профиле канала (M3 — шапка берёт квоту из `/api/providers/status`, поле
убрать или оставить лимитом канала); `ProjectPatch` (M3); `Episode.stage/status` (M3); «повторить упавший» и отмена
пачки (M6, вместе с интерфейсом пачки); эндпоинт пачки с общей суммой (M6); `drawn_at`/`price` и `changed` в отчёте
импорта (M6 и экран конфликтов); кэш текстов LLM (M4); `static` с `strength > 0` (модуль движения); удалённый id
генерации (M8); хвосты оболочки M1 и handoff — в сессии правок handoff перед M4. Claude Opus 5.5 — по решению
пользователя в каталоге `research` и `script`, профиль premium ($4/$20 — дешевле Opus 5 в standard; перевести в
standard — одна строка в `providers.yaml`). У 5.5 мышление не отключается — учесть в M4. Vitest однажды дал 2 падения, в 11 повторах (и под нагрузкой) не воспроизвелось; имена не
сохранились — при повторе сохранить вывод.

### 19. M3.1 — Бэкенд выпусков: создание, правка, сводка для карточки (2026-09-26, ветка `m3-episodes`)

- Миграция `004_episodes.sql`: `episodes.origin` (`backlog | reference | blank`, по умолчанию `blank`), индекс
  `episodes(channel, stage)`. Контракт выпуска — новый `docs/episodes.md` (строка в карте `CLAUDE.md`).
- `POST /api/episodes` без `id` и `title`: id `c01`/`o01` — максимум среди `c\d+` по всей таблице (id глобален) плюс
  один, номер с каталогом-сиротой пропускается; выбор и вставка — одна транзакция `BEGIN IMMEDIATE` (L-021).
  Название — «Новый выпуск»; стадия: `backlog` → `idea`, остальные → `script`.
- `PATCH /api/episodes/{id}`: `title` (1…200 после `strip`, `null` — 422), `short_title` (≤ 40, пустая строка и
  `null` — сброс); `id/channel/origin/stage/status` — 422 «через PATCH не меняются».
- Сводка — `models/episode_summary.py`, чистые `summarize` и `current_jobs`: кадры по статусам без `removed`, слова
  VO, длительность `voice → estimate (150 слов/мин) → target`, расход `charged + estimated`, джоб (`running` важнее
  `queued`). Список, `GET /{id}`, `POST`, `PATCH` отдают `EpisodeListItem`; журнал и джобы — запросом на список
  (`ledger.spent_by_episode`, `queue.active_jobs`), битый `project.json` одного выпуска список не роняет.
- Решения сверх задания: `EpisodeJob.status` (карточке надо отличать очередь от работы); `voice` только если у
  каждого кадра тайминг `voice`/`locked`; все ответы выпуска — одна форма `EpisodeListItem`.
- Вне списка «Создать» (согласовано): `cost/ledger.py`, `jobs/queue.py` — по функции; `frontend/scripts/typegen.mjs`
  — починен баг M2.7: снимались поля с именем `title` (`Episode.title`, `Section.title`, `Source.title`, L-020),
  тест в `types.test.ts`.
- Проверки: pytest 184, ruff, mypy, `typegen:check`, vitest 212, oxlint, `build` — зелёные. Тест гонки падает с
  обычным `BEGIN` — проверено и откачено.
- Живая проверка (uvicorn на временном `STUDIO_DATA_DIR`, рабочая `data/` не тронута): `c01`/`c02`/`o01`; 8
  параллельных `POST` — 8 × 201, id без дублей; `PATCH` и отказы; импорт пиратского плана через API + живой
  `sleep_job` + строки журнала → сводка 10/5/1/1/1, 204 слова, 81,6 с, $1,75, джоб с прогрессом, после отмены
  `null`; порядок по слоту, фильтр канала; битый `project.json` — 200 и предупреждение в логе. Нашла: тексты 422
  были английскими и двойными («Input should be None») — исправлено (`PydanticCustomError`, L-022).
- Хвосты: колонка доски в `docs/episodes.md` — словами, сверить с артбордом 1 в M3.5; `ruff format --check .` ругается
  на код в `docs/jobs.md` (с M2.5, не правил).

### 20. M3.2 — Слоты публикации и пресеты формата (2026-09-26, ветка `m3-episodes`)

- Расписание — `slots/schedule.py`: `data/schedule.json` `{anchor, every_days: 2, risk_days: 2}`, нет файла — пишется
  с якорем «сегодня»; слоты в обе стороны от якоря; состояние и риск — чистые функции от «сегодня». Контракт —
  новый `docs/slots.md` (строка в карте `CLAUDE.md` вместе с `config/formats.yaml`).
- `GET /api/slots?from=&count=11` — 3 прошлых слота и 8 с сегодняшнего; `state` + `risk {level, reason}`. Уровни
  сверены с артбордом: статус `failed`/`warning` — риск на любом расстоянии, неготовая стадия ближе `risk_days` —
  `warning`, в день слота — `failed`. Таблица артборда — `tests/test_slots.py`.
- `PUT /api/episodes/{id}/slot`: 422 `{message, nearest}`, 409 «Слот … занят выпуском «…» (id); …», `null` —
  снять, повтор — 200 без изменений. `POST /api/episodes` `slot: next_free | дата | null` в той же транзакции,
  что id; миграция `005_slots.sql` — уникальный индекс `slot_date`.
- Пресеты — `config/formats.yaml` + `models/formats.py` (проверка при старте, `ConfigError`); `GET /api/formats`
  — пресет + смета через `Gateway.estimate` запросами того же объёма (script, images × кадры, voice) +
  `stale_pricing`. Тест считает ожидаемое прямо из YAML; `default_profile: premium` меняет сумму.
- Вне списка «Создать» (согласовано в плане): `005_slots.sql`, `models/formats.py`, `api/deps.py` (`FormatsDep`),
  `main.py`, `api/__init__.py`; `tests/fixtures/config/formats.yaml` — symlink на `config/formats.yaml`
  (фикстурный каталог конфигов теперь тоже должен проходить старт).
- Живая проверка (uvicorn на временном `STUDIO_DATA_DIR`): окно из 11 слотов, `schedule.json` создан; смета
  Cursus $8.99 (сценарий $0.49, 100 кадров $6.70, голос $1.80), Otto $3.51; 5 параллельных `POST` — 5 слотов
  подряд; 422/409/повтор/снятие; `next_free` занял освободившийся слот; риски в окне. Нашла: 409 с одинаковыми
  «Новый выпуск» не говорил, кем занят слот — добавлен id.
- Проверки: pytest 213, ruff, mypy, `typegen:check`, vitest 212, oxlint, `build` — зелёные.
- Хвосты: «~$3.80» и «~$2.10» в артборде — числа макета, реальная смета выше (кадры и голос); сверить подпись в
  M3.6. `next_free` по заданию начинается с сегодняшнего: новый выпуск встаёт в сегодняшний слот и сразу красный —
  решить в M3.6 (диалог), не начинать ли с завтрашнего.

### 21. M3.3 — Слой данных фронта и оболочка на API (2026-09-26, ветка `m3-episodes`)

- `api/queries.ts` — ключи `qk.*` и пути `/api` в одном месте: `useChannels`, `useEpisodes(канал | 'all')`,
  `useEpisode` (пока грузится — строка из списка), `useCostSummary`/`useCostSummaries`, `useSlots`, `useFormat`,
  `useJobs`; мутации `useCreateEpisode`, `usePatchEpisode`, `useSetSlot` кладут ответ в кэш и перезапрашивают
  списки (и слоты). `api.put` добавлен в клиент. Клиент запросов — `api/queryClient.ts`: повтор только сети, ×2.
- `api/live.ts` — одна подписка SSE: снимок `GET /api/jobs` → поток с курсора, событие заменяет строку джоба в кэше;
  прогресс перезапрашивает выпуск не чаще раза в секунду (первое сразу, хвост окна не теряется), конечное — сразу,
  со слотами. StrictMode: отложенный старт после остановки не подписывается (тест — один живой поток).
- Оболочка на API: `TopBar` (название и стадия, расход месяца `charged + reserved`, в «Все каналы» — сумма и
  разбивка в подсказке, `Select` на три пункта), `StageRail` (`app/stages.ts`: done/active/error), `StatusBar`
  (первый `running` с процентом, ближайший слот с риском), `EpisodeScreen` (скелетон, 404, ошибка;
  `uiStore.openEpisode(episode)` ставит канал выпуска). `app/format.ts` (`formatUsd` — точки `format_usd`
  бэкенда, `formatDuration`, `formatSlotDate`), `app/labels.ts` (стадии, причины риска, виды джобов).
- «Бэкенд недоступен» (`BackendState`): любой запрос без ответа → карточка вида ErrorCard вместо рабочей области,
  шапка без расхода и без вечных скелетонов; «Повторить» — сброс запросов.
- Фикстуры ушли: `types/fixtures.ts` удалён, `mocks/placeholders.ts` — только цены заглушек 2–12; `MANUAL` из
  typegen убран. `mocks/api.ts` — контент артборда 1 через `satisfies` + `createMockApi()` (общий для vitest и e2e);
  `api/__tests__/fakes.ts` — фейк EventSource (из `sse.test.ts`) и `stubApi`. Экран 1 — пустое состояние или список
  названий.
- Живая проверка (uvicorn :8000 на временном `STUDIO_DATA_DIR` + `pnpm dev`, браузер через `@playwright/test`):
  расход $1.75 из $150 из `/api/cost/summary`; `sleep_job` — 0 → 17 → 50 %, после `done` — «Готово»; «Все
  каналы» — сумма из $250; выпуск Otto переключил канал. Нашла два бага оболочки на прокси Vite (L-023): мёртвый
  бэкенд даёт 502 text/plain, а не обрыв, и начатый поток SSE не обрывается. Исправлено: 502/503/504 без JSON →
  `status 0`, сторож тишины потока 35 с, обрыв потока → проверочный перезапрос, открытие → сброс. После правки:
  экран ошибки через ~23 с после остановки, после подъёма экран вернулся сам за 11 с; открыт при лежащем бэкенде →
  «Повторить» вернул экран за 0,2 с. Вечный скелетон переключателя канала при ошибке — убран.
- Проверки: vitest 260, oxlint, `tsc -b`, `build`, `typegen:check` — зелёные. e2e: 44 расхождения скриншотов + 22
  пропуска по замыслу — ожидаемо до M3.7 (в e2e ещё нет `page.route`, на каждом экране «Бэкенд недоступен»).
- Хвосты: решение 8 устава («остальные экраны зелёные») расходится с фактом — без моков API в e2e красные все
  экраны, шапка на каждом; индикатор сохранения снят до M3.4; названия в `mocks/api.ts` — из артборда 1 (другие
  артборды пишут «Every Rank on a Pirate Ship (…)») — выбрать в M3.7; у `samurai` в моке `vo_words` 2140 при
  `duration_source: target` — ради «~18:00» артборда, бэкенд так не отдаст.

### 22. M3.4 — Переключатель канала, переименование, автосохранение (2026-09-27, ветка `m3-episodes`)

- `app/autosave.ts` — один механизм на приложение: `createAutosaver` (ключ `episode:c01:title`, дебаунс 800 мс, одна
  запись на ключ — новое значение во время записи пишется после неё, последнее побеждает; сеть — повторы через
  1 и 2 с; 4xx/5xx — ошибка без повтора, `onFail` для отката, «Повторить») и хук `useAutosave(key, value, save)`
  (`undefined` — нечего сохранять). Состояние — `uiStore.save` (`idle | pending | saving | saved(at) | error`).
  `AutosaveGuard`: смена маршрута и уход со страницы пишут сразу, `beforeunload` предупреждает только при
  несохранённом; `PATCH` выпуска — с `keepalive`.
- `ChannelSwitcher` — кнопка с аватаром 20×20 (радиус 4, инициал 11/600), именем и шевроном; меню «Все каналы»,
  Cursus, Otto с галочкой accent на `Popover` кита (у `DropdownMenu` нет слота аватара и отметки выбранного — кит
  не трогал). Цвета — `channelLook.ts` через утилиты: дорожка кадров, accent, `line-strong` со светлым «∗» (как в
  артборде). Правило смены канала — `useChannel.ts` (`useSwitchChannel`), его возьмёт фильтр экрана 1 в M3.5.
- `EpisodeTitle` — клик/Enter → поле, Enter/потеря фокуса — принять, Esc — вернуть; пустое и длиннее 200 — подпись под
  полем; принятое — сразу в кэше выпуска и списков (`renameInCache`), запись через автосохранение, ошибка —
  откат к подтверждённому. `SaveIndicator` — «Сохраняю…», «Сохранено ЧЧ:ММ» (время сервера, `formatClock`),
  ошибка fail + «Повторить»; до первого сохранения — ничего.
- Живая проверка (uvicorn + `pnpm dev`, браузер через `@playwright/test`): переименование → «Сохраняю…» →
  «Сохранено 09:25», после перезагрузки имя на месте; Tab: пропуск → логотип → «Канал: Cursus», ↓ открывает меню с
  фокусом на выбранном, ↑ Enter → «Все каналы», фокус вернулся на кнопку; уход на другой этап через 0,3 с после
  Enter — `PATCH` сразу; бэкенд лежит — `PATCH` в 0,8 / +1 / +2 с, затем «Бэкенд недоступен…» + «Повторить» и откат
  названия; бэкенд поднят — «Повторить» сохранил, после перезагрузки имя на месте.
- Проверки: vitest 276 (новые `autosave.test.ts` 8, `topbar.test.tsx` 8), oxlint, `tsc -b`, `build`, тест токенов.
  `docs/visual_review.md`: переключатель — исправлено; размер аватара 20/4 (задание) против 18/2 (артборд).
- Хвосты: e2e по-прежнему красный до M3.7; LESSONS не пополнялся — граблей дольше получаса не было.

### 23. M3.5 — Экран «Выпуски»: доска и карточки (2026-09-28, ветка `m3-episodes`)

- `screens/episodes/board.ts` — чистые функции с таблицей случаев: `boardColumn` (все 36 пар стадия × статус, как в
  `docs/episodes.md`), `cardMeta` (строка «что сейчас» и её тон), `cardProgress` (доля стадии и заливка), `cardSlot`,
  `cardDuration`, `matchesQuery`, `countLabel`, `remainingSeconds`. `EpisodeCard` — ссылка «название, колонка»: клик и
  Enter → `openEpisode` + `paths.stage`. `Board` — шесть колонок, шапка вне прокрутки, скелетоны, «Из бэклога идей».
- Решения: экран берёт список обоих каналов (`useEpisodes('all')`) и режет его фильтром `uiStore.channel` через
  `useSwitchChannel`, иначе счётчик «1 из 9» не собрать; цель сценария «~3 000 слов» — из пресета формата
  (`useFormat`: минуты × слов/мин); оценка «~N мин» — по скорости с первого замера (в `EpisodeJob` нет `started_at`),
  не раньше 10 с наблюдения; полоса прогресса своя (у `ProgressBar` кита нет queued, ready мятный); «Опубликован» —
  `ready`; на пустой доске primary «Новый выпуск» только в `EmptyState`.
- `app/__tests__/shell.test.tsx`: ожидаемый перезапрос после `job.done` — `/api/episodes` вместо
  `?channel=cursus` (экран теперь берёт оба канала); код `app/` не менялся.
- Живая проверка (uvicorn + `pnpm dev` на временном `STUDIO_DATA_DIR`, Chromium `@playwright/test`): пустой экран —
  одна primary; выпуск через API до события не виден (опроса нет), `sleep_job` на нём → карточка в «Сценарии» без
  перезагрузки, «Проверочный джоб 48%, ~1 мин», штриховка; после `done` — «Сценарий не начат»; подсказка на
  выключенной кнопке, фильтр Otto — «0 из 1», клик → `/episodes/c01/script`; ошибок консоли нет.
- Проверки: vitest 363 (новые `board.test.ts` 74, `episodes.test.tsx` 13; полный прогон зелёный 4 раза подряд), oxlint,
  `tsc -b`, hex в `screens/episodes` нет. `docs/visual_review.md` — раздел «Экран 1: доска»; LESSONS — L-025.
- Хвосты: `uv` нет в PATH оболочки Claude — сервер шёл через `.venv/bin`; `EmptyState` не умеет выключенную primary,
  поэтому «Новый выпуск» на пустой доске кликается впустую до M3.6; «Из бэклога идей» — ссылка на `/ideas`, в
  артборде — диалог (сверить в M3.6); времени старта джоба в сводке нет — если появится, оценка станет мгновенной.

### 24. M3.6 — Полоса слотов и диалог «Новый выпуск» (2026-09-29, ветка `m3-episodes`)

- `screens/episodes/SlotStrip.tsx` — полоса над доской по `useSlots()`: месяц окна, ячейки ≥ 96 (число, день недели,
  глиф, короткое имя, заметка), «сегодня» — accent с кромкой 2px, риск — граница warning/fail, «Слот пропущен»,
  чужой канал при фильтре — `opacity-40`. `slotText.ts` — заметка из состояния, кода риска и сводки, месяц окна
  («сентябрь — октябрь 2026»), строка статус-строки «Следующий слот 13 сентября, Pirate Ship: экспорт не запускался».
- `AssignSlot.tsx` — меню пустого слота (выпуски без слота видимого канала) и занятого («Открыть выпуск», «Снять со
  слота»; у опубликованного — только первое); триггер кита растянут на ячейку — одна остановка Tab.
  `NewEpisodeDialog.tsx` — карточки канала (стрелки, фокус на выбранном), пресет и смета из `/api/formats`, «Откуда
  начать» (бэклог выключен), «Создаю…», ошибка в диалоге; успех → тост с датой из ответа, `openEpisode`, сценарий.
- Решения: `useSetSlot()` принимает `{id, channel, date}` и пишет оптимистично (ячейка и `slot_date` до ответа,
  откат снимка при 409/422, перезапрос слотов и списков в `onSettled`); `StatusBar` берёт текст риска из `slotText.ts`,
  `RISK_REASON` удалён; `mocks/api.ts` собирает слоты из текущих выпусков, отвечает 409/422 как бэкенд, `next_free` —
  по расписанию; пресет — поле только для чтения (один пресет на формат); из `board.ts` открыты `STATUS_TONE`,
  `failedShots`. Вне списка задания тронуты `app/StatusBar.tsx`, `app/labels.ts`, тесты `shell`, `queries`, `episodes`.
- Живая проверка (`./run.sh` на временном `STUDIO_DATA_DIR` + seed, Chromium `@playwright/test`): окно 23 сентября —
  13 октября, «сентябрь — октябрь 2026»; «Новый выпуск» → фокус на Cursus, «~$8.99 за выпуск» (Otto — ~$3.51) →
  `/episodes/c01/script`, тост «Выпуск создан: Cursus, слот 29 сентября», `projects/cursus/c01/project.json` на диске;
  сегодняшний слот — риск failed, статус-строка «Сегодняшний слот, Новый выпуск: сценарий не готов»; назначение на
  1 октября и снятие — тосты; 409 на устаревшем экране — тост с текстом бэкенда, ячейка с выпуском-владельцем; фильтр
  Otto приглушает два слота Cursus. В консоли — только сам ответ 409.
- Проверки: vitest 382 (новые `slots.test.tsx` 12, `new-episode.test.tsx` 8; полный прогон зелёный 3 раза подряд;
  тест ⌘1 падает без `useModalScope` — проверено), oxlint, `tsc -b`, hex в новых файлах нет. `docs/visual_review.md` —
  раздел «Экран 1: полоса слотов и диалог»; LESSONS — L-026 (рецепт живой проверки), L-008 свёрнут в архив.
- Хвосты: смета живого бэкенда ~$8.99 против ~$3.80 артборда — сверить `formats.yaml` и `pricing.yaml`, когда смета
  пойдёт в M4; ошибка создания — над подвалом, а не под кнопками (подвал `Dialog` — строка 48px); меню «Выпусков без
  слота нет» — один выключенный пункт; e2e по шапке и экрану 1 не пересняты — M3.7.

## Дальше

Модуль **M3 — Выпуски и календарь слотов** составлен 2026-09-26: устав `docs/tasks/M3.md` (восемь решений модуля,
приёмка) и этапы `M3.1`–`M3.7`. M3.1–M3.6 закрыты (разделы 19–24). Следующий этап — **M3.7 Визуальная приёмка и e2e на
моках API** (`docs/tasks/M3.7.md`): переснять эталоны шапки и экрана 1 со строками в `docs/visual_review.md`, затем приёмка
модуля и тег `m3`. Ветка `m3-episodes`.

Решения при составлении:
- хвост `ProjectPatch` → M4: переименование живёт в `episodes`, а не в `project.json`;
- `voice_quota` → M11: на экране 1 квоты нет;
- `strings.ru.ts` → сессия правок handoff.

Находка для правок handoff: цвета «Опубликован» (`#6F86B5` в артборде 1) нет в `tokens.css`. Ключ Anthropic
понадобится к M4. Перед M4 — сессия правок handoff (раздел M1.6 выше).

Открытые хвосты разбора видео ElevenLabs (2026-09-23, `docs/api_keys.md`, «Анимация кадров»):
- M8: удалённый id генерации (Veo, ElevenLabs, Kling) сохранять до начала опроса, иначе после падения джоб заплатит
  второй раз (принципы 7, 8); выбор пути анимации — при составлении M8.

## Как смотреть прототипы

Открыть любой `design/Studio - *.dc.html` в браузере. Шрифты (IBM Plex Sans,
IBM Plex Sans Condensed, Courier Prime) грузятся с Google Fonts — нужна сеть.
Карта переходов и указатель на файлы передачи — экран 11 (`Studio - 11 Прототип и передача.dc.html`).
