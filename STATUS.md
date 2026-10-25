# Studio — состояние проекта

Обновлено: 2026-10-16. Файл для Claude Code: что уже сделано, где что лежит,
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
  M3.5 берёт `ready`, и метка совпадает по цвету с «Монтажом»). Находка M3.7: действия заголовка экрана в артборде 1
  стоят через 12, у `ScreenLayout` — 8; сегмент фильтра в артборде с отступом 0 10 (фильтр 154 против 136 у кита) —
  сверить с остальными артбордами и закрепить одно значение в `layout.md` / `components.md`.

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

### 25. M3.7 — Визуальная приёмка и e2e на моках API (2026-09-29, ветка `m3-episodes`)

- `frontend/e2e/api.ts` — автоматическая фикстура: `page.route` на пути `/api/` отвечает из `createMockApi()` (свой мок у
  каждого теста, записи меняют его до конца теста), `/api/events` — пустой поток с `retry: 600000`, незамоканный путь →
  500 и падение теста со списком путей (проверено временно убранным `/formats`). Маршрут — предикат по `pathname`: glob
  `**/api/**` ловил модули Vite `/src/api/*.ts` (L-027).
- `e2e/episodes.spec.ts` (1536): диалог → «Создать выпуск» → тост «Выпуск создан: Cursus, слот 23 сентября» →
  `/episodes/c11/script` → «Выпуски»: карточка в «Сценарии» и выпуск в слоте 23 сентября → переименование →
  «Сохранено 12:41». `visual.spec.ts`: моки и часы 11 сентября 12:41 МСК, экран 1 — в «Все каналы», экраны выпуска —
  Pirate Ship, ожидание данных оболочки и каталога; новые эталоны `overlay-new-episode`, `overlay-slot-menu`.
- Сверка на 1536 (замеры DOM приложения и артборда, разбор старых эталонов по зонам) — раздел «M3, экран 1 и шапка» в
  `docs/visual_review.md`, открытых строк нет. Исправлено отдельными коммитами: время записи мока 12:41 МСК (`f4dfda3`,
  «Сохранено» берёт время сервера, а не часов браузера), порядок групп в окне клавиш (`169fad1`, L-028), аватар канала
  18×18 — переключатель 109px, как в артборде (`d292773`).
- Пересъёмка: изменились 43 эталона из 44 — шапка у всех (переключатель с аватаром, название и расход из моков, без
  «Сохранено 12:41» до первой записи), статус-строка (процесс и риск слота из API). Тело: экран 1 — полоса слотов,
  доска на моках, «Новый выпуск» включён; 04 — «период не выбран»; 09 — квота без расхода; 10 — каталог вместо пустой
  зоны старого эталона. Оверлей клавиш после исправления порядка групп остался в пороге старого эталона (шапка под
  скримом). Плюс 2 новых. `pnpm -C frontend e2e` — 47 зелёных три раза подряд.
- Проверки: vitest 383, oxlint, `build`, `typegen:check`; pytest 213, ruff, mypy. Типы e2e сверены разовым tsconfig
  (`tsc -b` e2e не включает).
- Хвосты: e2e вне `tsc -b` — завести tsconfig для `e2e/` при следующей правке тестов; «104 кадров» в заглушке
  «Генерации» (M1.3) — склонение поправится с экраном в M6; обнаружение мёртвого бэкенда на открытом экране — до 35 с
  (сторож потока, L-023), в прогоне 25 с.

### 26. Приёмка M3 (2026-09-29, ветка `m3-episodes`, тег `m3`)

- Семь этапов закрыты, коммит на каждый; бэкенд и фронт зелёные (раздел 25). `types/fixtures.ts` удалён, grep по
  `mocks/fixtures` и `types/fixtures` пуст; оболочка и экран 1 не импортируют `mocks/`, экраны 2–12 — только
  `mocks/placeholders`.
- Вручную (uvicorn и Vite на временном `STUDIO_DATA_DIR` + seed, Chromium `@playwright/test`):
  - «Новый выпуск» → Cursus, «С нуля» → тост «Выпуск создан: Cursus, слот 29 сентября», `/episodes/c01/script`,
    карточка в «Сценарии», выпуск в сегодняшнем слоте, `projects/cursus/c01/project.json` на диске;
  - переименование → «Сохраняю…» → «Сохранено 19:55»; после перезагрузки страницы выпуска имя на месте;
  - назначение в слот 1 октября и снятие — тосты; занятый слот — текст 409 бэкенда;
  - `sleep_job` (6 шагов) → «Проверочный джоб, Шаг 1 из 6 17%» … «83%» → «Готово»;
  - «Все каналы» — оба канала, Otto прячет карточки Cursus и приглушает два его слота; открытие выпуска Cursus из
    «Все каналы» — переключатель «Cursus»;
  - бэкенд остановлен → «Бэкенд недоступен. Сервер не отвечает. Запустите ./run.sh и повторите» через 25 с на открытом
    экране и сразу после перезагрузки, скелетонов нет; бэкенд поднят → «Повторить» вернул доску.
- Хвосты M1 и M2 модуля закрыты: `ChannelSwitcher` и «Все каналы», переименование, `Episode.stage/status`, `formatUsd`;
  `ProjectPatch` — в M4, `voice_quota` — в M11 (решения при составлении ниже).

### 27. Закрытие M3: аудит и хвосты перед M4 (2026-10-01, ветка `m3-episodes`)

- Повторная проверка приёмки: pytest 213, ruff, mypy; vitest 383, oxlint, `build`, `typegen:check`, e2e 47 + 28
  пропусков по замыслу — зелёные; grep по фикстурам пуст, оболочка и экран 1 `mocks/` не импортируют.
- `next_free` — со следующего дня (решение пользователя, хвост M3.2): новый выпуск больше не встаёт в сегодняшний
  слот с риском `failed`, сегодняшний назначается вручную. `api/episodes.py::next_free_slot`, `tests/test_slots.py`,
  `nextFree()` в `mocks/api.ts`, `docs/slots.md`, `docs/episodes.md`. Живая проверка (uvicorn на временном
  `STUDIO_DATA_DIR`, «сегодня» 1 октября — день слота): три `POST` → 3, 5, 7 октября, у 3-го риск `warning`; явная
  сегодняшняя дата → 201 и `failed`.
- `e2e/` в `tsc -b` — `frontend/tsconfig.e2e.json` (хвост M3.7): пробная ошибка типов в `e2e/` валит `build`.
- LESSONS: L-002, L-003, L-020, L-021, L-023 свёрнуты в архив (закреплены тестами или `CLAUDE.md`), 144 → 111 строк.
- Тег `m3` перенесён на коммит закрытия (был `b1b7708`, не пушился). Ветка и тег — на GitHub, PR `m3-episodes` →
  `main`; слияние — за пользователем.
- Не тронуто: `.claude/settings.json` — правка пользователя (сняты запреты `git push --force`/`-f`), в коммит не вошла.

### 28. Правки handoff перед M4 (2026-10-02, ветка `handoff-fixes`)

- Решения пользователя: вкладки экрана 3 — ⌘⇧1…⌘⇧3; заголовок экрана — 16 между блоками, 8 между контролами
  (замер шапок всех артбордов: так в 2, 3, 4, 7, 8, 12, отличался только 1); сегмент — паддинг 0 12, контейнер
  отступ 2, зазор 2 (артборды 2, 3, 12); `strings.ru.ts` убран из `stack.md` — подписи доменных значений и пары
  «действие → результат» живут в `app/labels.ts`.
- В claude.ai/design по готовому тексту правок: `tokens.css` — `--status-published`, шесть ширин панелей
  `--shell-*` (380, 320, 420, 300, 340, 480); `layout.md` — Идеи 300 / 340, Канон 480 (420–560), правило заголовка,
  ⌘⇧1…3; `components.md` — SegmentedControl и девять компонентов кита; `stack.md` — структура `src/` как в
  `CLAUDE.md` (без провайдеров и очереди во фронте), деньги в микродолларах; артборд 1 — шапка по правилу,
  `var(--status-published)`, без ⌘K/⌘N; артборд 3 — ⌘⇧1…3. Плюс находки M1.3: расхождения `stack.md` с кодом.
- Реимпорт через DesignSync (`/design-login`): `diff` с прежней `design/` — только заказанные строки, `support.js`
  без изменений; копирование в `design/` — командой пользователя (запись туда закрыта настройками).
- Код: `tokens:sync`; мост `bg-published` и `w-shell-*` в `theme.css`; `ScreenLayout` — зазор 16, ширины панелей
  через токены; `SegmentedControl` — отступ 2, зазор 2, сегмент 0 12; экран 1 — метка колонки `bg-published`,
  `EpisodeGlyph` (глиф «Опубликован» — сплошная точка своего цвета; кит StatusGlyph остаётся на пяти статусах),
  `glyphStatus` удалён; тест цвета глифа (с `bg-ready` падает — проверено).
- e2e: пересняты 35 эталонов из 46 — разбор по зонам в `docs/visual_review.md`, раздел «Правки handoff»; шапка
  экрана 1 совпадает с артбордом до пикселя (поиск 974, фильтр 1210–1376, кнопка 1384). Строки «макет» закрыты,
  кроме подвала оверлея клавиш (M11).
- Проверки: vitest 383, oxlint, `tsc -b`, `build`, `tokens:check`, e2e 47 — три прогона подряд.

### 29. M4.1 — Мост: промпты, разбор ответа, журнал обменов, заявка (2026-10-02, ветка `m4-script-bridge`)

- `pipeline/bridge/`:
  - `prompts.py` — шаблоны `backend/app/prompts/<id>.md`: front-matter `id`, `version`, `task`, `model_hint`;
    `id` = имя файла; рендер `{{name}}` строгий (нехватка и лишний ключ — ошибка с именами) и в один проход;
    `RenderedPrompt` с sha256; проверка при старте — `ConfigError`;
  - `extract.py` — `extract_json`: блок ```json → блок ``` с `{` → первый сбалансированный объект; обрыв —
    номер строки, синтаксис — строка и столбец исходного ответа, причины `json` по-русски; NaN и не-объект —
    ошибка, ничего не чинится;
  - `runs.py` + `006_bridge.sql` — журнал `bridge_runs`; `errors.py` — `BridgeAnswerError` → 422 `BridgeError`.
- API: `GET /api/bridge/settings`, `GET /api/bridge/runs?episode_id=&task=&limit=`. `plan_source: bridge` в
  `providers.yaml`, неизвестное значение — ошибка старта.
- Заявка — `project.json → brief` (`EpisodeBrief`). PATCH проекта отдаёт `msg` по-русски для лишнего и
  обязательного поля, литерала и типа строки.
- Решения:
  - модель заявки — `EpisodeBrief`, а не `Brief`: `Brief` уже есть в `director.py` (что вернул чат);
  - повторный ответ на закрытый обмен — новая строка с тем же промптом;
  - API недоступен и с ключом («подключается отдельным этапом»), `plan_source` в ответе — действующий;
  - каталога `backend/app/prompts/` нет — 0 шаблонов, первый появится в M4.2.
- Документы: новый `docs/bridge.md` (строка в карте `CLAUDE.md`), `brief` в `project_schema.md`, `plan_source` в
  `providers.md`; typegen — `types/bridge.ts`, `EpisodeBrief` в `types/project.ts`.
- Проверки: pytest 276, из них тесты моста 63 (prompts 20, extract 26, api 17), ruff, mypy, `typegen:check`, `tsc -b`. Живая
  проверка на временном `STUDIO_DATA_DIR`: оба `curl` из задания, 422 по-русски, мёрдж заявки, журнал через API,
  0 строк `cost_ledger`.
- Хвосты:
  - `tests/fixtures/config/formats.yaml` после `pull` оказался текстом вместо симлинка (L-029). Починено с согласия
    пользователя: `core.symlinks=true` в `.git/config`, `git checkout` файла; pytest — 276 зелёных;
  - неизвестная `task` в `/api/bridge/runs` — 422 с английским текстом FastAPI: запрос шлёт фронт, не человек.

### 30. M4.2 — План через мост: части, `canon_ref` и `voice` из кода, импорт (2026-10-06, ветка `m4-script-bridge`)

- `pipeline/script/plan_bridge.py` — чистые функции:
  - раскладка частей: `ceil(кадры пресета / plan.shots_per_part)`, Cursus 4 × 26, Otto 2;
  - контекст промптов; в конспекте части k — разделы, последний кадр, id эпох и обликов;
  - `build_canon_ref` (`v001`-заготовки) и `voice_for` (профиль + маршрут `voice`);
  - приём части: сверка `meta`, формат id, подстановка, `validate_director`.
- `api/plan.py` — `POST …/plan/prompt?part=k`, `POST …/plan/answer {text}`, `GET …/plan/parts`. Шаблоны
  `prompts/plan_first.md` и `plan_next.md` (v1), эталоны — `tests/fixtures/prompts/plan_*_c01*.txt`
  (`STUDIO_UPDATE_GOLDEN=1`).
- `api/director.import_plan(paths, db, episode, director, source)` — общий путь ручного импорта и моста; неполный
  набор возвращается как `PartsPending`. Успешный импорт переводит стадию `idea` → `script` (`mark_plan_imported`).
- Контракт: `Fact.shot_id` (пустое не выгружается — хэш старых планов тот же), `DirectorVersionInfo.source`
  (`bridge | manual | api`, по умолчанию `manual`), `ChannelProfile.voice`, `formats.yaml → plan.shots_per_part: 26`.
- Решения:
  - `canon_ref` набора строится по кадрам всех частей и дописывается в часть 1 — иначе облик, появившийся в
    части 3, валит сборку;
  - ожидаемая часть — часть открытого обмена, без него — следующая недостающая или замена принятой;
  - части 2…N без `brief`, `thumbnail`, `publish` (берутся из части 1) — короче ответ чата;
  - конфиг-модель — `PlanConfig`, ответ API — `PlanParts`.
- Отступление: `frontend/src/mocks/api.ts` — `voice` у двух каналов. Поле профиля в TS обязательное, без него
  `tsc -b` падает, а этап разрешал во фронте только typegen.
- Проверки: pytest 295 (новых 19: `test_plan_bridge.py` 16, `facts[].shot_id` 3), ruff, mypy, `typegen:check`,
  `tsc -b`, vitest 383, oxlint. Живая проверка (временный `STUDIO_DATA_DIR`, seed, c01): ответ настоящего чата
  claude.ai (Opus, 39,7 тыс. символов) принят как часть 1 из 4 с первого раза. В наборе 26 кадров, `canon_ref` с
  2 эпохами (`cape-cod-1717` чат добавил сам) и 3 обликами, 29 фактов с `shot_id`. Промпт части 2 — с `s027`.
  Тот же ответ с порчей: не та часть, чужой `episode_id`, обрыв, стилевой токен в `s005` → 422 по-русски,
  файлы выпуска не изменились, 0 строк в `cost_ledger`.
