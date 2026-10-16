# Сборка запроса картинки кадра

Контракт M5.5 (принцип 13; устав M5, решение 7). Код — `backend/app/pipeline/images/prompt_builder.py →
build_shot_request`, тексты секций — общие с листом опорных портретов (`pipeline/canon/anchors.py`: `style_block`,
`period_block`, `appearance_block`, `negative`), настройки — `config/canon.yaml → shots`. Предпросмотр —
`GET /api/projects/{id}/shots/{shot_id}/prompt` (`api/plan.py`), модель ответа — `ShotPrompt`, TS — `@/types/plan`.

Итоговый запрос кадра — промпт, negative, референсы, seed — собирает **код**. LLM пишет только `shot.image.prompt`:
что происходит, композицию, ракурс. Как это выглядит, задаёт канон канала в версиях, к которым прибит выпуск
(`canon_ref` плана, M5.2). Порядок секций и разделители меняются только с записью здесь и в `docs/LESSONS.md`.

## Порядок и разделители

| # | Секция (`kind`) | Источник (`source`) | Шапка в промпте | Текст |
|---|---|---|---|---|
| 1 | `style` | `style/vNNN` из `canon_ref` | `Rendering:` или `Rendering (style reference images 9–10):` | стиль целиком |
| 2 | `period` | `periods/<эпоха>/vNNN` эпохи кадра | `Era:` | эпоха целиком |
| 3 | `appearance` — по облику, в порядке `shot.image.appearances` | `characters/<персонаж>/vNNN#<облик>` | `Person 1 (reference images 1–4):` | облик |
| 4 | `action` | `shot` | `Action: <shot.image.prompt>` | действие кадра действующего плана, с правкой человека |
| 5 | `shot_size` | `shot` | `Shot size: <строка крупности>` | `config/canon.yaml → shots.sizes` |

- Секции разделены **пустой строкой** (`\n\n`), без завершающего перевода строки. Внутри секций 1–3 — строки
  `- Поле: значение`; пустые поля пропускаются, списки — через `, `.
- **Стиль** (`style_block(full=True)`): `Technique` (`render`), `Material`, `Processing`, `Optics` (`focal, depth,
  distortion`), `Light` (`character, contrast, direction`), `Palette` (`rule; colours роль #hex, …`), `Grain`,
  `Composition`. Лист портретов берёт из стиля меньше — без оптики, света и композиции (`docs/canon_schema.md`).
- **Эпоха** (`period_block(full=True)`): `Place`, `Years` (`1714 to 1718`, один год — числом), `Palette shift`,
  `Materials`, `Light sources`, `Architecture`, `Clothing`, `Props`. `forbidden` в текст не идёт — он в negative.
- **Облик** (`appearance_block`): `Age`, `Face` (`nature.face; face` облика), `Build`, `Hair`, `Clothing`, `Wear`,
  `Props`, `Posture`, `Manner`, `Personality`. Подписи `label` в промпт не идут никогда — они по-русски, для экрана.
- **Номера референсов** в шапках — позиции в итоговом списке `refs`, с единицы: сначала ракурсы облика 1, затем
  облика 2, затем кадры стиля. Один референс — `(reference image 5)`, ни одного — шапка без скобок.
- Секция, чья версия канона не резолвится, в текст не попадает, а в `problems` появляется строка (ниже).

## Negative

`style.negative_global ∪ period.forbidden ∪ negative_local` каждого облика кадра — по слою, внутри слоя — как в
каноне. Повтор без учёта регистра выбрасывается, остаётся первое написание. Через `, `.

## Референсы

Только файлы канона канала (принцип 13): выбранные ракурсы листов обликов кадра и опорные кадры стиля. Других
референсов нет. Ракурсы и кадры стиля по крупности (`config/canon.yaml → shots.sizes`):

| Крупность | Строка `Shot size` | Ракурсы листа (каждого облика) | Кадры стиля |
|---|---|---|---|
| `establishing` | wide establishing shot, the place reads first, people small in the frame | фас, в полный рост | общий план, толпа |
| `action` | medium-wide shot of the action, whole figures readable | фас, три четверти, в полный рост, в действии | общий план, портрет |
| `reaction` | close shot on the face and shoulders, the emotion readable | фас, три четверти, профиль | портрет, ночь |
| `detail` | close-up of the object or the hands in the action | фас, деталь | деталь, портрет |

- Ракурс берётся из `chosen.json` листа облика, файл должен быть на месте. Лист не готов — проблема (ниже), ракурсы,
  что есть, показываются.
- **Кадр стиля** подаётся, если выбран, файл на месте, сделан **в эпохе кадра** (`canon.period` в `chosen.json`) и не
  устарел против прибитой версии стиля (рендер, оптика, свет — `anchors.STYLE_FIELDS`). Иначе — предупреждение в
  `warnings`, рисовать оно не мешает: кадры стиля другой эпохи потянули бы её содержание в кадр.
