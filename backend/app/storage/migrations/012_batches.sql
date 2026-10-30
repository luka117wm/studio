-- M6.3: пачка джобов выпуска — «Сгенерировать N кадров». Флаги паузы и отмены живут здесь, а не в
-- памяти: пауза переживает перезапуск бэкенда. Джобы ссылаются на пачку через jobs.batch_id (M2.5).
-- Контракт — docs/jobs.md, «Пачка».
CREATE TABLE batches (
    id                 TEXT PRIMARY KEY,
    episode_id         TEXT NOT NULL REFERENCES episodes(id),
    kind               TEXT NOT NULL,               -- вид джобов пачки: shot_image
    model              TEXT NOT NULL,               -- ключ каталога модели на пачку
    created_at         TEXT NOT NULL,
    paused             INTEGER NOT NULL DEFAULT 0,
    cancelled          INTEGER NOT NULL DEFAULT 0,
    estimate_usd_micro INTEGER NOT NULL,            -- смета суммой при постановке, кэш не вычтен
    parallel           INTEGER NOT NULL,            -- лимит вида при постановке: для оценки времени
    retry_of           TEXT REFERENCES batches(id)  -- «Повторить упавшие»: пачка-источник
);
CREATE INDEX batches_episode ON batches(episode_id, created_at);
