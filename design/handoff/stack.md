# Стек и структура

## Стек

- **React 19 + TypeScript** (strict). Функциональные компоненты, без классов.
- **Vite** dev-сервер и сборка; приложение локальное, ключи в системном хранилище
  (Electron/Tauri-обёртка опциональна, UI от неё не зависит).
- **Tailwind CSS v4** поверх `tokens.css`: токены подключаются как CSS variables и
  прокидываются в `@theme`, hex в классах не дублируется.
- **lucide-react**, иконка 16px, `strokeWidth={1.5}`.
- **Zustand** для состояния выпуска и очередей, **TanStack Query** для провайдеров.
- **react-virtuoso** для длинных списков (104 кадра, 1 284 операции).
- **ffmpeg** через локальный процесс; таймлайн и плеер — `<video>` + canvas-оверлей,
  без видеобиблиотек.
- Тесты: Vitest + Testing Library на состояниях (пустое, процесс, ошибка, конфликт).

## Tailwind: мост к токенам

```css
/* app.css */
@import './handoff/tokens.css';
@import 'tailwindcss';

@theme {
  --color-app: var(--bg-app);
  --color-panel: var(--bg-panel);
  --color-strip: var(--bg-strip);
  --color-raised: var(--bg-raised);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-ink: var(--text-primary);
  --color-muted: var(--text-secondary);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-warning: var(--status-warning);
  --color-failed: var(--status-failed);
  --font-ui: var(--font-ui);
  --font-dense: var(--font-dense);
  --font-script: var(--font-script);
  --radius-control: var(--radius-control);
  --radius-panel: var(--radius-panel);
}
```

Правила: никакого `text-sm`/`text-base` — только `text-[13px]/[18px]` из шкалы
11/12/13/15/18. Никаких произвольных отступов вне 4/8/12/16.

## Структура

```
src/
  app/            AppShell, TopBar, StageRail, StatusBar, routing
  screens/        episodes, ideas, script, generation, edit, export, publish, settings
  components/     ui/ (Button, Input, Select, Slider, Toggle, StatusBadge, Toast, Dialog)
                  domain/ (ShotCard, Timeline, ScriptSheet, PlanTable, RenderQueue, …)
                  states/ (EmptyState, ProcessCard, ErrorCard, ConflictBar)
  domain/         episode.ts, plan.ts, timeline.ts, money.ts, timecode.ts
  providers/      anthropic.ts, gemini.ts, elevenlabs.ts, kling.ts, youtube.ts, gateway.ts
  queue/          jobQueue.ts (параллельность, пауза, отмена, докачка, повтор по rate limit)
  styles/         app.css (импорт tokens.css + @theme)
```

## Доменные инварианты — в коде, не в UI

```ts
type ShotTimingSource = 'voice' | 'locked' | 'estimate';
// 'voice'    — длительность равна длительности реплики VO (по умолчанию)
// 'locked'   — пользователь зафиксировал, расхождение показывается warning
// 'estimate' — озвучки нет: длительность из текста (152 слова/мин), «черновой тайминг»
```

- Пересчёт таймлайна при изменении VO — чистая функция `retime(plan, voice)`.
- Каждое платное действие проходит через `estimateCost()` и возвращает строку цены
  для подписи кнопки; при превышении лимита — поведение из настроек
  (`ask` — диалог, `stop` — блокировка).
- Изменение плана после генерации помечает кадры `stale` с указанием, что изменилось;
  UI показывает `ConflictBar` до решения.
- Деньги — целые центы (`number` в центах), форматирование одной функцией
  `formatUsd`; время — `formatTimecode` (`00:00:00`).
- Тексты интерфейса — в одном модуле `strings.ru.ts`: одно действие = один ключ,
  из него и кнопка, и тост («Перерисовать» → «Перерисовано»).

## Порядок реализации

1. Оболочка + токены + UI-кит + каталог состояний (экран 10 как storybook).
2. Выпуски и календарь слотов.
3. Сценарий и план: три режима, мост через чат, валидация JSON, смета.
4. Генерация: очередь с паузой, версии кадров, канон.
5. Монтаж: таймлайн, retime по голосу, инспектор кадра.
6. Инспектор: анимация и SFX, мультивыделение.
7. Экспорт: пресеты, очередь ffmpeg, лог.
8. Публикация: метаданные, обложка, загрузка с докачкой.
9. Настройки: провайдеры, маршрутизация, бюджеты, расходы, каналы.