- **Лимит модели** — `max_refs` маршрута `images` (`config/providers.yaml`, у Gemini 3 — 14). Если референсов больше:
  1. уходят кадры стиля, с последнего;
  2. уходят ракурсы сверх фаса — с последнего облика к первому, внутри облика с конца;
  3. фас не уходит никогда: не помещаются даже фасы — проблема «обликов в кадре N, а модель M принимает
     референсов не больше L — даже фасы не помещаются, уберите облик из кадра».

  Ушедшие — в `dropped` с причиной. Номера в шапках считаются после отбора.

## Seed, запрос и хэш входов

- **Seed** — `seed_of(выпуск, кадр, ссылки canon_ref кадра…, действие)`: sha256, 31 бит. Те же входы — тот же seed;
  смена версии канона или правка действия — другой.
- **Запрос** — `ImageRequest{prompt, negative, canon, refs, seed, aspect_ratio}`: `canon` — `{"style": …, "period":
  …, "appearance:<облик>": …}`, `refs` — `{path от data/, sha256}`, соотношение — `shots.aspect_ratio` (16:9).
- **Маршрут** — этап `images` профиля по умолчанию (`config/providers.yaml`); выбор профиля и модели на пачку — M6.
- **Хэш входов** — `input_hash(route, request)` шлюза (`docs/providers.md`, «Кэш по хэшу входов»): ключ кэша кадра
  M6. Смена версии стиля, эпохи или облика, правка действия, другой файл референса — другой хэш.
- Есть проблемы — запроса и хэша нет (`input_hash: null`): рисовать такой кадр нельзя.

## Проблемы и предупреждения

`problems` — что мешает рисовать, по-русски с id кадра; это не исключение и не 500:

- `кадр s001: эпоха periods/caribbean-1716/v009 не найдена в каноне cursus` — ссылка не резолвится (тексты
  `canon_store`, `docs/canon_schema.md`, «Ссылки из плана»);
- `кадр s002: облика you@powder-monkey-11 нет в canon_ref плана — импортируйте план заново`;
- `кадр s008: у облика bosun@caribbean-1716 нет листа опорных портретов — соберите его на экране «Канон»`,
  `… лист облика … 3/6 — выберите недостающие ракурсы …`, `… лист облика … устарел — пересоберите его …` — лист
  против прибитой версии облика, как в воротах «Утвердить план»;
- `кадр s002: в действии стилевой токен «cinematic lighting» (lighting) — стиль задаёт канон, опишите только
  действие, композицию и ракурс` — стоп-лист `config/prompt_stoplist.yaml`, тот же `find_style_tokens` (M2.2);
- не помещаются фасы (выше).

`warnings` — что не попало в запрос, но рисовать не мешает: кадра стиля нет, он другой эпохи или устарел.

## Предпросмотр — `GET /api/projects/{id}/shots/{shot_id}/prompt`

Кадр действующего плана (версия плюс правки). Ответ `ShotPrompt`:

| Поле | Что |
|---|---|
| `sections[]` | `{kind, source, label, text}`; у правленого действия `label` — «Действие — правка человека» |
| `text`, `negative` | итоговый промпт и negative |
| `refs[]`, `dropped[]` | `{kind: anchor \| style_frame, owner, slot, label, file, sha256}`; у ушедших — `reason` |
| `seed`, `aspect_ratio` | |
| `model`, `cost`, `usd` | маршрут `images` профиля по умолчанию; цена кадра по `gateway.estimate`, `usd` — до десятых цента |
| `input_hash` | ключ кэша кадра; `null` при проблемах |
| `problems`, `warnings` | выше |

Плана нет — 409, кадра в действующем плане нет — 404 «Кадра s999 в действующем плане выпуска нет.». Ничего не
пишется и не оплачивается.

## Три примера

Фикстура `tests/fixtures/director_canon_20shots.json`, канон `tests/fixtures/canon/` (стиль, Карибы 1716,
`you@powder-monkey-11`, `bosun@caribbean-1716`, все v001), листы 6/6 и кадры стиля Карибов. Тексты получены
сборщиком, не написаны руками.

### 1. Один персонаж — `s002`, `action`

