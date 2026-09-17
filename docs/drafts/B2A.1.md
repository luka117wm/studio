# B2A.1 — Схемы канона

**Блок:** B2A — Канон · **Оценка:** 4 ч · **Модель:** Opus · **План до кода:** да

## Цель
Стиль канала, период и персонаж с обликами описаны моделями, версионируются, и план эпизода не может сослаться на несуществующую версию.

## Читать
- `CLAUDE.md` — раздел «Данные: три уровня — три роли», принципы 13 и 14
- `backend/app/models/director.py`
- `backend/app/storage/paths.py`

## Создать / изменить
- `backend/app/models/canon.py` — `Style`, `Period`, `Character`, `Appearance`, `CanonRef`
- `backend/app/storage/canon_store.py` — чтение, запись новой версии, резолв ссылки `characters/you/v004#captain-35`
- `backend/app/models/director.py` — `canon` → `canon_ref`, в `Shot.image` поля `period` и `appearances`
- `docs/canon_schema.md`
- `tests/fixtures/canon/` — стиль Cursus, период `caribbean-1716`, персонаж `you` с 5 обликами
- `tests/test_canon.py`

## Не трогать
- `backend/app/pipeline/` — сборщик промпта в B2A.3

## Что сделать
1. `Style`: `render` (техника и материал изображения), `optics` (фокусное, глубина, дисторсия), `light` (характер, контраст, направление), `palette` (3–5 цветов с ролями), `grain`, `composition_rules`, `negative_global`.
2. `Period`: `id`, `label`, `region`, `years`, `palette_shift`, `materials`, `light_sources`, `architecture`, `clothing`, `props`, **`forbidden`** — обязательный непустой список анахронизмов (для 1716: очки в металлической оправе современного типа, спичечные коробки, вязаные шапки индустриального трикотажа, картофель в европейском рационе, кремнёвые замки неверного типа и так далее).
3. `Character`: `id`, `nature` (кто это, характер, осанка, манера — то, что не меняется), `appearances[]`.
4. `Appearance`: `id` вида `you@powder-monkey-11`, `period`, `age`, `build`, `face` (неизменяемые черты), `hair`, `clothing`, `wear_and_damage`, `props`, `negative_local`, `anchor_dir`.
5. Версионирование: `write_version()` создаёт следующий `vNNN.json`, существующие файлы иммутабельны. Резолв `characters/you/v004#captain-35` → конкретный `Appearance`.
6. `CanonRef` в director.json: `style`, `periods` (map), `appearances` (map). Валидация при импорте плана: каждая ссылка резолвится, иначе ошибка вида `кадр s047: облик you@captain-35 не найден в characters/you/v004`.
7. Одинаковые `face` у разных обликов одного персонажа — проверка на копипасту: если `face` расходится между обликами, предупреждение (это и есть источник «левых» лиц).
8. Фикстуры и тесты.

## Критерии приёмки
- [ ] `uv run pytest tests/test_canon.py -v` зелёный
- [ ] запись новой версии не трогает предыдущую (тест на иммутабельность)
- [ ] план со ссылкой на несуществующий облик не импортируется, сообщение содержит ID кадра и ID облика
- [ ] период без `forbidden` не проходит валидацию
- [ ] `docs/canon_schema.md` описывает все поля

## Команды проверки
```bash
uv run pytest tests/test_canon.py -v
uv run python -c "from app.storage.canon_store import resolve; print(resolve('cursus','characters/you/v004#captain-35').id)"
```

## Чего не делать
- не класть канон внутрь director.json
- не позволять правку старых версий
- не делать `forbidden` необязательным