- Хвосты:
  - `GET …/plan/parts` после импорта показывает «нужна часть 1» — версию экран 3 берёт из `project.json` (M4.4);
  - стадию `idea` → `script` вживую не видно: выпуск «С нуля» создаётся сразу в `script`, переход покрыт тестом;
  - сессия открылась в устаревшей копии `/mnt/d/studio/studio` (L-030).

### 31. M4.3 — Правки кадров, действующий план, версия из JSON (2026-10-07, ветка `m4-script-bridge`)

- `models/project.py`: `ShotOverride` — частичная правка в форме кадра (`vo`, `image{prompt, shot_size}`, `motion`,
  `transition_in`, `animate`, `sfx` целиком); пустые поля не выгружаются. `ShotState.user_override` теперь
  типизирован. `ProjectPatch` — в теле PATCH только `brief` и `shots{id: {duration_locked, prompt_locked,
  user_override}}`, хвост M2/M3 закрыт.
- `api/projects.py`: PATCH проверяет тело `ProjectPatch` и пускает только кадры текущей версии. Правки мёрджатся
  (`null` — сброс поля), действующий кадр проходит `Shot` + `check_shot`. Ошибки — `кадр s003: …`, поля пайплайна —
  «меняется пайплайном, не через PATCH». Ручной `stale`: правка промпта или крупности у `done`.
- `pipeline/director_import/effective.py` — чистые функции: `prune_override`, `apply_override`, `overridden_fields`,
  `edit_stale`, `effective_plan` → `EffectivePlan`/`PlanShot`.
- `api/plan.py`: `GET …/plan` (до импорта — `null`; убранные кадры — в конце, с содержимым из прошлой версии) и
  `POST …/director/validate` → `PlanCheck{ok, errors, items}`. `api/director.py`: `?source=` и `items` в 422.
- `validators.py`: `ValidationItem{shot_id, path, message}` идут параллельно `errors`, строки M2.2 прежние;
  проверки кадра вынесены в `check_shot(shot, ShotContext)`.
- Решения:
  - ошибки правки — только по поправленным полям;
  - `schema`/`episode_id`/`channel` в PATCH — 422 даже с теми же значениями;
  - `ProjectPatch` — своя группа схем `project_patch` (L-031).
- Старые тесты, писавшие `status`, `assets` и `director_version` через PATCH, пишут их в файл, как пайплайн
  (`test_api_episodes.py`, `test_director_import.py`).
- Проверки: pytest 322 (новых 27 в `test_plan_edits.py`), ruff, mypy, `typegen:check`, `pnpm build`, vitest 383,
  oxlint. Живая проверка (временный `STUDIO_DATA_DIR`, seed, c01 + фикстура):
  - PATCH VO → в файле только `user_override.vo`, `null` сбросил;
  - стилевой токен → 422 `кадр s003: …`; `director_version`/`assets` → 422 с текстом;
  - `/plan` с правкой; `validate` с `items`, на диск ничего;
  - правка VO s009 + v002 → правка на месте, `stale` с причиной, s006 в конце;
  - `?source=manual` → v003 `manual`, повтор — `created: false`.
- Хвосты: ручной `stale` вживую не виден — картинок до M6 нет, правило закреплено тестом. Фронт PATCH проекта пока
  не шлёт, автосохранение правок — M4.5.

### 32. M4.4 — Экран «Сценарий и план»: заявка, панель моста, режимы (2026-10-07, ветка `m4-script-bridge`)

- `screens/script/`:
  - `index.tsx` — заголовок: SegmentedControl режимов «Сценарий / План кадров / JSON» (⌘⇧1…⌘⇧3, группа
    «Сценарий», режим в адресе `?mode=`), счётчики по действующему плану: хронометраж = слова ÷ темп пресета,
    темп, слова, кадры; без плана — «—»;
  - `BriefForm.tsx` — заявка с источниками, автосохранение `brief:<id>`. Правка живёт в экране до записи — по ней
    включается кнопка промпта; перед запросом промпта — `autosaver.flushAll()`;
  - `BridgePanel.tsx` — источник плана, промпт части k из N, полоски частей (ready / queued / failed по `last_run`),
    подпись, «Последний обмен», вставка;
  - `PlanPreview.tsx` — кадры по разделам до листа M4.5; убранные — в конце.
- `screens/bridge/` (общее с экраном 2):
  - `CopyPrompt.tsx` — буфер или диалог «скопируйте вручную»;
  - `PasteAnswer.tsx` — поле, «Применить вставку», карточка отказа в виде ErrorCard с ошибками по кадрам.
- `api/queries.ts`: `useBridgeSettings`, `useProject`, `useSaveBrief`, `usePlan`, `usePlanParts`, `usePlanPrompt`,
  `useApplyPlanAnswer` (импорт плана инвалидирует план, выпуск и списки). `mocks/api.ts` — те же пути в памяти:
  заявка у samurai, план у pirate, отказ на стилевом токене.
- Решения:
  - кит с согласия: `SegmentOption.disabled` и `tooltip` (`aria-disabled`, стрелки проходят фокусом, не выбирают);
  - ErrorCard в кит не вынесен — карточка в `bridge/`;
  - `api/client.ts` читает `BridgeError` из корня тела (L-032);
  - `ScreenLayout.header.view`; `navigation.ts`: `useSearchParam` и `setSearchParam`;
  - `keyboard.register()`: в dev — `console.warn` о дубле сочетания с обоими владельцами (хвост M1.6 закрыт);
  - `useBridgeRuns` не заведён — `last_run` из `GET …/plan/parts` (хук — в M4.9).
- Проверки: vitest 397 (два полных прогона), oxlint, build, `tokens:check`, hex нет. e2e — 44 из 47: разошлись
  `03-script` × 3, пересъёмка в M4.12. Вживую (временный `STUDIO_DATA_DIR`, uvicorn + `pnpm dev`, Playwright-скрипт и
  браузер пользователя):
  - заявка → PATCH 200 → промпт части 1 (5 889 символов) в буфере, тост;
  - чужой `episode_id` → карточка по-русски, поле не очищено, полоска failed;
  - ответ настоящего чата claude.ai принят как часть 1 из 4, 26 кадров, полоска зелёная.
- Хвосты: «Сохранить как версию» и JSON — M4.7; лист и таблица с правками — M4.5. Сегмент «Claude API»
  перемонтируется, когда приходят настройки: фокус, поставленный до их ответа, теряется (мелочь).

### 33. M4.5 — Лист сценария и таблица плана с правками (2026-10-07, ветка `m4-script-bridge`)

- `screens/script/ScriptSheet.tsx` — лист 760:
  - шапка «Cursus — …» и «v003 · 1716–1726», sluglines разделов;
  - VO правится прямо на листе (`textarea` в стиле сценария, `field-sizing: content`), пометка «правка» и
    «Вернуть из плана» с значением версии в Tooltip;
  - правое поле: плейсхолдер 120×68, движение с иконкой, «анимация», «N SFX», глиф статуса; у `stale` — причины
    в Tooltip.
- `screens/script/PlanTable.tsx` — 11 колонок, строки 28, шапка 24 над прокруткой, от 30 строк — `Virtuoso`:
  - правка в ячейке: VO и промпт — поле (Enter, Esc), план, движение, переход и анимация — Select, сила — NumberInput
    3–25 %;
  - отметка правки, Tooltip «В плане: …», ошибка под ячейкой;
  - клавиатура — сетка: ↑↓ ←→, Enter, Esc с возвратом фокуса.
- `useShotEdit.ts` — черновик → автосохранение `shot:<выпуск>:<кадр>:<путь>` → PATCH `user_override` → перезапрос
  действующего плана; черновик снимается после записи; пустой VO не уходит. `shotLabels.ts` — подписи с таблицей
  случаев. `useDirectorVersion` — файл версии для «значения из плана». `PlanPreview.tsx` удалён.
- Моки: план «Пиратов» по артборду (v003, s006 `stale`, у s004 правка VO), файл версии, PATCH правок со сбросом и
  отказом 422.
- `api/client.ts`: к русским сообщениям 422 технический путь больше не дописывается — индикатор в шапке показывал
  «shots.s003.user_override.image.prompt: кадр s003: …» (нашлось вживую).
- Проверки: vitest 441 (новых 44, два полных прогона), oxlint, build, `tokens:check`, hex нет. e2e — 44 из 47:
  `03-script` × 3, пересъёмка в M4.12. Вживую (временный `STUDIO_DATA_DIR`, план фикстуры в c01, Playwright):
  - правка VO s001 → PATCH с одним полем через 839 мс → «Сохранено» → перезагрузка → правка на месте;
  - стилевой токен в промпте s003 → ошибка под ячейкой, значение в ячейке;
  - ↑← / Enter / Esc в таблице; «Вернуть из плана» → `{"vo": null}`, текст версии, пометка снята.
- Хвосты:
  - fps пресета — константа `PREVIEW_FPS = 30` в `shotLabels.ts`, пока fps нет в `config/formats.yaml` (модуль
    рендера);
  - длительность перехода в таблице не правится, только тип: из «встык» — 0.4 с;
  - сброс `motion` из ячейки шлёт `null` двумя записями — по ключам типа и силы (безвредно).

### 34. M4.6 — Смета плана и «Утвердить план» (2026-10-08, ветка `m4-script-bridge`)

- `pipeline/script/estimate.py` — `plan_estimate` по действующему плану (без `removed`): кадры × `images`, символы
  VO → `voice`, клипы `animate.recommended` по длительности → `animate`, план — мост $0 (`StageCost.via: bridge`) или
  `script` при `api`. Подписи «10 × $0.067», «1 021 знак», «1 клип × $0.25» (`format_unit_usd` — до десятых цента).
  Бюджеты месяц / выпуск / анимация: занятое, доля сметы, остаток, «Останется … из месячных $150»; превышение —
  `warnings`, 200. `GET /api/projects/{id}/estimate`.
- `pipeline/script/approve.py` — `CHECKS` (`stage`, `plan`, `vo`, `prompt`; M4.10 добавит сходство), `refusal` —
  сводка «2 кадра без VO: s003, s007 — …». `POST /api/episodes/{id}/approve`: 409 `ApprovalRefusal` в `detail`
  (формат бюджета — `detailOf` уже читает), успех — `approved_version`/`approved_at` в project.json и стадия
  `generate`, повтор — без записи. Джобов и резерва нет.
- Новая текущая версия плана: `generate` → `script` (`mark_plan_imported(new_version=)`), повторный импорт того же
  плана стадию не трогает, поздние стадии — тоже. `EffectivePlan.approved_version` теперь из project.json.
- Смета пресета (`GET /api/formats`) при мосте: сценарий $0 с `via: bridge`. Живые числа против артборда:
  **Cursus ~$8.50** (100 кадров $6.70, голос $1.80; было $8.99 со сценарием $0.49) против «~$3.80»;
  **Otto ~$3.31** (40 кадров $2.68, голос $0.63; было $3.51) против «~$2.10». Цены не правились — разница в кадрах.
- Решения:
  - тело 409 — в `detail`, как у бюджета и слотов, а не в корне (план этапа): нового формата нет, разрыв L-032 не
    возникает;
  - `approved_*` и `via` — с `exclude_if`: в TS необязательны, моки фронта (`satisfies`) не сломались (L-033);
  - тест M4.2 «модули сценария не зовут gateway» сужен: `estimate.py` может звать `Gateway.estimate`, но не
    `.call(`, журнал и Anthropic;
  - `Money`/`money` переехали из `api/cost.py` в `cost/pricing.py` (pipeline не импортирует `api/`); `plural` в
    `plan_bridge.py` и `LEVEL_TITLE` в `budget.py` стали публичными;
  - недособранный набор частей мешает только без версии: утверждается готовая версия, отменить набор нечем.
- Проверки: pytest 345 (новых 23), ruff, mypy, typegen:check; фронт — build, vitest 441, oxlint без правок.
  Вживую (временный `STUDIO_DATA_DIR`, план фикстуры в c01): смета без плана — 409; смета $1.02 со строкой моста;
  утверждение → `generate`, повтор не переписал project.json; v002 → `script`, план `v002`/утверждён `v001`;
  повторное → `generate`; пустые VO в файле → 409 со списком; журнал и очередь пусты.
- Хвосты:
  - правка кадра после утверждения стадию не меняет: действующий план расходится с утверждённым — решить в M6
    вместе с поздними стадиями;
  - смета считает план целиком, сделанное не вычитает (M6);
  - тест клиента на `problems` в 409 — на экране утверждения (M4.7).

### 35. M4.7 — JSON, факт-чек, смета и утверждение на экране (2026-10-08, ветка `m4-script-bridge`)

- `screens/script/JsonEditor.tsx` — режим «JSON»:
  - `textarea` поверх слоя подсветки, номера строк; каретка, выделение и прокрутка нативные, слой движется вслед;
  - текст текущей версии в 2 пробела; синтаксис — сразу и без запроса (строка:столбец), остальное —
    `director/validate` через 800 мс; строки с ошибками — фон `surface-failed`;
  - панель «Проверка»: клик ставит курсор на строку кадра или поля;
  - «Сохранить как версию» (secondary): тосты «Сохранено как v004» / «Совпадает с v003, новая версия не создана» /
    «Совпадает с v001 — план переключён на эту версию».
- `jsonHighlight.ts` — токены строки, `locate` (путь → строка, id кадра → индекс), `lineOfShot`, `lineOfPath`,
  `parsePlanJson`; `jsonDrafts.ts` — несохранённый JSON в памяти по выпуску: переживает уход на другой экран, смена
  режима — Dialog «Несохранённый JSON», закрытие вкладки — `beforeunload`.
- Правая панель: `FactCheck.tsx`, `EstimatePanel.tsx` прокручиваются под мостом; `ApprovePlan.tsx` — подвал, primary
  экрана: «Утвердить план» / «План v003 утверждён» / «Утвердить снова», 409 — сводка и кадры ссылками. Переход к кадру
  из факт-чека и отказа — режим «Сценарий», прокрутка и фокус на VO (по `data-shot`, лист не менялся).
- `queries.ts`: `useEstimate` (ключ — `dataUpdatedAt` плана: правка кадра перезапрашивает план и смету без правки
  `useShotEdit`), `useValidateDirector`, `useSaveDirectorVersion`, `useApprovePlan` (кэш выпуска, списки, project).
  `client.ts`: `approvalRefusal`, `planRejection` + тесты (хвост M4.6 закрыт). Моки: смета, проверка, версия из
  JSON, утверждение по правилам бэкенда; факты артборда у «Пиратов».
- Решения: без цены в кнопке «Утвердить план» — утверждение бесплатно, смета над ней (артборд так же); строки JSON —
  `accent`, а не `accent-deep` (`visual_review.md`); тесты M4.4 и клавиш поправлены под новую панель и редактор.