```
Rendering (style reference images 5–6):
- Technique: painterly digital illustration with the restraint of a museum diorama
- Material: matte surfaces, visible texture on wood, rope and cloth, no plastic sheen
- Processing: gentle contrast curve, slightly lifted blacks, no halos or oversharpening
- Optics: 35mm equivalent at eye level unless the shot asks otherwise, moderate depth of field, background readable but soft, none, verticals stay straight
- Light: motivated light from the period's own sources, medium-low, shadows keep their detail, one dominant side light, soft fill from the environment
- Palette: earthy base with one restrained accent per frame; colours shadows #2b2118, base #8a6a45, highlights #e8d8b5, accent #9e2b25
- Grain: fine even film grain across the frame
- Composition: one clear subject on the thirds, horizon never through the middle

Era:
- Place: Caribbean Sea: Bahamas, Jamaica and the Spanish Main
- Years: 1714 to 1718
- Palette shift: sun-bleached canvas, tarred black timber, turquoise shallows
- Materials: oak and pine planking caulked with oakum and pitch, hemp rope, flax sailcloth, wrought iron, brass fittings, vegetable-tanned leather
- Light sources: tropical sun, tallow candles, horn-paned lanterns, galley cooking fire
- Architecture: square-rigged sloops and brigantines, timber wharves on pilings, whitewashed stone forts with embrasures
- Clothing: loose linen shirts, canvas petticoat breeches, short wool jackets, tricorn hats, neckerchiefs, bare feet on deck
- Props: flintlock pistols, cutlasses, wooden buckets, powder kegs, leather cartridge cases, rope coils

Person 1 (reference images 1–4):
- Age: 11
- Face: narrow face, grey-green eyes, straight nose with a small bump, thin scar through the left eyebrow; boyish, sunburnt cheeks, the eyebrow scar still fresh
- Build: small and wiry
- Hair: dark brown, cropped short and uneven
- Clothing: oversized linen shirt, rolled canvas breeches, barefoot
- Wear: salt stains, torn shirt hem, black powder smudges on the hands
- Props: leather cartridge case
- Posture: alert, weight on the balls of the feet
- Manner: watches before acting, economical movements
- Personality: quiet, observant, quick to learn, dry sense of humor

Action: carries a leather cartridge case down the gun deck, glancing back over his shoulder

Shot size: medium-wide shot of the action, whole figures readable
```

- Источники: `style/v001`, `periods/caribbean-1716/v001`, `characters/you/v001#powder-monkey-11`, `shot`, `shot`.
- Референсы (6): `you@powder-monkey-11` — фас, три четверти, в полный рост, в действии (крупность `action`); кадры
  стиля — общий план, портрет. Отсюда «reference images 1–4» у облика и «style reference images 5–6» у стиля.
- Negative: 6 позиций `negative_global` стиля, 12 запретов эпохи, `adult beard, hat` облика.

### 2. Два персонажа — `s006`, `action`

Секции стиля и эпохи — те же, что в примере 1, кроме номеров в шапке: `Rendering (style reference images 9–10):`.
Облики идут в порядке `shot.image.appearances` — мальчик, затем боцман:

```
Person 1 (reference images 1–4):
- Age: 11
…  (как в примере 1)

Person 2 (reference images 5–8):
- Age: 40
- Face: broad flat face, broken nose, deep-set dark eyes, thick black eyebrows; weathered skin, grey stubble, a gold ring in one ear
- Build: barrel-chested and heavy-armed
- Hair: black hair going grey, tied under a red kerchief
- Clothing: sleeveless leather jerkin over a striped linen shirt, canvas breeches, bare feet
- Wear: tar-stained hands, frayed jerkin edges
- Props: bosun's whistle on a cord, knotted rope starter
- Posture: planted wide stance, shoulders forward
- Manner: points with the whole arm, never repeats an order
- Personality: loud, fair, quick to anger and quick to forget

Action: the bosun grabs the boy by the collar and drags him away from an open hatch

Shot size: medium-wide shot of the action, whole figures readable
```

- Референсы (10 из 14 допустимых): 4 ракурса мальчика, 4 ракурса боцмана, 2 кадра стиля.
- Negative: как в примере 1 и `officer's coat` боцмана. Его же `Hat` и `Text` выброшены — повторы `hat` облика
  мальчика и `text` стиля без учёта регистра.
- При лимите 5 (тест `test_ref_limit_drops_style_frames_then_angles_but_never_fronts`) уходят оба кадра стиля, затем
  у боцмана — в действии, в полный рост, три четверти. Остаются 4 ракурса мальчика и фас боцмана: шапки —
  `Rendering:` и `Person 2 (reference image 5):`. При лимите 1 — проблема: фасов два.

### 3. Без персонажа — `s004`, `detail`

Секций облика нет: `style` → `period` → `action` → `shot_size`.

```
Rendering (style reference images 1–2):
…  (стиль и эпоха — как в примере 1)

Action: a powder keg with its lid pried open, black grains spilled on the planks

Shot size: close-up of the object or the hands in the action
```

- Референсы (2): кадры стиля «деталь» и «портрет» — портретов нет, обликов в кадре нет.
- Negative: стиль и запреты эпохи, без `negative_local`.