- Проверки: vitest 481 (новых 40, два полных прогона), oxlint, build, `tokens:check`, `typegen:check`, hex нет.
  e2e 44 из 47 — те же `03-script` × 3 до M4.12. Вживую (бэкенд + `pnpm dev`, план из 4 частей через мост, 100
  кадров, Playwright): смета ~$10.21 со строкой «Мост через чат $0» и остатком месяца; пропущенная запятая —
  «строка 7:5», запросов 0; пустой VO s003 и стоп-слово s005 — строки 135 и 200 подсвечены, клик — курсор на 135;
  правка → «Сохранено как v002», версии `v001·bridge, v002·manual`; «Утвердить план» → «План v002 утверждён», рельс
  «Генерация — в работе», карточка на доске в «Генерации». Первый прогон упал, причина не поймана (L-034); четыре
  повторных на новых выпусках, в том числе на холодном vite, — зелёные.
- Хвосты:
  - смета ниже факт-чека: при длинном списке фактов видна только прокруткой — решить в M4.12 по эталону;
  - выключенная primary «План v003 утверждён» серая — сверить с макетом в M4.12;
  - проверка JSON на 3 000+ строк — без виртуализации; на плане 100 кадров ввод без задержек.

### 36. M4.8 — Бэклог идей и идеи через мост (2026-10-08, ветка `m4-script-bridge`)

- Миграция `007_ideas.sql`, `models/idea.py` (`Idea`, `IdeaCreate`, `IdeaPatch`, `IdeaProposal`), `api/ideas.py`:
  - `GET/POST /api/ideas`, `PATCH /api/ideas/{id}`; id `i0001…` внутри `BEGIN IMMEDIATE`;
  - переходы `proposed → backlog | dropped`, `backlog → dropped`, `dropped → backlog`; `used` — только созданием
    выпуска; неверный переход — 409 с текстом; тексты ошибок полей — одной фразой (L-022).
- Мост: шаблон `prompts/ideas.md` (v1, эталон `ideas_cursus.txt`), `POST /api/ideas/prompt|answer`; логика —
  `pipeline/research/ideas.py` (контекст, разбор ответа по идее, дубли). Обмен привязан к каналу:
  `latest_runs(channel=…)`.
- Семена: `profile.json → seeds`, `PATCH /api/channels/{id}` (до 20, до 80 знаков, без повторов), запись атомарная;
  пустой список не выгружается — `seeds?:` в TS (L-033).
- Выпуск из идеи: `EpisodeCreate.idea_id` — проверка идеи, название, заявка (`notes` ← `summary`) и `used` в одной
  транзакции с созданием; отказ не оставляет каталога.
- Решения:
  - дубли при приёме — со всеми идеями канала, кроме `dropped`, и с выпусками: повторная вставка ответа не удваивает
    `proposed`; «не повторять» в промпте — бэклог и выпуски, как в задании;
  - лишние ключи идеи от чата игнорируются; `85.0` — оценка 85;
  - семян в `seed.py` нет — по заданию они только в профиле.
- Проверки: pytest 386 (новых 41), ruff, mypy, `typegen:check`, фронт `build` без правок. Вживую (временный
  `STUDIO_DATA_DIR`, curl): семена с пустой строкой и пробелами → 2 семени, повтор → 422; `curl` промпта из задания;
  ответ из 6 идей → 3 сохранены, 3 пропущены (нет `angle`, дубль бэклога в другом регистре, `score: 150`), обмен
  `applied` с тремя ошибками; `proposed → backlog`, обратно — 409; выпуск c01 из идеи — название, заявка, стадия
  `idea`, идея `used`; повтор — 409, чужой канал — 422, `proposed` — 409; в «не повторять» — бэклог и выпуск.
- Хвосты: в «не повторять» промпта нет `proposed` — повтор такой идеи отсеет приём ответа, но чат потратит на неё
  слот; решить на экране идей (M4.9), если будет мешать.

### 37. M4.9 — Экран «Идеи»: семена, бэклог, идеи из чата (2026-10-08, ветка `m4-script-bridge`)

- `screens/ideas/`: `index.tsx` (вкладки «Тренды / Референс» в `?tab=`, «Бэклог: 7 идей», «Все каналы» — «Выберите
  канал»), `SeedsPanel.tsx` (чипы, Enter / Esc, повтор — подпись без запроса, 20 — «Семя» выключено),
  `Backlog.tsx` (по оценке, без оценки — в конце; «Начать выпуск», «Убрать»; «Убранные» с «Вернуть»),
  `ChatIdeas.tsx` (мост на `screens/bridge/` как есть, отчёт «Добавлено 4 идеи, пропущено 2» тостом и причинами;
  карточки `proposed` по артборду), `useStartEpisode.ts` («предложенная» → бэклог → выпуск с `idea_id` → экран 3 и
  тост M3.6), `ideaView.ts`, `IdeaScore.tsx`.
- Диалог «Новый выпуск»: «Из бэклога идей» включён, подпись — число идей канала, Select по оценке, создание с
  `idea_id`; пустой бэклог — пункт выключен «В бэклоге Cursus нет идей». Ссылка с доски на идеи уже была (M3.5).
- `queries.ts`: `useIdeas` (все статусы канала одним ключом), `useCreateIdea`, `usePatchIdea`, `useIdeasPrompt`,
  `useApplyIdeasAnswer`, `usePatchChannelSeeds`; `useCreateEpisode` с `idea_id` перезапрашивает идеи. Моки: идеи
  артборда и бэклог из 7, семена, правила бэкенда M4.8 для идей, семян и выпуска из идеи.
- Вне списка задания (сказано в сессии): строка экрана в статус-строке — `uiStore.statusNote`, `app/useStatusNote.ts`,
  вывод в `StatusBar.tsx`; текст тоста создания выпуска — `createdToast` в `episodes/board.ts` (диалог и экран идей).
- Проверки: vitest 498 (новых 17, два полных прогона), oxlint, build, `typegen:check`, hex нет. e2e 40 из 47:
  `02-ideas` × 3 и диалог «Новый выпуск» — новый экран и подпись, `03-script` × 3 — как раньше; пересъёмка в M4.12.
  Вживую (бэкенд + `pnpm dev`, Playwright): пять семян через интерфейс, «PIRATES» — подпись «уже есть»; промпт идей в
  буфер; **ответ настоящего чата claude.ai** (6 идей, JSON без блока ```json) — «Добавлено 6 идей»; «В бэклог»
  легиона — «Бэклог: 1 идея», статус «Идей в бэклоге 1, слот 10 октября свободен»; «Начать выпуск» монастыря →
  c01, экран 3 с заявкой из идеи, стадия «Идея», идея `used → c01`; диалог — «1 идея». Нашлось и исправлено:
  идеи одного ответа шли в обратном порядке (одно время создания) — теперь в порядке чата, тест.
- Хвосты:
  - `seeds` в TS остаётся `?:` (L-033): обязательным его сделала бы правка бэкенда, а этап её запрещал;
  - отказ ответа идей показывает «ideas[1]: идея 2: …» — `PasteAnswer` приписывает путь, а сообщение бэкенда его не
    содержит; поправить в `bridge.issueLine` или в `api/ideas._issues` отдельной правкой;
  - в живом скрипте `getByRole('status')` неоднозначен (тост — тоже `status`): статус-строку брать как
    `footer[role="status"]`.

### 38. M4.10 — Референс: субтитры, разбор через мост, метрики, сходство (2026-10-11, ветка `m4-script-bridge`)

- Миграция `008_reference_videos.sql`, `models/reference.py`, `config/reference.yaml` (`ngram: 5`,
  `max_similarity: 0.10`; проверка при старте, копия в `tests/fixtures/config`).
- `pipeline/research/`: `subtitles.py` (SRT, VTT с тегами и `NOTE`, расшифровка YouTube в обоих видах; конец
  последней реплики расшифровки — по словам при 150/мин), `reference.py` (контекст промпта, приём разбора с ошибками
  по номеру сегмента, метрики, структура для плана), `similarity.py` (n-граммы по кадру, фразы, `percent`).
- `api/references.py`: создание (422 на не-субтитры), список, чтение с метриками, промпт и ответ моста
  (`task: reference`, `target_id`), `…/episodes {mode}` — заявка с `reference_id`/`reference_mode`, идея — `topic`
  для `own_version`, «Новый выпуск»; без разбора — 409. `insert_episode` принимает готовую заявку.
- План: `plan_first` v2 — структура референса и инструкции по режиму, эталон обновлён; `GET …/similarity`;
  в `CHECKS` — `not_like_reference` (409 «Сходство с референсом 18 % при пороге 10 %: перепишите … — «…»»).
- Проверки: pytest 428 (новых 42), ruff, mypy, `typegen:check`, фронт `build` без правок. Вживую (временный
  `STUDIO_DATA_DIR`, curl из задания): ref0001 — 180 с, 14 реплик; не-субтитры — 422; промпт разбора; ответ с
  прозой — разбор и метрики (темп 91 при норме 150, факты 2.67/мин, держится до 02:45, крючок 01:20, 8 сегментов /
  4 ранга); выпуск `own_version` — идея из `topic`; промпт плана — структура, утечек 5-грамм субтитров 0; план со
  скопированными фразами — сходство 18 %, 409 с двумя фразами; правка двух кадров — 0 %, утверждение прошло.
- Решения: n-граммы плана по кадру с повторами, субтитры одним текстом, `ok` — не выше порога; метрики и реплики
  считаются при чтении (хранится исходный текст); проверка разбора — все ошибки сразу.
- Грабли: escape `\ufeff` при записи файла раскрылся в невидимый BOM — L-035.
- Хвосты:
  - `plan_next` (части 2…N) без структуры референса: продолжение в новом чате её не видит — добавить, если будет
    мешать;
  - правка кадров после утверждения не перепроверяет сходство (тот же хвост M4.6 — к M6).

### 39. M4.11 — Вкладка «Референс» (2026-10-12, ветка `m4-script-bridge`)

- `screens/ideas/ReferenceTab.tsx`: слева 420 — ввод («Ссылка на ролик», «Или текст и субтитры», «Сохранить»,
  ошибка формата под полем), Select референсов канала и «Новый референс», превью субтитров (только начало реплик),
  мост разбора на `screens/bridge/`, плашка сходства; справа «Карта структуры»: `StructureMap` (ширины по
  длительности, узкие — Tooltip, шкала 0…конец), `ReferenceMetrics` (три карточки, без средней длины кадра),
  `Techniques`, `ReferenceActions` («Новая тема по этой структуре» / «Своя версия этой темы» → экран 3 и тост; без
  разбора выключены). Шапка «Референс разобран …», строка статуса вкладки. Выбранный референс — `?ref=`.
- Чистые функции: `structureMap.ts` (ширины в сотых процента, сумма ровно 100), `referenceView.ts` (подписи
  метрик, шапка, превью, заголовок с запасным id). `SimilarityBadge.tsx` — общий для вкладки и экрана 3.
- Экран 3: секция «Сходство с референсом» у выпуска с `reference_id` (перезапрос с каждым ответом плана),
  `ReferenceNote` над заявкой — режим и ссылка на референс, только чтение.
- Диалог «Новый выпуск»: «Из референса» ведёт на `/ideas?tab=reference` выбранного канала, выпуск не создаёт.
- `queries.ts`: `useReferences`, `useReference`, `useCreateReference`, `useReferencePrompt`,
  `useApplyReferenceAnswer`, `useCreateEpisodeFromReference`, `useSimilarity`, `useReferenceEpisodes`. Моки:
  референс артборда (22:41, 10 сегментов, 4 приёма), создание, разбор, выпуск, сходство.
- `ideas/index.tsx`: «Тренды» — в `TrendsTab`, иначе строка статуса родителя перетирала строку вкладки.
- Проверки: vitest 520 (новых 22, два полных прогона), oxlint, build, hex нет. e2e 40 из 47 — те же 7 снимков, что
  после M4.9. Вживую (бэкенд + `pnpm dev`, Playwright): ошибка формата под полем; «Референс сохранён: 3:00, 14
  реплик»; **ответ настоящего claude.ai** — 9 сегментов, карта, метрики (91 слово/мин против 150, 4,3 факта/мин,
  2 крючка), 6 приёмов; «Своя версия этой темы» → c01, заметка о референсе; план из 4 частей через мост — сходство
  0 %, норма; 12 кадров с фразами субтитров — 11.4 %, warning с пятью фразами на экране 3 и на вкладке.
- Нашлось и исправлено: превью показывало сырой SRT; заголовок без названия — теперь id без кавычек.
- **Нашлось, не исправлено (бэкенд в этапе запрещён):** настоящий чат процитировал субтитры в `topic` («the bottom
  of the hull»), `topic` для «Своей версии» уходит идеей в промпт плана — утечка одной 5-граммы (L-036). Структура
  от кода чистая; сходство VO при утверждении ловит копирование.
- Хвосты:
  - **бэкенд:** `review_analysis` отклоняет `topic`, подписи сегментов и приёмы с n-граммами субтитров (принцип 11);
  - ответ, отклонённый целиком, показывает путь дважды («ideas[1]: идея 2: …») — с M4.9;
  - `plan_next` без структуры референса — с M4.10.

### 40. M4.12 — Визуальная приёмка и e2e на моках (2026-10-12, ветка `m4-script-bridge`)

- Сквозные сценарии на моках API (1536, часы 12:41 МСК, буфер через `grantPermissions`):
  - `e2e/script.spec.ts`: Otto из бэклога → заявка → промпт части 1 из 2 в буфере → ответ чата → «Часть 1 принята» →
    часть 2 → план v001 на листе → правка VO «Сохранено 12:41» → «Утвердить план» → рельс на «Генерации»;
  - `e2e/ideas.spec.ts`: семя → идеи из чата (2 принято, повтор бэклога пропущен) → «В бэклог» → «Начать выпуск» →
    заявка из идеи; субтитры → разбор → карта из 6 сегментов → «Новая тема по этой структуре» → `structure_clone`.
- `e2e/chat.ts`: ответы чата из `e2e/fixtures/` (проза вокруг JSON, субтитры — свой текст), буфер; ответ вставляется
  `writeText` + Ctrl+V, не `fill()` (L-034). Моки путей экранов 2 и 3 хватило, `src/mocks/api.ts` не менялся.
- `visual.spec.ts`: ожидание данных экранов 2 и 3 в `open()`, новые эталоны `03-script-plan`, `03-script-json`,
  `02-ideas-reference`. Пересняты 7 (`02-ideas` × 3, `03-script` × 3, `overlay-new-episode`), всего **49 эталонов**;
  разбор по зонам и замеры против артбордов 2 и 3 — `docs/visual_review.md`, раздел «M4, экраны 2 и 3».
- Исправлено по сверке, отдельными коммитами:
  - таблица плана: `border-row` не утилита — рамка цвета текста; строка 29 → 28; многоточие в «Раздел» и «Герои».
    Страж — тест «каждая утилита цвета и рамки в исходниках собирается» в `tokens.test.ts` (L-037);
  - `ToastStack`: новый тост перезапускал таймеры соседей, тост импорта плана жил ~10 с поверх «Утвердить план»;
    теперь 4 с от появления каждого (L-038).
- Хвосты M4.7 закрыты сверкой: смета под факт-чеком в прокрутке и серая выключенная primary — как в артборде и
  `components.md`.
- Проверки: e2e 53 прошло / 40 пропущено, три полных прогона подряд; vitest 522; oxlint, build, `typegen:check`,
  `tokens:check`; бэкенд — pytest 428, ruff, mypy.
- Хвосты:
  - тосты (кит): место 16/16 поверх статус-строки против 12/36 во всех артбордах; на 1536 стек закрывает «Утвердить
    план» и в артборде — правка handoff (стек левее правой панели или над её подвалом); стек показывает три старых,
    свежий ждёт за «и ещё N» — `components.md` не говорит, какие три;
  - «Утвердить план» включена у выпуска на стадии «Монтаж» и отвечает отказом 409 — как задумано в M4.7, но кнопку
    можно выключать заранее.

### Приёмка M4 (2026-10-13, тег `m4`)

- [x] двенадцать этапов закрыты, коммит на каждый
- [x] `uv run pytest && uv run ruff check . && uv run mypy backend tests` — 430, чисто (после хвостов, раздел 41)
- [x] `pnpm -C frontend test --run && lint && build && typegen:check && tokens:check && e2e` — зелёные; эталоны
      пересняты только в M4.12, каждое изменение — строка в `docs/visual_review.md`
- [x] Anthropic из кода не вызывается: `grep` находит провайдер M2.6 и его регистрацию, а также поле ключа в
      `settings.py` и проверку его наличия в `api/bridge.py` — без вызовов; мост не пишет в `cost_ledger` —
      `test_bridge_api.py`, `test_plan_bridge.py`
- [x] **вручную с настоящим claude.ai** (2026-10-13, раздел 41): идеи, план частями, битые ответы, правки, смета и
      утверждение, референс, без ключа — все пункты устава
- [x] хвосты устава закрыты: `ProjectPatch` (M4.3), «Из бэклога идей» (M4.9), ⌘⇧1…⌘⇧3 и предупреждение о дубле
      сочетания (M4.4), смета пресета при мосте (M4.6); кэш ответов LLM и мышление Opus 5.5 — к API-сессии
- [x] `docs/LESSONS.md` пополнен: L-037, L-038

Тег `m4` — на коммите закрытия (раздел 41), PR #4 `m4-script-bridge` → `main`; слияние — за пользователем.

### 41. Закрытие M4: хвосты и ручная приёмка (2026-10-13, ветка `m4-script-bridge`)

- Хвосты, закрытые кодом (коммит `e2f6dfb`):
  - принцип 11: `review_analysis` отклоняет тему, подписи и приёмы с фразами субтитров (`similarity.quotes`, `n` из
    `config/reference.yaml`), шаблон `reference` v2 предупреждает чат; L-036 закрыт;
  - `plan_next` v2 несёт структуру референса — части 2…N продолжит и новый чат;
  - в «не повторять» промпта идей — и предложенные (`proposed`);
  - ошибки моста — `message` как есть, без приписки пути («ideas[1]: идея 2: …» ушло); контракт в `docs/bridge.md`;
  - `/api/bridge/runs`: неизвестная задача и `limit` вне 1…100 — 422 по-русски;
  - `seeds` всегда в ответе и `profile.json`, в TS обязательное;
  - тосты: 12 / 36 над статус-строкой, видны три новых (решения пользователя), эталон `overlay-toasts` переснят;
  - `SEED_COMMAND` в ошибках «канал не найден», команды в `CLAUDE.md`; `ruff format --check .` чист.
- Закрыты решением: ошибка создания в диалоге уже над подвалом; меню пустого слота с одним выключенным пунктом —
  приём; «Утвердить план» на «Монтаже» — артефакт мока (новая версия на поздних стадиях — M6); фокус сегмента
  «Claude API» и двойной `null` сброса движения — безвредны; сторож мёртвого бэкенда 35 с — устройство (L-023);
  старые хвосты M3 и M4.2 неактуальны.
- **Ручная приёмка M4** — живой бэкенд + `pnpm dev` на временном `STUDIO_DATA_DIR`, Playwright-скрипт, ответы
  настоящего claude.ai через файлы:
  - идеи: 6 из чата → «В бэклог» → «Начать выпуск» → c02 в «Идее», заявка из идеи;
  - план c01 из 4 частей (части 2–4 — в новом чате: конспект принятых работает) → `director/v001.json`, 100 кадров,
    9 разделов, 19:24, стадия «Сценарий»; `canon_ref` и `voice` — из кода; сходство с субтитрами 0 из 2 519;
  - битые ответы: обрезанный JSON, стилевой токен (`кадр s003: …`), чужой `episode_id` — отказы по-русски, на диск
    ничего;
  - правки: VO на листе → «Сохранено 09:57», после перезагрузки на месте; v002 из чата правку не затёрла, `stale`
    «План изменил vo, но действует ручная правка vo»; JSON → «Сохранено как v003», `source: manual`;
  - смета ~$11.34 со строкой «План — Мост через чат — $0» и остатком месяца; «Утвердить план» → «Генерация», карточка
    на доске; v004 после утверждения вернула «Сценарий», утверждённой осталась v003;
  - референс: разбор 8 сегментов прошёл проверку цитат → «Новая тема по этой структуре» → c03; в промпте части 2 —
    структура; план с VO из субтитров — сходство 100 %, «Утвердить» отказывает с фразами;
  - без ключа: «Claude API» выключен с подсказкой, запросы страницы — только `localhost:5173`.
- Нашлось: пользователь отдал идеи, часть 1 и разбор в один чат — утечки нет (0 %), но для выпуска не по референсу
  её нечем поймать; правило «один обмен — один чат, разбор — отдельно» — в `docs/bridge.md`. JSON-редактор на плане
  4 492 строки: ~180 мс на символ (подсветка мемоизирована по строкам, тормозит согласование ~9 000 элементов),
  замена текста 181 мс, проверка ~1 с — хвост ниже.
- Проверки: pytest 430, ruff (check, format), mypy; vitest 522, oxlint, build, `typegen:check`, `tokens:check`;
  e2e 53 + 40 пропусков, зелёные.

### 42. M5.1 — Схемы канона, черновики и версии (2026-10-14, ветка `m5-canon`)

- `models/canon.py`: `Style` (группы артборда 12: рендер, `optics`, `light`, `palette{rule, swatches}`, зерно и
  композиция, `negative_global`), `Period` (`years{from, to}`, списки, `forbidden`), `Character` (`nature{personality,
  posture, manner, face}`, `appearances[]`), `Appearance`. Одна модель на черновик и версию: поля пустые по
  умолчанию, скелет из `id` — годный черновик. Форма — 422 по-русски (`PydanticCustomError`), правила публикации —
  `publish_problems()`, 409 со всеми нарушениями через `\n`. Кириллица в полях промпта (всё, кроме `label`) и
  пустые позиции списков не публикуются.
- `storage/canon_store.py`: конверт `{based_on, published_at|saved_at, data}`; `publish` пишет `v<N+1>` через
  новый `atomic.write_json_new` (`os.link` — существующий файл не заменить) и удаляет черновик; черновик, равный
  последней версии, не публикуется; `draft_from` не затирает черновик; `resolve_style/period/appearance` →
  `CanonRefError` со строчной буквы (M5.2 приставит кадр). Пути слоёв и якорей — в `paths.py` (`check_appearance_id`).
- `api/canon.py`: сводка, `GET ?version=`, `PUT/POST/DELETE …/draft`, `POST …/publish` для `style`,
  `periods/{id}`, `characters/{id}`; `CanonError` → `{detail}` 404/409. Сверх этапа, по решению: `DELETE …/draft`
  и отказ публиковать неизменённый черновик. typegen: группы `canon` и `canon_draft` (L-031).
- Контракт — `docs/canon_schema.md`; строка карты в `CLAUDE.md`. L-007 закреплён валидатором и ушёл в архив.
- Живая проверка (uvicorn на временном `STUDIO_DATA_DIR`, seed): черновик эпохи без запретов → 409, `draft.json`
  на месте → с запретами `v001.json` → правка → `v002`, sha256 `v001` тот же; 422 по-русски; канон Otto не виден Cursus.
- Проверки: pytest 465 (+35 `test_canon.py`), ruff (check, format), mypy, `typegen:check`, `pnpm build` — зелёные.
- Хвосты: `jq` в WSL нет, а «Команды проверки» M5.x идут через `| jq` — живая проверка шла через `python3 -m
  json.tool` (поставить: `sudo apt install jq`). Существование эпохи облика (`appearance.period`) при публикации
  персонажа не проверяется — его проверит резолв `canon_ref` в M5.2. Черновик из старой версии публикуется
  новой версией (откат v001 → v003) — так задумано.

### 43. M5.2 — Канон выпуска: прибитые версии, «нужно каналу», перевод, ворота утверждения (2026-10-14, ветка `m5-canon`)

- `pipeline/canon/episode_canon.py`: снимок канона канала (`published_canon`: версии и черновики; у облика — версии
  персонажа, где он есть), правило версий `pin_*` (прибитое в прошлой версии плана → последняя опубликованная →
  `v001`), `updated_ref` для перевода, `episode_canon` (статусы `missing | draft_only | ready | outdated`, `resolved`,
  лист облика, проблемы `{kind, id, issue, message}`), `canon_needed`. Лист — заглушка `sheet_state` («нет листа»
  до M5.4).
- Мост (`plan_bridge.build_canon_ref`, часть 1 и `_extend_first_part_canon`) строит версии по правилу. Ручной импорт и
  «Сохранить как версию» (`api/director.py`) и `director/validate` — решение при плане: присланный `canon_ref` как
  есть, недостающие ключи — по правилу (`fill_canon_ref`); блока нет — ошибка валидации, как раньше.
- API: `GET /api/projects/{id}/canon` (`null` без плана), `POST …/canon/update` → новая версия `source: manual`,
  `stale` по `canon_reasons`, нечего переводить — 200 `created: false`; `GET /api/canon/{channel}/needed`, `POST
  …/needed/periods/{id}` и `…/appearances/{id}` — скелеты (облик дописывается в черновик персонажа; черновик — из
  последней версии; нет персонажа — создаётся). Стиль в «нужно каналу» не входит.
- Утверждение: проверка `canon` последней в `CHECKS`; у проблемы — `canon {kind, id, issue}` (`exclude_if`, L-033) для
  ссылок M5.10; сводка «Канон не готов: 1 эпоха не опубликована, у 2 обликов нет листа — экран «Канон».».
  Прибитая ссылка, которая не находит версию, сама не переносится: `outdated` + `unresolved`, чинит перевод.
- Сверх списка файлов: `api/director.py` (согласовано в плане), `api/episodes.py` (`load_sources` открыт,
  `channel_episodes`), `tests/conftest.py` — фикстура `no_canon_gate` для тестов M4 о других проверках утверждения.
- Контракты: `director_schema.md` («Откуда версии»), `project_schema.md` («Канон выпуска», перевод),
  `episodes.md` (проверка `canon`), `canon_schema.md` («Нужно каналу»). typegen: `EpisodeCanon` в `plan`,
  `CanonNeeded` в `canon`.
- Живая проверка (uvicorn, временный `STUDIO_DATA_DIR`, seed): план фикстуры через мост в 4 частях → `needed` —
  caribbean-1716 и you@powder-monkey-11 → утверждение 409 со списком из трёх → скелет и эпоха v001, v002 →
  «Сохранить как версию» с правкой VO — v002 плана на `periods/…/v001` → перевод — v003 на v002, 10 кадров `stale`
  с причиной → повтор — `created: false`. Ошибок в логе сервера нет.
- Проверки: pytest 490 (+20 `test_episode_canon.py`, +2 в мосте, +3 в утверждении), ruff, mypy, `typegen:check`,
  `pnpm build` — зелёные. Мутация правила прибитых версий валит оба теста правила.
- Хвосты: перевод и «Сохранить как версию» идут через `import_plan` и сбрасывают недособранный набор частей моста
  (так было и в M4) — предупредить на экране 3 (M5.10). Кадры без картинки (`queued`) после перевода тоже
  получают `stale` (правило мёрджа M2.4) — решить в M6, где появятся картинки. Хвост M5.1 «`appearance.period`
  против опубликованной эпохи» M5.2 не закрыл: резолв проверяет версию персонажа и наличие облика — к M5.5
  (сборщику нужна эпоха облика) или M5.8.

### 44. M5.3 — Картинки Gemini: вызов с референсами, ассеты уровня канала, этап `anchors` (2026-10-16, ветка `m5-canon`)

- `providers/gemini.py::call` — `models.generate_content`: текст промпта (negative — фразой `Avoid: …`, отдельного
  параметра у Gemini нет), затем референсы `Part.from_bytes`; `image_size` из `params.size` маршрута, `aspect_ratio` и
  `seed` из запроса. «Thought images» не берутся и не оплачиваются. Отказ по содержанию (`blockReason`,
  `finishReason`) — `ProviderError` с подсказкой, без повтора; ошибки API — `status_error()` по телу (L-018), сеть —
  `TransientError`.
- Референсы: `ImageRef {path, sha256}` (`Gateway.image_ref`), в хэш входов — только sha256. Шлюз до вызова: лимит
  `max_refs` маршрута (`RouteError`, без обрезки), только файлы канона своего канала, сверка хэша, MIME по сигнатуре;
  провайдер получает `RefImage` байтами. Из кэша — без чтения референсов.
- Уровень канала: `CallContext(channel=…, stage="anchors")` без выпуска → файл в `canon/cache/<этап>/` или в
  `asset_dir` внутри канона; `assets` и `cost_ledger` — без `episode_id`; бюджет — только месячный канала.
  Миграция `009_channel_assets.sql`: `assets.channel NOT NULL`, `episode_id NULL` (таблица пересобрана, канал старых
  строк — из выпуска). Кэш по `(kind, input_hash)` общий.
- `config/providers.yaml`: этап `anchors` — `nb-pro-1k` (`gemini-3-pro-image`, 1K) во всех профилях; `max_refs: 14` у
  всех моделей картинок (разбивка Pro 6/5/3 — в `docs/providers.md` для M5.5).
- Живая проверка: VPN в WSL (Gemini без него недоступен — настроил пользователь) → `-k key_is_accepted` (63 модели) →
  `-k anchors`: 1K 1024×1024 с однотонным референсом, цвет чашки совпал с образцом; журнал — `charged anchors
  gemini-3-pro-image 1K $0.13 None`, затем `cached $0`, второго POST нет (`cache hit`). Первый прогон упал: Pro отдаёт
  **JPEG** с C2PA, а не PNG (L-039); `output_mime_type` в Developer API нет — файл `.jpg` по MIME ответа, тест принимает
  PNG и JPEG. Потрачено $0.26 (два прогона).
- Проверки: pytest 517 (+27: `test_gateway_images.py` 14, вызов Gemini в `test_providers.py` 13), ruff, mypy.
- Хвосты: M5.4 — лист опорных портретов будет из `.jpg`; не искать `*.png`. В `CLAUDE.md` («Структура»: «6 png»)
  формат листа не совпадает с тем, что отдаёт модель, — поправить формулировку при закрытии модуля или в M5.4.
  `.wslconfig` в корне репозитория (`dnsTunneling=false`) и снятые запреты `git push --force` в
  `.claude/settings.json` в коммит M5.3 не вошли — решить пользователю.

### 45. M5.4 — Листы опорных портретов и кадры стиля (2026-10-16, ветка `m5-canon`)

- `pipeline/canon/anchors.py`: заказ (`AnchorOrder`) собирает код из опубликованных версий канона и шаблонов
  `prompts/anchor_sheet.md` / `style_anchor.md` (`task: image`). В заказе по каждому кандидату: промпт, negative
  `global ∪ forbidden ∪ local`, seed от хэша (облик, версия, ракурс, n), соотношение сторон. Заказ целиком лежит в
  payload. Набор: `candidates/`, `rejected/`, `sheet.json` (все кандидаты), `chosen.json`. Выбор и отбраковка (файл
  и строка `assets` переезжают в `rejected/`). Состояние и устаревание по ракурсам; канон выпуска M5.2 теперь читает
  настоящий лист против прибитой версии.
- Джобы `anchor_sheet`, `anchor_angle`, `style_anchors` (`jobs/handlers/anchors.py`): сбой кандидата — `failed` у
  кандидата; сеть — повтор джоба, готовое из кэша; оба фаса не удались — остальные `failed` без вызовов. Один набор —
  один джоб. Бюджет канала проверяется до очереди. Миграция `010`: `jobs.channel`, оценка джоба канала в очереди
  занимает месячный бюджет.
- API (`api/canon.py`): лист, смета (лист / ракурс / стиль), сборка, перегенерация, выбор, отбраковка, копия облика
  (`canon_store.copy_appearance`), кадры стиля. `config/canon.yaml`: 6 ракурсов с подсказками артборда, `candidates: 2`,
  6 шаблонов кадров стиля.
- Решения пользователя (план этапа): `hair` и `age` устаревают весь лист, `wear` — три ракурса одежды; лист берёт из
  стиля рендер, материал, обработку, палитру и зерно (без света, оптики, композиции); копия облика переносит `face`,
  `build`, `hair`, `age`, `negative_local`. Решения этапа: фас-референс — первый удавшийся по времени, а не по номеру
  (L-041); смета — сверху, кэш не вычитается; модели ответов — в `pipeline/canon/anchors.py` и
  `jobs/handlers/anchors.py`: из `models/` шёл бы цикл импортов через `script.estimate`.
- Сверх списка файлов: `main.py`, `api/deps.py` (`canon.yaml`), `jobs/queue.py`, `cost/budget.py`, `storage/paths.py`,
  `pipeline/bridge/prompts.py` (`task: image`, плоский `Literal`), `tools/gen_schema.py`, `providers/fake.py`
  (картинка с сигнатурой PNG — годна референсом), `tests/fixtures/config/canon.yaml`. По живой проверке —
  `providers/base.py::network_error` в Gemini, Anthropic, ElevenLabs (L-040). Документы: `canon_schema.md`,
  `jobs.md`, `providers.md`, `bridge.md`, `episodes.md`, `project_schema.md`.
- Живая проверка (uvicorn, временный `STUDIO_DATA_DIR`, seed, канон фикстуры через API, настоящий Gemini Pro):
  - без канона — 409; смета $1.61 / $0.27 / $0.80; лимит $1 — отказ до очереди, строка `refused`, джоба нет;
  - лист: прогресс по SSE («Кандидат 11 из 12 · Деталь, 1»). На 11-м кандидате VPN моргнул: `ConnectError`, текст
    ошибки был пустым → `network_error`. Повторы и перезапуск брали готовое из кэша (60 строк `cached`, $0). После
    восстановления — 12/12, все 10 ракурсов с референсом `front-1`; картинки — один и тот же мальчик на сером фоне;
  - выбор шести → `chosen.json`, «готов 6/6»; «Профиль» — два новых файла, хэши 12 прежних те же, `chosen.json` тот
    же; выбор нового профиля меняет один ракурс; отбраковка → `rejected/`; повтор листа — 12 `cached`, $0;
  - итог: 14 картинок × $0.134 = $1.88 в `cost_ledger` этапа `anchors` без выпуска — как в смете.
- Проверки: pytest 535 (+17 `test_anchors.py`, +1 сеть в `test_providers.py`), ruff, mypy, `typegen:check`,
  `pnpm build`. Мутации правила устаревания одежды и переноса строки `assets` при отбраковке валят тесты.
- Хвосты:
  - M5.9: отдача файла картинки по пути от `data/` для экрана листа — эндпоинта нет.
  - M5.5/M6: на живом листе «leather cartridge case» нарисован патронташем с гильзами, бриджи — как брюки со
    шлёвками. Запреты эпохи в negative есть, но этого мало — проверка анахронизмов (M6) и, возможно, формулировки
    реквизита в каноне.
  - Кадры стиля вживую не собирались (в приёмке этапа их нет) — приёмка модуля.
  - `CLAUDE.md` «6 png» (L-039); `.wslconfig` и снятые запреты `git push --force` в `.claude/settings.json` — в
    коммит не входят, решает пользователь.

### 46. M5.5 — Сборщик промпта и предпросмотр кадра (2026-10-16, ветка `m5-canon`)

- `pipeline/images/prompt_builder.py → build_shot_request`: запрос картинки кадра из канона выпуска (`canon_ref`) и
  действия действующего плана. Секции `style → period → appearance… → action → shot_size` через пустую строку, у
  каждой источник; тексты — те же функции, что у листа M5.4 (стиль и эпоха в кадре целиком). Шапки называют номера
  референсов («Person 2 (reference images 5–8)»). Negative по слоям без повторов, seed от выпуска, кадра, ссылок
  канона и действия, хэш — `input_hash` шлюза по маршруту `images` профиля по умолчанию.
- Референсы: выбранные ракурсы листа по крупности + до двух кадров стиля (`config/canon.yaml → shots`, модель и
  проверка — `models/canon_config.py`). Лимит модели: уходят кадры стиля, затем ракурсы сверх фаса с последнего
  облика; фасы не влезают — проблема. Кадры стиля другой эпохи или устаревшие — предупреждение (решение
  пользователя).
- Проблемы по-русски с id кадра, без исключений: ссылка не резолвится, облика нет в `canon_ref`, лист не готов,
  стилевой токен, фасы не влезают. С проблемами запроса и хэша нет.
- `GET /api/projects/{id}/shots/{shot_id}/prompt` (`api/plan.py`): секции, текст, negative, референсы и ушедшие,
  seed, модель, цена кадра до десятых цента; плана нет — 409, кадра нет — 404. typegen: `ShotPrompt` в `plan`.
- Найден и исправлен дефект M5.4: пересборка кадров стиля в прежней эпохе брала файлы из кэша, но не возвращала
  выбор (`record_candidate`, L-042) — тест в `test_anchors.py`, мутация его валит.
- Контракт: `docs/prompt_assembly.md` (порядок, разделители, negative, референсы, seed, хэш, проблемы, предпросмотр,
  три примера, полученные сборщиком); карта `CLAUDE.md`; `canon_schema.md` (авто-выбор кадров стиля).
- Сверх списка файлов: `models/canon_config.py`, `tools/gen_schema.py`, `pipeline/canon/anchors.py` (дефект выше),
  фикстуры `director_canon_20shots.json` (20 кадров, 5 — с двумя персонажами, 4 — без) и `canon/character_bosun.json`.
- Живая проверка (uvicorn на каталоге данных M5.4 с настоящим листом 6/6, бесплатно): выпуск `c01`, пиратский план
  (`canon_ref` — только стиль, остальное прибил импорт на v001) → `…/shots/s003/prompt` — секции с источниками,
  4 ракурса листа, `gemini-3.1-flash-image` $0.067, проблем нет, два предупреждения «кадра стиля нет»; s010 с
  `you@captain-35` — «кадр s010: у облика you@captain-35 нет листа…», хэша нет; повтор s003 — тот же хэш; s999 —
  404. Ошибок в логе нет.
- Проверки: pytest 547 (+12 `test_prompt_builder.py`, тест кадров стиля в `test_anchors.py` расширен), ruff, mypy,
  `typegen:check`, `pnpm build`.
- Хвосты: профиль качества кадра — профиль по умолчанию, выбор на пачку и кадр — M6; привязка ассета к кадру при
  попадании в кэш — M6 (L-042); на экране предпросмотр — M5.10.

### 47. M5.6 — Эпоха через мост: черновик и «Дополнить запреты» (2026-10-16, ветка `m5-canon`)

- Задача моста `canon_period` (`BridgeTask`, `PromptTask`; `CHECK` на `task` в `bridge_runs` нет — миграция не
  нужна). Шаблон `prompts/canon_period.md` v1: один шаблон на оба режима, `{{mode}}` выбирает правила. Только факты
  времени и места, категории стоп-листа словами, `label` — по-русски, остальное — по-английски, не меньше 10 запретов.
- `pipeline/canon/period_bridge.py` (чистые функции): контекст — канал, формат, выпуски, чьи планы ссылаются на
  эпоху (идея, угол, кадры), текущая эпоха; стиля в контексте нет. Приём — строгая форма режима, все ошибки сразу,
  `path` вида `forbidden[3]`: кириллица вне `label`, стилевой токен (`find_style_tokens`), пустая строка, меньше 10
  запретов. `draft` заполняет пустые поля и возвращает «чат предложил иначе»; `forbidden` добавляет новые без
  повторов (регистр, артикли, пробелы, знак в конце) — «Добавлено N, повторов M».
- API (`api/canon.py`): `POST …/periods/{id}/prompt?mode=` и `…/answer?mode=` — режим параметром (решение
  пользователя); журнал с `target_id` = эпоха, ответ без обмена — `record_answer`; `forbidden` без эпохи — 409.
  Сбор планов канала для «нужно каналу» и для промпта эпохи — общий `_channel_plans`.
- Решения пользователя: режим ответа — параметром; заполненный `forbidden` в `draft` не объединяется, а уходит в
  «чат предложил иначе».
- Сверх списка: `tools/gen_schema.py` (`PeriodPrompt`, `PeriodAnswerResult`, `PeriodAnswerBody`), ожидание текста
  в `tests/test_bridge_api.py` (список задач в отказе собирается из `BridgeTask`). Документы: `bridge.md`
  («Эпоха», таблицы задач и журнала), `canon_schema.md` («Черновик эпохи из моста»).
- Живая проверка (uvicorn, временный каталог, стиль канала и выпуск «Галера» на `venice-1570`, настоящий claude.ai в
  новом чате): «нужно каналу» — venice-1570, 10 кадров → промпт `draft` → ответ принят с первого раза: 10 полей,
  21 запрет, `applied` → промпт `forbidden` в том же чате → «Добавлено 52, повторов 0» (73 запрета) → «Опубликовать»
  → `periods/venice-1570/v001.json`. «Нужно каналу» пуст, `cost_ledger` — 0 строк, стиля и обликов мост не тронул,
  ошибок в логе нет.
- Проверки: pytest 558 (+11 `test_period_bridge.py`), ruff, mypy, `typegen:check`, `pnpm build`.
- Хвосты:
  - смысловые повторы запретов: чат прислал «Rialto stone arch bridge» при «Rialto stone bridge» и вторую гондолу с
    `ferro` — текстовое правило задания их не ловит. Подсветка «похоже на …» (rapidfuzz уже в стеке) — экран
    «Периоды» (M5.8), там же человек чистит черновик перед публикацией (L-036, «Повтор»);
  - в живых запретах есть спорные позиции (`felze` гондолы в 1570 уже был) — проверка фактов эпохи — дело человека
    при публикации, на экране M5.8.

### 48. M5.7 — Экран «Канон»: слой «Стиль», версии, опорные кадры стиля (2026-10-16, ветка `m5-canon`)

- Экран 12 (`screens/canon/`): слои «Стиль / Периоды / Персонажи» в заголовке, ⌘⇧1…⌘⇧3 (группа «Канон» в
  `GROUP_ORDER`, L-028), слой — в адресе `?layer=`; «Все каналы» — «Выберите канал», как экран 2. Шапка приложения
  на экране 12 — «Канон», «уровень канала, не выпуска»; правая панель `anchors` 480 (хвосты M1.6 закрыты).
- Слой «Стиль»: группы артборда, палитра с образцами (`style={{ background }}` из данных), negative чипами. Правка
  шапки — черновик автосохранением (`canon:<канал>:style`, один PUT); «Опубликовать vN» — подтверждение со списком
  изменений, отказ 409 построчно; старая версия — только чтение и «Создать vN из vM»; «Сбросить черновик» в меню
  версии с «Отменить» в тосте; история и «Сравнить с vN» — построчно, изменённые поля помечены.
- Панель «Опорные кадры стиля»: шесть шаблонов со статусом, выбор опубликованной эпохи, «Пересобрать (6, ~$0.80)» —
  цена из сметы, отказ бюджета текстом, прогресс по SSE, «устарели» после рендера, оптики, света.
- Бэкенд отдельным коммитом (`ad7c055`, L-043): `channel` в `Job` и событии SSE, `GET …/style/anchors/estimate`.
- Сверх списка: `api/client.ts` (`delete`), `app/labels.ts` (виды джобов опорных), `app/StatusBar.tsx` (подсказки не
  сжимаются), `ui/Textarea.tsx` (`autosize`), `KeyboardHelp.tsx`, фейк `fetch` и e2e-мок — 204 без тела.
  `tokens.test.ts`: hex разрешён только значением поля `hex` образца — данные канона, а не цвет интерфейса.
- Живая проверка (uvicorn + `pnpm dev`, временный каталог, эпоха `caribbean-1716` через API): стиль руками → v001 →
  правка света → v002 → «Сравнить с v001» — «1 поле из 14 изменено: Направление света»; v001 — только чтение, полей
  ввода нет; месячный лимит $0.50 — отказ текстом, джоба нет, в журнале строка `refused`.
  «Пересобрать (6, ~$0.80)» в Карибах на настоящем Gemini Pro (согласие пользователя): прогресс в панели и
  статус-строке по SSE «Кандидат N из 6», ~2 мин; «6 кадров, версия v002», `chosen.json` — шесть JPEG на v002; в
  `cost_ledger` 6 строк `charged` этапа `anchors` без выпуска, $0.80. Кадры читаются по канону: свет сверху через
  решётку (правка v002), один практический источник, одно насыщенное пятно. Ошибок в логе нет.
- Проверки: vitest 534 (+12 `style.test.tsx`), oxlint, `build`, `typegen:check`, `tokens:check`; pytest 559; e2e —
  50 эталонов без изменений, `12-canon` × 3 расходятся (пересъёмка — M5.11).
- Хвосты: картинки кадров стиля на экране — с эндпоинтом отдачи файлов в M5.9; число выпусков на версии и «что
  изменилось» в истории — данных нет в API (`docs/visual_review.md`).

### 49. M5.8 — Слои «Периоды» и «Персонажи» (2026-10-17, ветка `m5-canon`)

- Бэкенд отдельным коммитом (`8489f33`): в сводке канона у эпохи `region`, `years` и `episodes` (выпуски, чьи
  текущие планы её используют), у персонажа `sheets_ready`; `uses_period`, `canon_overview`.
- Механика версий трёх слоёв — `LayerWorkspace.tsx`: черновик с автосохранением `canon:<канал>:<путь>`, только
  чтение, сравнение, история, публикация с 409, «Создать из», сброс с «Отменить». Стиль M5.7 переведён на неё, его 12
  тестов зелёные (правка — только ожидание форм «Эпоха» и «Персонаж» по ⌘⇧2/3). Хуки `useCanonDoc`…`usePublishCanon`
  общие для слоёв; `ChipList.tsx`, `canonFields.ts`.
- «Периоды»: список с глифом и «нельзя использовать: нет запретов», карточка — подпись, регион, годы, шесть групп
  чипами, запреты (пустые — красным), подсказка повтора по словам; «Новый период» и «Дублировать» с близкой эпохи.
  Мост: у пустой эпохи «Скопировать промпт эпохи» — главное действие, «Чат предложил иначе» для полей человека,
  «Дополнить запреты» → «Добавлено N, повторов M».
- «Персонажи»: список с листами, «Неизменяемое», облики карточками 3:4 со статусом листа и ценой, «Кадры с этим
  обликом не генерируются», форма облика, «Новый облик», «Скопировать облик в другой период» («Переносится» /
  «Заполняется заново»). «Нужно каналу» — правая колонка обоих слоёв: «Создать» скелет или «Открыть».
- Кит: список `Select` в `Dialog` с M1.2 был под подложкой и мышью не выбирался (L-044) — z-60, тест в
  `select.test.tsx`. Сверх плана файлов: `canonFields.ts`, `ChipList.tsx`, `LayerWorkspace.tsx` (вместо
  `useCanonLayer.ts`), `ui/Select.tsx`, `CopyPrompt` (`variant`), `ScreenLayout` (`kind: 'canon'`).
- Живая проверка (uvicorn + `pnpm dev`, временный каталог; план c01 через мост ответами фикстуры): «Нужно каналу» →
  скелет `hadrian-wall-122` → промпт эпохи в новый чат claude.ai (пользователь) → черновик: 8 полей, 18 запретов,
  «Чат предложил иначе: Годы 122 — чат: 120–125» (годы вписаны руками до вставки) → «Дополнить запреты» в том же
  чате: «Добавлено 31, повторов 0», подсказка «chimneys» / «oil lamps with glass chimneys» → v001, 49 запретов, «Все
  эпохи из планов уже опубликованы». Персонаж you: два облика из «Нужно каналу», «Новый период» `dacia-106` с вала
  (7 списков перенесены), копия `you@legionary-19-dacia` — face, build, hair, age, negative побайтово, одежда
  пустая; публикация — отказ «без названия», после подписи v001. `cost_ledger` — 0 строк, ошибок в логе нет.
- Проверки: vitest 551 (+17), oxlint, `build`, `typegen:check`, `tokens:check`; pytest 561, ruff, mypy; e2e — 50
  эталонов без изменений, `12-canon` × 3 расходятся (пересъёмка — M5.11).
- Хвосты: факты ответа чата проверяет человек — в живом ответе спорны «turnips» и «pocket sundials» (у римлян были);
  смысловой повтор другими словами («red Roman cloaks…» и «…red tunic-and-shield uniform…») сравнение по словам не
  ловит (L-036); `Tooltip`, `Popover`, `DropdownMenu` (z-40) окажутся под подложкой, если попадут в диалог; тест
  M5.7 «Опубликовать v004» (ожидания по 1 с) раз упал под нагрузкой; тост вставки «сравните на экране «Канон»» на
  самом экране «Канон» — текст бэкенда M5.6; фас облика и кадры стиля картинками — M5.9.

### 50. M5.9 — Лист опорных портретов на экране (2026-10-20, ветка `m5-canon`)

- Сверка контракта M5.4 с экраном — бэкенд отдельным коммитом (`f0fac9a`):
  - миниатюры webp 160/320 по id кандидата `GET …/anchors/{облик|style}/{кандидат}/thumb`, лениво в `thumbs/`
    (`storage/thumbs.py`, зависимость `opencv-python-headless`), и из `rejected/`;
  - фас-референс — выбранный фас, пока не менялись лицо, телосложение, волосы, возраст: до этого любая новая версия
    персонажа давала 409 на «Перегенерировать ракурс» (L-045);
  - `POST …/anchors/stale` — устаревшие ракурсы одним джобом `anchor_angle` (на набор — один джоб), строка сметы
    `stale` («3 ракурса × 2 кандидата», $0.80). Решения пользователя: так, а не «весь лист» или по одному ракурсу;
    клик по карточке облика выбирает облик и открывает лист.
- Экран: `AnchorSheet.tsx` — полноэкранный слой `?sheet=`, шапка «готов 6/6», баннер устаревания с причиной бэкенда,
  сетка 3 × 2, подвал с «Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)», прогресс и «Отменить».
  `AnchorAngle.tsx` — плитки-миниатюры, выбор, «Отбраковать» у кандидата, «Отбракованные (N)», «рисую / в очереди»
  из порядка заказа и `progress`. Тосты по концу джоба — `sheetJobs.ts` (сумма из `GET /api/jobs/{id}`). Джоб листа
  находится по `payload.target` (`useSheetJob`). На карточке облика и в кадрах стиля — миниатюры.
- `live.ts`: прогресс джоба канала раз в секунду перезапрашивает наборы опорных — кандидаты видны по ходу; конец
  любого джоба — сводки расходов: шапка оставалась «$0» после трат, найдено вживую (L-046).
- Моки: листы изменяемые, устаревание по правилу бэкенда, у Капитана v002 с другим лицом; сборка, перегенерация,
  `/stale`, выбор, отбраковка, `GET /jobs/{id}`, отмена, SVG-миниатюры (`MockResponse.contentType`, `e2e/api.ts`).
- Живая проверка (uvicorn + `pnpm dev`, временный каталог, канон из фикстур): пустой лист, Esc, перезагрузка с
  `?sheet=`, 409 «нужен фас» текстом, отказ бюджета до очереди — бесплатно; настоящий Gemini Pro (согласие, $1.88):
  12 кандидатов по ходу сборки, сбоев 0, тост «Лист собран, списано $1.61», выбор шести → «готов 6/6» на карточке с
  фасом, «Перегенерировать ракурс» «Профиль» → кандидаты 3 и 4, тост «$0.27». На диске 14 кандидатов и 14 миниатюр,
  `chosen.json` — шесть ракурсов v001, `cost_ledger` — 14 строк `charged` этапа `anchors` без выпуска, $1.876.
- Проверки: vitest 560 (+9), oxlint, `build`, `typegen:check`, `tokens:check`; pytest 566 (+5), ruff, mypy; e2e — 50
  эталонов без изменений, `12-canon` × 3 расходятся (миниатюры кадров стиля; пересъёмка — M5.11).
- Хвосты: полный vitest на 16 воркерах при загруженной машине (другие сессии, 7 ГБ памяти) — 2…30 таймаутов 5 с в
  тяжёлых тестах экранов, так же и на `f0fac9a` до правок фронта; с `--maxWorkers=6` — 560/560 дважды подряд;
  частичное устаревание вживую не прогонялось (тесты бэкенда и моков есть); строка списка персонажей у устаревшего
  листа пишет «лист не собран» (`characterMeta` смотрит только `sheets_ready`).

### 51. M5.10 — Канон на экране «Сценарий и план» (2026-10-21, ветка `m5-canon`)

- Сверка контракта с экраном: `GET …/canon`, `POST …/canon/update`, `GET …/shots/{id}/prompt` есть с M5.2 и M5.5,
  бэкенд не менялся. Расхождения: адреса экрана 12 в задании (`&id=`) — взяты из кода M5.8/M5.9; `ShotPrompt.problems`
  — строки без адресата, ссылку экран ставит по id сущности кадра в тексте (`ShotPrompt.tsx::problemLink`).
- Экран 3: `CanonPanel.tsx` — «Канон выпуска» над сметой: стиль, эпохи, облики — прибитая версия и статус, у облика
  лист ссылкой на `?sheet=`; «Перевести на новые версии» — только через подтверждение со списком «эпоха …: v001 →
  v002, 20 кадров», тост «План v002 на новых версиях канона: 20 кадров stale». `ShotPrompt.tsx` — Dialog lg (решение
  плана: промпт — тысячи знаков): секции с источником, итоговый текст, negative, референсы, seed, модель, цена;
  проблемы — со ссылками. Вход — иконка 16 в строке движения листа и ячейка в таблице, третья в сетке ←→ (тест
  таблицы сдвинут на ячейку). `ApprovePlan` — проблемы `canon` ссылками на экран 12, у `unresolved` ссылки нет.
  Статус-строка — `canonNote`. Адреса и строка канона — `canonLinks.ts`, ссылка — `CanonLink.tsx`.
- Запросы: `qk.episodeCanon` — под префиксом канона канала (публикация и конец джоба листа перезапрашивают), в ключе
  версия плана; `qk.shotPrompt` — под `qk.plan`. Моки: канон выпуска из кадров плана по правилам `episode_canon`
  (по умолчанию готов, отличия — `api.canon.episodes`), проверка `canon` в «Утвердить план» со сводкой, перевод,
  предпросмотр.
- Живая проверка (uvicorn + `pnpm dev`, временный каталог, канон фикстур, листы записями M5.4 — $0): боцман 3/6 →
  «Канон: 1 из 2 обликов без листа» → отказ со ссылкой → лист → выбраны три ракурса → «готов»; предпросмотр s002 —
  `style/v001`, `periods/caribbean-1716/v001`, `characters/you/v001#powder-monkey-11`, 6 референсов, ~$0.067 →
  «План v001 утверждён»; эпоха v002 → «есть v002» → подтверждение → 20 кадров stale с причиной «Эпоха
  caribbean-1716: periods/…/v001 → periods/…/v002», «Утвердить снова», стадия `script`; вход из таблицы клавиатурой.
  e2e-дифф нашёл обрезанную «отъезд 1.12×» на поле листа — IconButton 24 заменён кнопкой размером с иконку.
- Проверки: vitest 570 (+10) с `--maxWorkers=6` дважды, oxlint, `build`, `typegen:check`, `tokens:check`; e2e —
  расходятся `03-script` × 3, `03-script-plan`, `03-script-json` (секция канона, иконки входа) и `12-canon` × 3 (с
  M5.9) — пересъёмка в M5.11.
- Хвосты: полный vitest на 16 воркерах — таймауты 5 с (чистый HEAD — 4, с этапом — 10; L-047), `maxWorkers` в
  `vitest.config.ts` — решить; `ShotPrompt.problems` без адресата — поле `canon`, как у `ApprovalProblem`, убрало бы
  разбор текста; живой перевод при смене стиля и облика не прогонялся (тесты моков есть).

### 52. M5.11 — Визуальная приёмка, e2e на моках, приёмка модуля M5 (2026-10-21, ветка `m5-canon`)

- Сессия оборвалась на лимите после шагов 1–2 плана; продолжена по транскрипту и `git diff` (L-030): vitest 570/570
  на незакоммиченных моках, потом дальше по плану. `maxWorkers: 6` в `vite.config.ts` — отдельный коммит (L-047).
- Моки: канон выпуска считается из канона канала (`canonFacts`): прибитые версии по выпуску (`episodePins`) ставятся
  при создании версии плана по правилу M5.2, перевод их двигает, план «Пиратов» создаётся при старте мока; отличия
  vitest (`CanonTweak`) — поверх. Мок стал честнее и уронил сквозной M4.12: у Otto в моках стиля нет — сценарий теперь
  публикует его сам (L-048).
- e2e: `canon.spec.ts` (Samurai: отказ утверждения → «Нужно каналу» → промпт эпохи в буфере → ответ с прозой →
  v001 → облик → лист с прогрессом по SSE → 6/6 → перевод → «План v002 утверждён», ~17 с), `canon-version.spec.ts`
  («Пираты»: стиль v004 → «есть v004» → перевод → 8 кадров stale с причиной, ~9 с), `events.ts` — фейковый
  `EventSource` и `emitJob`. Трасса (L-038): дольше секунды — первая загрузка и «Утвердить план» под тостом перевода
  (до 4 с, как в M4.12); 7,4 с на клике по карточке облика в первом прогоне — нагрузка машины, во втором нет.
- Сверка с артбордом 12 (замер DOM, `file://`): одно исправление — строка списка персонажей «лист не готов» вместо
  «лист не собран» у устаревшего листа (хвост M5.9), отдельный коммит; остальное совпадает или решено в M5.7–M5.10 —
  `docs/visual_review.md`, раздел M5.11.
- Эталоны: пересняты 8 (`12-canon` × 3 — прежний был заглушкой M1.6, `03-script` × 3, `03-script-plan`,
  `03-script-json`), новые 4 (`12-canon-periods`, `12-canon-characters`, `12-canon-sheet`, `03-script-canon`);
  всего **53**. e2e три раза подряд — 59 passed.
- Приёмка модуля — где проверено вживую:

  | Пункт | Где |
  |---|---|
  | канон из планов, «Нужно каналу», скелеты | M5.2 (API), M5.8 (экран) |
  | эпоха через настоящий claude.ai, «Дополнить запреты», v001 | M5.6, M5.8 |
  | стилевой токен в ответе эпохи — отказ по-русски | M5.11: «materials[0]: стилевой токен «oil painting» (medium)…», «light_sources[0]: … «cinematic lighting»», черновик пуст |
  | стиль руками → v001 → v002, кадры стиля настоящим Gemini | M5.7 ($0.80) |
  | кадры стиля v001 устаревают после v002, выпуск на v001 не тронут | M5.11: «Кадры стиля устарели: в v002 изменились light.direction», выпуск — v001, 0 stale, «есть v002» |
  | лист настоящим Gemini, прогресс SSE, выбор, перегенерация, отбраковка, кэш | M5.4 ($1.88), M5.9 ($1.88) |
  | новая версия облика с другим лицом → «Лист устарел, пересоберите» | M5.11: баннер «в v002 изменились nature.face», API `outdated 6/6` |
  | копия облика в другую эпоху — лицо побайтово, лист пустой | M5.8 |
  | экран 3: канон выпуска, отказ со ссылками, предпросмотр, перевод → stale | M5.10 |
  | бюджет меньше цены листа — отказ до очереди | M5.4, M5.7 |

  Живая проверка M5.11 — $0: uvicorn + `pnpm dev`, временный каталог, канон фикстур, лист и кадры стиля записями;
  выпуски c09 (план 20 кадров) и c10 (Samurai с эпохой edo-1650). Ошибок в журнале сервера нет. Тест побайтовой
  неизменяемости — `test_period_draft_publish_and_versions_are_immutable`; эпоха без `forbidden` — 409
  (`test_period_without_forbidden_is_409_and_draft_kept`, L-007); задачи моста — `BridgeTask` = `plan`, `ideas`,
  `reference`, `canon_period` (`anchor_sheet`, `style_anchor` — шаблоны картинок, `task: image`); хвосты устава
  (панель 480, шапка «уровень канала») закрыты в M5.7.
- Хвосты: сводка канона на персонажа знает только `sheets_ready` — устаревший и несобранный лист в списке
  неразличимы (поле статусов листов в `CanonCharacterItem` — бэкенд); карточка облика сразу после публикации новой
  версии персонажа долю секунды показывает прежний статус листа, до перезапроса.

### 53. Хвосты M5 перед PR (2026-10-21, ветка `m5-canon`)

Решения пользователя: хвосты с назначенным модулем — в устав своего модуля (M6 — в `docs/tasks/M6.md`); скорость
JSON-редактора — в M6; локальная правка `.claude/settings.json` (снятые запреты `git push --force`) остаётся вне
коммитов.

- **Закрыто кодом:**
  - сводка канона считает `sheets_outdated`: строка списка персонажей — «лист устарел» с глифом warning, как
    карточка облика (хвосты M5.9, M5.11);
  - `ShotPrompt.problems` — `{message, canon?}` с адресатом, как у `ApprovalProblem`. Экран больше не разбирает
    текст, у «ссылка не находит версию» ссылки нет, как в отказе утверждения; проп `canon` у предпросмотра убран
    (хвост M5.10);
  - перевод на новые версии и «Сохранить как версию» сбрасывают недособранный набор частей моста — теперь
    предупреждение до клика (`planParts.ts`, хвост M5.2). Мок сбрасывает части при импорте, как бэкенд;
  - `Tooltip`, `Popover`, `DropdownMenu` — z-60, выше подложки диалога, как `Select` (хвост M5.8, L-044);
  - текст вставки эпохи «сравните на экране «Канон»» на самом экране «Канон» → «сравните в списке «Чат
    предложил иначе»» (хвост M5.8);
  - публикация канона ждёт перезапрос сводки: карточка облика сразу после тоста показывает новый статус листа,
    а не прежний «готов 6/6» (хвост M5.11);
  - `CLAUDE.md`: «6 png» → «6 картинок, формат — от модели» (хвост M5.3, L-039).
- **Закрыто раньше этапами** (в хвостах оставались формально): отдача картинок — M5.9; кадры стиля вживую — M5.7;
  предпросмотр на экране — M5.10; подсветка повторов запретов — M5.8; `maxWorkers` — M5.11; эпоха облика при
  публикации персонажа: публикация разрешена, лист без опубликованной эпохи — 409 с текстом (`sheet_canon`, M5.4).
- **Живая проверка** ($0, uvicorn + `pnpm dev`, временный каталог, записи листов): стиль v002 при недособранном
  наборе частей → в подтверждении «Набор частей из чата не закончен (принята 1 из 2) — перевод его сбросит…» →
  перевод → части `[]`, у s001 «Стиль канала: style/v001 → style/v002»; одежда юнги → «Cursus · 3 облика · 1
  устарел» с warning, карточка сразу «устарел 6/6», баннер «Достаточно пересобрать: в полный рост, в действии,
  деталь» и «Пересобрать 3 ракурса (~$0.80)»; перевод на облик v002 → 13 кадров stale → предпросмотр s002:
  проблема листа со ссылкой на `?sheet=you@powder-monkey-11`, в API `canon.issue = sheet_outdated`. Ошибок в
  журнале и консоли нет. Частичное устаревание и перевод при смене стиля и облика (хвосты M5.9, M5.10) — проверены.
- Проверки: pytest 567 (+1), ruff, mypy; vitest 572 (+2), oxlint, `build`, `typegen:check`, `tokens:check`; e2e —
  переснят `12-canon-characters` (строка Капитана), остальные эталоны без изменений.
- Открытым остаётся одно: `jq` в WSL (`sudo apt install jq`) — ставит пользователь; задания M6 пишутся без `| jq`.

### 54. M6.1 — Кадр как ассет: версии, выбранная версия, миниатюры (2026-10-22, ветка `m6-generation`)

Решения пользователя при плане: новый кадр импорта — `todo` (`queued` с M6.3 значит «джоб в очереди»); вернувшийся
в план кадр с картинкой — `stale` с причиной «сверьте её»; ручная правка (`edit_stale`) — по тому же признаку «есть картинка»;
замок project.json — пока в версиях кадра, PATCH и импорт — в M6.2.

- **Версии кадра** (`pipeline/images/shot_assets.py`, контракт — новый `docs/generation.md`): файл
  `media/<кадр>/vNNN.<ext>` новым файлом (`atomic.write_bytes_new`, link без перезаписи), расширение — по сигнатуре
  (`image_mime`), номер — после последнего на диске и в `assets`; миниатюры webp 160/320 сразу, нет — при запросе;
  строка `assets["img-<кадр>-v<N>"]` с `model`, `seed`, `variant`, `usd_micro`, `created_at`, `cached`.
  `ShotState.image_version` — выбранная; первая выбирается сама, выбор — `done` и сброс причин; `Project` не
  пропускает `image_version` без своего ассета. Запись — под `atomic.update_lock` (L-049).
- **API** `api/shots.py`: `GET …/shots/{id}/images` (новые сверху), `POST …/{v}/choose`, `…/{v}/thumb?w=160|320`,
  `…/{v}/file` — `immutable`; 404 по-русски (выпуск, план, кадр не из плана или убран, версия не этого кадра), 422 ширины.
- **Правило `stale`** (хвост M5.2, раздел 43): кадр без выбранной картинки не становится `stale` ни от плана, ни от
  перевода канона, ни от конфликта с блокировкой — статус прежний, причины копятся в `stale_reasons` историей без
  повторов, в отчёте `stale: false`. Признак картинки — `has_image` (`image_version`), один для мёрджа и правки.
- **Тесты:** фикстура `draw` в `conftest.py` кладёт версию тем же кодом, что джоб; тесты, которые раньше изображали
  картинку записью `status: done`, рисуют через неё (импорт, канон, правки, мост).
- **Живая проверка** ($0, uvicorn на временном каталоге, версии положены `add_image_version` из скрипта): две версии
  (PNG, JPEG) → 2 файла и 4 миниатюры; список с метаданными, новые сверху; `thumb?w=320` — webp, `immutable`; `file` —
  `image/jpeg`, байты совпали; выбор 2 → `done`, `image_version: 2`; 404 и 422 с текстами; импорт v2 — s008 с
  картинкой `stale`, s002 без картинки `todo` с причиной в истории.
- Проверки: pytest 581 (+14), ruff, mypy, `typegen:check`; фронт — `typegen`, `build`, oxlint, тест типов (поля
  новые и необязательные — экраны не тронуты).

### 55. M6.2 — Джоб кадра `shot_image`: сборщик → шлюз → версия (2026-10-22, ветка `m6-generation`)

Решения пользователя при плане: (A) новая версия у `stale`-кадра выбирается сама, как у кадра без картинки — у
`done` ждёт человека; (B) без вечного ключа идемпотентности: занятый кадр — 409, повтор после `done` находит версию
по хэшу; (C) отмена не стартовавшего джоба — колбэк `HandlerSpec.on_cancel`.

- **Заказ** (`pipeline/images/shot_job.py`, `POST …/shots/{id}/generate {model?}`): план утверждён (текущая
  версия), кадр в действующем плане, сборщик без `problems` (409 с адресатами `canon`), модель из каталога (422),
  кадр не занят (409 с `job_id`), бюджет до очереди (409 `BudgetRefusal`). Payload — `ShotOrder` с запросом целиком.
  Сборщик получил `variant` (N ≥ 2 меняет только seed) и `model`; вариант 1 — хэш предпросмотра.
- **Джоб** (`jobs/handlers/shots.py`): `queued` → `generating` → версия; тот же хэш среди версий — `exists` без
  вызова; шлюз `cached`/`charged` — версия жёсткой ссылкой на файл шлюза (`atomic.link_new`, L-042). Отказ модели,
  `RouteError`, бюджет в момент вызова — `failed` с причиной в новом `ShotState.error`, без повтора; сеть — повтор
  очереди. `Asset.model_id` рядом с ключом модели.
- **Gemini:** категория фильтра (`safetyRatings` с `blocked`) по-русски в тексте отказа.
- **Каталог:** `label` у моделей `images`, `GET /api/providers/catalog/{stage}` — подписи, цены единицы из
  `pricing.yaml`, ключ профиля по умолчанию.
- **Вне плана:** в журнале не было кадра — миграция `011_ledger_shot.sql`, `cost_ledger.shot_id` (только у вызова
  выпуска); замок `update_lock` — у PATCH, импорта и утверждения (хвост M6.1, L-049); `FakeProvider` отдаёт
  настоящий PNG (L-050).
- **Живая проверка:** $0 — сервер с `JOB_WORKERS=0` на временном каталоге: каталог с ценами $0.034/$0.067/$0.101/
  $0.134, 409 «не утверждён», 422 модель, 404 кадр, 201 `queued` → 409 занят → отмена → `todo`, 409 бюджет, 409
  проблема листа с адресатом. Платно ($0.067, `-m live -k shot_image`, с согласия): кадр s002 — версия 1 `.jpg`
  (Nano Banana 2 тоже отдаёт JPEG), строка `charged` с кадром, повтор — `exists`.
- Проверки: pytest 599 (+18), ruff, mypy, `typegen:check`; фронт — `typegen`, `build`, oxlint.

### 56. M6.3 — Пачка кадров: смета и бюджет суммой, пауза, отмена, параллельность (2026-10-22, ветка `m6-generation`)

Решения пользователя при плане: D-1 — новая текущая версия плана отменяет `queued` джобы кадров, заказ помнит версию
плана; принято без возражений: пачка на паузе — выпуск `generating`; кадр в незаконченной работе — 409 на всю пачку;
`stale`-кадр после пачки — `warning`; отдельный джоб кадра тоже ведёт статус выпуска.

- **Пачка** (`pipeline/images/batch.py`, `api/batches.py`): выбор (без `shots` — без картинки и `stale`, `redraw` —
  следующий вариант), пропуски с причиной и адресатами, смета `…/generate/estimate`, постановка — занятость и бюджет
  суммой и запись пачки с джобами в одной `BEGIN IMMEDIATE` (409 с суммой, `refused`, джобов 0; гонка двух пачек —
  проходит одна); пауза, продолжение, отмена (`queued` → `cancelled`, начатые дорисуются), «Повторить упавшие» (отказ
  модели без правки — только явно, иначе предупреждение).
- **Очередь** (миграция `012_batches.sql`, раздел «пачки» в `jobs/queue.py`): `claim` пропускает пачки на паузе (флаг
  в БД — переживает перезапуск), `BatchSummary` с оценкой времени, событие `batch.updated` в той же транзакции; пул —
  `HandlerSpec.max_parallel` (у `shot_image` — `IMAGES_PARALLEL`, общий пул делится), `on_finish` после конца джоба.
- **Статус выпуска** (`pipeline/images/status.py`): идёт работа — `generating`, иначе `ready`/`warning`; возврат в
  `script` — `queued`.
- **D-1:** импорт новой текущей версии снимает очередь кадров (`cancel_for_new_plan`); `ShotOrder.plan_version` —
  версия, нарисованная по прежнему плану, сама не выбирается.
- **Вне плана:** SQL пачек — в `queue.py`, не в отдельном модуле (одна транзакция с джобами, без цикла импорта);
  `Money` и форматтеры — в листе `cost/money.py` (цикл `queue` → `pricing` → `providers` → `worker`, L-051); общее
  окружение тестов генерации — `tests/episode_env.py`, `mypy_path` += `tests`; миграция — `012` (`011` занят M6.2).
- **Живая проверка** ($0, временные `STUDIO_DATA_DIR` и `CONFIG_DIR`, `images` → `fake`, 1 воркер): смета 20 ×
  $0.067 = $1.34 → пачка → пауза сразу: 1 дорисован, 19 ждут → перезапуск uvicorn → пауза на месте, 19 в очереди →
  продолжить → 20 из 20, 20 версий, выпуск `ready`, потрачено $1.34. Нашлось: на паузе оценка времени — `null`.
- Проверки: pytest 616 (+17), ruff, mypy, `typegen:check`; фронт — `typegen`, `build`, oxlint.

### 57. M6.4 — Перерисовка и версии: вариант, «Добавить версию», выбор, «С правкой…» (2026-10-22, ветка `m6-generation`)

Решение пользователя при плане: E-1 — новая версия сама выбирается и у `stale`-кадра (как решение A в M6.2), в том
числе после «С правкой…»; задание писало «только у кадра без выбранной» — уточнение записано в `docs/tasks/M6.4.md`.

- **`POST …/shots/{id}/redraw {model?, prompt?}`** — «Перерисовать», «Добавить версию», «С правкой…»: следующий
  свободный вариант (`shot_job.next_variant` — версии и `queued`/`running` джобы кадра; два клика подряд — 2 и 3),
  ставится и при незаконченном джобе кадра; бюджет до очереди. `GET …/redraw/estimate` — вариант и цена до клика.
- **«С правкой…»**: логика PATCH правок вынесена в `api/projects.py → patched_project` (без записи); правка
  проверяется стоп-листом и на пустоту (422 с токеном), заказ собирается по поправленному кадру, бюджет — и только
  потом правка пишется, так что отказ ничего не оставляет. У `failed` кадра `error` снимает только удача.
- **Пачка `redraw`** — тот же `next_variant`.
- **Живая проверка** ($0, `images` → `fake`): кадр → v1, v2, v3 (варианты 1–3, разные seed) → выбрана v1 → выбор v2 →
  `image_version = 2`, три файла на месте; «С правкой…» с «cinematic lighting» — 422 по-русски, `project.json` цел.
- Проверки: pytest 626 (+10), ruff, mypy, `typegen:check`; фронт — `typegen`, `build`, oxlint.

### 58. M6.5 — Сходство лица: YuNet + SFace, фас облика, `consistency_low` (2026-10-25, ветка `m6-generation`)

Решения пользователя при плане: фикстуры — новые картинки нашим Gemini (вариант «а»), на тесты до $1–2; `low` у
выбранной версии — `warning` выпуска уже в M6.5 (решение 5 устава, `pipeline/images/status.py`).

- **Проверка** — `pipeline/checks/face.py`: YuNet + SFace из `opencv-python-headless`, CPU, без torch; эталон —
  выбранный фас листа (как `anchor_refs`), кэш эмбеддинга по sha256 файла; лица кадра ≥ `min_face_px` (48 px на
  кадре ≤ 1280); лучшее косинусное сходство на облик; статусы `ok`/`low`/`no_face`/`skipped` с причинами. Не бросает:
  нет весов, битые веса, сбой — `skipped`, предупреждение в журнал один раз. Веса — один раз на процесс (0.5 с),
  ~0.1 с на кадр.
- **Контракт** — `Asset.checks.face` (`FaceCheck`, `FaceMatch`), пишется вместе с версией одной записью
  (`Drawing.checks`); у кадра без обликов `checks` нет. `ShotOrder.appearances` — облики кадра в заказе.
- **`shot_check`** + `POST …/shots/{id}/check` — бесплатная перепроверка выбранной версии (`pipeline/checks/
  shot_check.py`, `shot_assets.set_checks` под замком): 404 без картинки или выбора, 409 без персонажей.
- **Веса** — `config/checks.yaml` (URL opencv_zoo + зеркало Hugging Face, sha256 сверены по обоим, MIT / Apache
  2.0), `app.tools.fetch_models` → `data/models/` через временный файл; повтор ничего не качает (29 с и 3 с вживую).
- **Порог 0.47** подобран на `tests/fixtures/faces/` (8 картинок, наш Gemini, $0.80 = 4 × Pro 1K + 4 × nb2): свой
  0.53–0.77, чужой в кадре 0.35–0.42; 0.363 из доков SFace на рисованных не работает (L-052).
- **Живая проверка** (временные данные, фейковый маршрут, $0): без весов — `skipped` с подсказкой, джоб `done`;
  веса подложены без перезапуска — перепроверка `no_face` на шуме фейка; версия s002 с картинкой B вместо облика A —
  `low` 0.351, кадр `done`, стадия `generate`; версия с A в сцене — `ok` 0.632; 404/409 по-русски.
- Проверки: pytest 651 (+25) и `-m models` 10, ruff, mypy, `typegen`, `typegen:check`, `build`.

### 59. M6.6 — Анахронизмы через VLM: этап `check`, `anachronism_suspect`, выключатель (2026-10-25, ветка `m6-generation`)

Решение пользователя при плане: модель — `gemini-3.5-flash-lite` (GA, без даты отключения, замена 3.1 по
deprecations; $0.30 / $2.50 за 1M, сверено на ai.google.dev 2026-10-25). Сессия шла без `/clear` после M6.5.

- **Провайдер** — вид запроса `vision` (`VisionRequest`: текст, `ImageRef`, схема, лимит; единицы `token_in/out`),
  Gemini — JSON-ответ по `response_json_schema`, `media_resolution`/`thinking_level`/`max_output_tokens` из
  маршрута, расход по `usage_metadata`; шлюз пускает картинку вопроса только из своего выпуска, в хэш — её sha256,
  ответ — файл `.json` и кэш. Фейк — очередь `answers`.
- **Проверка** — `pipeline/checks/anachronism.py`: вопрос по шаблону `anachronism_check.md` (`task: check`),
  строгий разбор `{"found": [строки]}` (иначе `failed`), сверка с `forbidden` через rapidfuzz WRatio ≥ 70
  (формулировкой канона, чужое — в журнал); `checks.anachronism {status ok|suspect|failed|off, found, period,
  usd_micro, reason}` второй записью после версии, по миниатюре 320.
- **Деньги** — `ShotOrder.check` при постановке, `order_cost` = картинка + вопрос; пачка — сумма цен заказов
  (`sum_costs`, L-053); строки журнала этапа `check`; перепроверка той же версии — `cached` $0.
- **Выключатель** — `profile.checks.anachronism` (нет поля — включено), `PATCH /api/channels/{id} {checks}`; выключено
  при постановке или после — `off` без вызова. Перепроверка платная при включённой, 409 только «нет персонажей и
  выключено» (хвост M6.5 закрыт); `off` при перепроверке не затирает прежний результат версии; `suspect` у
  выбранной — `warning`; выбор версии пересчитывает статус.
- **Живой тест** `-m live -k vision_check`: настоящая модель на `no_face.jpg` со списком «cannon, smartphone,
  plastic bottle» — `{"found": ["cannon"]}`, 400 / 17 токенов, $0.000163 (два прогона ≈ $0.0003); ключ видит модель.
- **Живая проверка** (фейковый маршрут, $0): выключено — `off`, цена кадра $0.067, строк `check` нет; PATCH on —
  `ok`, цена 68 067 µ$, строки `check` с кадром; перепроверка — `cached` $0; 409 и 422 по-русски.
- Проверки: pytest 680 (+29), ruff, mypy, `typegen:check`, `build`, oxlint.

### 60. M6.7 — Экран «Генерация»: полоса очередей, канон выпуска, сетка кадров, заглушка голоса (2026-10-26, ветка `m6-generation`)

Решения пользователя при плане (Д1–Д5): моки артборда 4 — по запросу теста (`api.generateArtboard()`), план «Пиратов»
по умолчанию — артборда 3 (L-054); пачка выпуска — из снимка джобов; «параллельно N» — `jobs.running`; статус-строка
— «N кадров не удались: …», а не «с отказом фильтра»; плитки — из project.json, а не 104 запроса версий.

- **Экран 4** (`screens/generate/`): шапка «104 кадра, 8 разделов»; полоса 72 (`QueueStrip`: «Кадры: 78 из 104»,
  остаток, прогресс готово/рисуется, смета, параллельно, ошибки, пауза и продолжение, отмена через `Dialog`); канон
  выпуска 280 только для чтения (`CanonSide`: стиль и эпоха с версиями, облики с фасом листа, «лист не собран»
  пунктиром); сетка (`ShotGrid`, `ShotTile`, `grid.ts`): прилипающие разделы со сводкой, 5/6/8 в ряд, миниатюра 320,
  глиф, точки версий, причина сбоя; «Голос» 320 — заглушка M7. Состояния: плана нет, план не утверждён — ссылка на
  экран 3; до первой пачки — «Сгенерировать N кадров (~$X)» по смете бэкенда, отказ — текстом; остались кадры без
  картинки — то же действие в шапке.
- **Живые данные**: `sse.ts` слушает `batch.updated` (`StreamEvent`), `live.ts` кладёт сводку в кэш без перезапроса,
  переход джоба `shot_image` раз в секунду перезапрашивает project.json (точно) и смету; запросы — `useEpisodeBatch`,
  `useGenerateEstimate`, `useGenerate`, `useBatchAction`, `shotThumb`. Подписи джобов `shot_image`/`shot_check`.
- **Вне плана:** `refState`, `sheetLabel`, `SHEET_STATUS` переехали в `screens/script/canonLinks.ts` (общие с экраном 3);
  `estimates.shotsUsd` убран из заглушек; L-036 свёрнут в архив (файл ≤ 150 строк).
- **Живая проверка** ($0, временные данные, `images` → `fake`, 1 воркер, план из 104 кадров): «План не утверждён» →
  утверждение → «Сгенерировать 104 кадра (~$6.97)» → пауза на 3 кадрах (2.5 с — по-прежнему 3) → перезагрузка —
  «на паузе» → продолжить — полоса и миниатюры растут → отмена через диалог (87 в очереди → 84 `todo`) → «Сгенерировать
  84 кадра (~$5.63)» в шапке → 104 из 104, расход в шапке $0 → $6.97; ⌥1/⌥3; 5/6/8 колонок на 1536/1920/2560.
  Сетка 104 плиток после перезагрузки — 590 мс до последней плитки, долгих задач нет: виртуализация не нужна. 409 у
  миниатюр фаса — листы тестового окружения пишутся заглушками байтов, не картинками.
- Проверки: vitest 595 (+23), oxlint, `build`, `typegen:check`, `tokens:check`. e2e не гонял: эталон 04 переснимается в M6.12.

## Дальше

Модуль **M3** закрыт 2026-09-29 (разделы 19–28), тег `m3`. Модуль **M4** закрыт 2026-10-13 (разделы 29–41), тег `m4`,
PR #4 и #5 `m4-script-bridge` слиты в `main`. Модуль **M5 «Канон»** закрыт 2026-10-21 (разделы 42–53), тег `m5`,
ветка `m5-canon`.

1. **M6 «Генерация» составлен 2026-10-21:** `docs/tasks/M6.md`, двенадцать этапов `M6.1`…`M6.12`, ~44 ч, ветка
   `m6-generation` от `m5-canon`. Решения пользователя: панель «Голос» экрана 4 — заглушка до M7; лицо — локально
   (OpenCV YuNet + SFace, MIT и Apache 2.0, $0), анахронизмы — VLM Gemini Flash-Lite по `forbidden` с выключателем в
   профиле канала, только пометки; «Сделать опорным» и «Смягчить промпт через Claude» — вне M6; ручная приёмка — с
   настоящим Gemini, ~$2–3. Хвосты M6 ниже вошли в этапы. `M6.1`–`M6.4` закрыты 2026-10-22 (разделы 54–57),
   `M6.5`, `M6.6` — 2026-10-25 (разделы 58–59), `M6.7` — 2026-10-26 (раздел 60). **Следующая сессия — `M6.8`**
   (выбор кадров и действия, Sonnet), стартовая фраза — в `docs/tasks/M6.md`. Claude Code — в `~/projects/studio`.
2. К API-сессии (когда будет ключ): кэш ответов LLM, мышление Opus 5.5, `ANTHROPIC_API_KEY`.

Хвосты со своим модулем:
- M6 (все вошли в этапы `docs/tasks/M6.md`): проверка консистентности кадров (черновик `B2A.5`); «104 кадров» в заглушке «Генерации»; `drawn_at`/`price`
  и `changed` в отчёте импорта; правка кадра после утверждения, новая версия на поздних стадиях (и кнопка
  утверждения на них), смета без вычета сделанного, сходство после правок (разделы 34, 38); скорость JSON-редактора
  на плане ~4 500 строк — ~180 мс на символ, виртуализация строк подсветки (раздел 41, решение пользователя
  2026-10-21). Из M5: анахронизмы на готовых кадрах (раздел 45); профиль качества — по умолчанию, выбор на пачку и кадр (раздел 46); привязка ассета к кадру
  при попадании в кэш (раздел 46, L-042).
- M6 из M6.1–M6.4 (разделы 54–57): **M6.9** — выбор версии старого запроса — `done` без сверки хэша с текущим
  запросом: показать в «Сравнении версий», какая версия соответствует действующему плану и канону; статус кадра
  при нескольких перерисовках в очереди: первая готовая ставит `done`, пока остальные ждут; **M6.11–M6.12** — мок
  `mocks/api.ts` ещё ставит новым кадрам плана артборда 3 `queued` и делает `stale` кадры без картинки при переводе
  канона, а экран 3 показывает `stale_reasons` — у кадра без картинки там теперь история (пачки, `generate` и
  `batch.updated` мок и `sse.ts` знают с M6.7);
  **M6.11** — `drawn_at`/`price` в отчёте импорта по-прежнему `null`; правка кадра на экране 3 во время пачки:
  `queued` джоб кадра рисует прежний промпт (новая версия плана очередь снимает, правка — нет). Закрыто в M6.2–M6.3:
  замок у PATCH и импорта; перерисовка `stale`-кадра выбирает новую версию сама; заказ до новой версии плана —
  очередь снимается, версия старого плана сама не выбирается (D-1); пачка с суммой, отмена, «Повторить упавшие».
- M6 из M6.5–M6.6 (разделы 58–59): **M6.10** — «Подозрительные» сортируют по `score`; у `no_face`/`skipped` его
  нет — в конец; `anachronism_suspect` со списком `found`; пока вопрос идёт, у версии нет `checks.anachronism` —
  «проверяется»; выключатель VLM — `PATCH /api/channels/{id} {checks}`; мок `mocks/api.ts` не знает `checks` и
  `ChannelProfile.checks`. **M6.8** — цена кадра в кнопке включает вопрос к VLM (`BatchEstimate.unit`; кнопка пачки
  M6.7 берёт `total` — сумму заказов). Известный предел порога: фронтальные портреты разных людей на одном фоне —
  0.52 (выше 0.47). Версия, найденная по хэшу (`exists`), не перепроверяется. OpenCV 5 при загрузке весов дважды
  пишет в stderr `setPreferableTarget Targets are not supported by the new graph engine` — шум, не наш журнал.
  Расхождение задания: `uv run python -m app.tools.fetch_models` без `PYTHONPATH=backend` не находит `app` (L-013),
  в `CLAUDE.md` и доках — с ним, как у `seed`.
- M6 из M6.7 (раздел 60): **M6.8** — наведение, выбор, «Перерисовать», «С правкой…», «Открыть в монтаже» у плиток;
  клавиши R и V; плитки берут причину сбоя из `ShotState.error`. **M6.12** — эталон 04 снимать с
  `api.generateArtboard()` (L-054), `e2e/events.ts` научить `batch.updated`. Пачка выпуска на экране — последняя с
  джобом кадра в снимке `GET /api/jobs` (200 последних): после большой чужой пачки её не видно — понадобится
  `GET /api/projects/{id}/batches`. «Свет и оптика» артборда в канон выпуска не вошли: в `GET …/canon` их нет. Ширина
  панелей перетаскиванием — задача оболочки (ни на одном экране её нет).
- M7: `static` с `strength > 0`. M8: длительность перехода в таблице и инспекторе (раздел 33); удалённый id
  генерации (Veo, ElevenLabs, Kling) сохранять до начала опроса (принципы 7, 8); ключ Gemini не видит модели Veo
  каталога `animate` (`veo-3.1-*-generate-preview`, `-m live -k "key_is_accepted and gemini"` падает 2026-10-22) —
  сверить ID при выборе пути анимации. M9: fps пресета вместо
  `PREVIEW_FPS = 30`. M11: `voice_quota` на экране 1, подвал окна горячих клавиш.


## Как смотреть прототипы

Открыть любой `design/Studio - *.dc.html` в браузере. Шрифты (IBM Plex Sans,
IBM Plex Sans Condensed, Courier Prime) грузятся с Google Fonts — нужна сеть.
Карта переходов и указатель на файлы передачи — экран 11 (`Studio - 11 Прототип и передача.dc.html`).
